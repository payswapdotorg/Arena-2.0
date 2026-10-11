import { z } from "zod";
import { arenaIdSchema } from "@arena/contracts";
import { nonEmptyMedium as nonEmptyMediumSchema } from "./common.js";

/**
 * AR2-009 — 冻结 rubric 评分 + quorum 求值（EA1.0 §3/§4；issue #11）。
 *
 * 冻结纪律：
 * - rubric 在轮开启前冻结（版本化维度/权重/hard-stop；评分引擎记录
 *   rubric 版本与逐维度判定，绝不只记均值）；
 * - hard-stop 维度失败 → 整体绝不 accept：均值/票数/星级永远不能越过
 *   失败的硬性验收标准（EA1.0 §7「No crowd vote can override failed
 *   hard acceptance criteria」）；
 * - quorum 只统计独立完成的评审（FINALIZED）；自评在类型上就缺席
 *   （candidate.never_an_independent_vote: true）—— 不是运行时过滤，
 *   是结构不可能；
 * - quorum 未达 → fail-closed：请求补位/升级，绝不隐式批准。
 */

export const rubricDimensionSchema = z
  .object({
    dimension_id: arenaIdSchema,
    name: nonEmptyMediumSchema,
    weight: z.number().min(0).max(1),
    hard_stop: z.boolean(),
    scoring_guide: nonEmptyMediumSchema,
  })
  .strict();

export const frozenRubricSchema = z
  .object({
    rubric_version: arenaIdSchema,
    dimensions: z.array(rubricDimensionSchema).min(1).max(32),
    weights_sum_to_one: z.literal(true),
  })
  .strict();

export const reviewerVerdictSchema = z.enum(["accept", "reject", "revise", "abstain", "escalate"]);

export const dimensionScoreSchema = z
  .object({
    dimension_id: arenaIdSchema,
    score: z.number().min(0).max(1),
    explanation: nonEmptyMediumSchema,
    evidence_refs: z.array(arenaIdSchema).max(16),
    uncertainty: z.number().min(0).max(1),
  })
  .strict();

export const reviewerEvaluationSchema = z
  .object({
    rubric_version: arenaIdSchema,
    reviewer_expert_id: arenaIdSchema,
    dimension_scores: z.array(dimensionScoreSchema).min(1).max(32),
    overall_verdict: reviewerVerdictSchema,
    safety_or_professional_concerns: z.array(nonEmptyMediumSchema).max(16),
    nontrivial_score_explanations_present: z.literal(true),
  })
  .strict();

export type FrozenRubric = z.infer<typeof frozenRubricSchema>;
export type ReviewerEvaluation = z.infer<typeof reviewerEvaluationSchema>;
export type RubricDimension = z.infer<typeof rubricDimensionSchema>;
export type ReviewerVerdict = z.infer<typeof reviewerVerdictSchema>;

export type RubricScoreEvaluation =
  | {
      kind: "WELL_FORMED";
      rubric_version: string;
      /** 逐维度判定（记录保留 —— 不只是均值）。 */
      dimension_decisions: ReadonlyArray<{
        dimension_id: string;
        mean_score: number;
        hard_stop: boolean;
        failed: boolean;
      }>;
      weighted_mean: number;
      hard_stop_failed: boolean;
    }
  | { kind: "REJECTED"; issues: ReadonlyArray<{ field: string; rule: string }> };

/** 冻结 rubric 校验 + 聚合评审评分（结构检查 + 逐维度判定记录）。 */
export function evaluateAgainstRubric(input: {
  rubric: FrozenRubric;
  evaluations: readonly ReviewerEvaluation[];
}): RubricScoreEvaluation {
  const rubricCheck = frozenRubricSchema.safeParse(input.rubric);
  if (!rubricCheck.success) {
    return {
      kind: "REJECTED",
      issues: rubricCheck.error.issues.map((issue) => ({
        field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
        rule: issue.message,
      })),
    };
  }
  if (input.evaluations.length === 0) {
    return {
      kind: "REJECTED",
      issues: [{ field: "evaluations", rule: "at least one finalized review required" }],
    };
  }
  for (const evaluation of input.evaluations) {
    if (evaluation.rubric_version !== input.rubric.rubric_version) {
      return {
        kind: "REJECTED",
        issues: [
          {
            field: "rubric_version",
            rule: `evaluation rubric ${evaluation.rubric_version} does not match frozen rubric ${input.rubric.rubric_version}`,
          },
        ],
      };
    }
    for (const dimension of input.rubric.dimensions) {
      const scored = evaluation.dimension_scores.find(
        (score) => score.dimension_id === dimension.dimension_id,
      );
      if (scored === undefined) {
        return {
          kind: "REJECTED",
          issues: [
            {
              field: "dimension_scores",
              rule: `required dimension ${dimension.dimension_id} unscored by reviewer ${evaluation.reviewer_expert_id}`,
            },
          ],
        };
      }
    }
  }
  const dimensionDecisions = input.rubric.dimensions.map((dimension) => {
    const scores = input.evaluations
      .map((evaluation) =>
        evaluation.dimension_scores.find((score) => score.dimension_id === dimension.dimension_id),
      )
      .filter((score): score is NonNullable<typeof score> => score !== undefined);
    const mean = scores.reduce((sum, score) => sum + score.score, 0) / Math.max(scores.length, 1);
    return {
      dimension_id: dimension.dimension_id,
      mean_score: mean,
      hard_stop: dimension.hard_stop,
      failed: dimension.hard_stop && mean < 1,
    };
  });
  const weightedMean = input.rubric.dimensions.reduce((sum, dimension) => {
    const decision = dimensionDecisions.find(
      (candidate) => candidate.dimension_id === dimension.dimension_id,
    );
    return sum + dimension.weight * (decision?.mean_score ?? 0);
  }, 0);
  return {
    kind: "WELL_FORMED",
    rubric_version: input.rubric.rubric_version,
    dimension_decisions: dimensionDecisions,
    weighted_mean: weightedMean,
    hard_stop_failed: dimensionDecisions.some((decision) => decision.failed),
  };
}

