import assert from "node:assert/strict";
import test from "node:test";
import { RightsGrantRegistry } from "@arena/learning";
import {
  validateDatasetIntake,
  evaluateIntakeRights,
  hostMatchesPattern,
  type IntakePolicy,
} from "../src/contract.js";
import {
  ACTOR_AUTHOR,
  NOW,
  TENANT_ALPHA,
  TENANT_BETA,
  blenderDataset,
  rightsGrant,
  tenantContext,
} from "./fixtures.js";

/**
 * AR2-018 验收（issue #34）组 2：intake —— 完整溯源通过；每类缺失/不一致
 * 以精确 reason code 阻断；rights DENIED/UNKNOWN/EXPIRED 各自阻断；哈希
 * 不匹配阻断；schema 无效阻断；质量度量被记录；租户范围不匹配阻断。
 */

function intake(overrides: {
  dataset?: unknown;
  registry?: RightsGrantRegistry;
  policy?: Partial<IntakePolicy>;
  tenant?: string;
}) {
  const registry = overrides.registry ?? registryWithGrant();
  return validateDatasetIntake({
    dataset: overrides.dataset ?? blenderDataset(),
    tenant_context: tenantContext(overrides.tenant ?? TENANT_ALPHA),
    rights_registry: registry,
    policy: {
      permitted_source_patterns: ["docs.example.org", "*.example.org"],
      privacy_profile: "TENANT",
      retention_profile: "STANDARD",
      ...overrides.policy,
    },
    now: NOW,
    intake_id: "itk_00000001",
    correlation_id: "cor_00000042",
    recorded_by: ACTOR_AUTHOR,
  });
}

function registryWithGrant(): RightsGrantRegistry {
  const registry = new RightsGrantRegistry();
  registry.recordGrant(rightsGrant());
  return registry;
}

test("intake: a complete dataset with an explicit grant is ACCEPTED", () => {
  const record = intake({});
  assert.equal(record.outcome, "ACCEPTED");
  assert.equal(record.stage1_schema.passed, true);
  assert.equal(record.stage2_semantics.passed, true);
  assert.deepEqual(record.stage2_semantics.reason_codes, []);
  assert.equal(record.provenance_completeness.complete, true);
  assert.equal(record.rights.state, "LINKED");
  assert.equal(record.rights.grant_id, "grt_00000001");
  assert.equal(record.source_policy.verdict, "COMPLIANT");
  assert.equal(record.integrity.per_item_verified, true);
  assert.equal(record.integrity.object_hash_verified, true);
});

test("intake: quality metrics are recorded (counts, dedup, completeness)", () => {
  const record = intake({});
  assert.equal(record.quality.item_count, 7);
  assert.equal(record.quality.distinct_source_urls, 7);
  // one exact content duplicate exists by design (Brushed Metal mirror):
  assert.equal(record.quality.unique_content_hashes, 6);
  assert.ok(Math.abs(record.quality.dedup_ratio - 1 / 7) < 1e-9);
  assert.ok(record.quality.field_completeness > 0.8);
  assert.ok(record.quality.quarantined_item_ratio > 0);
});

test("intake: a missing transformation lineage blocks with UPG_PROVENANCE_INCOMPLETE", () => {
  const dataset = blenderDataset();
  for (const item of dataset.items) item.transformations = [];
  const record = intake({ dataset });
  assert.equal(record.outcome, "BLOCKED");
  assert.ok(record.stage2_semantics.reason_codes.includes("UPG_PROVENANCE_INCOMPLETE"));
  assert.ok(
    record.provenance_completeness.checks.some(
      (check) => check.field === "items[].transformations (lineage)" && !check.present,
    ),
  );
});

test("intake: an inconsistent quarantine annotation blocks with the exact reason code", () => {
  const dataset = blenderDataset();
  const clean = dataset.items.find((item) => item.quarantine_annotations.length === 0);
  clean!.quarantine_annotations = ["injection_directive_in_content"];
  const record = intake({ dataset });
  assert.equal(record.outcome, "BLOCKED");
  assert.ok(record.stage2_semantics.reason_codes.includes("UPG_PROVENANCE_INCOMPLETE"));
  assert.ok(
    record.provenance_completeness.checks.some(
      (check) => check.field === "items[].transformations (lineage)" && !check.consistent,
    ),
  );
});

