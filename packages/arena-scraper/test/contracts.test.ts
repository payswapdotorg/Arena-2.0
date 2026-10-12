import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { computeCanonicalDigest } from "@arena/acquisition";
import {
  SCRAPER_SCHEMA_FAMILY,
  acquisitionRunSchema,
  checkAcquisitionRun,
  checkApiConnectorDescriptor,
  checkDatasetArtifact,
  checkScraperBuild,
  checkScraperDefinition,
  checkScraperVersion,
  computeScraperDefinitionDigest,
  datasetArtifactSchema,
  scraperBuildSchema,
  scraperDefinitionSchema,
  scraperVersionSchema,
  scrpErrorCodeSchema,
  sourceSafetyProfileSchema,
  validateScraperDefinitionSemantics,
  type ApiConnectorDescriptor,
  type ScraperDefinition,
} from "../src/contract.js";
import {
  APIFY_TOKEN_SECRET_REF,
  TENANT_ALPHA,
  productionDefinition,
} from "./fixtures.js";

/**
 * AR2-017 验收（issue #33）：SCRP1.0 契约 schema 面 ——
 * 正向量解析、未知字段 typed 拒绝（含秘密走私）、版本门、摘要稳定性、
 * 版本不可变性、安全词表钉死（bypass 字面量不可为 true）。
 */

test("contracts: the SCRP1.0 family id is stable and distinct", () => {
  assert.equal(SCRAPER_SCHEMA_FAMILY, "SCRP1.0");
});

test("contracts: a valid ScraperDefinition parses through the trust-boundary check", () => {
  const check = checkScraperDefinition(productionDefinition());
  assert.equal(check.ok, true);
  if (check.ok) assert.equal(check.definition.acquisition_method, "HTTP_CRAWL");
});

test("contracts: an unknown field is a typed rejection (a smuggled secret never parses)", () => {
  const smuggled = { ...productionDefinition(), api_secret: "sk-live-000000000000000000" };
  const check = checkScraperDefinition(smuggled);
  assert.equal(check.ok, false);
  if (!check.ok) assert.equal(check.code, "SCRP_UNKNOWN_FIELD");
});

test("contracts: a CF1.0/ACQ1.0 schema_version is rejected at the version gate", () => {
  for (const foreign of ["CF1.0", "ACQ1.0", "SCRP2.0"]) {
    const check = checkScraperDefinition({ ...productionDefinition(), schema_version: foreign });
    assert.equal(check.ok, false);
    if (!check.ok) assert.equal(check.code, "SCRP_SCHEMA_VERSION_UNSUPPORTED");
  }
});

test("contracts: safety bypass fields are structurally impossible (literal false)", () => {
  for (const field of [
    "authentication_bypass",
    "captcha_bypass",
    "paywall_bypass",
    "access_control_bypass",
    "stealth_fingerprint_evasion",
    "proxy_rotation_evasion",
    "private_data_sources",
  ]) {
    const attempt = {
      ...productionDefinition(),
      safety_profile: { ...productionDefinition().safety_profile, [field]: true },
    };
    assert.equal(checkScraperDefinition(attempt).ok, false, `${field} must not parse as true`);
  }
  assert.equal(sourceSafetyProfileSchema.safeParse(productionDefinition().safety_profile).success, true);
});

test("contracts: robots policy must declare respect_robots (literal true)", () => {
  const attempt = {
    ...productionDefinition(),
    robots_policy: { ...productionDefinition().robots_policy, respect_robots: false },
  };
  assert.equal(checkScraperDefinition(attempt).ok, false);
});

test("contracts: seeds outside the declared source scope fail semantics", () => {
  const issues = validateScraperDefinitionSemantics(
    productionDefinition({ seeds: ["https://evil.example.com/steal"] }) as ScraperDefinition,
  );
  assert.ok(issues.some((issue) => issue.field === "seeds"));
});

test("contracts: a login-walled source is default-deny at the semantic gate", () => {
  const issues = validateScraperDefinitionSemantics(
    productionDefinition({
      safety_profile: { ...productionDefinition().safety_profile, source_requires_authentication: true },
    }) as ScraperDefinition,
  );
  assert.ok(issues.some((issue) => issue.rule.includes("login-walled")));
});

