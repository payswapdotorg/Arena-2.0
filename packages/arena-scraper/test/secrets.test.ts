import assert from "node:assert/strict";
import test from "node:test";
import { SyntheticLocalProvider } from "@arena/capsule";
import {
  ApifyAdapter,
  QuarantineLayer,
  ScraperFactory,
  ScraperRunService,
  checkApiConnectorDescriptor,
  type ApiConnectorDescriptor,
} from "../src/contract.js";
import {
  ACTOR_AUTHOR,
  ACTOR_RELEASER,
  ACTOR_REVIEWER,
  APIFY_TOKEN_SECRET_REF,
  APIFY_TOKEN_VALUE,
  MockResolver,
  TENANT_ALPHA,
  fixtureDefinition,
  fixtureEndpoint,
  realNowIso,
  realNowMs,
  realSleep,
  secretResolverFor,
  tenantContext,
} from "./fixtures.js";
import { startApifyMockServer, startFixtureServer } from "./fixture-server.js";

/**
 * AR2-017 验收（issue #33）：secret hygiene —— 日志/记录/工件绝不包含
 * credential 值（对 fixture 秘密形状断言）；secret-shaped 与 PII 内容在数据
 * 集组装前被 redact；descriptor 只携带 REFERENCE。
 */

const AWS_EXAMPLE_KEY = ["AKIA", "IOSFODNN", "7EXAMPLE"].join("");
const FAKE_SK = "sk-TESTSECRET0000000000000000";

test("secrets: quarantine redacts every secret-shaped pattern before dataset assembly", () => {
  const quarantine = new QuarantineLayer({
    allowed_content_types: ["text/html"],
    max_item_bytes: 65536,
    max_quarantined_records: 10,
    redact_secrets: true,
    redact_pii: true,
  });
  const dirty = [
    `api key ${FAKE_SK}`,
    `aws ${AWS_EXAMPLE_KEY}`,
    "Authorization: Bearer supersecret-bearer-token-0123456789",
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----",
    "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.KMUFsIDTioYtH3T4fwpMeJf36POk6yJV_adQssw5c",
    "mail someone@example.org",
  ].join("\n");
  const sanitized = quarantine.sanitizeContent(dirty);
  for (const raw of [FAKE_SK, AWS_EXAMPLE_KEY, "supersecret-bearer-token-0123456789", "MIIEow", "someone@example.org"]) {
    assert.ok(!sanitized.content.includes(raw), `${raw.slice(0, 12)}… must be redacted`);
  }
  assert.ok(sanitized.content.includes("[REDACTED:secret_key]"));
  assert.ok(sanitized.content.includes("[REDACTED:aws_access_key]"));
  assert.ok(sanitized.content.includes("[REDACTED:email]"));
  assert.ok(sanitized.redactions.includes("secret_key"));
  assert.ok(sanitized.redactions.includes("bearer_token"));
});

test("secrets: an emitted dataset and its run record never contain credential values", async () => {
  const server = await startFixtureServer({
    pages: {
      "/guide": `<html>page that references a stray token ${FAKE_SK} inline</html>`,
    },
  });
  try {
    const factory = new ScraperFactory({
      nowIso: realNowIso,
      fixtureRunner: { run: async () => ({ passed: true, summary: "ok" }) },
    });
    const definition = fixtureDefinition(server.port, [`http://127.0.0.1:${server.port}/guide`]);
    const start = factory.startBuild(TENANT_ALPHA, ACTOR_AUTHOR, definition);
    assert.equal(start.ok, true);
    const buildId = start.ok ? start.build.build_id : "";
    for (const [gate, actor] of [
      ["STATIC_VALIDATION", ACTOR_AUTHOR],
      ["DEPENDENCY_SOURCE_LICENSE_REVIEW", ACTOR_REVIEWER],
      ["BUILD", ACTOR_AUTHOR],
      ["FIXTURE_RUN", ACTOR_AUTHOR],
      ["SOURCE_POLICY_BUDGET_CHECK", ACTOR_REVIEWER],
    ] as const) {
      const result = await factory.runGate(buildId, TENANT_ALPHA, actor, gate);
      assert.equal(result.ok, true, gate);
    }
    const release = await factory.release(buildId, TENANT_ALPHA, ACTOR_RELEASER, "1.0.0");
    assert.equal(release.ok, true);
    const service = new ScraperRunService({
      provider: new SyntheticLocalProvider({ now: () => new Date(realNowMs()) }),
      factory,
      resolver: new MockResolver(),
      nowMs: realNowMs,
      nowIso: realNowIso,
      sleep: realSleep,
    });
    const started = service.startRun(tenantContext(TENANT_ALPHA), {
      request_id: "req_00000001",
      provider_id: "prv_00000001",
      scraper_version_id: release.ok ? release.version.version_id : "",
      idempotency_key: "secrets-key-1",
      correlation_id: "cor_00000001",
      causation_id: null,
      deadline: new Date(Date.now() + 60_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      quotas: { max_pages: 5, max_items: 50, max_bytes: 500_000, wall_time_seconds: 30, max_cost_usd: 1 },
      fixture_endpoints: [fixtureEndpoint(server.port)],
    });
    const runId = started.ok ? started.run.run_id : "";
    const outcome = await service.executeRun(TENANT_ALPHA, runId);
    assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.detail);
    const run = service.runs.find(runId, TENANT_ALPHA);
    assert.ok(run !== null);
    const dataset = service.datasets.find(run.output_dataset_id!, TENANT_ALPHA);
    assert.ok(dataset !== null);
    // The stray in-page secret is redacted in the emitted dataset item.
    assert.ok(!JSON.stringify(dataset).includes(FAKE_SK));
    assert.ok(JSON.stringify(dataset).includes("[REDACTED:secret_key]"));
    // Run records, events and evidence never contain any secret value.
    assert.ok(!JSON.stringify(run).includes(FAKE_SK));
    const build = factory.findBuild(buildId, TENANT_ALPHA);
    assert.ok(!JSON.stringify(build).includes(FAKE_SK));
    assert.ok(!JSON.stringify(build).includes(APIFY_TOKEN_VALUE));
  } finally {
    await server.close();
  }
});