test("intake: a retrieval timestamp after emission blocks (internal consistency)", () => {
  const dataset = blenderDataset();
  dataset.items[0]!.retrieved_at = "2026-10-12T00:00:01Z";
  dataset.emitted_at = "2026-10-12T00:00:00Z";
  const record = intake({ dataset });
  assert.equal(record.outcome, "BLOCKED");
  assert.ok(record.stage2_semantics.reason_codes.includes("UPG_PROVENANCE_INCOMPLETE"));
  assert.ok(record.quality.malformed_item_ratio > 0);
});

test("intake: rights DENIED (revoked grant) blocks with UPG_RIGHTS_DENIED", () => {
  const registry = registryWithGrant();
  registry.revoke("grt_00000001", NOW);
  const record = intake({ registry });
  assert.equal(record.outcome, "BLOCKED");
  assert.ok(record.stage2_semantics.reason_codes.includes("UPG_RIGHTS_DENIED"));
  assert.equal(record.rights.state, "DENIED");
});

test("intake: rights UNKNOWN (no grant at all) blocks with UPG_RIGHTS_UNKNOWN", () => {
  const registry = new RightsGrantRegistry();
  const record = intake({ registry });
  assert.equal(record.outcome, "BLOCKED");
  assert.ok(record.stage2_semantics.reason_codes.includes("UPG_RIGHTS_UNKNOWN"));
  assert.equal(record.rights.state, "UNKNOWN");
});

test("intake: rights EXPIRED blocks with UPG_RIGHTS_EXPIRED", () => {
  const registry = new RightsGrantRegistry();
  registry.recordGrant(rightsGrant({ expires_at: "2026-10-12T00:00:00Z" }));
  const record = intake({ registry });
  assert.equal(record.outcome, "BLOCKED");
  assert.ok(record.stage2_semantics.reason_codes.includes("UPG_RIGHTS_EXPIRED"));
  assert.equal(record.rights.state, "EXPIRED");
});

test("intake: a PROHIBITED item posture blocks with UPG_RIGHTS_DENIED", () => {
  const dataset = blenderDataset();
  dataset.items[0]!.rights_posture = "PROHIBITED";
  const record = intake({ dataset });
  assert.equal(record.outcome, "BLOCKED");
  assert.ok(record.stage2_semantics.reason_codes.includes("UPG_RIGHTS_DENIED"));
});

test("intake: an UNKNOWN item posture blocks with UPG_RIGHTS_UNKNOWN", () => {
  const dataset = blenderDataset();
  dataset.items[0]!.rights_posture = "UNKNOWN";
  const record = intake({ dataset });
  assert.equal(record.outcome, "BLOCKED");
  assert.ok(record.stage2_semantics.reason_codes.includes("UPG_RIGHTS_UNKNOWN"));
});

test("intake: a tampered per-item hash blocks with UPG_INTEGRITY_MISMATCH", () => {
  const dataset = blenderDataset();
  dataset.items[0]!.content_hash = "0".repeat(64);
  const record = intake({ dataset });
  assert.equal(record.outcome, "BLOCKED");
  assert.ok(record.stage2_semantics.reason_codes.includes("UPG_INTEGRITY_MISMATCH"));
  assert.equal(record.integrity.per_item_verified, false);
});

test("intake: a tampered object hash blocks with UPG_INTEGRITY_MISMATCH", () => {
  const dataset = blenderDataset();
  dataset.object_hash = "f".repeat(64);
  const record = intake({ dataset });
  assert.equal(record.outcome, "BLOCKED");
  assert.ok(record.stage2_semantics.reason_codes.includes("UPG_INTEGRITY_MISMATCH"));
  assert.equal(record.integrity.object_hash_verified, false);
  assert.equal(record.integrity.computed_object_hash !== record.integrity.expected_object_hash, true);
});

