import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import {
  ApifyAdapter,
  checkApiConnectorDescriptor,
  verifyConnectorWebhook,
  type ApiConnectorDescriptor,
  type ConnectorCallRequest,
} from "../src/contract.js";
import {
  APIFY_TOKEN_SECRET_REF,
  APIFY_TOKEN_VALUE,
  realNowMs,
  realSleep,
  secretResolverFor,
} from "./fixtures.js";
import { startApifyMockServer } from "./fixture-server.js";

/**
 * AR2-017 验收（issue #33）：ExternalApiConnectorPort 语义 ——
 * descriptor 校验、credential REFERENCE 往返（绝不携带值）、速率/配额/成本
 * 上限、timeout → UNKNOWN（非失败）、模糊结局按 operation identity 对账、
 * 重试上限、webhook 签名校验。全部通过本地 mock server（ApifyAdapter 作为
 * port 的具体实现）——绝不触达付费 API。
 */

function descriptor(overrides: Record<string, unknown> = {}): ApiConnectorDescriptor {
  return {
    schema_version: "SCRP1.0",
    descriptor_id: "apd_00000001",
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
    retry: { max_retries: 2, backoff_base_ms: 5, timeout_ms: 1500, ambiguity: "RECONCILE_SUPPORTED" },
    response_schema: { schema_id: "sch_00000005", schema_version: "1.0.0" },
    max_response_bytes: 1048576,
    max_items: 1000,
    retention_requirements: "dataset items retained per tenant policy",
    provenance_requirements: "record actor run id + usage",
    regions: ["GH"],
    required_entitlements: [],
    webhook: {
      used: false,
      signature_header: "x-signature",
      algorithm: "HMAC-SHA256",
      secret_ref: null,
      replay_policy: "n/a",
    },
    ...overrides,
  } as ApiConnectorDescriptor;
}

function callRequest(host: string, endpoint: string, overrides: Partial<ConnectorCallRequest> = {}): ConnectorCallRequest {
  return {
    operation_id: "op_00000001",
    host,
    endpoint,
    method: "POST",
    ...overrides,
  };
}

function adapter(baseUrl: string | null): ApifyAdapter {
  return new ApifyAdapter({
    config:
      baseUrl === null
        ? null
        : { adapter_version: "1.0.0", api_token_secret_ref: APIFY_TOKEN_SECRET_REF, base_url: baseUrl },
    secretResolver: secretResolverFor({ [APIFY_TOKEN_SECRET_REF]: APIFY_TOKEN_VALUE }),
    nowMs: realNowMs,
    sleep: realSleep,
  });
}

test("connector: descriptor validation is strict and a credential VALUE never parses", () => {
  const check = checkApiConnectorDescriptor(descriptor());
  assert.equal(check.ok, true);
  const withValue = { ...descriptor(), credential_reference: { secret_ref: "s", scope: "s", value: APIFY_TOKEN_VALUE } };
  assert.equal(checkApiConnectorDescriptor(withValue).ok, false);
  const withInlineToken = { ...descriptor(), api_token: APIFY_TOKEN_VALUE };
  const rejected = checkApiConnectorDescriptor(withInlineToken);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.code, "SCRP_UNKNOWN_FIELD");
});

test("connector: a happy-path actor run collects the dataset store with provenance", async () => {
  const mock = await startApifyMockServer({
    token: APIFY_TOKEN_VALUE,
    actors: {
      "act-collect": {
        pollsToSucceed: 2,
        usageTotalUsd: 0.02,
        datasetItems: [{ title: "Blender material reference", url: "https://docs.example.org/x" }],
      },
    },
  });
  try {
    const a = adapter(mock.baseUrl);
    const outcome = await a.call(descriptor(), callRequest("127.0.0.1", "/v2/acts/act-collect/runs"));
    assert.equal(outcome.kind, "SUCCEEDED");
    if (outcome.kind === "SUCCEEDED") {
      assert.ok(Array.isArray(outcome.body));
      assert.deepEqual(outcome.body, [{ title: "Blender material reference", url: "https://docs.example.org/x" }]);
      assert.ok(outcome.operation_id.includes("run-"), "operation identity is the apify run id");
      assert.equal(outcome.cost_amount, 0.02);
      assert.ok(outcome.bytes > 0);
    }
    assert.equal(mock.bearerSeen, `Bearer ${APIFY_TOKEN_VALUE}`, "token used in flight");
  } finally {
    await mock.close();
  }
});

