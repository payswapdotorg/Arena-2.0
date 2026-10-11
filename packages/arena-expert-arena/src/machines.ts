import type { TransitionCommand } from "@arena/contracts";

export * from "./round-machine.js";
export * from "./candidate-machine.js";
export * from "./review-machine.js";

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
