import type { StateMachineDefinition, TransitionCommand } from "@arena/contracts";

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

export const CANDIDATE_STATES = [
  "DRAFT",
  "SUBMITTED",
  "VALIDATING",
  "VALIDATOR_PASSED",
  "VALIDATOR_FAILED",
  "VALIDATOR_INCONCLUSIVE",
  "INDEPENDENT_REVIEW",
  "REVISION_REQUESTED",
  "ACCEPTED",
  "REJECTED",
  "WITHDRAWN",
] as const;

export type CandidateState = (typeof CANDIDATE_STATES)[number];

export const candidateStateMachine: StateMachineDefinition<CandidateState> = {
  id: "expert-arena-candidate",
  initial: "DRAFT",
  states: CANDIDATE_STATES,
  terminals: ["VALIDATOR_FAILED", "VALIDATOR_INCONCLUSIVE", "ACCEPTED", "REJECTED", "WITHDRAWN"],
  transitions: [
    {
      from: "DRAFT",
      to: "SUBMITTED",
      command: "SubmitIntervention",
      guards: [
        "candidate_version_immutable",
        "artifact_manifest_present",
        "self_evaluation_structured",
      ],
    },
    {
      from: "REVISION_REQUESTED",
      to: "SUBMITTED",
      command: "SubmitIntervention",
      guards: [
        "candidate_version_immutable",
        "artifact_manifest_present",
        "new_revision_version_created",
      ],
    },
    {
      from: "SUBMITTED",
      to: "VALIDATING",
      command: "SubmitSelfEvaluation",
      guards: ["self_evaluation_recorded_never_a_vote"],
    },
    {
      from: "VALIDATING",
      to: "VALIDATOR_PASSED",
      command: "SystemRecordProofDecision",
      guards: ["proof_satisfied"],
    },
    {
      from: "VALIDATING",
      to: "VALIDATOR_FAILED",
      command: "SystemRecordProofDecision",
      guards: ["proof_failed"],
    },
    {
      from: "VALIDATING",
      to: "VALIDATOR_INCONCLUSIVE",
      command: "SystemRecordProofDecision",
      guards: ["proof_inconclusive"],
    },
    {
      from: "VALIDATING",
      to: "INDEPENDENT_REVIEW",
      command: "SystemBeginVerification",
      guards: ["independent_review_required"],
    },
    {
      from: "VALIDATOR_PASSED",
      to: "INDEPENDENT_REVIEW",
      command: "SystemBeginVerification",
      guards: ["materiality_review_required"],
    },
    {
      from: "INDEPENDENT_REVIEW",
      to: "REVISION_REQUESTED",
      command: "RequestRevision",
      guards: ["revision_allowed_within_policy"],
    },
    {
      from: "INDEPENDENT_REVIEW",
      to: "ACCEPTED",
      command: "SystemRecordProofDecision",
      guards: ["quorum_reached", "self_evaluation_not_counted", "hard_stop_criteria_not_failed"],
    },
    {
      from: "INDEPENDENT_REVIEW",
      to: "REJECTED",
      command: "SystemRecordProofDecision",
      guards: ["quorum_reached", "rejection_grounds_recorded"],
    },
    {
      from: "DRAFT",
      to: "WITHDRAWN",
      command: "CancelEscalation",
      guards: ["author_requested_withdrawal"],
    },
    {
      from: "SUBMITTED",
      to: "WITHDRAWN",
      command: "CancelEscalation",
      guards: ["author_requested_withdrawal", "no_accepted_outcome"],
    },
  ],
  state_docs: {
    DRAFT: {
      entry: "author prepares the versioned package",
      exit: "submitted with manifest + structured self-evaluation",
    },
    SUBMITTED: {
      entry: "immutable candidate version frozen",
      exit: "self-evaluation recorded, validation begins",
    },
    VALIDATING: {
      entry: "predeclared validator runs against the isolated candidate branch",
      exit: "validator verdict or independent review",
    },
    VALIDATOR_PASSED: {
      entry: "validator evidence satisfied",
      exit: "materiality review (P0/P1) or terminal",
    },
    VALIDATOR_FAILED: {
      entry: "validator evidence failed — terminal",
      exit: "terminal (immutable failure)",
    },
    VALIDATOR_INCONCLUSIVE: {
      entry: "validator evidence inconclusive — fail closed",
      exit: "terminal",
    },
    INDEPENDENT_REVIEW: {
      entry: "conflict-checked reviewers score the frozen rubric",
      exit: "accept/reject/revision",
    },
    REVISION_REQUESTED: {
      entry: "revision requested within policy",
      exit: "new immutable version submitted",
    },
    ACCEPTED: {
      entry: "independent decision accepted the candidate",
      exit: "terminal (bound to round outcome)",
    },
    REJECTED: { entry: "independent decision rejected the candidate", exit: "terminal" },
    WITHDRAWN: { entry: "author withdrew before an accepted outcome", exit: "terminal" },
  },
};

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

/** 机器命令别名（文档化映射 —— 命令本体是冻结枚举，绝不新增）。 */
export const ROUND_COMMANDS: Readonly<Record<string, TransitionCommand>> = {
  freeze: "CreateEscalation",
  open: "StartAttempt",
  closeSubmissions: "SystemExpireEscalation",
  beginValidation: "SystemBeginVerification",
  beginReview: "SystemBeginVerification",
  recordProofDecision: "SystemRecordProofDecision",
  beginAdjudication: "SystemResolveDispute",
  resolveAdjudication: "SystemResolveDispute",
  releasePaymentReference: "SystemReleasePayment",
  acknowledgeOutcome: "AcknowledgeResult",
  reconcilePaymentReference: "SystemReconcileProvider",
};

export const EXPERT_ARENA_MACHINE_DISCLOSURE =
  "Expert Arena state machines (EA1.0 §6) are declared on the frozen contracts engine " +
  "(evaluateTransition) using the frozen command enum; reviewer timeout lands in REPLACED with " +
  "replacement/escalation — no transition anywhere infers approval from absence; DECIDED to " +
  "PAYMENT_PENDING carries a payment operation REFERENCE only (payment authority is AR2-010's)";
