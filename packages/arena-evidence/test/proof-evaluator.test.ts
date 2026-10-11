import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceEnvelope, ProofPolicySnapshot } from "@arena/contracts";
import { evaluateProof, type ProofEvaluationInput } from "../src/contract.js";
import type { NormalizedValidatorOutput } from "../src/contract.js";

/**
 * AR2-007 — proof-class 评估器验收（issue #9 的四条验收标准）：
 *
 * 1. P0 before-fail/after-pass 编译/测试示例：基线失败 + 干预后通过 →
 *    SATISFIED；基线全通过 → FAILED（归因无从建立）；
 * 2. 失败/不确定 → 永不付款：ProofDecision 是 decision-only（payout_implication
 *    恒为 decision_only；FAILED/INCONCLUSIVE 不携带任何支付语义）；
 * 3. P1 非确定性校验器按冻结策略聚合：达标 → SATISFIED；flaky/不足 →
 *    INCONCLUSIVE（按 inconclusive_rule 路由）；失败样本 → FAILED；
 * 4. P2/P3 作者自评永不构成通过：自评存在时同样 INCONCLUSIVE(fail-closed)。
 */

function policy(overrides: Partial<ProofPolicySnapshot>): ProofPolicySnapshot {
  return {
    policy_version: "PVP1.0",
    content_digest: "1e".repeat(32),
    selected_class: "P0",
    selection_rationale: "deterministic validator establishes the outcome",
    per_criterion_classes: [{ criterion_id: "crt_00000001", proof_class: "P0" }],
    validators: [
      {
        validator_id: "val_00000001",
        validator_version: "1.2.0",
        kind: "deterministic",
        allowed_commands: ["pnpm", "test"],
        timeout_seconds: 1800,
        resource_limits: "2 vCPU / 3 GB",
        evidence_policy: "trusted runner logs and hashes",
      },
    ],
    rerun_policy: { minimum_reruns: 2, risk_exception: null },
    sample_policy: null,
    review_policy: null,
    observation_policy: null,
    payout_gate: {
      release_requires: "all_predicates_pass",
      caller_authenticity_verified: true,
      task_binding_verified: true,
      dispute_blocks_release: true,
    },
    retry_next_expert: {
      max_attempts: 3,
      max_aggregate_spend: 500,
      cooldown_policy: "48h",
      failed_attempt_posture: "isolate_branch",
      next_expert_baseline: "baseline_plus_approved_prior_attempts",
    },
    timeout: "72h",
    dispute_conditions: "logs contradict outcome",
    budget_ceiling: 500,
    ...overrides,
  };
}

function run(
  verdict: "PASS" | "FAIL" | "INCONCLUSIVE",
  note = "",
  kind: "deterministic" | "statistical" | "rubric" | "field_observer" = "deterministic",
): NormalizedValidatorOutput {
  return {
    validator_id: "val_00000001",
    validator_version: "1.2.0",
    kind,
    verdict:
      verdict === "PASS"
        ? { kind: "PASS" }
        : verdict === "FAIL"
          ? { kind: "FAIL", reason: note || "exit_code=1" }
          : { kind: "INCONCLUSIVE", reason: note || "runner wedged" },
    samples: kind === "statistical" ? [{ passed: verdict === "PASS", note }] : [],
    dimensions: [],
    duration_ms: 100,
    failure: null,
  };
}

function evidence(
  id: string,
  tier: EvidenceEnvelope["provenance"]["issuer_tier"] = "arena_runner",
): EvidenceEnvelope {
  return {
    evidence_id: id,
    object: {
      content_digest: "ab".repeat(32),
      size_bytes: 128,
      media_type: "application/json",
      storage_ref: `mem://evidence/${id}`,
    },
    provenance: {
      issuer_tier: tier,
      issuer_id: "run_00000001",
      signature_algorithm: tier === "untrusted_attachment" ? null : "ed25519",
      signature: tier === "untrusted_attachment" ? null : "sig_00000001",
      issued_at: "2026-10-11T00:00:00Z",
      replay_protection: "nonce",
    },
    binding: {
      tenant_id: "tnt_00000001",
      escalation_id: "esc_00000001",
      attempt_id: "att_00000001",
      environment_digest: "cd".repeat(32),
      validator_id: "val_00000001",
      validator_version: "1.2.0",
    },
    redaction_class: tier === "untrusted_attachment" ? "internal" : "tenant",
    immutable: true,
    correction: null,
    recorded_at: "2026-10-11T00:00:00Z",
  };
}

