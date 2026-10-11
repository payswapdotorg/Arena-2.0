import type { StateMachineDefinition } from "@arena/contracts";

/**
 * AR2-009 — Expert Arena 冻结状态机（EA1.0 §6；issue #11）。
 *
 * 三台机器：round / candidate / review。全部用 @arena/contracts 冻结引擎
 * （StateMachineDefinition + evaluateTransition）声明 —— 绝不手写跳转；
 * 命令复用冻结命令枚举（SubmitSelfEvaluation / SubmitReviewerEvaluation /
 * RequestRevision / SubmitAppeal / SubmitIntervention + 系统触发器）。
 *
 * 冻结纪律：
 * - 评审超时 → REPLACED + 补位/升级（EA1.0 §4「Never infer approval from
 *   reviewer timeout」——不存在任何「超时即通过」的边）；
 * - DECIDED → PAYMENT_PENDING 只携带支付操作引用（无独立支付权威 ——
 *   支付状态机归 AR2-010 @arena/payment）；
 * - 机器细化只经 ACR + 契约测试（EA1.0 §6）。
 */

export const REVIEW_STATES = [
  "ASSIGNED",
  "ACCEPTED_BY_REVIEWER",
  "IN_PROGRESS",
  "SUBMITTED",
  "CHALLENGED",
  "FINALIZED",
  "REPLACED",
] as const;

export type ReviewState = (typeof REVIEW_STATES)[number];

export const reviewStateMachine: StateMachineDefinition<ReviewState> = {
  id: "expert-arena-review",
  initial: "ASSIGNED",
  states: REVIEW_STATES,
  terminals: ["FINALIZED", "REPLACED"],
  transitions: [
    {
      from: "ASSIGNED",
      to: "ACCEPTED_BY_REVIEWER",
      command: "AcceptOffer",
      guards: ["reviewer_conflict_check_passed", "reviewer_capacity_available"],
    },
    {
      from: "ASSIGNED",
      to: "REPLACED",
      command: "SystemExpireEscalation",
      guards: ["review_deadline_exceeded", "replacement_requested"],
    },
    {
      from: "ACCEPTED_BY_REVIEWER",
      to: "IN_PROGRESS",
      command: "StartAttempt",
      guards: ["review_work_begun"],
    },
    {
      from: "ACCEPTED_BY_REVIEWER",
      to: "REPLACED",
      command: "SystemExpireEscalation",
      guards: ["review_deadline_exceeded", "replacement_requested"],
    },
    {
      from: "IN_PROGRESS",
      to: "SUBMITTED",
      command: "SubmitReviewerEvaluation",
      guards: ["all_required_dimensions_scored", "evidence_refs_attached", "uncertainty_disclosed"],
    },
    {
      from: "IN_PROGRESS",
      to: "REPLACED",
      command: "SystemExpireEscalation",
      guards: ["review_deadline_exceeded", "replacement_requested"],
    },
    {
      from: "SUBMITTED",
      to: "CHALLENGED",
      command: "SubmitAppeal",
      guards: ["challenge_grounds_present"],
    },
    {
      from: "SUBMITTED",
      to: "FINALIZED",
      command: "SystemRecordProofDecision",
      guards: ["review_counted_toward_quorum"],
    },
    {
      from: "CHALLENGED",
      to: "FINALIZED",
      command: "SystemResolveDispute",
      guards: ["challenge_resolved_by_independent_adjudicator"],
    },
  ],
  state_docs: {
    ASSIGNED: {
      entry: "conflict-checked reviewer assigned",
      exit: "reviewer accepts or is replaced on timeout",
    },
    ACCEPTED_BY_REVIEWER: {
      entry: "reviewer accepted the assignment",
      exit: "work begins or replacement",
    },
    IN_PROGRESS: {
      entry: "reviewer scoring in progress",
      exit: "structured evaluation submitted or replacement",
    },
    SUBMITTED: {
      entry: "per-dimension scores with evidence submitted",
      exit: "finalized or challenged",
    },
    CHALLENGED: {
      entry: "procedural/evidence challenge recorded",
      exit: "independent adjudicator resolves",
    },
    FINALIZED: { entry: "review counts toward quorum (immutable)", exit: "terminal" },
    REPLACED: {
      entry: "timeout/forfeit replaced by a new assignment — never implicit approval",
      exit: "terminal",
    },
  },
};
