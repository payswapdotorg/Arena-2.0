import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceEnvelope, ProofPolicySnapshot } from "@arena/contracts";
import { evaluateProof, type NormalizedValidatorOutput } from "@arena/evidence";
import {
  applyPredeclaredValidation,
  recordAdjudication,
  selectRoundOutcome,
  popularityCannotOverrideProof,
} from "../src/contract.js";
import type { CandidateValidationInput } from "../src/contract.js";

/**
 * AR2-009 — 裁定 + 轮结果 + 同一预声明验证（issue #11 验收）：
 * P0 赢家绑定 SATISFIED 的 AR2-007 验证证据（票数不能替代）；
 * P2 赢家必须来自独立决定（作者声明/人气不够）；
 * hard-stop 失败永远 NO_WINNER；裁定人独立性类型化强制；
 * 全部合格候选应用同一预声明验证；支付只有操作 id 引用。
 */

const P0_POLICY: ProofPolicySnapshot = {
  policy_version: "PVP1.0",
  content_digest: "cd".repeat(32),
  selected_class: "P0",
  selection_rationale: "Deterministic fixture comparison only",
  per_criterion_classes: [{ criterion_id: "cri_00000001", proof_class: "P0" }],
  validators: [
    {
      validator_id: "val_00000001",
      validator_version: "1.0.0",
      kind: "deterministic",
      allowed_commands: ["node", "tsx"],
      timeout_seconds: 300,
      resource_limits: "test: 2 cpu, 2GiB memory",
      evidence_policy: "test: stdout captured, no network",
    },
  ],
  rerun_policy: { minimum_reruns: 1, risk_exception: null },
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
    cooldown_policy: "test: exponential",
    failed_attempt_posture: "retain_attributed",
    next_expert_baseline: "immutable_baseline_only",
  },
  timeout: "test: 24h",
  dispute_conditions: "test: any hard-stop failure",
  budget_ceiling: 400,
};

function run(verdict: "PASS" | "FAIL"): NormalizedValidatorOutput {
  return {
    validator_id: "val_00000001",
    validator_version: "1.0.0",
    kind: "deterministic",
    verdict: { kind: verdict, reason: `scripted ${verdict}` },
    samples: [],
    dimensions: [],
    duration_ms: 42,
    failure: null,
  };
}

function evidence(evidenceId: string): EvidenceEnvelope {
  return {
    evidence_id: evidenceId,
    object: {
      content_digest: "ab".repeat(32),
      size_bytes: 128,
      media_type: "application/json",
      storage_ref: `test://evidence/${evidenceId}`,
    },
    provenance: {
      issuer_tier: "arena_runner",
      issuer_id: "run_00000001",
      signature_algorithm: "test-hmac-sha256",
      signature: "sig_test_00000001",
      issued_at: "2026-10-11T07:00:00Z",
      replay_protection: "nonce",
    },
    binding: {
      tenant_id: "tnt_00000001",
      escalation_id: "esc_00000001",
      attempt_id: "att_00000001",
      environment_digest: "cd".repeat(32),
      validator_id: "val_00000001",
      validator_version: "1.0.0",
    },
    redaction_class: "tenant",
    immutable: true,
    correction: null,
    recorded_at: "2026-10-11T07:01:00Z",
  };
}

function candidateValidation(
  candidateId: string,
  post: readonly NormalizedValidatorOutput[],
): CandidateValidationInput {
  return {
    candidate_id: candidateId,
    baseline_runs: [run("FAIL")],
    post_intervention_runs: post,
    evidence: [evidence(`evd_${candidateId.slice(-8)}`)],
    self_evaluation_present: true,
  };
}

test("identical predeclared validation is applied to every eligible candidate", () => {
  const decisions = applyPredeclaredValidation({
    policy: P0_POLICY,
    candidates: [
      candidateValidation("cand_00000001", [run("PASS")]),
      candidateValidation("cand_00000002", [run("FAIL")]),
      candidateValidation("cand_00000003", [run("PASS")]),
    ],
  });
  assert.equal(decisions.length, 3);
  // 同一 policy、同一求值器：PASS 的候选全部 SATISFIED，FAIL 的 FAILED。
  for (const decision of decisions) {
    assert.equal(decision.decision.selected_class, "P0");
    assert.equal(decision.decision.self_evaluation_counted, false);
  }
  const byId = new Map(
    decisions.map((decision) => [decision.candidate_id, decision.decision.status]),
  );
  assert.equal(byId.get("cand_00000001"), "SATISFIED");
  assert.equal(byId.get("cand_00000002"), "FAILED");
  assert.equal(byId.get("cand_00000003"), "SATISFIED");
});