test("intake: a schema-invalid dataset blocks at stage 1 with a typed reason code", () => {
  const noVersion = intake({ dataset: { hello: "world" } });
  assert.equal(noVersion.outcome, "BLOCKED");
  assert.equal(noVersion.stage1_schema.passed, false);
  // SCRP1.0's classifier treats a missing/foreign schema_version as the version gate.
  assert.deepEqual(noVersion.stage2_semantics.reason_codes, ["UPG_SCHEMA_VERSION_UNSUPPORTED"]);
  const missingItems = intake({ dataset: { ...blenderDataset(), items: undefined } });
  assert.equal(missingItems.outcome, "BLOCKED");
  assert.deepEqual(missingItems.stage2_semantics.reason_codes, ["UPG_DATASET_SCHEMA_INVALID"]);
  const foreignVersion = intake({ dataset: blenderDataset({ schema_version: "ACQ1.0" as never }) });
  assert.deepEqual(foreignVersion.stage2_semantics.reason_codes, ["UPG_SCHEMA_VERSION_UNSUPPORTED"]);
});

test("intake: a tenant-scope mismatch blocks with UPG_TENANT_SCOPE_MISMATCH", () => {
  const record = intake({ dataset: blenderDataset({ tenant_id: TENANT_BETA }) });
  assert.equal(record.outcome, "BLOCKED");
  assert.ok(record.stage2_semantics.reason_codes.includes("UPG_TENANT_SCOPE_MISMATCH"));
});

test("intake: an out-of-pattern source host blocks with UPG_SOURCE_POLICY_VIOLATION", () => {
  const dataset = blenderDataset();
  dataset.items[0]!.source_url = "https://evil.example.com/steal";
  const record = intake({ dataset });
  assert.equal(record.outcome, "BLOCKED");
  assert.ok(record.stage2_semantics.reason_codes.includes("UPG_SOURCE_POLICY_VIOLATION"));
  assert.equal(record.source_policy.verdict, "VIOLATION");
  assert.equal(record.source_policy.violations.length, 1);
  assert.equal(record.source_policy.violations[0]!.item_id, "itm_brushedmetal01");
});

test("intake: redaction classes observed are propagated into the record", () => {
  const record = intake({});
  assert.ok(record.privacy_retention.redaction_classes_observed.includes("tenant"));
  assert.ok(record.privacy_retention.redaction_classes_observed.includes("operator"));
});

test("intake: evaluateIntakeRights classifies grant states deterministically", () => {
  const empty = new RightsGrantRegistry();
  assert.equal(evaluateIntakeRights(empty, TENANT_ALPHA, "dst_00000001", NOW).state, "UNKNOWN");
  const revoked = new RightsGrantRegistry();
  revoked.recordGrant(rightsGrant());
  revoked.revoke("grt_00000001", NOW);
  assert.equal(evaluateIntakeRights(revoked, TENANT_ALPHA, "dst_00000001", NOW).state, "DENIED");
  const expired = new RightsGrantRegistry();
  expired.recordGrant(rightsGrant({ expires_at: "2026-10-12T00:00:00Z" }));
  assert.equal(evaluateIntakeRights(expired, TENANT_ALPHA, "dst_00000001", NOW).state, "EXPIRED");
  const otherTenant = new RightsGrantRegistry();
  otherTenant.recordGrant(rightsGrant({ tenant_id: TENANT_BETA }));
  assert.equal(evaluateIntakeRights(otherTenant, TENANT_ALPHA, "dst_00000001", NOW).state, "UNKNOWN");
});

test("intake: host pattern matching mirrors the SCRP1.0 allowlist semantics", () => {
  assert.equal(hostMatchesPattern("docs.example.org", "docs.example.org"), true);
  assert.equal(hostMatchesPattern("materials.example.org", "*.example.org"), true);
  assert.equal(hostMatchesPattern("example.org", "*.example.org"), false);
  assert.equal(hostMatchesPattern("evil.example.com", "*.example.org"), false);
  assert.equal(hostMatchesPattern("docs.example.org", "other.org"), false);
});