export type QuorumOutcome =
  | {
      kind: "QUORUM_REACHED";
      required: number;
      counted: number;
      /** 结构性证据：计数集合里自评缺席（类型不可能，运行时再断言一次）。 */
      self_evaluation_entries: 0;
      hard_stop_failed: boolean;
    }
  | {
      kind: "QUORUM_NOT_REACHED";
      required: number;
      counted: number;
      action: "request_replacement_or_escalate";
      approval_implied: false;
    };

/**
 * quorum 求值：只统计独立完成的评审。required 来自冻结
 * proof_policy.review_policy.minimum_independent_reviews（P2 schema 下限 2）；
 * 高影响/争议轮升到 raise_to。缺失 → fail-closed（EA1.0 §4）。
 */
export function evaluateQuorum(input: {
  required_reviewers: number;
  raised_to: number | null;
  finalized_reviews: readonly ReviewerEvaluation[];
  rubric_evaluation: RubricScoreEvaluation;
}): QuorumOutcome {
  const required = input.raised_to ?? input.required_reviewers;
  const counted = input.finalized_reviews.length;
  if (counted < required) {
    return {
      kind: "QUORUM_NOT_REACHED",
      required,
      counted,
      action: "request_replacement_or_escalate",
      approval_implied: false,
    };
  }
  const hardStopFailed =
    input.rubric_evaluation.kind === "WELL_FORMED" && input.rubric_evaluation.hard_stop_failed;
  return {
    kind: "QUORUM_REACHED",
    required,
    counted,
    self_evaluation_entries: 0,
    hard_stop_failed: hardStopFailed,
  };
}

/** 分歧检测：裁定触发（EA1.0 §4 disagreement threshold 的保守形态）。 */
export type DisagreementVerdict =
  | { adjudication_required: false }
  | { adjudication_required: true; trigger: string; detail: string };

export function detectDisagreement(input: {
  evaluations: readonly ReviewerEvaluation[];
  disagreement_threshold: number;
}): DisagreementVerdict {
  const acceptCount = input.evaluations.filter((e) => e.overall_verdict === "accept").length;
  const rejectCount = input.evaluations.filter((e) => e.overall_verdict === "reject").length;
  if (acceptCount > 0 && rejectCount > 0) {
    return {
      adjudication_required: true,
      trigger: "verdict_divergence",
      detail: `${acceptCount} accept vs ${rejectCount} reject across independent reviewers`,
    };
  }
  if (input.evaluations.some((e) => e.overall_verdict === "escalate")) {
    return {
      adjudication_required: true,
      trigger: "reviewer_escalation",
      detail: "at least one reviewer escalated a safety or professional concern",
    };
  }
  const dimensionIds = new Set(
    input.evaluations.flatMap((evaluation) =>
      evaluation.dimension_scores.map((score) => score.dimension_id),
    ),
  );
  for (const dimensionId of dimensionIds) {
    const scores = input.evaluations
      .map((evaluation) =>
        evaluation.dimension_scores.find((score) => score.dimension_id === dimensionId),
      )
      .filter((score): score is NonNullable<typeof score> => score !== undefined)
      .map((score) => score.score);
    if (scores.length > 1) {
      const spread = Math.max(...scores) - Math.min(...scores);
      if (spread > input.disagreement_threshold) {
        return {
          adjudication_required: true,
          trigger: "score_disagreement",
          detail: `dimension ${dimensionId} spread ${spread.toFixed(3)} exceeds threshold ${input.disagreement_threshold}`,
        };
      }
    }
  }
  return { adjudication_required: false };
}

export const RUBRIC_QUORUM_DISCLOSURE =
  "Rubric scoring records the frozen rubric version and per-dimension decisions; hard-stop failures " +
  "block acceptance regardless of means, votes or ratings; quorum counts only finalized independent " +
  "reviews and fails closed when short — self-evaluation is structurally absent from the counted set";
