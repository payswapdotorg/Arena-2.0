import assert from "node:assert/strict";
import test from "node:test";
import { arenaErrorCodeSchema } from "@arena/contracts";
import { acqErrorCodeSchema, computeCanonicalDigest } from "@arena/acquisition";
import { scrpErrorCodeSchema } from "@arena/scraper";
import {
  UPGRADE_SCHEMA_FAMILY,
  upgErrorCodeSchema,
  UPG_ERROR_CATALOG,
  upgError,
  upgHttpStatusFor,
  isUpgRetryable,
  UpgradeTypedError,
  datasetIntakeRecordSchema,
  datasetTransformationManifestSchema,
  capabilityUpgradeProposalSchema,
  computeProposalDigest,
  validateProposalSemantics,
  evaluateProposalTransition,
  proposalStateIsTerminal,
  capabilityEvaluationSuiteSchema,
  computeSuiteDigest,
  validateSuiteSemantics,
  evaluationRunSchema,
  beforeAfterDeltaSchema,
  publicationDecisionSchema,
  rollbackRecordSchema,
  adoptionRecordSchema,
  graderKindSchema,
  type CapabilityUpgradeProposal,
} from "../src/contract.js";
import {
  blenderDataset,
  evaluationSuite,
  manifestOps,
  rightsGrant,
  upgradeProposal,
  NOW,
  TENANT_ALPHA,
  ACTOR_AUTHOR,
} from "./fixtures.js";
import { RightsGrantRegistry } from "@arena/learning";
import { buildTransformationManifest } from "../src/manifest.js";
import { validateDatasetIntake } from "../src/intake.js";
import { tenantContext } from "./fixtures.js";

/**
 * AR2-018 验收（issue #34）组 1：UPG1.0 契约 schema 面 ——
 * 正向量、未知字段 typed 拒绝、版本门、摘要稳定性、状态机合法/非法
 * 转换与 reason code、错误目录完备性。
 */

test("contracts: the UPG1.0 family id is stable and distinct", () => {
  assert.equal(UPGRADE_SCHEMA_FAMILY, "UPG1.0");
  assert.notEqual(UPGRADE_SCHEMA_FAMILY, "CF1.0");
  assert.notEqual(UPGRADE_SCHEMA_FAMILY, "ACQ1.0");
  assert.notEqual(UPGRADE_SCHEMA_FAMILY, "SCRP1.0");
});

test("contracts: every UPG_* code has a complete catalog entry", () => {
  const codes = upgErrorCodeSchema.options;
  assert.ok(codes.length >= 35);
  for (const code of codes) {
    const entry = UPG_ERROR_CATALOG[code];
    assert.ok(entry !== undefined, `${code} missing from catalog`);
    const statusOk = (entry.http_status >= 400 && entry.http_status <= 599) || entry.http_status === 200;
    assert.ok(statusOk, `${code} has an implausible http status ${entry.http_status}`);
    assert.equal(typeof entry.retryable, "boolean");
    assert.ok(entry.description.length > 5);
  }
  assert.equal(UPG_ERROR_CATALOG.UPG_IDEMPOTENCY_REPLAY.http_status, 200);
  assert.equal(upgHttpStatusFor("UPG_NOT_FOUND"), 404);
  assert.equal(upgHttpStatusFor("UPG_IDEMPOTENCY_REPLAY"), 200);
  assert.equal(isUpgRetryable("UPG_EVALUATION_INCONCLUSIVE"), true);
  assert.equal(isUpgRetryable("UPG_RIGHTS_DENIED"), false);
});

test("contracts: the error envelope round-trips and typed errors carry it", () => {
  const envelope = upgError("UPG_RIGHTS_DENIED", "denied", "cor_00000042", { a: 1 });
  assert.equal(envelope.code, "UPG_RIGHTS_DENIED");
  assert.deepEqual(envelope.details, { a: 1 });
  const thrown = new UpgradeTypedError(envelope);
  assert.equal(thrown.envelope.code, "UPG_RIGHTS_DENIED");
  assert.match(thrown.message, /denied/);
});

test("contracts: a valid CapabilityUpgradeProposal parses and its digest is canonical", () => {
  const proposal = upgradeProposal();
  assert.equal(capabilityUpgradeProposalSchema.safeParse(proposal).success, true);
  const digest = computeProposalDigest(proposal);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(computeProposalDigest(deepReverseKeys(proposal)), digest);
});

test("contracts: an unknown field is a typed rejection (smuggled policy override never parses)", () => {
  const smuggled = { ...upgradeProposal(), force_publish: true };
  const parsed = capabilityUpgradeProposalSchema.safeParse(smuggled);
  assert.equal(parsed.success, false);
});

test("contracts: foreign schema_version gates are rejected (version immutability)", () => {
  for (const foreign of ["CF1.0", "ACQ1.0", "SCRP1.0", "UPG2.0"]) {
    const parsed = capabilityUpgradeProposalSchema.safeParse({
      ...upgradeProposal(),
      schema_version: foreign,
    });
    assert.equal(parsed.success, false, `${foreign} must not parse as UPG1.0`);
  }
  const parsed = datasetIntakeRecordSchema.safeParse({ schema_version: "CF1.0" });
  assert.equal(parsed.success, false);
});

