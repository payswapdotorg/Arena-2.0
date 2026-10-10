import type {
  AcceptanceCriteria,
  EvidenceEnvelope,
  ProofPolicySnapshot,
  ResultEnvelope,
} from "@arena/contracts";
import type { DemoTag } from "./demo-fixtures.js";
import type { StructuredSelfEvaluation } from "./expert-flow.js";

/**
 * AR2-003 slice 2 — reviewer/adjudicator 视图模型（验收场景 3）。
 *
 * - criterion 行由冻结 criterionOutcomeSchema 形状驱动（decision/proof_class/
 *   evidence_ids/hard_stop_triggered），并与验收标准陈述合并展示；
 * - 脱敏分区：public/tenant → 共享区；reviewer_private → 独立可见区
 *   （视觉分离 + data-redaction-class）；operator → 对 reviewer 面扣留
 *   （只披露计数，绝不渲染内容）；
 * - verification trail 逐字段展示（validators/versions/reviewers/adjudicator/
 *   outcomes/policy_version）；
 * - 自评永远渲染在独立分区且不计入 independent_review_count
 *   （SELF_EVALUATION_IS_NOT_A_VOTE_RULE）。
 */

export interface ReviewerCriterionRow {
  criterion_id: string;
  statement: string;
  decision: "PASS" | "FAIL" | "INCONCLUSIVE" | "NOT_EVALUATED";
  proof_class: "P0" | "P1" | "P2" | "P3";
  evidence_ids: readonly string[];
  hard_stop_triggered: boolean;
  /** 自评对同一 criterion 的立场（如有）——仅并排展示，不是投票。 */
  self_decision: "PASS" | "FAIL" | "INCONCLUSIVE" | "NOT_EVALUATED" | null;
}

export interface VerificationTrail {
  validators: ReadonlyArray<{ validator_id: string; validator_version: string }>;
  reviewer_ids: readonly string[];
  adjudicator_id: string | null;
  outcomes: readonly string[];
  policy_version: string;
}

export interface RedactionPartition {
  shared: readonly EvidenceEnvelope[];
  reviewer_private: readonly EvidenceEnvelope[];
  withheld_operator_count: number;
}

export interface ReviewDeckView {
  result_id: string;
  escalation_id: string;
  attempt_id: string;
  status: ResultEnvelope["status"];
  criterion_rows: readonly ReviewerCriterionRow[];
  trail: VerificationTrail;
  redaction: RedactionPartition;
  self_evaluation: StructuredSelfEvaluation | null;
  /** 独立评审人数（只来自 trail.reviewer_ids；自评永不计入）。 */
  independent_review_count: number;
  demo: DemoTag;
}

export interface AdjudicationView {
  divergent: boolean;
  trigger: string | null;
  adjudicator_id: string | null;
}

/** 最小策略形状（ProofPolicySnapshot["review_policy"] 的结构子集）。 */
export type ReviewPolicyLike = Pick<
  NonNullable<ProofPolicySnapshot["review_policy"]>,
  "adjudication_trigger" | "minimum_independent_reviews"
>;

/** 证据脱敏分区：operator 级扣留（计数披露），reviewer_private 独立区。 */
export function partitionByRedactionClass(
  evidence: readonly EvidenceEnvelope[],
): RedactionPartition {
  const shared: EvidenceEnvelope[] = [];
  const reviewerPrivate: EvidenceEnvelope[] = [];
  let withheld = 0;
  for (const envelope of evidence) {
    if (envelope.redaction_class === "operator") {
      withheld += 1;
    } else if (envelope.redaction_class === "reviewer_private") {
      reviewerPrivate.push(envelope);
    } else {
      shared.push(envelope);
    }
  }
  return { shared, reviewer_private: reviewerPrivate, withheld_operator_count: withheld };
}

/** 组装 reviewer deck（criterion 行 + trail + 分区 + 自评分离）。 */
export function buildReviewDeck(
  result: ResultEnvelope,
  criteria: AcceptanceCriteria,
  evidence: readonly EvidenceEnvelope[],
  selfEvaluation: StructuredSelfEvaluation | null,
  demo: DemoTag,
): ReviewDeckView {
  const selfByCriterion = new Map<string, StructuredSelfEvaluation["entries"][number]>();
  if (selfEvaluation !== null) {
    for (const entry of selfEvaluation.entries) {
      selfByCriterion.set(entry.criterion_id, entry);
    }
  }
  const rows: ReviewerCriterionRow[] = result.criterion_decisions.map((outcome) => {
    const criterion = criteria.find((c) => c.criterion_id === outcome.criterion_id);
    const self = selfByCriterion.get(outcome.criterion_id);
    return {
      criterion_id: outcome.criterion_id,
      statement: criterion?.statement ?? "(criterion not in frozen acceptance set)",
      decision: outcome.decision,
      proof_class: outcome.proof_class,
      evidence_ids: outcome.evidence_ids,
      hard_stop_triggered: outcome.hard_stop_triggered,
      self_decision: self?.decision ?? null,
    };
  });
  return {
    result_id: result.result_id,
    escalation_id: result.escalation_id,
    attempt_id: result.attempt_id,
    status: result.status,
    criterion_rows: rows,
    trail: {
      validators: result.verification.validator_ids.map((validator_id, index) => ({
        validator_id,
        validator_version: result.verification.validator_versions[index] ?? "(missing version)",
      })),
      reviewer_ids: result.verification.reviewer_ids,
      adjudicator_id: result.verification.adjudicator_id,
      outcomes: result.verification.outcomes,
      policy_version: result.verification.policy_version,
    },
    redaction: partitionByRedactionClass(evidence),
    self_evaluation: selfEvaluation,
    independent_review_count: result.verification.reviewer_ids.length,
    demo,
  };
}

/** 分歧判定：outcome 带不一致 或 hard-stop 争议在场 → 触发 adjudication。 */
export function adjudicationView(
  deck: ReviewDeckView,
  policy: ReviewPolicyLike | null,
): AdjudicationView {
  const outcomes = deck.trail.outcomes;
  const bandsDiverge =
    outcomes.length >= 2 && outcomes.some((band) => band !== (outcomes[0] ?? band));
  const hardStopDispute = deck.criterion_rows.some((row) => row.hard_stop_triggered);
  const divergent = bandsDiverge || hardStopDispute;
  return {
    divergent,
    trigger: policy?.adjudication_trigger ?? null,
    adjudicator_id: deck.trail.adjudicator_id,
  };
}