test("P0 winning candidate payment is tied to verified validator evidence, not votes", () => {
  // 真实 AR2-007 决策（非手造）：baseline FAIL → post PASS ⇒ SATISFIED。
  const satisfied = evaluateProof({
    policy: P0_POLICY,
    baseline_runs: [run("FAIL")],
    post_intervention_runs: [run("PASS")],
    evidence: [evidence("evd_00000001")],
    self_evaluation_present: true,
  });
  assert.equal(satisfied.status, "SATISFIED");

  const outcome = selectRoundOutcome({
    round_id: "round_00000001",
    proof_class: "P0",
    proof_decision: satisfied,
    independent_decision_reached: false, // P0：不需要独立评审聚合
    hard_stop_criteria_failed: false,
    indicated_candidate_id: "cand_00000001",
    payment_operation_reference: "pay_op_00000001",
  });
  assert.equal(outcome.kind, "WINNER_SELECTED");
  if (outcome.kind === "WINNER_SELECTED") {
    assert.equal(outcome.selection_basis, "validator_evidence");
    assert.equal(outcome.proof_decision_status, "SATISFIED");
    assert.equal(outcome.payment_operation_reference, "pay_op_00000001");
    assert.equal(outcome.payment_authority, "external_arena_payment_domain");
  }

  // 没有验证证据（FAILED 决策）→ 没有赢家 —— 票数再多也不行。
  const failed = evaluateProof({
    policy: P0_POLICY,
    baseline_runs: [run("FAIL")],
    post_intervention_runs: [run("FAIL")],
    evidence: [evidence("evd_00000002")],
    self_evaluation_present: true,
  });
  assert.equal(failed.status, "FAILED");
  const noWinner = selectRoundOutcome({
    round_id: "round_00000002",
    proof_class: "P0",
    proof_decision: failed,
    independent_decision_reached: true,
    hard_stop_criteria_failed: false,
    indicated_candidate_id: "cand_00000001",
    payment_operation_reference: "pay_op_00000002",
  });
  assert.equal(noWinner.kind, "NO_WINNER");
  if (noWinner.kind === "NO_WINNER")
    assert.equal(noWinner.reason, "validator_evidence_not_satisfied");
});

test("P2 winner cannot be selected or paid based only on author claims or popularity", () => {
  // P2：独立决定缺失 → NO_WINNER（哪怕 hard-stop 没失败、人气再高）。
  const noIndependent = selectRoundOutcome({
    round_id: "round_00000003",
    proof_class: "P2",
    proof_decision: null,
    independent_decision_reached: false,
    hard_stop_criteria_failed: false,
    indicated_candidate_id: "cand_00000001",
    payment_operation_reference: "pay_op_00000003",
  });
  assert.equal(noIndependent.kind, "NO_WINNER");
  if (noIndependent.kind === "NO_WINNER") {
    assert.equal(noIndependent.reason, "independent_decision_missing");
    assert.equal(noIndependent.approval_implied, false);
  }

  // 独立决定达成 → 赢家（basis = independent_decision，非验证器）。
  const withIndependent = selectRoundOutcome({
    round_id: "round_00000003",
    proof_class: "P2",
    proof_decision: null,
    independent_decision_reached: true,
    hard_stop_criteria_failed: false,
    indicated_candidate_id: "cand_00000002",
    payment_operation_reference: "pay_op_00000004",
  });
  assert.equal(withIndependent.kind, "WINNER_SELECTED");
  if (withIndependent.kind === "WINNER_SELECTED") {
    assert.equal(withIndependent.selection_basis, "independent_decision");
    assert.equal(withIndependent.proof_decision_status, null);
  }

  // hard-stop 失败优先于一切。
  const hardStop = selectRoundOutcome({
    round_id: "round_00000004",
    proof_class: "P2",
    proof_decision: null,
    independent_decision_reached: true,
    hard_stop_criteria_failed: true,
    indicated_candidate_id: "cand_00000001",
    payment_operation_reference: "pay_op_00000005",
  });
  assert.equal(hardStop.kind, "NO_WINNER");
  if (hardStop.kind === "NO_WINNER") assert.equal(hardStop.reason, "hard_stop_criteria_failed");
});

