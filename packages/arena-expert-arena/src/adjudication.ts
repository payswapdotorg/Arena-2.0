import { z } from "zod";
import { arenaIdSchema, isoTimestampSchema } from "@arena/contracts";
import { nonEmptyMedium as nonEmptyMediumSchema } from "./common.js";
import type { ProofDecision } from "@arena/evidence";

/**
 * AR2-009 — 裁定 + 轮结果选择（EA1.0 §4/§8；issue #11）。
 *
 * 冻结纪律：
 * - 裁定触发：分数分歧/评审结论分歧/评审人冲突/hard-stop 安全关切/
 *   必需维度未评分/证据溯源争议/validator 分歧（EA1.0 §4 全清单）；
 * - 裁定人独立于候选作者与本轮既有评审（可行处）；
 * - 轮结果：P0/P1 赢家必须绑定 SATISFIED 的 ProofDecision（AR2-007 输入）
 *   —— 票数/均值/星级永远不能替代验证证据；P2/P3 赢家必须来自独立
 *   决定（quorum 或裁定）—— 作者声明永远不够；
 * - 支付绑定 = 支付操作 id 引用（无独立支付权威 —— AR2-010 的领域）。
 */

export const adjudicationTriggerSchema = z.enum([
  "score_disagreement",
  "verdict_divergence",
  "reviewer_conflict",
  "hard_stop_safety_concern",
  "required_dimension_unscored",
  "evidence_provenance_disputed",
  "validator_disagreement",
]);

export const adjudicationRecordSchema = z
  .object({
    adjudication_id: arenaIdSchema,
    round_id: arenaIdSchema,
    trigger: adjudicationTriggerSchema,
    adjudicator_expert_id: arenaIdSchema,
    decided_at: isoTimestampSchema,
    rationale: nonEmptyMediumSchema,
    evidence_refs: z.array(arenaIdSchema).max(32),
    winning_candidate_id: arenaIdSchema.nullable(),
    /** 裁定人独立性声明（不是候选作者、不是本轮评审人 —— 可行处）。 */
    adjudicator_independent_of: z
      .object({
        candidate_authors: z.array(arenaIdSchema),
        prior_reviewers: z.array(arenaIdSchema),
      })
      .strict(),
  })
  .strict();

export type AdjudicationTrigger = z.infer<typeof adjudicationTriggerSchema>;
export type AdjudicationRecord = z.infer<typeof adjudicationRecordSchema>;

export type AdjudicationOutcome =
  | { kind: "RECORDED"; record: AdjudicationRecord }
  | { kind: "REJECTED"; issues: ReadonlyArray<{ field: string; rule: string }> };

/** 记录一条裁定（独立性在类型上必须显式声明）。 */
export function recordAdjudication(input: unknown): AdjudicationOutcome {
  const parsed = adjudicationRecordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      kind: "REJECTED",
      issues: parsed.error.issues.map((issue) => ({
        field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
        rule: issue.message,
      })),
    };
  }
  if (
    parsed.data.adjudicator_independent_of.candidate_authors.includes(
      parsed.data.adjudicator_expert_id,
    )
  ) {
    return {
      kind: "REJECTED",
      issues: [
        {
          field: "adjudicator_expert_id",
          rule: "adjudicator must be independent of candidate authors",
        },
      ],
    };
  }
  if (
    parsed.data.adjudicator_independent_of.prior_reviewers.includes(
      parsed.data.adjudicator_expert_id,
    )
  ) {
    return {
      kind: "REJECTED",
      issues: [
        {
          field: "adjudicator_expert_id",
          rule: "adjudicator must be independent of prior reviewers where feasible",
        },
      ],
    };
  }
  return { kind: "RECORDED", record: parsed.data };
}

