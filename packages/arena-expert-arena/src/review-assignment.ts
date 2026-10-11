import type { ExpertProfile } from "@arena/matching";
import { evaluateConflictOfInterest } from "@arena/matching";

/**
 * AR2-009 — 冲突筛查的评审分配（EA1.0 §1 evaluator path / §7；issue #11）。
 *
 * 冻结纪律：
 * - 分配前检查：任务能力/资格 → AR2-008 冻结面（checkExpertProfile 消费方
 *   自行调用）；本模块叠加评审特有检查：同人自评（self-review）、同轮
 *   候选作者身份（attempt participation）、评审容量；
 * - 共享冲突语义委托 AR2-008 evaluateConflictOfInterest（绝不第二套）；
 * - 超时/放弃 → REPLACED + 补位请求：绝不从缺席推导批准（EA1.0 §4）。
 */

export interface ReviewerCapacity {
  expert_id: string;
  active_review_slots: number;
  max_concurrent_reviews: number;
}

export interface ReviewAssignmentContext {
  /** 本轮全部候选的作者（含被评审候选作者本人）。 */
  round_candidate_author_ids: readonly string[];
  /** AR2-008 ConflictContext（失败尝试/先前参与/租户关系）。 */
  failed_attempt_expert_ids: readonly string[];
  prior_involvement_expert_ids: readonly string[];
  conflicted_tenant_ids: readonly string[];
}

export type ReviewerExclusionReason =
  | "same_expert_as_candidate_author"
  | "author_of_another_candidate_in_round"
  | "reviewer_capacity_exhausted";

/** 评审资格检查（评审特有 + 委托 AR2-008 冲突面）。 */
export function checkReviewerEligibility(input: {
  reviewer: ExpertProfile;
  candidate_author_expert_id: string;
  context: ReviewAssignmentContext;
  capacity: ReviewerCapacity;
}): { ok: true } | { ok: false; reasons: readonly string[]; explanation: string } {
  const reasons: ReviewerExclusionReason[] = [];
  if (input.reviewer.expert_id === input.candidate_author_expert_id) {
    reasons.push("same_expert_as_candidate_author");
  }
  if (
    input.reviewer.expert_id !== input.candidate_author_expert_id &&
    input.context.round_candidate_author_ids.includes(input.reviewer.expert_id)
  ) {
    reasons.push("author_of_another_candidate_in_round");
  }
  if (input.capacity.active_review_slots >= input.capacity.max_concurrent_reviews) {
    reasons.push("reviewer_capacity_exhausted");
  }
  if (reasons.length > 0) {
    return { ok: false, reasons, explanation: `reviewer excluded: ${reasons.join(", ")}` };
  }
  const conflict = evaluateConflictOfInterest(input.reviewer, {
    failedAttemptExpertIds: input.context.failed_attempt_expert_ids,
    priorInvolvementExpertIds: input.context.prior_involvement_expert_ids,
    conflictedTenantIds: input.context.conflicted_tenant_ids,
  });
  if (!conflict.ok) {
    return { ok: false, reasons: conflict.reasons, explanation: conflict.explanation };
  }
  return { ok: true };
}

export type ReviewAssignmentRecord = {
  assignment_id: string;
  round_id: string;
  candidate_id: string;
  reviewer_expert_id: string;
  assigned_at: string;
  state: "ASSIGNED" | "REPLACED";
  /** REPLACED 时记录：超时/放弃 + 补位请求（从未隐式批准）。 */
  replacement_note: string | null;
};

export type ReplacementOutcome =
  | { kind: "REPLACED"; record: ReviewAssignmentRecord; approval_implied: false }
  | { kind: "NOT_ASSIGNED"; explanation: string };

/** 评审分配登记处（内存参考实现）。 */
export class ReviewAssignmentRegistry {
  private readonly assignments: ReviewAssignmentRecord[] = [];
  private readonly sequence = { value: 0 };

  constructor(
    private readonly now: () => string = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  ) {}

  assignReviewer(input: {
    round_id: string;
    candidate_id: string;
    reviewer_expert_id: string;
  }): ReviewAssignmentRecord {
    this.sequence.value += 1;
    const record: ReviewAssignmentRecord = {
      assignment_id: `rvas_${String(this.sequence.value).padStart(8, "0")}`,
      round_id: input.round_id,
      candidate_id: input.candidate_id,
      reviewer_expert_id: input.reviewer_expert_id,
      assigned_at: this.now(),
      state: "ASSIGNED",
      replacement_note: null,
    };
    this.assignments.push(record);
    return record;
  }

  /** 评审超时/放弃：REPLACED + 补位（批准恒为 false —— 结构字面量）。 */
  replaceOnTimeout(input: {
    assignment_id: string;
    reason: "deadline_exceeded" | "forfeited";
    deadline: string;
  }): ReplacementOutcome {
    const record = this.assignments.find(
      (candidate) => candidate.assignment_id === input.assignment_id,
    );
    if (record === undefined || record.state !== "ASSIGNED") {
      return { kind: "NOT_ASSIGNED", explanation: "assignment not found or not active" };
    }
    record.state = "REPLACED";
    record.replacement_note = `${input.reason} at ${input.deadline}: replacement requested, escalation if quorum at risk — approval never inferred from absence`;
    return { kind: "REPLACED", record, approval_implied: false };
  }

  activeAssignments(candidateId: string): readonly ReviewAssignmentRecord[] {
    return this.assignments.filter(
      (record) => record.candidate_id === candidateId && record.state === "ASSIGNED",
    );
  }

  all(): readonly ReviewAssignmentRecord[] {
    return [...this.assignments];
  }
}

export const REVIEW_ASSIGNMENT_DISCLOSURE =
  "Reviewer assignment runs reviewer-specific checks (self-review, round-author collision, capacity) " +
  "and delegates shared conflict semantics to the frozen AR2-008 screen; timeout or forfeit REPLACES the " +
  "assignment and requests a replacement — quorum approval is never inferred from reviewer absence";
