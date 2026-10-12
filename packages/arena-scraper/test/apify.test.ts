import assert from "node:assert/strict";
import test from "node:test";
import { ApifyAdapter } from "../src/contract.js";
import {
  APIFY_TOKEN_SECRET_REF,
  APIFY_TOKEN_VALUE,
  realNowMs,
  realSleep,
  secretResolverFor,
} from "./fixtures.js";
import { startApifyMockServer } from "./fixture-server.js";
import type { ApiConnectorDescriptor, ConnectorCallRequest } from "../src/contract.js";

/**
 * AR2-017 验收（issue #33）：Apify 适配器 —— 只对本地 mock server 运行；
 * 未配置 → 惰性（fail closed）；成本上限突破 → fail closed；401/429/5xx
 * 处理。绝不调用真实付费 API。
 */

function descriptor(overrides: Record<string, unknown> = {}): ApiConnectorDescriptor {
  return {
    schema_version: "SCRP1.0",
    descriptor_id: "apd_00000002",
    tenant_id: "tnt_00000001",
    adapter_id: "apify-adapter",
    adapter_version: "1.0.0",
    provider_id: "prv_00000009",
    approved_host_patterns: ["api.apify.com", "127.0.0.1"],
    approved_endpoint_patterns: ["^/v2/acts/.+/runs$"],
    approved_methods: ["GET", "POST"],
    request_schema: { schema_id: "sch_00000004", schema_version: "1.0.0" },
    credential_reference: { secret_ref: APIFY_TOKEN_SECRET_REF, scope: "apify:actor-run" },
    rate: { min_interval_ms: 0, max_concurrency: 1 },
    quota: { max_calls_total: 10 },
    cost: { currency: "USD", ceiling_amount: 1 },
    retry: { max_retries: 2, backoff_base_ms: 3, timeout_ms: 1000, ambiguity: "RECONCILE_SUPPORTED" },
    response_schema: { schema_id: "sch_00000005", schema_version: "1.0.0" },
    max_response_bytes: 1048576,
    max_items: 1000,
    retention_requirements: "dataset items retained per tenant policy",
    provenance_requirements: "record actor run id + usage",
    regions: ["GH"],
    required_entitlements: [],
    webhook: { used: false, signature_header: "x-signature", algorithm: "HMAC-SHA256", secret_ref: null, replay_policy: "n/a" },
    ...overrides,
  } as ApiConnectorDescriptor;
}

function callRequest(operationId = "op_apify_1", actor = "act-ok"): ConnectorCallRequest {
  return { operation_id: operationId, host: "127.0.0.1", endpoint: `/v2/acts/${actor}/runs`, method: "POST" };
}

function configuredAdapter(baseUrl: string): ApifyAdapter {
  return new ApifyAdapter({
    config: { adapter_version: "1.0.0", api_token_secret_ref: APIFY_TOKEN_SECRET_REF, base_url: baseUrl },
    secretResolver: secretResolverFor({ [APIFY_TOKEN_SECRET_REF]: APIFY_TOKEN_VALUE }),
    nowMs: realNowMs,
    sleep: realSleep,
  });
}

test("apify: never-configured adapter is inert (explicit configuration is mandatory)", async () => {
  const inert = new ApifyAdapter({
    config: null,
    secretResolver: secretResolverFor({ [APIFY_TOKEN_SECRET_REF]: APIFY_TOKEN_VALUE }),
    nowMs: realNowMs,
    sleep: realSleep,
  });
  assert.equal(inert.adapterVersion, "0.0.0");
  const outcome = await inert.call(descriptor(), callRequest());
  assert.equal(outcome.kind, "FAILED");
  if (outcome.kind === "FAILED") assert.equal(outcome.code, "SCRP_CONNECTOR_NOT_CONFIGURED");
  const reconciled = await inert.reconcile(descriptor(), "op_x", callRequest());
  assert.equal(reconciled.kind, "RECONCILE_UNSUPPORTED");
});

test("apify: run-list + dataset-store fetch happy path against the mock server", async () => {
  const mock = await startApifyMockServer({
    token: APIFY_TOKEN_VALUE,
    actors: {
      "act-ok": {
        pollsToSucceed: 2,
        usageTotalUsd: 0.01,
        datasetItems: [{ id: 1, title: "reference row" }, { id: 2, title: "another row" }],
      },
    },
  });
  try {
    const adapter = configuredAdapter(mock.baseUrl);
    const outcome = await adapter.call(descriptor(), callRequest());
    assert.equal(outcome.kind, "SUCCEEDED");
    if (outcome.kind === "SUCCEEDED") {
      assert.equal((outcome.body as unknown[]).length, 2);
      assert.equal(outcome.cost_amount, 0.01);
    }
    assert.equal(mock.postRunCount, 1);
    assert.equal(mock.bearerSeen, `Bearer ${APIFY_TOKEN_VALUE}`);
  } finally {
    await mock.close();
  }
});

