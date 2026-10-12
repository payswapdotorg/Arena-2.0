import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  CONTRACT_CORPUS_VERSION,
  CONTRACT_VERSION,
  arenaErrorCodeSchema,
  evidenceObjectSchema,
  tenantContextSchema,
  type BodyVersion,
  type RightsGrant,
} from "@arena/contracts";
import {
  RightsGrantRegistry,
  bodyVersionSchema,
  rightsGrantSchema,
} from "@arena/learning";
import {
  ACQUISITION_SCHEMA_FAMILY,
  acqErrorCodeSchema,
  canonicalJsonStringify,
  checkCapabilityGapReport,
  computeCanonicalDigest,
  computeGapReportDigest,
} from "@arena/acquisition";
import {
  datasetArtifactSchema as scrpDatasetArtifactSchema,
  scrpErrorCodeSchema,
  SCRAPER_SCHEMA_FAMILY,
} from "@arena/scraper";
import {
  UPGRADE_SCHEMA_FAMILY,
  upgErrorCodeSchema,
  renderEvidenceObject,
  computeEnvironmentDigest,
  HARNESS_VERSION,
  type EvidenceChainRecord,
} from "../src/contract.js";
import {
  NOW,
  TENANT_ALPHA,
  bodyVersion,
  blenderDataset,
  gapReport,
  rightsGrant,
  tenantContext,
  evaluationSuite,
} from "./fixtures.js";

/**
 * AR2-018 验收（issue #34）组 10：CF1.0/ACQ1.0/SCRP1.0 非回归 sanity ——
 * 引入 @arena/upgrade 不得扰动冻结家族：常量不变、错误码空间互不相交、
 * 共享形状照常解析、canonical digest 稳定、evidence-object 约定可记录。
 */

test("nonregression: frozen family constants are unchanged", () => {
  assert.equal(CONTRACT_CORPUS_VERSION, "CF1.0");
  assert.equal(CONTRACT_VERSION, "ES2.0");
  assert.equal(ACQUISITION_SCHEMA_FAMILY, "ACQ1.0");
  assert.equal(SCRAPER_SCHEMA_FAMILY, "SCRP1.0");
  assert.equal(UPGRADE_SCHEMA_FAMILY, "UPG1.0");
  assert.notEqual(UPGRADE_SCHEMA_FAMILY, CONTRACT_CORPUS_VERSION);
  assert.notEqual(UPGRADE_SCHEMA_FAMILY, ACQUISITION_SCHEMA_FAMILY);
  assert.notEqual(UPGRADE_SCHEMA_FAMILY, SCRAPER_SCHEMA_FAMILY);
});

test("nonregression: the four error-code spaces stay disjoint", () => {
  const cf = arenaErrorCodeSchema.options;
  const acq = acqErrorCodeSchema.options;
  const scrp = scrpErrorCodeSchema.options;
  const upg = upgErrorCodeSchema.options;
  for (const code of upg) {
    assert.equal((cf as readonly string[]).includes(code), false);
    assert.equal((acq as readonly string[]).includes(code), false);
    assert.equal((scrp as readonly string[]).includes(code), false);
  }
  assert.equal(arenaErrorCodeSchema.safeParse("UPG_RIGHTS_UNKNOWN").success, false);
  assert.equal(acqErrorCodeSchema.safeParse("UPG_LEAKAGE_DETECTED").success, false);
  assert.equal(scrpErrorCodeSchema.safeParse("UPG_ROLLBACK_NOT_POSSIBLE").success, false);
  assert.equal(upgErrorCodeSchema.safeParse("ARENA_UNKNOWN_FIELD").success, false);
  assert.equal(upgErrorCodeSchema.safeParse("ACQ_ROUTE_BLOCKED").success, false);
  assert.equal(upgErrorCodeSchema.safeParse("SCRP_EGRESS_DENIED").success, false);
});

test("nonregression: canonical digests are byte-stable across import paths", () => {
  const value = { z: 1, a: { y: [true, null, ""], b: 2 } };
  const viaAcquisition = computeCanonicalDigest(value);
  const viaSha = createHash("sha256").update(canonicalJsonStringify(value), "utf8").digest("hex");
  assert.equal(viaAcquisition, viaSha);
  assert.equal(computeCanonicalDigest(value), viaAcquisition);
  assert.equal(canonicalJsonStringify(value), '{"a":{"b":2,"y":[true,null,""]},"z":1}');
});

test("nonregression: the frozen shapes still parse the upgrade-plane fixtures", () => {
  // CF1.0 tenant context
  const tenant = tenantContext(TENANT_ALPHA);
  assert.ok(tenantContextSchema.safeParse(tenant).success);
  assert.equal(tenantContextSchema.safeParse({ ...tenant, derived_from: "caller" }).success, false);
  // SCRP1.0 dataset artifact (the scraper family is untouched)
  const dataset = blenderDataset();
  assert.ok(scrpDatasetArtifactSchema.safeParse(dataset).success);
  assert.ok(scrpDatasetArtifactSchema.safeParse(dataset).success);
  // ACQ1.0 gap report still validates and digests stably
  const check = checkCapabilityGapReport(gapReport());
  assert.equal(check.ok, true);
  assert.equal(computeGapReportDigest(gapReport()), computeGapReportDigest(gapReport()));
  // AR2-014 learning shapes still parse
  const body: BodyVersion = bodyVersion();
  assert.ok(bodyVersionSchema.safeParse(body).success);
  const grant: RightsGrant = rightsGrant();
  assert.ok(rightsGrantSchema.safeParse(grant).success);
  const registry = new RightsGrantRegistry();
  const recorded = registry.recordGrant(grant);
  assert.equal(recorded.kind, "RECORDED");
});

test("nonregression: upgrade evidence records render into the frozen CF1.0 evidence-object shape", () => {
  const record: EvidenceChainRecord = {
    stage: "SOURCE_CAPTURE",
    ref_id: "dst_00000001",
    content_digest: "ab".repeat(32),
    recorded_at: NOW,
  };
  const rendered = renderEvidenceObject(record);
  assert.ok(evidenceObjectSchema.safeParse(rendered).success);
  assert.equal(rendered.content_digest, record.content_digest);
  assert.ok(rendered.storage_ref.startsWith("arena-upgrade://evidence/"));
  assert.ok(rendered.size_bytes > 0);
});

test("nonregression: the pinned environment convention remains self-consistent", () => {
  const suite = evaluationSuite();
  const digest = computeEnvironmentDigest({
    harness_version: suite.pinned_environment.harness_version,
    substrate_id: suite.pinned_environment.substrate_id,
    prompts_tools_digest: suite.pinned_environment.prompts_tools_digest,
    runtime_config_digest: suite.pinned_environment.runtime_config_digest,
  });
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(suite.pinned_environment.harness_version, HARNESS_VERSION);
  assert.equal(HARNESS_VERSION, "UPG-HARNESS1.0");
});

test("nonregression: importing @arena/upgrade does not disturb the learning publication flow", () => {
  const registry = new RightsGrantRegistry();
  registry.recordGrant(rightsGrant());
  const evaluation = registry.evaluateReuseRight({
    tenant_id: TENANT_ALPHA,
    artifact_id: "dst_00000001",
    scope: "single_tenant_reuse",
    now: NOW,
  });
  assert.equal(evaluation.kind, "RIGHTS_GRANTED");
  const denied = registry.evaluateReuseRight({
    tenant_id: TENANT_ALPHA,
    artifact_id: "dst_unknown9999",
    scope: "single_tenant_reuse",
    now: NOW,
  });
  assert.equal(denied.kind, "RIGHTS_MISSING");
});
