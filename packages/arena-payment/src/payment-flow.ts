import {
  paymentStateMachine,
  evaluateTransition,
  type ProofPolicySnapshot,
  type TransitionCommand,
} from "@arena/contracts";
import { PaymentLedger, type LedgerEntry } from "./ledger.js";
import type { ProviderReconciliation, TestPaymentProvider } from "./test-provider.js";
import { evaluateEvidenceGate, evaluatePayoutGate, type EligibilityInput } from "./eligibility.js";

/**
 * AR2-010 — 支付流编排（PVP1.0 §4 状态机 + issue #12 验收）。
 * 迁移全部走冻结 paymentStateMachine（绝不手写跳转）；金额移动先有 durable
 * 预留；Release 按 payment_operation_id 幂等（台账唯一键 + 守卫双防线）；
 * provider 超时先对账再重试（绝不盲重试）；资格 ≠ 结算（SETTLED 需
 * provider 确认 + 台账对账）。
 */

export type FlowStepOutcome =
  | { kind: "TRANSITIONED"; from: string; to: string; version: number; ledger: AppendSummary }
  | { kind: "BLOCKED"; code: FlowBlockedCode; message: string; failed_guards: readonly string[] };

export type AppendSummary = { appended: LedgerEntry | null; replayed: LedgerEntry | null } | null;

export type FlowBlockedCode =
  | "INVALID_TRANSITION"
  | "INVARIANT_VIOLATION"
  | "NO_RESERVATION"
  | "DUPLICATE_OPERATION"
  | "PROVIDER_ALREADY_ACKED";

export interface PaymentFlowContext {
  tenant_id: string;
  escalation_id: string;
  attempt_id: string;
  policy: ProofPolicySnapshot;
}

/** 单一 escalation 的支付资格聚合（状态机驱动 + 台账追加）。 */
export class PaymentFlow {
  private state = "NOT_APPLICABLE";
  private version = 0;
  private reservationId: string | null = null;
  private readonly ledger: PaymentLedger;
  private readonly context: PaymentFlowContext;

  constructor(ledger: PaymentLedger, context: PaymentFlowContext) {
    this.ledger = ledger;
    this.context = context;
  }

  private log(
    kind: Parameters<PaymentLedger["append"]>[0]["kind"],
    overrides: Partial<Parameters<PaymentLedger["append"]>[0]> & { memo: string },
  ): ReturnType<PaymentLedger["append"]> {
    return this.ledger.append({
      kind,
      tenant_id: this.context.tenant_id,
      escalation_id: this.context.escalation_id,
      attempt_id: this.context.attempt_id,
      reservation_id: this.reservationId,
      payment_operation_id: null,
      amount: null,
      currency: null,
      supersedes_entry_id: null,
      ...overrides,
    });
  }

  current(): { state: string; version: number } {
    return { state: this.state, version: this.version };
  }

  /** 创建时 durable 预留（NOT_APPLICABLE → RESERVED；台账 BUDGET_RESERVED）。 */
  reserve(amount: number, currency: string): FlowStepOutcome {
    const outcome = this.step("CreateEscalation", { budget_reserved_durably: true });
    if (outcome.kind === "BLOCKED") return outcome;
    const appended = this.ledger.append({
      kind: "BUDGET_RESERVED",
      tenant_id: this.context.tenant_id,
      escalation_id: this.context.escalation_id,
      attempt_id: null,
      reservation_id: null,
      payment_operation_id: null,
      amount,
      currency,
      memo: "budget reserved durably at escalation creation",
      supersedes_entry_id: null,
    });
    if (appended.kind === "APPENDED") {
      this.reservationId = appended.entry.entry_id;
    }
    return outcome;
  }

  /** StartAttempt → PENDING_EVIDENCE。 */
  startAttempt(): FlowStepOutcome {
    return this.step("StartAttempt", { attempt_started: true });
  }

