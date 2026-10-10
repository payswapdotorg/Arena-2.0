import type { StateMachineDefinition } from "./machine.js";

/**
 * A11 — Escalation（任务生命周期）状态机。
 * ES2.0 §6 的不变量 1、2、4、5、7、9、10 直接挂在这台机器的守卫上；
 * 不变量 3、6、8 分别在 attempt / payment / learning 机器上。
 */

export const ESCALATION_STATES = [
  "CREATED",
  "CLARIFICATION",
  "OFFERED",
  "ASSIGNED",
  "ENVIRONMENT_READY",
  "VERIFYING",
  "REVISION_REQUESTED",
  "APPEALED",
  "ACCEPTED",
  "CLOSED",
  "CANCELLED",
  "EXPIRED",
  "FAILED_EXHAUSTED",
] as const;

export type EscalationState = (typeof ESCALATION_STATES)[number];

/** 不变量 1 的六项检查（ES2.0 §6：capability/qualification/conflict/privacy/budget/availability）。 */
export const ASSIGNMENT_GUARDS = [
  "capability_matched",
  "qualification_current",
  "conflict_check_passed",
  "privacy_authorized",
  "budget_available",
  "expert_available",
] as const;

/** 不变量 2 的两项（capsule manifest + isolation assurance）。 */
export const ENVIRONMENT_GUARDS = [
  "capsule_manifest_recorded",
  "isolation_assurance_recorded",
] as const;

/** 不变量 5：proof 满足 = P0/P1 validator 合取 或 P2/P3 裁决成功（OR 语义由该组合事实承载）。 */
export const PROOF_SATISFIED_GUARD = "proof_satisfied";

/** 不变量 7：结果记录已提交。 */
export const RESULT_COMMITTED_GUARD = "result_record_committed";

/** 不变量 9：已执行的外部副作用已披露。 */
export const SIDE_EFFECTS_DISCLOSED_GUARD = "external_side_effects_disclosed";