test("secrets: the Apify token is used in flight but never appears in outcomes or descriptors", async () => {
  const mock = await startApifyMockServer({
    token: APIFY_TOKEN_VALUE,
    actors: { "act-ok": { pollsToSucceed: 1, usageTotalUsd: 0, datasetItems: [{ ok: 1 }] } },
  });
  try {
    const adapter = new ApifyAdapter({
      config: { adapter_version: "1.0.0", api_token_secret_ref: APIFY_TOKEN_SECRET_REF, base_url: mock.baseUrl },
      secretResolver: secretResolverFor({ [APIFY_TOKEN_SECRET_REF]: APIFY_TOKEN_VALUE }),
      nowMs: realNowMs,
      sleep: realSleep,
    });
    const desc: ApiConnectorDescriptor = {
      schema_version: "SCRP1.0",
      descriptor_id: "apd_00000003",
      tenant_id: TENANT_ALPHA,
      adapter_id: "apify-adapter",
      adapter_version: "1.0.0",
      provider_id: "prv_00000009",
      approved_host_patterns: ["127.0.0.1"],
      approved_endpoint_patterns: ["^/v2/acts/.+/runs$"],
      approved_methods: ["GET", "POST"],
      request_schema: { schema_id: "sch_00000004", schema_version: "1.0.0" },
      credential_reference: { secret_ref: APIFY_TOKEN_SECRET_REF, scope: "apify:actor-run" },
      rate: { min_interval_ms: 0, max_concurrency: 1 },
      quota: { max_calls_total: 5 },
      cost: { currency: "USD", ceiling_amount: 1 },
      retry: { max_retries: 1, backoff_base_ms: 2, timeout_ms: 1000, ambiguity: "RECONCILE_SUPPORTED" },
      response_schema: { schema_id: "sch_00000005", schema_version: "1.0.0" },
      max_response_bytes: 1048576,
      max_items: 100,
      retention_requirements: "none beyond tenant policy",
      provenance_requirements: "record run id",
      regions: ["GH"],
      required_entitlements: [],
      webhook: { used: false, signature_header: "x-s", algorithm: "HMAC-SHA256", secret_ref: null, replay_policy: "n/a" },
    };
    const outcome = await adapter.call(desc, {
      operation_id: "op_secret_1",
      host: "127.0.0.1",
      endpoint: "/v2/acts/act-ok/runs",
      method: "POST",
    });
    assert.equal(outcome.kind, "SUCCEEDED");
    assert.equal(mock.bearerSeen, `Bearer ${APIFY_TOKEN_VALUE}`, "the token WAS used in flight");
    assert.ok(!JSON.stringify(outcome).includes(APIFY_TOKEN_VALUE), "the token never appears in the outcome");
    assert.ok(!JSON.stringify(desc).includes(APIFY_TOKEN_VALUE), "the descriptor carries only the REFERENCE");
    const parsed = checkApiConnectorDescriptor(desc);
    assert.equal(parsed.ok, true);
  } finally {
    await mock.close();
  }
});