test("P0 acceptance: baseline FAIL → post-intervention PASS (minimum_reruns honored)", () => {
  const input: ProofEvaluationInput = {
    policy: policy({}),
    baseline_runs: [run("FAIL", "exit_code=1 compile error")],
    post_intervention_runs: [run("PASS", "exit_code=0"), run("PASS", "exit_code=0")],
    evidence: [evidence("evd_00000001"), evidence("evd_00000002")],
    self_evaluation_present: false,
  };
  const decision = evaluateProof(input);
  assert.equal(decision.status, "SATISFIED");
  assert.equal(decision.selected_class, "P0");
  assert.equal(decision.payout_implication, "decision_only");
  assert.deepEqual(decision.trusted_evidence_ids, ["evd_00000001", "evd_00000002"]);
});

test("P0 rejects a passing baseline: intervention attribution cannot be established", () => {
  const input: ProofEvaluationInput = {
    policy: policy({}),
    baseline_runs: [run("PASS", "exit_code=0")],
    post_intervention_runs: [run("PASS", "exit_code=0"), run("PASS", "exit_code=0")],
    evidence: [evidence("evd_00000001")],
    self_evaluation_present: false,
  };
  const decision = evaluateProof(input);
  assert.equal(decision.status, "FAILED");
  assert.match(decision.basis, /baseline must demonstrate the failing pre-intervention state/);
});

test("P0 fail-closed: missing baseline and missing post runs are INCONCLUSIVE", () => {
  const noBaseline: ProofEvaluationInput = {
    policy: policy({}),
    baseline_runs: [],
    post_intervention_runs: [run("PASS", "exit_code=0")],
    evidence: [evidence("evd_00000001")],
    self_evaluation_present: false,
  };
  assert.equal(evaluateProof(noBaseline).status, "INCONCLUSIVE");

  const noPost: ProofEvaluationInput = {
    policy: policy({}),
    baseline_runs: [run("FAIL", "exit_code=1")],
    post_intervention_runs: [],
    evidence: [evidence("evd_00000001")],
    self_evaluation_present: false,
  };
  const decision = evaluateProof(noPost);
  assert.equal(decision.status, "INCONCLUSIVE");
  assert.equal(decision.routing_hint, "retry_within_budget");
});

test("P0: post-intervention failure → FAILED (next_expert routing); inconclusive rerun → INCONCLUSIVE", () => {
  const failed: ProofEvaluationInput = {
    policy: policy({}),
    baseline_runs: [run("FAIL", "exit_code=1")],
    post_intervention_runs: [run("PASS", "exit_code=0"), run("FAIL", "exit_code=1")],
    evidence: [evidence("evd_00000001")],
    self_evaluation_present: false,
  };
  const failedDecision = evaluateProof(failed);
  assert.equal(failedDecision.status, "FAILED");
  assert.equal(failedDecision.routing_hint, "next_expert");

  const inconclusive: ProofEvaluationInput = {
    policy: policy({}),
    baseline_runs: [run("FAIL", "exit_code=1")],
    post_intervention_runs: [run("PASS", "exit_code=0"), run("INCONCLUSIVE", "runner wedged")],
    evidence: [evidence("evd_00000001")],
    self_evaluation_present: false,
  };
  const inconclusiveDecision = evaluateProof(inconclusive);
  assert.equal(inconclusiveDecision.status, "INCONCLUSIVE");
});