test("contracts: the proposal state machine records legal transitions with reason codes", () => {
  assert.deepEqual(
    evaluateProposalTransition("SUBMITTED", "EVALUATED"),
    { ok: true, reason_code: "evaluation_completed" },
  );
  assert.deepEqual(
    evaluateProposalTransition("EVALUATED", "PUBLISHED"),
    { ok: true, reason_code: "publication_approved" },
  );
  assert.deepEqual(
    evaluateProposalTransition("EVALUATED", "INCONCLUSIVE"),
    { ok: true, reason_code: "thresholds_not_met" },
  );
  assert.deepEqual(
    evaluateProposalTransition("EVALUATED", "FAILED"),
    { ok: true, reason_code: "evaluation_failed" },
  );
  assert.deepEqual(
    evaluateProposalTransition("EVALUATED", "REJECTED"),
    { ok: true, reason_code: "rights_or_policy_blocked" },
  );
});

test("contracts: illegal proposal transitions are rejected with the allowed set", () => {
  const direct = evaluateProposalTransition("SUBMITTED", "PUBLISHED");
  assert.equal(direct.ok, false);
  if (!direct.ok) {
    assert.equal(direct.code, "UPG_STATE_TRANSITION_ILLEGAL");
    assert.deepEqual(direct.allowed, ["EVALUATED", "REJECTED"]);
  }
  const fromTerminal = evaluateProposalTransition("PUBLISHED", "EVALUATED");
  assert.equal(fromTerminal.ok, false);
  if (!fromTerminal.ok) assert.deepEqual(fromTerminal.allowed, []);
  assert.equal(proposalStateIsTerminal("PUBLISHED"), true);
  assert.equal(proposalStateIsTerminal("EVALUATED"), false);
  const resurrection = evaluateProposalTransition("INCONCLUSIVE", "SUBMITTED");
  assert.equal(resurrection.ok, false);
});

test("contracts: proposal semantics reject an unauthorized fine-tuning selection", () => {
  const proposal = upgradeProposal({
    delivery_strategy: {
      strategy: "AUTHORIZED_FINE_TUNING",
      reason_code: "first_applicable_preferred_order",
      applied_order: [],
    },
  });
  const issues = validateProposalSemantics(proposal as CapabilityUpgradeProposal);
  assert.ok(issues.some((issue) => issue.field === "delivery_strategy.strategy"));
  assert.deepEqual(validateProposalSemantics(upgradeProposal()), []);
});

test("contracts: the pack schema enforces deterministic digest recomputation", () => {
  const registry = new RightsGrantRegistry();
  registry.recordGrant(rightsGrant());
  const dataset = blenderDataset();
  const intake = validateDatasetIntake({
    dataset,
    tenant_context: tenantContext(TENANT_ALPHA),
    rights_registry: registry,
    policy: {
      permitted_source_patterns: ["docs.example.org", "*.example.org"],
      privacy_profile: "TENANT",
      retention_profile: "STANDARD",
    },
    now: NOW,
    intake_id: "itk_00000001",
    correlation_id: "cor_00000042",
    recorded_by: ACTOR_AUTHOR,
  });
  const built = buildTransformationManifest({
    dataset,
    intake_id: intake.intake_id,
    manifest_id: "mfs_00000001",
    ops: manifestOps(),
    now: NOW,
    created_by: ACTOR_AUTHOR,
  });
  assert.equal(built.outcome.kind, "OK");
  assert.equal(built.manifest !== null && datasetTransformationManifestSchema.safeParse(built.manifest).success, true);
  assert.match(built.manifest!.output_digest, /^[a-f0-9]{64}$/);
});

test("contracts: the evaluation suite schema pins its graders and thresholds", () => {
  const suite = evaluationSuite();
  assert.equal(capabilityEvaluationSuiteSchema.safeParse(suite).success, true);
  assert.match(computeSuiteDigest(suite), /^[a-f0-9]{64}$/);
  assert.deepEqual(validateSuiteSemantics(suite), []);
  const badGrader = evaluationSuite({
    target_tasks: [
      { task_id: "tsk_00000001", fixture_input: "q", expected_output: "a", grader: { kind: "HUMAN_VIBES" } },
    ],
  });
  assert.equal(capabilityEvaluationSuiteSchema.safeParse(badGrader).success, false);
  assert.deepEqual(graderKindSchema.options, ["EXACT_MATCH", "SET_OVERLAP", "REFUSAL_CORRECT"]);
});