test("contracts: an unpinned crawlee version fails the supply-chain lock", () => {
  const issues = validateScraperDefinitionSemantics(
    productionDefinition({
      runtime_requirements: { ...productionDefinition().runtime_requirements, crawlee_version: "3.13.0" },
    }) as ScraperDefinition,
  );
  assert.ok(issues.some((issue) => issue.field === "runtime_requirements.crawlee_version"));
});

test("contracts: definition digests are canonical and stable across key order", () => {
  const definition = productionDefinition();
  const first = computeScraperDefinitionDigest(definition);
  assert.equal(computeScraperDefinitionDigest(deepReverseKeys(definition)), first);
  assert.match(first, /^[a-f0-9]{64}$/);
});

function deepReverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepReverseKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).reverse()) {
      out[key] = deepReverseKeys(entry);
    }
    return out;
  }
  return value;
}

test("contracts: ScraperVersion round-trips and rejects unknown fields", () => {
  const version = {
    schema_version: "SCRP1.0",
    version_id: "scv_00000001",
    definition_id: "sdf_00000001",
    tenant_id: TENANT_ALPHA,
    version: "1.0.0",
    definition_digest: "cd".repeat(32),
    build_digest: "ef".repeat(32),
    dependency_lock_digest: "12".repeat(32),
    released_at: "2026-10-12T00:00:00Z",
    released_by: { actor_id: "act_00000003", role: "RELEASER" },
    release_evidence: [
      { evidence_id: "evd_00000001", kind: "RELEASE_APPROVAL", digest: "ab".repeat(32), summary: "ok" },
    ],
  };
  const check = checkScraperVersion(version);
  assert.equal(check.ok, true);
  assert.equal(checkScraperVersion({ ...version, extra: 1 }).ok, false);
  assert.equal(scraperVersionSchema.safeParse({ ...version, schema_version: "CF1.0" }).success, false);
});

test("contracts: AcquisitionRun strict envelope and status vocabulary", () => {
  const run = {
    schema_version: "SCRP1.0",
    run_id: "run_00000001",
    tenant_id: TENANT_ALPHA,
    request_id: "req_00000001",
    provider_id: "prv_00000001",
    scraper_version_id: "scv_00000001",
    scraper_version_digest: "ef".repeat(32),
    idempotency_key: "scrp-key-1",
    correlation_id: "cor_00000001",
    causation_id: null,
    status: "PENDING",
    attempt_counter: 0,
    lease: null,
    deadline: "2026-11-01T00:00:00Z",
    quotas: { max_pages: 10, max_items: 100, max_bytes: 100000, wall_time_seconds: 60, max_cost_usd: 5 },
    events: [
      { event_seq: 1, at: "2026-10-12T00:00:00Z", kind: "RUN_CREATED", detail: "created" },
    ],
    output_dataset_id: null,
    terminal_reason: null,
    operation_identity: null,
  };
  const check = checkAcquisitionRun(run);
  assert.equal(check.ok, true);
  assert.equal(checkAcquisitionRun({ ...run, secret_value: "leak" }).ok, false);
  assert.equal(acquisitionRunSchema.safeParse({ ...run, status: "EXPLODING" }).success, false);
});

test("contracts: DatasetArtifact strict envelope", () => {
  const item = {
    item_id: "itm_0000000000000000000001",
    source_url: "https://docs.example.org/materials",
    content_hash: "ab".repeat(32),
    retrieved_at: "2026-10-12T00:00:00Z",
    method: "HTTP_CRAWL",
    method_version: "SCRP-ENGINE1.0",
    license_assessment: "CC-BY-SA documentation",
    rights_posture: "PERMITTED",
    redaction_class: "tenant",
    transformations: [{ step: "FETCHED", detail: "status 200" }],
    quarantine_annotations: [],
    content: "<html></html>",
  };
  const dataset = {
    schema_version: "SCRP1.0",
    dataset_id: "dst_00000001",
    tenant_id: TENANT_ALPHA,
    run_id: "run_00000001",
    scraper_version_id: "scv_00000001",
    object_hash: "cd".repeat(32),
    items: [item],
    emitted_at: "2026-10-12T00:00:00Z",
    provenance: {
      definition_digest: "cd".repeat(32),
      build_digest: "ef".repeat(32),
      engine: "SCRP-ENGINE1.0",
      crawlee_version: "3.18.2",
      terminal_reason: "COMPLETED",
    },
  };
  const check = checkDatasetArtifact(dataset);
  assert.equal(check.ok, true);
  assert.equal(checkDatasetArtifact({ ...dataset, items: [{ ...item, content: undefined }] }).ok, false);
  assert.equal(datasetArtifactSchema.safeParse({ ...dataset, schema_version: "ACQ1.0" }).success, false);
});