test("P0: fewer passing reruns than minimum_reruns → INCONCLUSIVE", () => {
  const input: ProofEvaluationInput = {
    policy: policy({}),
    baseline_runs: [run("FAIL", "exit_code=1")],
    post_intervention_runs: [run("PASS", "exit_code=0")],
    evidence: [evidence("evd_00000001")],
    self_evaluation_present: false,
  };
  const decision = evaluateProof(input);
  assert.equal(decision.status, "INCONCLUSIVE");
  assert.match(decision.basis, /at least 2 passing rerun\(s\); observed 1/);
});

test("P1 aggregation: all samples pass at the frozen size × repetitions → SATISFIED with details", () => {
  const p1 = policy({
    selected_class: "P1",
    per_criterion_classes: [{ criterion_id: "crt_00000001", proof_class: "P1" }],
    sample_policy: {
      sample_size: 3,
      repetitions: 2,
      aggregate_threshold: ">= 6/6 samples within 5% of target",
      inconclusive_rule: "retry_within_budget",
    },
  });
  const runs = [
    run("PASS", "sample 1", "statistical"),
    run("PASS", "sample 2", "statistical"),
    run("PASS", "sample 3", "statistical"),
    run("PASS", "repetition 2", "statistical"),
    run("PASS", "repetition 2", "statistical"),
    run("PASS", "repetition 2", "statistical"),
  ];
  const decision = evaluateProof({
    policy: p1,
    baseline_runs: [],
    post_intervention_runs: runs,
    evidence: [evidence("evd_00000001")],
    self_evaluation_present: false,
  });
  assert.equal(decision.status, "SATISFIED");
  assert.notEqual(decision.aggregation, null);
  assert.equal(decision.aggregation?.passed, 6);
  assert.equal(decision.aggregation?.meets_threshold, true);
});

test("P1 aggregation: any failing sample → FAILED (flaky never auto-passes)", () => {
  const p1 = policy({
    selected_class: "P1",
    per_criterion_classes: [{ criterion_id: "crt_00000001", proof_class: "P1" }],
    sample_policy: {
      sample_size: 3,
      repetitions: 2,
      aggregate_threshold: ">= 6/6 samples within 5% of target",
      inconclusive_rule: "retry_within_budget",
    },
  });
  const decision = evaluateProof({
    policy: p1,
    baseline_runs: [],
    post_intervention_runs: [
      run("PASS", "s1", "statistical"),
      run("PASS", "s2", "statistical"),
      run("PASS", "s3", "statistical"),
      run("PASS", "r2a", "statistical"),
      run("PASS", "r2b", "statistical"),
      run("FAIL", "flaky sample", "statistical"),
    ],
    evidence: [evidence("evd_00000001")],
    self_evaluation_present: false,
  });
  assert.equal(decision.status, "FAILED");
  assert.equal(decision.routing_hint, "next_expert");
});

test("P1 aggregation: insufficient/inconclusive samples → INCONCLUSIVE with the frozen routing rule", () => {
  const p1 = policy({
    selected_class: "P1",
    per_criterion_classes: [{ criterion_id: "crt_00000001", proof_class: "P1" }],
    sample_policy: {
      sample_size: 3,
      repetitions: 2,
      aggregate_threshold: ">= 6/6 samples within 5% of target",
      inconclusive_rule: "independent_review",
    },
  });
  const partial = evaluateProof({
    policy: p1,
    baseline_runs: [],
    post_intervention_runs: [run("PASS", "s1", "statistical"), run("PASS", "s2", "statistical")],
    evidence: [evidence("evd_00000001")],
    self_evaluation_present: false,
  });
  assert.equal(partial.status, "INCONCLUSIVE");
  assert.equal(partial.routing_hint, "independent_review");
  assert.equal(partial.aggregation?.meets_threshold, false);

  const inconclusiveRun = evaluateProof({
    policy: p1,
    baseline_runs: [],
    post_intervention_runs: [run("INCONCLUSIVE", "seed drift", "statistical")],
    evidence: [evidence("evd_00000001")],
    self_evaluation_present: false,
  });
  assert.equal(inconclusiveRun.status, "INCONCLUSIVE");
});