test("connector: rate limiting enforces inter-call spacing per approved host", async () => {
  const mock = await startApifyMockServer({
    token: APIFY_TOKEN_VALUE,
    actors: { "act-rate": { pollsToSucceed: 1, usageTotalUsd: 0, datasetItems: [] } },
  });
  try {
    const slow = new ApifyAdapter({
      config: { adapter_version: "1.0.0", api_token_secret_ref: APIFY_TOKEN_SECRET_REF, base_url: mock.baseUrl },
      secretResolver: secretResolverFor({ [APIFY_TOKEN_SECRET_REF]: APIFY_TOKEN_VALUE }),
      nowMs: realNowMs,
      sleep: realSleep,
    });
    const desc = descriptor({ rate: { min_interval_ms: 80, max_concurrency: 1 } });
    const first = await slow.call(desc, callRequest("127.0.0.1", "/v2/acts/act-rate/runs"));
    const second = await slow.call(desc, callRequest("127.0.0.1", "/v2/acts/act-rate/runs", { operation_id: "op_00000002" }));
    assert.equal(first.kind, "SUCCEEDED");
    assert.equal(second.kind, "SUCCEEDED");
    assert.equal(mock.bearerSeen, `Bearer ${APIFY_TOKEN_VALUE}`);
  } finally {
    await mock.close();
  }
});

test("connector: quota exhaustion fails closed with a typed code", async () => {
  const mock = await startApifyMockServer({
    token: APIFY_TOKEN_VALUE,
    actors: { "act-quota": { pollsToSucceed: 1, usageTotalUsd: 0, datasetItems: [] } },
  });
  try {
    const a = adapter(mock.baseUrl);
    const desc = descriptor({ quota: { max_calls_total: 1 } });
    const first = await a.call(desc, callRequest("127.0.0.1", "/v2/acts/act-quota/runs"));
    assert.equal(first.kind, "SUCCEEDED");
    const second = await a.call(desc, callRequest("127.0.0.1", "/v2/acts/act-quota/runs", { operation_id: "op_2" }));
    assert.equal(second.kind, "FAILED");
    if (second.kind === "FAILED") assert.equal(second.code, "SCRP_CONNECTOR_QUOTA_EXCEEDED");
  } finally {
    await mock.close();
  }
});

test("connector: a cost-ceiling breach fails closed before further spend", async () => {
  const mock = await startApifyMockServer({
    token: APIFY_TOKEN_VALUE,
    actors: { "act-costly": { pollsToSucceed: 1, usageTotalUsd: 10, datasetItems: [] } },
  });
  try {
    const a = adapter(mock.baseUrl);
    const desc = descriptor({ cost: { currency: "USD", ceiling_amount: 0.05 } });
    const outcome = await a.call(desc, callRequest("127.0.0.1", "/v2/acts/act-costly/runs"));
    assert.equal(outcome.kind, "FAILED");
    if (outcome.kind === "FAILED") assert.equal(outcome.code, "SCRP_CONNECTOR_COST_CEILING_EXCEEDED");
  } finally {
    await mock.close();
  }
});

test("connector: timeout is an UNKNOWN outcome with persisted operation identity, then reconciles", async () => {
  const mock = await startApifyMockServer({
    token: APIFY_TOKEN_VALUE,
    actors: { "act-slow": { pollsToSucceed: 9999, usageTotalUsd: 0.01, datasetItems: [{ ok: true }] } },
    succeedAfterMs: { "act-slow": 400 },
  });
  try {
    const a = adapter(mock.baseUrl);
    const desc = descriptor({ retry: { max_retries: 1, backoff_base_ms: 2, timeout_ms: 120, ambiguity: "RECONCILE_SUPPORTED" } });
    const outcome = await a.call(desc, callRequest("127.0.0.1", "/v2/acts/act-slow/runs"));
    assert.equal(outcome.kind, "UNKNOWN", "a timeout is UNKNOWN, not failure");
    if (outcome.kind === "UNKNOWN") {
      assert.equal(outcome.code, "SCRP_CONNECTOR_TIMEOUT_UNKNOWN");
      assert.ok(outcome.operation_id.includes("run-"), "operation identity carries the provider run id");
    }
    // After the provider-side run finishes, reconciliation completes WITHOUT duplicate paid work.
    await realSleep(350);
    const reconciled = await a.reconcile(
      desc,
      outcome.kind === "UNKNOWN" ? outcome.operation_id : "",
      callRequest("127.0.0.1", "/v2/acts/act-slow/runs"),
    );
    assert.equal(reconciled.kind, "RECONCILED_SUCCEEDED");
    assert.equal(mock.postRunCount, 1, "no duplicate run was started");
  } finally {
    await mock.close();
  }
});