export const escalationStateMachine: StateMachineDefinition<EscalationState> = {
  id: "escalation",
  initial: "CREATED",
  states: ESCALATION_STATES,
  terminals: ["CLOSED", "CANCELLED", "EXPIRED", "FAILED_EXHAUSTED"],
  transitions: [
    {
      from: "CREATED",
      to: "CREATED",
      command: "AmendEscalation",
      guards: ["pre_assignment_amendment"],
    },
    {
      from: "CLARIFICATION",
      to: "CREATED",
      command: "RespondToClarification",
      guards: ["clarification_answered"],
    },
    {
      from: "CREATED",
      to: "CLARIFICATION",
      command: "SystemProposeOffer",
      guards: ["clarification_needed"],
    },
    {
      from: "CREATED",
      to: "OFFERED",
      command: "SystemProposeOffer",
      guards: ["candidate_expert_matched"],
    },
    { from: "OFFERED", to: "ASSIGNED", command: "AcceptOffer", guards: [...ASSIGNMENT_GUARDS] },
    { from: "OFFERED", to: "CREATED", command: "DeclineOffer", guards: [] },
    {
      from: "ASSIGNED",
      to: "ENVIRONMENT_READY",
      command: "StartAttempt",
      guards: [...ENVIRONMENT_GUARDS],
    },
    {
      from: "ENVIRONMENT_READY",
      to: "VERIFYING",
      command: "SubmitIntervention",
      guards: [
        "candidate_version_immutable",
        "artifact_manifest_present",
        "acceptance_criteria_frozen",
        "proof_policy_frozen",
      ],
    },
    {
      from: "REVISION_REQUESTED",
      to: "VERIFYING",
      command: "SubmitIntervention",
      guards: [
        "candidate_version_immutable",
        "artifact_manifest_present",
        "acceptance_criteria_frozen",
        "proof_policy_frozen",
      ],
    },
    {
      from: "VERIFYING",
      to: "REVISION_REQUESTED",
      command: "RequestRevision",
      guards: ["revision_budget_remaining"],
    },
    { from: "VERIFYING", to: "APPEALED", command: "SubmitAppeal", guards: ["appeal_window_open"] },
    {
      from: "APPEALED",
      to: "VERIFYING",
      command: "SubmitReviewerEvaluation",
      guards: ["adjudicator_qualified", "adjudication_recorded"],
    },
    {
      from: "VERIFYING",
      to: "ACCEPTED",
      command: "SystemRecordProofDecision",
      guards: [PROOF_SATISFIED_GUARD, "criterion_conjunction_passed"],
    },
    {
      from: "ACCEPTED",
      to: "CLOSED",
      command: "AcknowledgeResult",
      guards: [RESULT_COMMITTED_GUARD],
    },
    {
      from: "CREATED",
      to: "CANCELLED",
      command: "CancelEscalation",
      guards: [SIDE_EFFECTS_DISCLOSED_GUARD],
    },
    {
      from: "CLARIFICATION",
      to: "CANCELLED",
      command: "CancelEscalation",
      guards: [SIDE_EFFECTS_DISCLOSED_GUARD],
    },
    {
      from: "OFFERED",
      to: "CANCELLED",
      command: "CancelEscalation",
      guards: [SIDE_EFFECTS_DISCLOSED_GUARD],
    },
    {
      from: "ASSIGNED",
      to: "CANCELLED",
      command: "CancelEscalation",
      guards: [SIDE_EFFECTS_DISCLOSED_GUARD, "capsule_teardown_verified"],
    },
    {
      from: "ENVIRONMENT_READY",
      to: "CANCELLED",
      command: "CancelEscalation",
      guards: [SIDE_EFFECTS_DISCLOSED_GUARD, "capsule_teardown_verified"],
    },
    {
      from: "VERIFYING",
      to: "CANCELLED",
      command: "CancelEscalation",
      guards: [SIDE_EFFECTS_DISCLOSED_GUARD, "capsule_teardown_verified"],
    },
    {
      from: "CREATED",
      to: "EXPIRED",
      command: "SystemExpireEscalation",
      guards: ["deadline_exceeded"],
    },
    {
      from: "CLARIFICATION",
      to: "EXPIRED",
      command: "SystemExpireEscalation",
      guards: ["deadline_exceeded"],
    },
    {
      from: "OFFERED",
      to: "EXPIRED",
      command: "SystemExpireEscalation",
      guards: ["deadline_exceeded"],
    },
    {
      from: "ASSIGNED",
      to: "EXPIRED",
      command: "SystemExpireEscalation",
      guards: ["deadline_exceeded"],
    },
    {
      from: "ENVIRONMENT_READY",
      to: "EXPIRED",
      command: "SystemExpireEscalation",
      guards: ["deadline_exceeded"],
    },
    {
      from: "VERIFYING",
      to: "EXPIRED",
      command: "SystemExpireEscalation",
      guards: ["deadline_exceeded"],
    },
    {
      from: "ASSIGNED",
      to: "FAILED_EXHAUSTED",
      command: "SystemRouteNextExpert",
      guards: ["no_attempts_remaining"],
    },
    {
      from: "ENVIRONMENT_READY",
      to: "FAILED_EXHAUSTED",
      command: "SystemRouteNextExpert",
      guards: ["no_attempts_remaining"],
    },
    {
      from: "VERIFYING",
      to: "FAILED_EXHAUSTED",
      command: "SystemRouteNextExpert",
      guards: ["no_attempts_remaining"],
    },
  ],
  state_docs: {
    CREATED: {
      entry: "CreateEscalation accepted (idempotent creation)",
      exit: "offer proposed, clarification opened, cancelled or expired",
    },
    CLARIFICATION: {
      entry: "requester input required before matching",
      exit: "clarification answered or escalation ends",
    },
    OFFERED: {
      entry: "system proposed a candidate expert offer",
      exit: "offer accepted/declined or expiry",
    },
    ASSIGNED: {
      entry: "AcceptOffer with all six assignment checks passed",
      exit: "environment provisioned, rerouted or ended",
    },
    ENVIRONMENT_READY: {
      entry: "capsule manifest + isolation assurance recorded",
      exit: "intervention submitted or escalation ends",
    },
    VERIFYING: {
      entry: "immutable candidate submitted against frozen policy",
      exit: "proof decision, revision, appeal or exhaustion",
    },
    REVISION_REQUESTED: {
      entry: "reviewer requested a revision",
      exit: "revised candidate resubmitted",
    },
    APPEALED: {
      entry: "requester/expert appealed the verification outcome",
      exit: "adjudication returns the escalation to VERIFYING",
    },
    ACCEPTED: {
      entry: "proof satisfied and criterion conjunction passed",
      exit: "result acknowledged after commit",
    },
    CLOSED: { entry: "AcknowledgeResult after result record commit", exit: "terminal" },
    CANCELLED: { entry: "CancelEscalation with side effects disclosed", exit: "terminal" },
    EXPIRED: { entry: "deadline exceeded before completion", exit: "terminal" },
    FAILED_EXHAUSTED: { entry: "attempts/budget exhausted with typed failure", exit: "terminal" },
  },
};