test("P2: author self-evaluation alone NEVER satisfies the proof (fail-closed, not a vote)", () => {
  const p2 = policy({
    selected_class: "P2",
    per_criterion_classes: [{ criterion_id: "crt_00000001", proof_class: "P2" }],
    review_policy: {
      minimum_independent_reviews: 2,
      raise_to: 3,
      blind: true,
      rubric_version: "1.0.0",
      adjudication_trigger: "score divergence > 2 on any dimension",
      abstention_policy: "abstain -> replacement reviewer",
    },
    validators: [
      {
        validator_id: "val_00000002",
        validator_version: "1.0.0",
        kind: "rubric",
        allowed_commands: ["review"],
        timeout_seconds: 600,
        resource_limits: "1 vCPU / 1 GB",
        evidence_policy: "blind candidate ids + rubric dimensions",
      },
    ],
  });
  const decision = evaluateProof({
    policy: p2,
    baseline_runs: [],
    post_intervention_runs: [run("PASS", "author says all criteria met", "rubric")],
    evidence: [evidence("evd_00000001")],
    self_evaluation_present: true,
  });
  assert.equal(decision.status, "INCONCLUSIVE");
  assert.equal(decision.self_evaluation_counted, false);
  assert.match(decision.basis, /NOT counted as an independent vote/);
  assert.equal(decision.routing_hint, "independent_review");
  assert.equal(decision.payout_implication, "decision_only");
});

test("P3: observation outcomes fail closed even with a self-evaluation present", () => {
  const p3 = policy({
    selected_class: "P3",
    per_criterion_classes: [{ criterion_id: "crt_00000001", proof_class: "P3" }],
    observation_policy: {
      observation_period: "30d",
      trusted_sources: ["operator telemetry feed"],
      attestation_rule: "signed daily attestations from >= 2 sources",
      interim_milestones: "7d checkpoint",
      dispute_process: "operator arbitration within 14d",
    },
  });
  const decision = evaluateProof({
    policy: p3,
    baseline_runs: [],
    post_intervention_runs: [],
    evidence: [evidence("evd_00000001")],
    self_evaluation_present: true,
  });
  assert.equal(decision.status, "INCONCLUSIVE");
  assert.equal(decision.self_evaluation_counted, false);
  assert.equal(decision.routing_hint, "fail_closed");
});

test("malformed snapshots fail closed: P1 without sample_policy / P2 without review_policy", () => {
  const malformedP1 = policy({
    selected_class: "P1",
    per_criterion_classes: [{ criterion_id: "crt_00000001", proof_class: "P1" }],
    sample_policy: null,
  });
  const d1 = evaluateProof({
    policy: malformedP1,
    baseline_runs: [],
    post_intervention_runs: [run("PASS", "s1", "statistical")],
    evidence: [],
    self_evaluation_present: false,
  });
  assert.equal(d1.status, "INCONCLUSIVE");
  assert.equal(d1.routing_hint, "fail_closed");

  const malformedP2 = policy({ selected_class: "P2", review_policy: null });
  const d2 = evaluateProof({
    policy: malformedP2,
    baseline_runs: [],
    post_intervention_runs: [],
    evidence: [],
    self_evaluation_present: false,
  });
  assert.equal(d2.status, "INCONCLUSIVE");
});

test("untrusted attachments are excluded from the decision's trusted evidence set", () => {
  const decision = evaluateProof({
    policy: policy({}),
    baseline_runs: [run("FAIL", "exit_code=1")],
    post_intervention_runs: [run("PASS", "exit_code=0"), run("PASS", "exit_code=0")],
    evidence: [evidence("evd_00000001"), evidence("evd_00000002", "untrusted_attachment")],
    self_evaluation_present: false,
  });
  assert.deepEqual(decision.trusted_evidence_ids, ["evd_00000001"]);
});