export type RoundOutcomeSelection =
  | {
      kind: "WINNER_SELECTED";
      round_id: string;
      winning_candidate_id: string;
      selection_basis: "validator_evidence" | "independent_decision";
      /** P0/P1：绑定的验证证据决策（SATISFIED 才可能到这里）。 */
      proof_decision_status: "SATISFIED" | null;
      hard_stop_criteria_failed: false;
      payment_operation_reference: string;
      payment_authority: "external_arena_payment_domain";
    }
  | {
      kind: "NO_WINNER";
      reason:
        | "hard_stop_criteria_failed"
        | "validator_evidence_not_satisfied"
        | "independent_decision_missing"
        | "quorum_not_reached";
      approval_implied: false;
    };

/**
 * 轮结果选择（EA1.0 §1.7/§8）。
 *
 * P0/P1：winner 绑定 SATISFIED ProofDecision —— 没有验证证据就没有赢家，
 * 票数再高也不行（popularity cannot override proof）。
 * P2/P3：winner 必须来自独立决定（quorum 达成无 hard-stop 失败，或裁定）。
 * hard-stop 失败永远优先于一切评分聚合。
 */
export function selectRoundOutcome(input: {
  round_id: string;
  proof_class: "P0" | "P1" | "P2" | "P3";
  /** P0/P1 必填：AR2-007 的验证证据决策（SATISFIED 的那个候选的决策）。 */
  proof_decision: ProofDecision | null;
  /** 独立评审聚合是否达成（quorum + 无 hard-stop 失败）。 */
  independent_decision_reached: boolean;
  hard_stop_criteria_failed: boolean;
  /** 证据/独立决定指向的候选（无则视为未决）。 */
  indicated_candidate_id: string | null;
  /** 支付操作引用（由支付域生成 —— 这里只引用）。 */
  payment_operation_reference: string;
}): RoundOutcomeSelection {
  if (input.hard_stop_criteria_failed) {
    return { kind: "NO_WINNER", reason: "hard_stop_criteria_failed", approval_implied: false };
  }
  if (input.proof_class === "P0" || input.proof_class === "P1") {
    if (input.proof_decision === null || input.proof_decision.status !== "SATISFIED") {
      return {
        kind: "NO_WINNER",
        reason: "validator_evidence_not_satisfied",
        approval_implied: false,
      };
    }
    if (input.indicated_candidate_id === null) {
      return {
        kind: "NO_WINNER",
        reason: "validator_evidence_not_satisfied",
        approval_implied: false,
      };
    }
    return {
      kind: "WINNER_SELECTED",
      round_id: input.round_id,
      winning_candidate_id: input.indicated_candidate_id,
      selection_basis: "validator_evidence",
      proof_decision_status: "SATISFIED",
      hard_stop_criteria_failed: false,
      payment_operation_reference: input.payment_operation_reference,
      payment_authority: "external_arena_payment_domain",
    };
  }
  if (!input.independent_decision_reached || input.indicated_candidate_id === null) {
    return { kind: "NO_WINNER", reason: "independent_decision_missing", approval_implied: false };
  }
  return {
    kind: "WINNER_SELECTED",
    round_id: input.round_id,
    winning_candidate_id: input.indicated_candidate_id,
    selection_basis: "independent_decision",
    proof_decision_status: null,
    hard_stop_criteria_failed: false,
    payment_operation_reference: input.payment_operation_reference,
    payment_authority: "external_arena_payment_domain",
  };
}

/** 热度/人气覆盖尝试（测试与文档用）：显式拒绝，理由冻结。 */
export function popularityCannotOverrideProof(input: {
  votes_for_candidate: number;
  hard_stop_criteria_failed: boolean;
}): { override_allowed: false; explanation: string } {
  return {
    override_allowed: false,
    explanation: input.hard_stop_criteria_failed
      ? "hard-stop acceptance criteria failed: no vote count, mean score or rating can override them (EA1.0 §7)"
      : "popularity never substitutes for proof: winner selection is bound to validator evidence or an independent decision (EA1.0 §1.7)",
  };
}

export const ADJUDICATION_DISCLOSURE =
  "Adjudication is triggered by recorded disagreement/conflict/safety conditions and resolved by an " +
  "independent adjudicator; round winners are bound to verified validator evidence (P0/P1) or an " +
  "independent decision (P2/P3) — popularity, votes or ratings never override proof, and payment " +
  "moves only by reference into the AR2-010 payment domain";