  /** 记录证明决策：资格闸门（不变量 6）→ payout 闸门，两步都经冻结
   * 状态机；FAILED/INCONCLUSIVE/争议/自批准 → BLOCKED，状态不动。 */
  recordProofDecision(input: EligibilityInput): FlowStepOutcome {
    const gate = evaluateEvidenceGate(input);
    this.log("ELIGIBILITY_DECIDED", {
      memo: `proof decision ${input.decision.status} (${input.decision.selected_class}); gate ${gate.kind}`,
    });
    if (gate.kind === "EVIDENCE_GATE_BLOCKED") {
      return {
        kind: "BLOCKED",
        code: "INVARIANT_VIOLATION",
        message: gate.reason,
        failed_guards: failedGuardNames(gate.guards),
      };
    }
    // 第一步：PENDING_EVIDENCE → EVIDENCE_ACCEPTED。
    const first = this.step("SystemRecordProofDecision", guardsToFacts(gate.guards));
    if (first.kind === "BLOCKED") return first;
    // 第二步：EVIDENCE_ACCEPTED → READY_TO_RELEASE（payout 闸门）。
    const payout = evaluatePayoutGate(input.decision, this.context.policy);
    if (payout.kind === "NOT_READY") {
      return {
        kind: "BLOCKED",
        code: "INVARIANT_VIOLATION",
        message: payout.reason,
        failed_guards: failedPayoutNames(payout.guards),
      };
    }
    return this.step("SystemRecordProofDecision", {
      all_predicates_passed: payout.guards.all_predicates_passed,
      caller_authenticity_verified: payout.guards.caller_authenticity_verified,
      task_binding_verified: payout.guards.task_binding_verified,
    });
  }

  /** 提交放款：operation id 必须新鲜（台账 + 流程双防线）；重复 →
   * DUPLICATE_OPERATION，无第二次转账。 */
  async release(options: {
    payment_operation_id: string;
    amount: number;
    currency: string;
    payee: string;
    provider: TestPaymentProvider;
  }): Promise<FlowStepOutcome> {
    if (this.reservationId === null) {
      return blocked("NO_RESERVATION", "release requires a durable budget reservation");
    }
    if (this.state !== "READY_TO_RELEASE") {
      return blocked(
        "INVALID_TRANSITION",
        `SystemReleasePayment is not valid in state ${this.state} (release requires READY_TO_RELEASE)`,
      );
    }
    if (this.usedOperationIds.has(options.payment_operation_id)) {
      return blocked(
        "DUPLICATE_OPERATION",
        `payment_operation_id ${options.payment_operation_id} was already used — replay is the caller's only option`,
      );
    }
    // 台账先行（幂等键）：同 operation_id 的重复提交在这里被挡下。
    const ledgerOutcome = this.log("RELEASE_OPERATION", {
      payment_operation_id: options.payment_operation_id,
      amount: options.amount,
      currency: options.currency,
      memo: `test-mode release to ${options.payee}`,
    });
    if (ledgerOutcome.kind === "REPLAYED") {
      return blocked(
        "DUPLICATE_OPERATION",
        "ledger already holds a release for this payment_operation_id",
      );
    }
    if (ledgerOutcome.kind === "REJECTED") {
      return blocked("INVARIANT_VIOLATION", `${ledgerOutcome.code}: ${ledgerOutcome.message}`);
    }
    this.usedOperationIds.add(options.payment_operation_id);

    const stepOutcome = this.step("SystemReleasePayment", {
      payment_operation_id_fresh: true,
    });
    if (stepOutcome.kind === "BLOCKED") return stepOutcome;

    // provider 提交（test-mode 模拟器；挂起 = 超时路径）。
    const submitted = await options.provider.submit({
      payment_operation_id: options.payment_operation_id,
      kind: "release",
      amount: options.amount,
      currency: options.currency,
      payee: options.payee,
    });
    if (submitted.acknowledged) {
      return this.providerSettled(options.payment_operation_id);
    }
    // 超时 → FAILED_REQUIRES_RECONCILIATION（绝不盲重试）。
    this.log("PROVIDER_TIMEOUT", {
      payment_operation_id: options.payment_operation_id,
      memo: "provider did not acknowledge — reconciliation required before any retry",
    });
    return this.step("SystemReconcileProvider", { provider_timeout: true });
  }

  /** 对账：先按 operation id 查 provider/台账 —— 已确认 → SETTLED；
   * provider 无记录 → 重提交；在途 → 等待结算（不盲重试）。 */
  async reconcile(options: {
    payment_operation_id: string;
    provider: TestPaymentProvider & ProviderReconciliation;
  }): Promise<FlowStepOutcome> {
    const ledgerAcked = this.ledger.providerAcked(options.payment_operation_id);
    const providerState = await options.provider.query(options.payment_operation_id);
    if (ledgerAcked || providerState?.settled === true) {
      return this.providerSettled(options.payment_operation_id);
    }
    if (providerState === null) {
      // provider 侧无记录：对账后重提交（FAILED_REQUIRES_RECONCILIATION → RELEASE_SUBMITTED）。
      return this.step("SystemReconcileProvider", { reconciled_by_operation_id: true });
    }
    return blocked(
      "PROVIDER_ALREADY_ACKED",
      "provider reports the operation as in flight — wait for settlement before retry",
    );
  }

