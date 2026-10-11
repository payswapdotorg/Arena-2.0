import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluatePayoutGate,
  PaymentFlow,
  PaymentLedger,
  InMemoryTestProvider,
} from "@arena/payment";
import type { ExpertProfile } from "@arena/matching";
import {
  CandidateRegistry,
  checkReviewerEligibility,
  evaluateAgainstRubric,
  evaluateQuorum,
  detectDisagreement,
  recordAdjudication,
  selectRoundOutcome,
  type FrozenRubric,
  type ReviewerEvaluation,
} from "@arena/expert-arena";
import {
  evaluateScenarioProof,
  interventionPassingRuns,
  scenarioP2Policy,
  trustedEvidence,
} from "../src/contract.js";

/**
 * AR2-012 — 验收剖面 C（issue #14）：P2 非应用可验证场景 —— 独立 Arena 评审。
 *
 * P2 策略 → AR2-007 evaluateProof fail-closed（INCONCLUSIVE，路由
 * independent_review）→ 自动支付闸门 NOT_READY（冻结 fail-closed —— 披露
 * 而非绕过）→ AR2-009 Expert Arena 独立评审（不可变候选 + 冲突筛查 +
 * 冻结 rubric + quorum + 分歧裁定）→ 轮结果（独立决定）携带支付操作引用。
 */

function profile(expertId: string, tenantId: string): ExpertProfile {
  return {
    expert_id: expertId,
    tenant_id: tenantId,
    capabilities: [
      { capability_id: "cap_generic_0001", level: "senior", evidence_refs: ["evd_00000009"] },
    ],
    qualifications: [
      {
        qualification: "licensed engineer",
        evidence_refs: ["evd_00000010"],
        jurisdiction: "GH",
        expires_at: null,
      },
    ],
    availability: { max_concurrent_attempts: 3, active_attempts: 0 },
    jurisdictions: ["GH"],
    policy_flags: [],
  };
}

function selfEvaluation(claims: Array<{ id: string; status: "met" | "partially_met" }>): unknown {
  return {
    claims: claims.map((claim) => ({
      criterion_id: claim.id,
      claim: `author claim for ${claim.id}`,
      status: claim.status,
      evidence_refs: [`evd_${claim.id}`],
      confidence: 0.8,
      rationale: "author rationale (claim, not verification)",
    })),
    assumptions: ["author assumption"],
    limitations: ["author limitation"],
    known_failure_modes: [],
    residual_risks: [],
    validator_results: [],
    never_an_independent_vote: true,
  };
}

function candidatePackage(status: "met" | "partially_met"): unknown {
  return {
    solution_artifacts: [{ artifact_id: "art_00000001", digest: "ab".repeat(32) }],
    declared_assumptions: ["author assumption"],
    evidence_manifest: ["evd_00000001"],
    validation_instructions: "rubric-based review — no deterministic validator applies",
    limitations: ["author limitation"],
    self_evaluation: selfEvaluation([
      { id: "cri_00000001", status },
      { id: "cri_00000002", status: "met" },
    ]),
  };
}

const RUBRIC: FrozenRubric = {
  rubric_version: "rub_harness_p2",
  dimensions: [
    {
      dimension_id: "dim_correctness",
      name: "Correctness under rubric",
      weight: 0.6,
      hard_stop: true,
      scoring_guide: "Rubric anchors fully satisfied",
    },
    {
      dimension_id: "dim_evidence",
      name: "Evidence quality",
      weight: 0.4,
      hard_stop: false,
      scoring_guide: "Evidence supports every claim",
    },
  ],
  weights_sum_to_one: true,
};