test("contracts: ScraperBuild strict envelope and state vocabulary", () => {
  const build = {
    schema_version: "SCRP1.0",
    build_id: "bld_00000001",
    definition_id: "sdf_00000001",
    tenant_id: TENANT_ALPHA,
    state: "DRAFT",
    created_at: "2026-10-12T00:00:00Z",
    transitions: [
      {
        from: "DRAFT",
        to: "DRAFT",
        gate: "STATIC_VALIDATION",
        actor: { actor_id: "act_00000001", role: "AUTHOR" },
        at: "2026-10-12T00:00:00Z",
        evidence: { evidence_id: "evd_00000001", kind: "VALIDATION_REPORT", digest: "ab".repeat(32), summary: "draft" },
        rejection: null,
      },
    ],
    build_digest: "ef".repeat(32),
    build_plan: "{\"artifact_kind\":\"arena-scraper-build-plan\"}",
    rejection_reason: null,
  };
  const check = checkScraperBuild(build);
  assert.equal(check.ok, true);
  assert.equal(checkScraperBuild({ ...build, state: "EXPLODED" }).ok, false);
  assert.equal(scraperBuildSchema.safeParse({ ...build, build_plan: "" }).success, false);
});

function connectorDescriptor(): ApiConnectorDescriptor {
  return {
    schema_version: "SCRP1.0",
    descriptor_id: "apd_00000001",
    tenant_id: TENANT_ALPHA,
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
    retry: { max_retries: 2, backoff_base_ms: 5, timeout_ms: 200, ambiguity: "RECONCILE_SUPPORTED" },
    response_schema: { schema_id: "sch_00000005", schema_version: "1.0.0" },
    max_response_bytes: 1048576,
    max_items: 1000,
    retention_requirements: "dataset items retained per tenant policy",
    provenance_requirements: "record actor run id + usage",
    regions: ["GH"],
    required_entitlements: [],
    webhook: {
      used: true,
      signature_header: "x-apify-signature",
      algorithm: "HMAC-SHA256",
      secret_ref: APIFY_TOKEN_SECRET_REF,
      replay_policy: "reject seen timestamps",
    },
  };
}

test("contracts: ApiConnectorDescriptor parses and rejects a credential VALUE", () => {
  const check = checkApiConnectorDescriptor(connectorDescriptor());
  assert.equal(check.ok, true);
  const smuggledValue = { ...connectorDescriptor(), credential_reference: { secret_ref: "s", scope: "s", value: "sk-live" } };
  assert.equal(checkApiConnectorDescriptor(smuggledValue).ok, false);
  const inlineSecret = { ...connectorDescriptor(), api_token: "sk-live-000000000000" };
  const rejected = checkApiConnectorDescriptor(inlineSecret);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.code, "SCRP_UNKNOWN_FIELD");
});

test("contracts: SCRP_* error codes are disjoint from the frozen catalogs' shapes", () => {
  assert.equal(scrpErrorCodeSchema.safeParse("ARENA_UNKNOWN_FIELD").success, false);
  assert.equal(scrpErrorCodeSchema.safeParse("ACQ_ROUTE_BLOCKED").success, false);
  assert.equal(scrpErrorCodeSchema.safeParse("SCRP_EGRESS_DENIED").success, true);
});

test("contracts: canonical digest agrees with sha256 over canonical JSON", () => {
  const value = { b: 1, a: [2, 3] };
  const canonical = JSON.stringify({ a: [2, 3], b: 1 });
  const expected = createHash("sha256").update(canonical, "utf8").digest("hex");
  assert.equal(computeCanonicalDigest(value), expected);
  assert.equal(scraperDefinitionSchema.safeParse(productionDefinition()).success, true);
});