test("connector: retry cap exhaustion on persistent 5xx is a typed failure", async () => {
  const mock = await startApifyMockServer({
    token: APIFY_TOKEN_VALUE,
    actors: { "act-500": { pollsToSucceed: 1, usageTotalUsd: 0, datasetItems: [] } },
    alwaysFail: { "act-500": 1 },
  });
  try {
    const a = adapter(mock.baseUrl);
    const desc = descriptor({ retry: { max_retries: 2, backoff_base_ms: 2, timeout_ms: 500, ambiguity: "RECONCILE_UNSUPPORTED" } });
    const outcome = await a.call(desc, callRequest("127.0.0.1", "/v2/acts/act-500/runs"));
    assert.equal(outcome.kind, "FAILED");
    if (outcome.kind === "FAILED") assert.equal(outcome.code, "SCRP_CONNECTOR_RETRY_EXCEEDED");
    assert.equal(mock.postRunCount, 3, "one attempt + two retries");
  } finally {
    await mock.close();
  }
});

test("connector: method and host approval are enforced before any request", async () => {
  const mock = await startApifyMockServer({ token: APIFY_TOKEN_VALUE, actors: {} });
  try {
    const a = adapter(mock.baseUrl);
    const badMethod = await a.call(descriptor(), callRequest("127.0.0.1", "/v2/acts/x/runs", { method: "DELETE" }));
    assert.equal(badMethod.kind, "FAILED");
    if (badMethod.kind === "FAILED") assert.equal(badMethod.code, "SCRP_CONNECTOR_METHOD_NOT_ALLOWED");
    const badHost = await a.call(descriptor(), callRequest("evil.example", "/v2/acts/x/runs"));
    assert.equal(badHost.kind, "FAILED");
    if (badHost.kind === "FAILED") assert.equal(badHost.code, "SCRP_CONNECTOR_HOST_NOT_APPROVED");
    assert.equal(mock.postRunCount, 0, "no request left the adapter");
  } finally {
    await mock.close();
  }
});

test("connector: webhook signature validation (HMAC-SHA256, declared where used)", () => {
  const secret = "webhook-secret-value-TEST";
  const desc = descriptor({
    webhook: {
      used: true,
      signature_header: "x-apify-signature",
      algorithm: "HMAC-SHA256",
      secret_ref: "sec_webhook",
      replay_policy: "reject replayed timestamps",
    },
  });
  const body = JSON.stringify({ event: "run.succeeded", runId: "run-0001" });
  const signature = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  const valid = verifyConnectorWebhook(desc, { "x-apify-signature": signature }, body, secret);
  assert.equal(valid.ok, true);
  const tampered = verifyConnectorWebhook(desc, { "x-apify-signature": `${signature.slice(0, -2)}ff` }, body, secret);
  assert.equal(tampered.ok, false);
  const missing = verifyConnectorWebhook(desc, {}, body, secret);
  assert.equal(missing.ok, false);
  const unused = verifyConnectorWebhook(descriptor(), { "x-signature": "zz" }, body, secret);
  assert.equal(unused.ok, false);
});

test("connector: credential resolution failure fails closed", async () => {
  const mock = await startApifyMockServer({ token: APIFY_TOKEN_VALUE, actors: {} });
  try {
    const broken = new ApifyAdapter({
      config: { adapter_version: "1.0.0", api_token_secret_ref: "sec_missing", base_url: mock.baseUrl },
      secretResolver: secretResolverFor({ [APIFY_TOKEN_SECRET_REF]: APIFY_TOKEN_VALUE }),
      nowMs: realNowMs,
      sleep: realSleep,
    });
    const desc = descriptor({
      credential_reference: { secret_ref: "sec_missing", scope: "apify:actor-run" },
    });
    const outcome = await broken.call(desc, callRequest("127.0.0.1", "/v2/acts/x/runs"));
    assert.equal(outcome.kind, "FAILED");
    if (outcome.kind === "FAILED") assert.equal(outcome.code, "SCRP_CONNECTOR_CREDENTIAL_MISSING");
  } finally {
    await mock.close();
  }
});
