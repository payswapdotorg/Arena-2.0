import type { StateMachineDefinition } from "./machine.js";
import { escalationStateMachine, type EscalationState } from "./escalation.js";
import { attemptStateMachine, type AttemptState } from "./attempt.js";
import { paymentStateMachine, type PaymentState } from "./payment-eligibility.js";
import { learningStateMachine, type LearningState } from "./learning-publication.js";

/**
 * B3 — ES2.0 §6 十条不变量的机器可核查注册表。
 * 每条不变量指明：所在状态机、触发命令、必经守卫（全部必须为真）。
 * 过渡测试逐条断言：抽掉任何一个守卫事实 ⇒ 迁移被拒（INVARIANT_VIOLATION）。
 */

export interface InvariantSpec {
  id: "INV1" | "INV2" | "INV3" | "INV4" | "INV5" | "INV6" | "INV7" | "INV8" | "INV9" | "INV10";
  statement: string;
  machine: StateMachineDefinition<string>;
  from: string;
  command: string;
  guards: readonly string[];
}

export const ES20_INVARIANTS: readonly InvariantSpec[] = [
  {
    id: "INV1",
    statement:
      "No ASSIGNED state unless capability, qualification, conflict, privacy, budget and availability checks pass.",
    machine: escalationStateMachine as unknown as StateMachineDefinition<string>,
    from: "OFFERED",
    command: "AcceptOffer",
    guards: [
      "capability_matched",
      "qualification_current",
      "conflict_check_passed",
      "privacy_authorized",
      "budget_available",
      "expert_available",
    ],
  },
  {
    id: "INV2",
    statement:
      "No ENVIRONMENT_READY until a capsule manifest and isolation assurance are recorded.",
    machine: escalationStateMachine as unknown as StateMachineDefinition<string>,
    from: "ASSIGNED",
    command: "StartAttempt",
    guards: ["capsule_manifest_recorded", "isolation_assurance_recorded"],
  },
  {
    id: "INV3",
    statement: "No SUBMITTED state without an immutable candidate version and artifact manifest.",
    machine: attemptStateMachine as unknown as StateMachineDefinition<string>,
    from: "ENVIRONMENT_READY",
    command: "SubmitIntervention",
    guards: ["candidate_version_immutable", "artifact_manifest_present"],
  },
  {
    id: "INV4",
    statement: "No VERIFYING state without a frozen acceptance and proof policy version.",
    machine: escalationStateMachine as unknown as StateMachineDefinition<string>,
    from: "ENVIRONMENT_READY",
    command: "SubmitIntervention",
    guards: ["acceptance_criteria_frozen", "proof_policy_frozen"],
  },
  {
    id: "INV5",
    statement:
      "No ACCEPTED_RESULT unless the required P0/P1 validator conjunction or P2/P3 adjudication succeeds.",
    machine: escalationStateMachine as unknown as StateMachineDefinition<string>,
    from: "VERIFYING",
    command: "SystemRecordProofDecision",
    guards: ["proof_satisfied", "criterion_conjunction_passed"],
  },
  {
    id: "INV6",
    statement:
      "No payment eligibility while evidence is inconclusive, disputed, self-approved or bound to the wrong tenant, attempt or revision.",
    machine: paymentStateMachine as unknown as StateMachineDefinition<string>,
    from: "PENDING_EVIDENCE",
    command: "SystemRecordProofDecision",
    guards: [
      "evidence_conclusive",
      "not_disputed",
      "not_self_approved",
      "evidence_binding_correct",
    ],
  },
  {
    id: "INV7",
    statement: "No customer result delivery before the final result record commits.",
    machine: escalationStateMachine as unknown as StateMachineDefinition<string>,
    from: "ACCEPTED",
    command: "AcknowledgeResult",
    guards: ["result_record_committed"],
  },
  {
    id: "INV8",
    statement:
      "No learning publication before rights, provenance, validation, scope and consent checks pass.",
    machine: learningStateMachine as unknown as StateMachineDefinition<string>,
    from: "APPROVED",
    command: "SystemPublishLearning",
    guards: [
      "rights_verified",
      "provenance_verified",
      "validation_passed",
      "scope_verified",
      "consent_verified",
    ],
  },
  {
    id: "INV9",
    statement: "No cancellation claim that conceals an already-performed external side effect.",
    machine: escalationStateMachine as unknown as StateMachineDefinition<string>,
    from: "ASSIGNED",
    command: "CancelEscalation",
    guards: ["external_side_effects_disclosed", "capsule_teardown_verified"],
  },
  {
    id: "INV10",
    statement: "No retry beyond authorized aggregate budget or attempt count.",
    machine: attemptStateMachine as unknown as StateMachineDefinition<string>,
    from: "VERIFYING",
    command: "SystemRouteNextExpert",
    guards: ["budget_remaining", "attempts_remaining"],
  },
];

export const ALL_MACHINES = {
  escalation: escalationStateMachine as StateMachineDefinition<EscalationState>,
  attempt: attemptStateMachine as StateMachineDefinition<AttemptState>,
  payment: paymentStateMachine as StateMachineDefinition<PaymentState>,
  learning: learningStateMachine as StateMachineDefinition<LearningState>,
};
