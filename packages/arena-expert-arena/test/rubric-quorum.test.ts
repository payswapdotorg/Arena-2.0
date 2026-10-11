import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAgainstRubric, evaluateQuorum, detectDisagreement } from "../src/contract.js";
import type { FrozenRubric, ReviewerEvaluation } from "../src/contract.js";

/**
 * AR2-009 — rubric 评分 + quorum（issue #11 验收）：
 * 逐维度判定被记录（不只是均值）；hard-stop 失败阻断 accept（均值/票数
 * 不能越过）；quorum 只统计独立完成评审且缺失时 fail-closed；
 * 分歧（结论分歧/升级/分数离散）触发裁定；自评在计数集合中结构性缺席。
 */

const RUBRIC: FrozenRubric = {
  rubric_version: "rub_00000001",
  dimensions: [
    {
      dimension_id: "dim_correctness",
      name: "Correctness",
      weight: 0.5,
      hard_stop: true,
      scoring_guide: "Pinned fixture comparison must fully pass",
    },
    {
      dimension_id: "dim_evidence",
      name: "Evidence quality",
      weight: 0.3,
      hard_stop: false,
      scoring_guide: "Evidence refs support every nontrivial claim",
    },
    {
      dimension_id: "dim_clarity",
      name: "Clarity",
      weight: 0.2,
      hard_stop: false,
      scoring_guide: "Reproducer and rationale are followable",
    },
  ],
  weights_sum_to_one: true,
};

function evaluation(
  reviewerId: string,
  scores: Record<string, number>,
  verdict: ReviewerEvaluation["overall_verdict"] = "accept",
): ReviewerEvaluation {
  return {
    rubric_version: RUBRIC.rubric_version,
    reviewer_expert_id: reviewerId,
    dimension_scores: Object.entries(scores).map(([dimension_id, score]) => ({
      dimension_id,
      score,
      explanation: `${reviewerId} explains the nontrivial score for ${dimension_id}`,
      evidence_refs: ["evd_00000001"],
      uncertainty: 0.1,
    })),
    overall_verdict: verdict,
    safety_or_professional_concerns: [],
    nontrivial_score_explanations_present: true,
  };
}

test("rubric scoring records per-dimension decisions, not only a mean", () => {
  const result = evaluateAgainstRubric({
    rubric: RUBRIC,
    evaluations: [
      evaluation("exp_00000010", { dim_correctness: 1, dim_evidence: 0.8, dim_clarity: 0.9 }),
      evaluation("exp_00000011", { dim_correctness: 1, dim_evidence: 0.6, dim_clarity: 0.7 }),
    ],
  });
  assert.equal(result.kind, "WELL_FORMED");
  if (result.kind === "WELL_FORMED") {
    assert.equal(result.dimension_decisions.length, 3);
    const evidence = result.dimension_decisions.find((d) => d.dimension_id === "dim_evidence");
    assert.ok(evidence !== undefined);
    assert.equal(evidence.mean_score, 0.7);
    assert.equal(evidence.hard_stop, false);
    assert.equal(result.hard_stop_failed, false);
    assert.ok(result.weighted_mean > 0 && result.weighted_mean < 1);
  }
});

test("hard-stop dimension failure blocks acceptance regardless of mean or votes", () => {
  const result = evaluateAgainstRubric({
    rubric: RUBRIC,
    evaluations: [
      evaluation("exp_00000010", { dim_correctness: 1, dim_evidence: 0.9, dim_clarity: 0.9 }),
      evaluation("exp_00000011", { dim_correctness: 0.4, dim_evidence: 0.9, dim_clarity: 0.9 }),
    ],
  });
  assert.equal(result.kind, "WELL_FORMED");
  if (result.kind === "WELL_FORMED") {
    assert.equal(result.hard_stop_failed, true);
    const correctness = result.dimension_decisions.find(
      (d) => d.dimension_id === "dim_correctness",
    );
    assert.ok(correctness !== undefined);
    assert.equal(correctness.failed, true);
    // 即便其它维度均值很高，hard-stop 失败仍是整体失败。
    assert.ok(result.weighted_mean >= 0.8);
  }
});

test("missing required dimension scores are typed rejections", () => {
  const partial: ReviewerEvaluation = {
    ...evaluation("exp_00000010", { dim_correctness: 1, dim_evidence: 0.8 }),
  };
  const result = evaluateAgainstRubric({ rubric: RUBRIC, evaluations: [partial] });
  assert.equal(result.kind, "REJECTED");
  if (result.kind === "REJECTED") {
    assert.ok(result.issues.some((issue) => issue.rule.includes("dim_clarity")));
  }
});

test("rubric version mismatch is a typed rejection (frozen rubric discipline)", () => {
  const otherVersion: ReviewerEvaluation = {
    ...evaluation("exp_00000010", { dim_correctness: 1, dim_evidence: 0.8, dim_clarity: 0.8 }),
    rubric_version: "rub_99999999",
  };
  const result = evaluateAgainstRubric({ rubric: RUBRIC, evaluations: [otherVersion] });
  assert.equal(result.kind, "REJECTED");
});