test("contracts: run, delta, decision and adoption schemas parse their fixtures", () => {
  const run = evaluationRunSchema.safeParse({
    schema_version: "UPG1.0",
    run_id: "run_evalbase001",
    tenant_id: TENANT_ALPHA,
    suite_ref: { suite_id: "sut_00000001", suite_version: "1.0.0", suite_digest: "0".repeat(64) },
    mode: "BASELINE",
    pack_ref: null,
    environment_digest: "1".repeat(64),
    harness_version: "UPG-HARNESS1.0",
    executed_at: NOW,
    executed_by: ACTOR_AUTHOR,
    per_task: [],
    aggregate: { task_count: 0, mean_score: 0 },
    evidence: [],
  });
  assert.equal(run.success, true);
  const delta = beforeAfterDeltaSchema.safeParse({
    schema_version: "UPG1.0",
    delta_id: "dlt_00000001",
    tenant_id: TENANT_ALPHA,
    proposal_id: "prp_00000001",
    baseline_run_ref: { run_id: "run_evalbase001", content_digest: "2".repeat(64) },
    candidate_run_ref: { run_id: "run_evalcand001", content_digest: "3".repeat(64) },
    target: { task_count: 3, baseline_mean: 0, candidate_mean: 1, delta: 1 },
    regression: { case_count: 0, baseline_failures: 0, candidate_failures: 0, new_failures: [] },
    leakage: { probes: [], all_passed: true },
    guardrails: { cases: [], all_passed: true },
    thresholds: { min_target_metric_delta: 0.5, max_regression_failures: 0, require_leakage_pass: true, require_guardrail_pass: true },
    thresholds_met: true,
    confidence_caveats: ["deterministic mock harness: no live model evaluation is claimed"],
  });
  assert.equal(delta.success, true);
  assert.equal(
    publicationDecisionSchema.safeParse({
      schema_version: "UPG1.0",
      decision_id: "dec_00000001",
      tenant_id: TENANT_ALPHA,
      proposal_id: "prp_00000001",
      outcome: "BLOCKED",
      reason_code: "rights_no_grant",
      threshold_evaluation: {
        thresholds: { min_target_metric_delta: 0.5, max_regression_failures: 0, require_leakage_pass: true, require_guardrail_pass: true },
        observed: { target_delta: 1, new_regression_failures: 0, leakage_passed: true, guardrails_passed: true },
        met: true,
      },
      rights_snapshot: { evaluated_at: NOW, state: "UNKNOWN", grant_id: null, scope: null, reason: "no_grant" },
      published_pack: null,
      rollback_pointer: null,
      adopting_client: null,
      scope: { tenant_id: TENANT_ALPHA, rights_scope: "single_tenant_reuse" },
      evidence: [],
      decided_at: NOW,
      decided_by: ACTOR_AUTHOR,
      feedback: { usage_counter_at_decision: 0, note: "feedback only" },
    }).success,
    true,
  );
  assert.equal(
    rollbackRecordSchema.safeParse({
      schema_version: "UPG1.0",
      rollback_id: "rlb_00000001",
      tenant_id: TENANT_ALPHA,
      pack_id: "pck_00000001",
      from_version: 2,
      to_version: 1,
      reason: "post-adoption regression",
      at: NOW,
      actor: ACTOR_AUTHOR,
      evidence_refs: [],
    }).success,
    true,
  );
  assert.equal(
    adoptionRecordSchema.safeParse({
      schema_version: "UPG1.0",
      adoption_id: "adp_00000001",
      tenant_id: TENANT_ALPHA,
      pack_id: "pck_00000001",
      version: 1,
      decision_id: "dec_00000001",
      client: { client_application_id: "app_00000001", agent_id: "agt_00000001" },
      adopted_at: NOW,
      active: true,
    }).success,
    true,
  );
});

test("contracts: the four error-code spaces are disjoint (no cross-family drift)", () => {
  const cfCodes = arenaErrorCodeSchema.options;
  const acqCodes = acqErrorCodeSchema.options;
  const scrpCodes = scrpErrorCodeSchema.options;
  const upgCodes = upgErrorCodeSchema.options;
  for (const code of upgCodes) {
    assert.equal((cfCodes as readonly string[]).includes(code), false, `${code} must not exist in CF1.0`);
    assert.equal((acqCodes as readonly string[]).includes(code), false, `${code} must not exist in ACQ1.0`);
    assert.equal((scrpCodes as readonly string[]).includes(code), false, `${code} must not exist in SCRP1.0`);
  }
  assert.equal(arenaErrorCodeSchema.safeParse("UPG_NOT_FOUND").success, false);
  assert.equal(acqErrorCodeSchema.safeParse("UPG_RIGHTS_DENIED").success, false);
  assert.equal(scrpErrorCodeSchema.safeParse("UPG_LEAKAGE_DETECTED").success, false);
});

test("contracts: canonical digests are stable across key order in this family too", () => {
  const value = { z: 1, a: { y: [true, null, ""], b: 2 } };
  assert.equal(computeCanonicalDigest(value), computeCanonicalDigest(deepReverseKeys(value)));
});

function deepReverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepReverseKeys);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0));
    const result: Record<string, unknown> = {};
    for (const [key, inner] of entries) result[key] = deepReverseKeys(inner);
    return result;
  }
  return value;
}