test("popularity cannot override proof (explicit frozen refusal)", () => {
  const refusal = popularityCannotOverrideProof({
    votes_for_candidate: 1_000_000,
    hard_stop_criteria_failed: true,
  });
  assert.equal(refusal.override_allowed, false);
  assert.match(refusal.explanation, /hard-stop/);
  const withoutFailure = popularityCannotOverrideProof({
    votes_for_candidate: 1_000_000,
    hard_stop_criteria_failed: false,
  });
  assert.equal(withoutFailure.override_allowed, false);
  assert.match(withoutFailure.explanation, /popularity never substitutes for proof/);
});

test("material disagreement produces an adjudication record with an independent adjudicator", () => {
  const valid = recordAdjudication({
    adjudication_id: "adj_00000001",
    round_id: "round_00000001",
    trigger: "verdict_divergence",
    adjudicator_expert_id: "exp_00000099",
    decided_at: "2026-10-11T09:00:00Z",
    rationale:
      "Reviewer verdicts diverged; evidence weight favors cand_00000001 with recorded basis",
    evidence_refs: ["evd_00000001", "evd_00000002"],
    winning_candidate_id: "cand_00000001",
    adjudicator_independent_of: {
      candidate_authors: ["exp_00000001", "exp_00000002"],
      prior_reviewers: ["exp_00000010", "exp_00000011"],
    },
  });
  assert.equal(valid.kind, "RECORDED");
  if (valid.kind === "RECORDED") {
    assert.equal(valid.record.trigger, "verdict_divergence");
    assert.equal(valid.record.winning_candidate_id, "cand_00000001");
  }

  // 裁定人是候选作者 → 类型化拒绝（独立性）。
  const authorAdjudicator = recordAdjudication({
    adjudication_id: "adj_00000002",
    round_id: "round_00000001",
    trigger: "score_disagreement",
    adjudicator_expert_id: "exp_00000001",
    decided_at: "2026-10-11T09:30:00Z",
    rationale: "attempt to self-adjudicate",
    evidence_refs: [],
    winning_candidate_id: "cand_00000001",
    adjudicator_independent_of: {
      candidate_authors: ["exp_00000001"],
      prior_reviewers: [],
    },
  });
  assert.equal(authorAdjudicator.kind, "REJECTED");

  // 裁定人是本轮评审人 → 类型化拒绝（可行处独立）。
  const reviewerAdjudicator = recordAdjudication({
    adjudication_id: "adj_00000003",
    round_id: "round_00000001",
    trigger: "reviewer_conflict",
    adjudicator_expert_id: "exp_00000010",
    decided_at: "2026-10-11T09:45:00Z",
    rationale: "attempt to adjudicate own review",
    evidence_refs: [],
    winning_candidate_id: "cand_00000001",
    adjudicator_independent_of: {
      candidate_authors: ["exp_00000001"],
      prior_reviewers: ["exp_00000010"],
    },
  });
  assert.equal(reviewerAdjudicator.kind, "REJECTED");

  // 未知触发器 → schema 拒绝。
  const unknownTrigger = recordAdjudication({
    adjudication_id: "adj_00000004",
    round_id: "round_00000001",
    trigger: "because_i_said_so",
    adjudicator_expert_id: "exp_00000099",
    decided_at: "2026-10-11T10:00:00Z",
    rationale: "invalid trigger",
    evidence_refs: [],
    winning_candidate_id: null,
    adjudicator_independent_of: { candidate_authors: [], prior_reviewers: [] },
  });
  assert.equal(unknownTrigger.kind, "REJECTED");
});

test("traceability: winner, policy basis, evidence decision and payment reference are stable ids", () => {
  const satisfied = evaluateProof({
    policy: P0_POLICY,
    baseline_runs: [run("FAIL")],
    post_intervention_runs: [run("PASS")],
    evidence: [evidence("evd_00000009")],
    self_evaluation_present: true,
  });
  const outcome = selectRoundOutcome({
    round_id: "round_00000009",
    proof_class: "P0",
    proof_decision: satisfied,
    independent_decision_reached: false,
    hard_stop_criteria_failed: false,
    indicated_candidate_id: "cand_00000009",
    payment_operation_reference: "pay_op_00000009",
  });
  assert.equal(outcome.kind, "WINNER_SELECTED");
  if (outcome.kind === "WINNER_SELECTED") {
    assert.equal(outcome.round_id, "round_00000009");
    assert.equal(outcome.winning_candidate_id, "cand_00000009");
    assert.equal(outcome.proof_decision_status, "SATISFIED");
    assert.equal(outcome.payment_operation_reference, "pay_op_00000009");
    // 无独立支付权威：支付语义只是「外部支付域的引用」。
    assert.equal(outcome.payment_authority, "external_arena_payment_domain");
  }
});