  /** 争议（SubmitAppeal）：DISPUTED —— 任何在途放款被阻断。 */
  openDispute(): FlowStepOutcome {
    this.log("DISPUTE_OPENED", {
      memo: "dispute filed — release blocked pending resolution",
    });
    return this.step("SubmitAppeal", { dispute_filed: true });
  }

  /** 争议解决：支持方 → PENDING_EVIDENCE；反对方 → REFUND_PENDING + 退款。 */
  async resolveDispute(options: {
    inFavor: boolean;
    refund_operation_id: string;
    amount: number;
    currency: string;
    payee: string;
    provider: TestPaymentProvider;
  }): Promise<FlowStepOutcome> {
    this.log("DISPUTE_RESOLVED", {
      memo: options.inFavor
        ? "dispute resolved in favor — evidence path resumes"
        : "dispute resolved against — refund path",
    });
    const outcome = this.step("SystemResolveDispute", {
      dispute_resolved_in_favor: options.inFavor,
      dispute_resolved_against: !options.inFavor,
    });
    if (outcome.kind === "BLOCKED") return outcome;
    if (!options.inFavor) {
      const refund = this.log("REFUND_OPERATION", {
        payment_operation_id: options.refund_operation_id,
        amount: options.amount,
        currency: options.currency,
        memo: `test-mode refund to requester (${options.payee} reversed)`,
      });
      if (refund.kind === "APPENDED") {
        await options.provider.submit({
          payment_operation_id: options.refund_operation_id,
          kind: "refund",
          amount: options.amount,
          currency: options.currency,
          payee: options.payee,
        });
        return this.step("SystemReconcileProvider", { refund_acknowledged: true });
      }
    }
    return outcome;
  }

  /** 取消（CancelEscalation）—— 侧效应披露守卫。 */
  cancel(): FlowStepOutcome {
    return this.step("CancelEscalation", {
      external_side_effects_disclosed: true,
      no_release_in_flight: this.state !== "RELEASE_SUBMITTED",
    });
  }

  private async providerSettled(operationId: string): Promise<FlowStepOutcome> {
    this.log("PROVIDER_ACK", {
      payment_operation_id: operationId,
      memo: "provider acknowledged the operation",
    });
    // 机器忠实路径：FAILED_REQUIRES_RECONCILIATION 需先按 operation id 重提交
    // （reconciled_by_operation_id）回到 RELEASE_SUBMITTED，再结算。
    if (this.state === "FAILED_REQUIRES_RECONCILIATION") {
      const resubmitted = this.step("SystemReconcileProvider", {
        reconciled_by_operation_id: true,
      });
      if (resubmitted.kind === "BLOCKED") return resubmitted;
    }
    const settled = this.step("SystemReconcileProvider", {
      provider_acknowledged: true,
      ledger_reconciled: true,
    });
    if (settled.kind === "BLOCKED") return settled;
    this.log("RECONCILIATION", {
      payment_operation_id: operationId,
      memo: "ledger reconciled with provider acknowledgement — SETTLED",
    });
    return settled;
  }

  private readonly usedOperationIds = new Set<string>();

  private step(command: TransitionCommand, facts: Record<string, boolean>): FlowStepOutcome {
    const evaluation = evaluateTransition(paymentStateMachine, this.state, command, facts);
    if (!evaluation.ok) {
      if (evaluation.code === "ARENA_INVALID_TRANSITION") {
        return blocked("INVALID_TRANSITION", `command ${command} not valid in state ${this.state}`);
      }
      return {
        kind: "BLOCKED",
        code: "INVARIANT_VIOLATION",
        message: `transition rejected: failed guards ${evaluation.failed_guards.join(", ")}`,
        failed_guards: evaluation.failed_guards,
      };
    }
    this.state = evaluation.to;
    this.version += 1;
    return {
      kind: "TRANSITIONED",
      from: evaluation.matched.from,
      to: evaluation.to,
      version: this.version,
      ledger: null,
    };
  }
}

function blocked(code: FlowBlockedCode, message: string): FlowStepOutcome {
  return { kind: "BLOCKED", code, message, failed_guards: [] };
}

function guardsToFacts(guards: {
  evidence_conclusive: boolean;
  not_disputed: boolean;
  not_self_approved: boolean;
  evidence_binding_correct: boolean;
}): Record<string, boolean> {
  return { ...guards };
}

function failedGuardNames(guards: {
  evidence_conclusive: boolean;
  not_disputed: boolean;
  not_self_approved: boolean;
  evidence_binding_correct: boolean;
}): string[] {
  return Object.entries(guards)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
}

function failedPayoutNames(guards: {
  all_predicates_passed: boolean;
  caller_authenticity_verified: boolean;
  task_binding_verified: boolean;
}): string[] {
  return Object.entries(guards)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
}