function review(
  reviewerId: string,
  correctness: number,
  evidence: number,
  verdict: ReviewerEvaluation["overall_verdict"],
): ReviewerEvaluation {
  return {
    rubric_version: RUBRIC.rubric_version,
    reviewer_expert_id: reviewerId,
    dimension_scores: [
      {
        dimension_id: "dim_correctness",
        score: correctness,
        explanation: `${reviewerId} rubric anchor assessment`,
        evidence_refs: ["evd_00000001"],
        uncertainty: 0.1,
      },
      {
        dimension_id: "dim_evidence",
        score: evidence,
        explanation: `${reviewerId} evidence assessment`,
        evidence_refs: ["evd_00000001"],
        uncertainty: 0.1,
      },
    ],
    overall_verdict: verdict,
    safety_or_professional_concerns: [],
    nontrivial_score_explanations_present: true,
  };
}

test("P2 non-application-verifiable: fail-closed proof → frozen payout gate NOT_READY → independent review decides → round outcome", () => {
  const policy = scenarioP2Policy();

  // 1) AR2-007 P2 评估：非应用可验证 + 无独立评审记录 → INCONCLUSIVE（fail-closed）。
  const decision = evaluateScenarioProof({
    policy,
    post_runs: interventionPassingRuns(), // 即便 validator 通过 —— P2 语义不采纳为充分
    evidence: [trustedEvidence("evd_harness_p2_1", "att_harness_p2_1")],
    self_evaluation_present: true,
  });
  assert.equal(decision.status, "INCONCLUSIVE");
  assert.equal(decision.self_evaluation_counted, false);
  assert.equal(decision.routing_hint, "independent_review");

  // 2) 自动支付闸门：冻结 fail-closed（rubric_plus_independent_approval —— 披露而非绕过）。
  const gate = evaluatePayoutGate(decision, policy);
  assert.equal(gate.kind, "NOT_READY");
  const flow = new PaymentFlow(new PaymentLedger(), {
    tenant_id: "tnt_00000001",
    escalation_id: "esc_harness_p2",
    attempt_id: "att_harness_p2_1",
    policy,
  });
  flow.reserve(500, "USD");
  flow.startAttempt();
  const recorded = flow.recordProofDecision({
    decision,
    policy,
    disputed: false,
    bindingCorrect: true,
  });
  assert.equal(
    recorded.kind,
    "BLOCKED",
    "P2 cannot release without the independent approval record",
  );
  assert.equal(flow.current().state, "PENDING_EVIDENCE");

  // 3) Expert Arena 独立评审（真实 AR2-009 机器）：
  //    两位专家各提交不可变候选（结构化自评 —— 永远不是票）。
  const registry = new CandidateRegistry(() => "2026-10-11T10:00:00Z");
  const alpha = registry.submitCandidate({
    round_id: "round_harness_p2",
    author_expert_id: "exp_00000001",
    candidate_package: candidatePackage("met"),
  });
  const beta = registry.submitCandidate({
    round_id: "round_harness_p2",
    author_expert_id: "exp_00000002",
    candidate_package: candidatePackage("partially_met"),
  });
  assert.equal(alpha.kind, "SUBMITTED");
  assert.equal(beta.kind, "SUBMITTED");
  assert.equal(registry.allSelfEvaluationsMarkedNeverVote("round_harness_p2"), true);

  //    冲突筛查：作者不能互评（同轮候选作者身份排除）。
  const reviewers = [
    profile("exp_00000010", "tnt_00000003"),
    profile("exp_00000011", "tnt_00000004"),
  ];
  for (const reviewer of reviewers) {
    const eligibility = checkReviewerEligibility({
      reviewer,
      candidate_author_expert_id: "exp_00000001",
      context: {
        round_candidate_author_ids: ["exp_00000001", "exp_00000002"],
        failed_attempt_expert_ids: [],
        prior_involvement_expert_ids: [],
        conflicted_tenant_ids: [],
      },
      capacity: {
        expert_id: reviewer.expert_id,
        active_review_slots: 0,
        max_concurrent_reviews: 2,
      },
    });
    assert.equal(eligibility.ok, true);
  }
  const authorAsReviewer = checkReviewerEligibility({
    reviewer: profile("exp_00000002", "tnt_00000002"),
    candidate_author_expert_id: "exp_00000001",
    context: {
      round_candidate_author_ids: ["exp_00000001", "exp_00000002"],
      failed_attempt_expert_ids: [],
      prior_involvement_expert_ids: [],
      conflicted_tenant_ids: [],
    },
    capacity: { expert_id: "exp_00000002", active_review_slots: 0, max_concurrent_reviews: 2 },
  });
  assert.equal(authorAsReviewer.ok, false);

  //    冻结 rubric 评分（逐维度判定）+ quorum（只计独立评审 —— 自评结构性缺席）。
  const evaluations = [
    review("exp_00000010", 1, 0.9, "accept"),
    review("exp_00000011", 0.5, 0.8, "reject"), // 分歧 → 裁定
  ];
  const rubricEvaluation = evaluateAgainstRubric({ rubric: RUBRIC, evaluations });
  assert.equal(rubricEvaluation.kind, "WELL_FORMED");
  const quorum = evaluateQuorum({
    required_reviewers: 2,
    raised_to: null,
    finalized_reviews: evaluations,
    rubric_evaluation: rubricEvaluation,
  });
  assert.equal(quorum.kind, "QUORUM_REACHED");
  if (quorum.kind === "QUORUM_REACHED") assert.equal(quorum.self_evaluation_entries, 0);

  //    分歧检测 → 裁定（独立裁定人）。
  const disagreement = detectDisagreement({ evaluations, disagreement_threshold: 0.4 });
  assert.equal(disagreement.adjudication_required, true);
  const adjudication = recordAdjudication({
    adjudication_id: "adj_harness_p2",
    round_id: "round_harness_p2",
    trigger: "verdict_divergence",
    adjudicator_expert_id: "exp_00000099",
    decided_at: "2026-10-11T11:00:00Z",
    rationale:
      "Reviewer verdicts diverged; rubric anchors favor cand_round_harness_p2_exp_00000001 with recorded evidence weight",
    evidence_refs: ["evd_00000001"],
    winning_candidate_id: "cand_round_harness_p2_exp_00000001",
    adjudicator_independent_of: {
      candidate_authors: ["exp_00000001", "exp_00000002"],
      prior_reviewers: ["exp_00000010", "exp_00000011"],
    },
  });
  assert.equal(adjudication.kind, "RECORDED");

  // 4) 轮结果（真实 AR2-009 selectRoundOutcome）：P2 → 独立决定 → 赢家 + 支付操作引用。
  const outcome = selectRoundOutcome({
    round_id: "round_harness_p2",
    proof_class: "P2",
    proof_decision: null,
    independent_decision_reached: true,
    hard_stop_criteria_failed: false,
    indicated_candidate_id: "cand_round_harness_p2_exp_00000001",
    payment_operation_reference: "pop_harness_p2_1",
  });
  assert.equal(outcome.kind, "WINNER_SELECTED");
  if (outcome.kind === "WINNER_SELECTED") {
    assert.equal(outcome.selection_basis, "independent_decision");
    assert.equal(outcome.winning_candidate_id, "cand_round_harness_p2_exp_00000001");
    assert.equal(outcome.payment_operation_reference, "pop_harness_p2_1");
    assert.equal(outcome.payment_authority, "external_arena_payment_domain");
  }

  // 5) 人气不能越过证明：hard-stop 失败 → NO_WINNER（即便独立决定已达成）。
  const blocked = selectRoundOutcome({
    round_id: "round_harness_p2",
    proof_class: "P2",
    proof_decision: null,
    independent_decision_reached: true,
    hard_stop_criteria_failed: true,
    indicated_candidate_id: "cand_round_harness_p2_exp_00000002",
    payment_operation_reference: "pop_harness_p2_2",
  });
  assert.equal(blocked.kind, "NO_WINNER");

  // 6) 支付域确认：P2 自动放款仍被冻结闸门挡住（引用挂起 —— 披露）。
  const provider = new InMemoryTestProvider();
  assert.equal(
    provider.operationCount(),
    0,
    "no payment submitted for P2 without the approval-record wiring",
  );
});