test("quorum counts only independent reviews and fails closed when short", () => {
  const rubricEvaluation = evaluateAgainstRubric({
    rubric: RUBRIC,
    evaluations: [
      evaluation("exp_00000010", { dim_correctness: 1, dim_evidence: 0.8, dim_clarity: 0.8 }),
      evaluation("exp_00000011", { dim_correctness: 1, dim_evidence: 0.8, dim_clarity: 0.8 }),
    ],
  });
  assert.equal(rubricEvaluation.kind, "WELL_FORMED");

  // 只完成 1/2（P2 下限）。
  const short = evaluateQuorum({
    required_reviewers: 2,
    raised_to: null,
    finalized_reviews: [
      evaluation("exp_00000010", { dim_correctness: 1, dim_evidence: 0.8, dim_clarity: 0.8 }),
    ],
    rubric_evaluation: rubricEvaluation,
  });
  assert.equal(short.kind, "QUORUM_NOT_REACHED");
  if (short.kind === "QUORUM_NOT_REACHED") {
    assert.equal(short.approval_implied, false);
    assert.equal(short.action, "request_replacement_or_escalate");
  }

  // 达成 2/2。
  const reached = evaluateQuorum({
    required_reviewers: 2,
    raised_to: null,
    finalized_reviews: [
      evaluation("exp_00000010", { dim_correctness: 1, dim_evidence: 0.8, dim_clarity: 0.8 }),
      evaluation("exp_00000011", { dim_correctness: 1, dim_evidence: 0.8, dim_clarity: 0.8 }),
    ],
    rubric_evaluation: rubricEvaluation,
  });
  assert.equal(reached.kind, "QUORUM_REACHED");
  if (reached.kind === "QUORUM_REACHED") {
    assert.equal(reached.counted, 2);
    // 结构性证据：计数集合自评条目数恒为 0（类型上不可能出现）。
    assert.equal(reached.self_evaluation_entries, 0);
  }

  // 高影响轮升到 3（raise_to）：2/3 仍 fail-closed。
  const raised = evaluateQuorum({
    required_reviewers: 2,
    raised_to: 3,
    finalized_reviews: [
      evaluation("exp_00000010", { dim_correctness: 1, dim_evidence: 0.8, dim_clarity: 0.8 }),
      evaluation("exp_00000011", { dim_correctness: 1, dim_evidence: 0.8, dim_clarity: 0.8 }),
    ],
    rubric_evaluation: rubricEvaluation,
  });
  assert.equal(raised.kind, "QUORUM_NOT_REACHED");
});

test("material disagreement produces an adjudication trigger", () => {
  // 1) 结论分歧（accept vs reject）。
  const divergence = detectDisagreement({
    evaluations: [
      evaluation(
        "exp_00000010",
        { dim_correctness: 1, dim_evidence: 0.8, dim_clarity: 0.8 },
        "accept",
      ),
      evaluation(
        "exp_00000011",
        { dim_correctness: 1, dim_evidence: 0.8, dim_clarity: 0.8 },
        "reject",
      ),
    ],
    disagreement_threshold: 0.4,
  });
  assert.equal(divergence.adjudication_required, true);
  if (divergence.adjudication_required) assert.equal(divergence.trigger, "verdict_divergence");

  // 2) 分数离散超阈值。
  const spread = detectDisagreement({
    evaluations: [
      evaluation("exp_00000010", { dim_correctness: 1, dim_evidence: 0.9, dim_clarity: 0.8 }),
      evaluation("exp_00000011", { dim_correctness: 1, dim_evidence: 0.2, dim_clarity: 0.8 }),
    ],
    disagreement_threshold: 0.4,
  });
  assert.equal(spread.adjudication_required, true);
  if (spread.adjudication_required) assert.equal(spread.trigger, "score_disagreement");

  // 3) 评审人升级（安全关切）。
  const escalated = detectDisagreement({
    evaluations: [
      evaluation("exp_00000010", { dim_correctness: 1, dim_evidence: 0.8, dim_clarity: 0.8 }),
      evaluation(
        "exp_00000011",
        { dim_correctness: 1, dim_evidence: 0.8, dim_clarity: 0.8 },
        "escalate",
      ),
    ],
    disagreement_threshold: 0.4,
  });
  assert.equal(escalated.adjudication_required, true);

  // 4) 一致同意 + 低离散 → 无裁定。
  const agree = detectDisagreement({
    evaluations: [
      evaluation("exp_00000010", { dim_correctness: 1, dim_evidence: 0.8, dim_clarity: 0.8 }),
      evaluation("exp_00000011", { dim_correctness: 1, dim_evidence: 0.75, dim_clarity: 0.8 }),
    ],
    disagreement_threshold: 0.4,
  });
  assert.equal(agree.adjudication_required, false);
});
