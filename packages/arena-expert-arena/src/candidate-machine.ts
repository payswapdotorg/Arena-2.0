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