test("apify: an invalid token surfaces as a credential failure (401)", async () => {
  const mock = await startApifyMockServer({
    token: "different-correct-token",
    actors: { "act-ok": { pollsToSucceed: 1, usageTotalUsd: 0, datasetItems: [] } },
  });
  try {
    const adapter = new ApifyAdapter({
      config: { adapter_version: "1.0.0", api_token_secret_ref: APIFY_TOKEN_SECRET_REF, base_url: mock.baseUrl },
      secretResolver: secretResolverFor({ [APIFY_TOKEN_SECRET_REF]: "wrong-token-value" }),
      nowMs: realNowMs,
      sleep: realSleep,
    });
    const outcome = await adapter.call(descriptor(), callRequest());
    assert.equal(outcome.kind, "FAILED");
    if (outcome.kind === "FAILED") assert.equal(outcome.code, "SCRP_CONNECTOR_CREDENTIAL_MISSING");
  } finally {
    await mock.close();
  }
});

test("apify: a 429 is retried once and then succeeds", async () => {
  const mock = await startApifyMockServer({
    token: APIFY_TOKEN_VALUE,
    rateLimitFirstN: { "act-ok": 1 },
    actors: { "act-ok": { pollsToSucceed: 1, usageTotalUsd: 0, datasetItems: [{ v: 1 }] } },
  });
  try {
    const adapter = configuredAdapter(mock.baseUrl);
    const outcome = await adapter.call(descriptor(), callRequest());
    assert.equal(outcome.kind, "SUCCEEDED");
    assert.ok(mock.postRunCount >= 2, "the 429 attempt plus the retry both hit the API");
  } finally {
    await mock.close();
  }
});

test("apify: persistent 5xx exhausts retries with a typed failure", async () => {
  const mock = await startApifyMockServer({
    token: APIFY_TOKEN_VALUE,
    actors: { "act-dead": { pollsToSucceed: 1, usageTotalUsd: 0, datasetItems: [] } },
    alwaysFail: { "act-dead": 1 },
  });
  try {
    const adapter = configuredAdapter(mock.baseUrl);
    const outcome = await adapter.call(descriptor(), callRequest("op_dead", "act-dead"));
    assert.equal(outcome.kind, "FAILED");
    if (outcome.kind === "FAILED") assert.equal(outcome.code, "SCRP_CONNECTOR_RETRY_EXCEEDED");
    assert.equal(mock.postRunCount, 3, "initial + 2 retries");
  } finally {
    await mock.close();
  }
});

test("apify: cost ceiling breach fails closed mid-run", async () => {
  const mock = await startApifyMockServer({
    token: APIFY_TOKEN_VALUE,
    actors: { "act-pricey": { pollsToSucceed: 1, usageTotalUsd: 5, datasetItems: [{ x: 1 }] } },
  });
  try {
    const adapter = configuredAdapter(mock.baseUrl);
    const desc = descriptor({ cost: { currency: "USD", ceiling_amount: 1 } });
    const outcome = await adapter.call(desc, { ...callRequest(), endpoint: "/v2/acts/act-pricey/runs" });
    assert.equal(outcome.kind, "FAILED");
    if (outcome.kind === "FAILED") assert.equal(outcome.code, "SCRP_CONNECTOR_COST_CEILING_EXCEEDED");
  } finally {
    await mock.close();
  }
});

test("apify: an oversized response is rejected against max_response_bytes", async () => {
  const mock = await startApifyMockServer({
    token: APIFY_TOKEN_VALUE,
    actors: { "act-ok": { pollsToSucceed: 1, usageTotalUsd: 0, datasetItems: [] } },
  });
  try {
    const adapter = configuredAdapter(mock.baseUrl);
    const outcome = await adapter.call(descriptor({ max_response_bytes: 1 }), callRequest());
    assert.equal(outcome.kind, "FAILED");
    if (outcome.kind === "FAILED") assert.equal(outcome.code, "SCRP_CONNECTOR_RESPONSE_INVALID");
  } finally {
    await mock.close();
  }
});
