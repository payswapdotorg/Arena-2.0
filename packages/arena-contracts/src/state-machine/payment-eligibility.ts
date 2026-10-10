import type { StateMachineDefinition } from "./machine.js";

/**
 * A11 — 支付资格状态机（PVP1.0 §4 的十二个状态 + 规则）。
 * 不变量 6：证据不确定/争议/自批准/错误绑定 ⇒ 不得进入 EVIDENCE_ACCEPTED。
 * EVIDENCE_ACCEPTED / READY_TO_RELEASE ≠ SETTLED：提供商确认 + 台账对账才构成结算。
 * Release 按 payment operation ID 幂等；provider 超时先对账再重试。
 */

export const PAYMENT_STATES = [
  "NOT_APPLICABLE",
  "RESERVED",
  "PENDING_EVIDENCE",
  "EVIDENCE_ACCEPTED",
  "READY_TO_RELEASE",
  "RELEASE_SUBMITTED",
  "SETTLED",
  "DISPUTED",
  "REFUND_PENDING",
  "REFUNDED",
  "FAILED_REQUIRES_RECONCILIATION",
  "CANCELLED",
] as const;

export type PaymentState = (typeof PAYMENT_STATES)[number];

/** 不变量 6 的守卫（ES2.0 §6）。 */
export const EVIDENCE_GATE_GUARDS = [
  "evidence_conclusive",
  "not_disputed",
  "not_self_approved",
  "evidence_binding_correct",
] as const;

export const paymentStateMachine: StateMachineDefinition<PaymentState> = {
  id: "payment-eligibility",
  initial: "NOT_APPLICABLE",
  states: PAYMENT_STATES,
  terminals: ["SETTLED", "REFUNDED", "CANCELLED"],
  transitions: [
    {
      from: "NOT_APPLICABLE",
      to: "RESERVED",
      command: "CreateEscalation",
      guards: ["budget_reserved_durably"],
    },
    {
      from: "RESERVED",
      to: "PENDING_EVIDENCE",
      command: "StartAttempt",
      guards: ["attempt_started"],
    },
    {
      from: "PENDING_EVIDENCE",
      to: "EVIDENCE_ACCEPTED",
      command: "SystemRecordProofDecision",
      guards: [...EVIDENCE_GATE_GUARDS],
    },
    {
      from: "PENDING_EVIDENCE",
      to: "DISPUTED",
      command: "SubmitAppeal",
      guards: ["dispute_filed"],
    },
    {
      from: "DISPUTED",
      to: "PENDING_EVIDENCE",
      command: "SystemResolveDispute",
      guards: ["dispute_resolved_in_favor"],
    },
    {
      from: "DISPUTED",
      to: "REFUND_PENDING",
      command: "SystemResolveDispute",
      guards: ["dispute_resolved_against"],
    },
    {
      from: "EVIDENCE_ACCEPTED",
      to: "READY_TO_RELEASE",
      command: "SystemRecordProofDecision",
      guards: ["all_predicates_passed", "caller_authenticity_verified", "task_binding_verified"],
    },
    {
      from: "READY_TO_RELEASE",
      to: "RELEASE_SUBMITTED",
      command: "SystemReleasePayment",
      guards: ["payment_operation_id_fresh"],
    },
    {
      from: "RELEASE_SUBMITTED",
      to: "SETTLED",
      command: "SystemReconcileProvider",
      guards: ["provider_acknowledged", "ledger_reconciled"],
    },
    {
      from: "RELEASE_SUBMITTED",
      to: "FAILED_REQUIRES_RECONCILIATION",
      command: "SystemReconcileProvider",
      guards: ["provider_timeout"],
    },
    {
      from: "FAILED_REQUIRES_RECONCILIATION",
      to: "RELEASE_SUBMITTED",
      command: "SystemReconcileProvider",
      guards: ["reconciled_by_operation_id"],
    },
    {
      from: "REFUND_PENDING",
      to: "REFUNDED",
      command: "SystemReconcileProvider",
      guards: ["refund_acknowledged"],
    },
    {
      from: "NOT_APPLICABLE",
      to: "CANCELLED",
      command: "CancelEscalation",
      guards: ["external_side_effects_disclosed"],
    },
    {
      from: "RESERVED",
      to: "CANCELLED",
      command: "CancelEscalation",
      guards: ["external_side_effects_disclosed"],
    },
    {
      from: "PENDING_EVIDENCE",
      to: "CANCELLED",
      command: "CancelEscalation",
      guards: ["external_side_effects_disclosed"],
    },
    {
      from: "EVIDENCE_ACCEPTED",
      to: "CANCELLED",
      command: "CancelEscalation",
      guards: ["external_side_effects_disclosed", "no_release_in_flight"],
    },
  ],
  state_docs: {
    NOT_APPLICABLE: {
      entry: "initial state; absorbing for zero-budget escalations",
      exit: "budget reserved via amendment/creation, or cancelled",
    },
    RESERVED: {
      entry: "budget durably reserved at creation",
      exit: "attempt starts or cancellation",
    },
    PENDING_EVIDENCE: {
      entry: "attempt in flight awaiting proof",
      exit: "evidence gate, dispute or cancellation",
    },
    EVIDENCE_ACCEPTED: {
      entry: "invariant-6 gate passed (conclusive, undisputed, not self-approved, correctly bound)",
      exit: "payout gate or cancellation",
    },
    READY_TO_RELEASE: {
      entry: "all predicates passed and authenticity/binding verified",
      exit: "release submitted (idempotent by operation id)",
    },
    RELEASE_SUBMITTED: {
      entry: "unique payment operation submitted",
      exit: "settled, or reconciliation required on timeout",
    },
    SETTLED: { entry: "provider acknowledged and ledger reconciled", exit: "terminal" },
    DISPUTED: {
      entry: "dispute filed on the evidence/result",
      exit: "resolution moves to evidence or refund",
    },
    REFUND_PENDING: { entry: "dispute resolved against payment", exit: "refund acknowledged" },
    REFUNDED: { entry: "refund completed and reconciled", exit: "terminal" },
    FAILED_REQUIRES_RECONCILIATION: {
      entry: "provider timeout; query by operation id before any retry",
      exit: "reconciled release resubmission",
    },
    CANCELLED: { entry: "cancellation with side effects disclosed", exit: "terminal" },
  },
};
