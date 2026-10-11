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

export const ROUND_STATES = [
  "DRAFT",
  "FROZEN",
  "OPEN_FOR_ATTEMPTS",
  "SUBMISSIONS_CLOSED",
  "VALIDATING",
  "REVIEWING",
  "ADJUDICATING",
  "DECIDED",
  "PAYMENT_PENDING",
  "CLOSED",
] as const;

export type RoundState = (typeof ROUND_STATES)[number];

export const roundStateMachine: StateMachineDefinition<RoundState> = {
  id: "expert-arena-round",
  initial: "DRAFT",
  states: ROUND_STATES,
  terminals: ["CLOSED"],
  transitions: [
    {
      from: "DRAFT",
      to: "FROZEN",
      command: "CreateEscalation",
      guards: [
        "round_material_from_frozen_contract",
        "rubric_version_pinned",
        "budget_declared",
        "deadline_declared",
      ],
    },
    {
      from: "FROZEN",
      to: "OPEN_FOR_ATTEMPTS",
      command: "StartAttempt",
      guards: ["eligible_experts_notified", "equalized_context_prepared"],
    },
    {
      from: "OPEN_FOR_ATTEMPTS",
      to: "SUBMISSIONS_CLOSED",
      command: "SystemExpireEscalation",
      guards: ["submission_deadline_exceeded"],
    },
    {
      from: "SUBMISSIONS_CLOSED",
      to: "VALIDATING",
      command: "SystemBeginVerification",
      guards: ["at_least_one_candidate_submitted"],
    },
    {
      from: "VALIDATING",
      to: "REVIEWING",
      command: "SystemBeginVerification",
      guards: ["independent_review_required"],
    },
    {
      from: "VALIDATING",
      to: "DECIDED",
      command: "SystemRecordProofDecision",
      guards: ["validator_evidence_decisive", "hard_stop_criteria_not_failed"],
    },
    {
      from: "REVIEWING",
      to: "ADJUDICATING",
      command: "SystemResolveDispute",
      guards: ["adjudication_trigger_met"],
    },
    {
      from: "REVIEWING",
      to: "DECIDED",
      command: "SystemRecordProofDecision",
      guards: ["quorum_reached", "no_open_adjudication_trigger", "self_evaluation_not_counted"],
    },
    {
      from: "ADJUDICATING",
      to: "DECIDED",
      command: "SystemResolveDispute",
      guards: ["adjudication_recorded", "adjudicator_independent"],
    },
    {
      from: "DECIDED",
      to: "PAYMENT_PENDING",
      command: "SystemReleasePayment",
      guards: ["payment_operation_reference_present", "payment_authority_external"],
    },
    {
      from: "DECIDED",
      to: "CLOSED",
      command: "AcknowledgeResult",
      guards: ["outcome_acknowledged"],
    },
    {
      from: "PAYMENT_PENDING",
      to: "CLOSED",
      command: "SystemReconcileProvider",
      guards: ["payment_reference_resolved"],
    },
  ],
  state_docs: {
    DRAFT: {
      entry: "round drafted from escalation material",
      exit: "material pinned from the frozen contract",
    },
    FROZEN: {
      entry: "brief/rubric/budget/deadline immutable",
      exit: "eligible experts notified with equalized context",
    },
    OPEN_FOR_ATTEMPTS: {
      entry: "experts may submit versioned candidates",
      exit: "submission deadline exceeded",
    },
    SUBMISSIONS_CLOSED: {
      entry: "no further candidate versions accepted",
      exit: "validation begins on submitted candidates",
    },
    VALIDATING: {
      entry: "predeclared application validators run per candidate",
      exit: "validator decision or independent review",
    },
    REVIEWING: {
      entry: "conflict-checked independent reviewers score the frozen rubric",
      exit: "quorum decision or adjudication trigger",
    },
    ADJUDICATING: {
      entry: "independent adjudicator resolves the recorded trigger",
      exit: "adjudication record lands",
    },
    DECIDED: {
      entry: "winner selected under the prespecified proof policy",
      exit: "acknowledgement or payment reference",
    },
    PAYMENT_PENDING: {
      entry: "payment operation reference recorded (authority external)",
      exit: "payment reference resolved by the payment domain",
    },
    CLOSED: { entry: "terminal — round history immutable", exit: "terminal" },
  },
};
