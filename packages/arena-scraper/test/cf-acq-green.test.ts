import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  CONTRACT_CORPUS_VERSION,
  CONTRACT_VERSION,
  arenaErrorCodeSchema,
  capsuleManifestSchema,
  tenantContextSchema,
} from "@arena/contracts";
import {
  ACQUISITION_SCHEMA_FAMILY,
  acqErrorCodeSchema,
  canonicalJsonStringify,
  computeCanonicalDigest,
} from "@arena/acquisition";
import {
  SYNTHETIC_ISOLATION_SUITE_DIGEST,
  buildScraperCapsuleManifest,
  scrpErrorCodeSchema,
  SCRAPER_SCHEMA_FAMILY,
  type AcquisitionRun,
  type ScraperDefinition,
  type ScraperVersion,
} from "../src/contract.js";
import { productionDefinition, tenantContext } from "./fixtures.js";

/**
 * AR2-017 验收（issue #33）：CF1.0 / ACQ1.0 非回归 sanity ——
 * 引入 @arena/scraper 不得扰动冻结家族：常量不变、错误码空间互不相交、
 * 共享形状照常解析、capsule manifest 仍然合法、canonical digest 稳定。
 */

test("cf/acq green: frozen corpus version constants are unchanged", () => {
  assert.equal(CONTRACT_CORPUS_VERSION, "CF1.0");
  assert.equal(CONTRACT_VERSION, "ES2.0");
  assert.equal(ACQUISITION_SCHEMA_FAMILY, "ACQ1.0");
  assert.equal(SCRAPER_SCHEMA_FAMILY, "SCRP1.0");
  assert.notEqual(SCRAPER_SCHEMA_FAMILY, CONTRACT_CORPUS_VERSION);
  assert.notEqual(SCRAPER_SCHEMA_FAMILY, ACQUISITION_SCHEMA_FAMILY);
});

test("cf/acq green: the three error-code spaces are disjoint", () => {
  const cfCodes = arenaErrorCodeSchema.options;
  const acqCodes = acqErrorCodeSchema.options;
  const scrpCodes = scrpErrorCodeSchema.options;
  const overlapCA = acqCodes.filter((code) => (cfCodes as readonly string[]).includes(code));
  const overlapCS = scrpCodes.filter(
    (code) => (cfCodes as readonly string[]).includes(code) || (acqCodes as readonly string[]).includes(code),
  );
  assert.deepEqual(overlapCA, []);
  assert.deepEqual(overlapCS, []);
  assert.ok(arenaErrorCodeSchema.safeParse("SCRP_EGRESS_DENIED").success === false);
  assert.ok(acqErrorCodeSchema.safeParse("SCRP_EGRESS_DENIED").success === false);
  assert.ok(scrpErrorCodeSchema.safeParse("ARENA_UNKNOWN_FIELD").success === false);
  assert.ok(scrpErrorCodeSchema.safeParse("ACQ_ROUTE_BLOCKED").success === false);
});

test("cf/acq green: shared CF1.0 shapes still parse the scraper-plane fixtures", () => {
  const tenant = tenantContext("tnt_00000001");
  assert.ok(tenantContextSchema.safeParse(tenant).success);
  assert.equal(tenantContextSchema.safeParse({ ...tenant, derived_from: "caller" }).success, false);
});

test("cf/acq green: the capsule manifest produced by the scraper plane still validates (CF1.0)", () => {
  const version: ScraperVersion = {
    schema_version: "SCRP1.0",
    version_id: "scv_00000001",
    definition_id: "sdf_00000001",
    tenant_id: "tnt_00000001",
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
  const run: AcquisitionRun = {
    schema_version: "SCRP1.0",
    run_id: "run_00000001",
    tenant_id: "tnt_00000001",
    request_id: "req_00000001",
    provider_id: "prv_00000001",
    scraper_version_id: version.version_id,
    scraper_version_digest: version.build_digest,
    idempotency_key: "k",
    correlation_id: "cor_00000001",
    causation_id: null,
    status: "PENDING",
    attempt_counter: 0,
    lease: null,
    deadline: "2026-11-01T00:00:00Z",
    quotas: { max_pages: 1, max_items: 1, max_bytes: 1000, wall_time_seconds: 10, max_cost_usd: 1 },
    events: [],
    output_dataset_id: null,
    terminal_reason: null,
    operation_identity: null,
  };
  const manifest = buildScraperCapsuleManifest({
    run,
    definition: productionDefinition() as ScraperDefinition,
    version,
    manifestId: "csm_00000001",
    capsuleId: "cap_00000001",
  });
  assert.equal(capsuleManifestSchema.safeParse(manifest).success, true, "the CF1.0 capsule envelope is respected");
  assert.equal(manifest.egress_policy.denied_default, true);
  assert.equal(manifest.assurance.conformance_suite_digest, SYNTHETIC_ISOLATION_SUITE_DIGEST);
});

test("cf/acq green: canonical digests are byte-stable across import order", () => {
  const value = { z: 1, a: { y: [true, null, ""], b: 2 } };
  const digestViaAcquisition = computeCanonicalDigest(value);
  const digestViaSha = createHash("sha256").update(canonicalJsonStringify(value), "utf8").digest("hex");
  assert.equal(digestViaAcquisition, digestViaSha);
  assert.equal(computeCanonicalDigest(value), digestViaAcquisition);
  const canonical = canonicalJsonStringify(value);
  assert.equal(canonical, '{"a":{"b":2,"y":[true,null,""]},"z":1}');
});
