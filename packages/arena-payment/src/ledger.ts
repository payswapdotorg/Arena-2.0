/**
 * AR2-010 — 追加式支付台账（PVP1.0 §4；issue #12）。
 *
 * 冻结规则在本台账的强制方式：
 * - 台账不可变：条目一旦追加不可修改/删除；修正 = 追加新条目并引用
 *   supersedes_entry_id（与 EvidenceEnvelope 的修正语义同族）。
 * - Release 按 payment operation ID 幂等：数据库级唯一性由
 *   release_operations 的唯一键模拟（同 operation_id 二次提交 →
 *   REPLAYED，返回原始条目，绝不产生第二笔转账记录）。
 * - 金额移动永远引用 reservation：没有预留就没有支付（双记账纪律）。
 * - EVIDENCE_ACCEPTED / READY_TO_RELEASE ≠ SETTLED —— provider 确认 +
 *   台账对账才构成结算；本台账用 PROVIDER_ACK + RECONCILIATION 条目
 *   显式表达这一链条。
 */

export type LedgerEntryKind =
  | "BUDGET_RESERVED"
  | "ELIGIBILITY_DECIDED"
  | "RELEASE_OPERATION"
  | "PROVIDER_ACK"
  | "PROVIDER_TIMEOUT"
  | "RECONCILIATION"
  | "REFUND_OPERATION"
  | "DISPUTE_OPENED"
  | "DISPUTE_RESOLVED"
  | "CANCELLATION";

export interface LedgerEntry {
  entry_id: string;
  kind: LedgerEntryKind;
  tenant_id: string;
  escalation_id: string;
  attempt_id: string | null;
  /** 金额移动条目（RESERVE/RELEASE/REFUND）的引用预留。 */
  reservation_id: string | null;
  /** provider 操作幂等键（RELEASE/REFUND/ACK/TIMEOUT/RECONCILIATION）。 */
  payment_operation_id: string | null;
  amount: number | null;
  currency: string | null;
  memo: string;
  recorded_at: string;
  /** 修正链（新条目指向被取代者；不改历史）。 */
  supersedes_entry_id: string | null;
}

export type AppendOutcome =
  | { kind: "APPENDED"; entry: LedgerEntry }
  | { kind: "REPLAYED"; entry: LedgerEntry; reason: "duplicate_operation_id" }
  | { kind: "REJECTED"; code: LedgerRejectionCode; message: string };

export type LedgerRejectionCode =
  | "UNKNOWN_RESERVATION"
  | "DUPLICATE_ENTRY_ID"
  | "NEGATIVE_AMOUNT"
  | "SUPERSEDES_UNKNOWN_ENTRY"
  | "SUPERSEDES_SELF";

/** 追加式台账（内存参考实现；durable 化走 AR2-005 端口接线，接口不变）。 */
export class PaymentLedger {
  private readonly byId = new Map<string, LedgerEntry>();
  /** 幂等键注册表 —— 只登记金额移动（RELEASE/REFUND）：观察类条目
   * （PROVIDER_ACK/TIMEOUT/RECONCILIATION）可共享 operation id 而不
   * 破坏「唯一转账」不变量。 */
  private readonly movementsByOperation = new Map<string, LedgerEntry>();
  private readonly entries: LedgerEntry[] = [];
  private sequence = 0;

  /**
   * 唯一写入入口。金额移动（RELEASE/REFUND）必须携带 payment_operation_id
   * 与 reservation 引用；同 operation_id 重复提交 → REPLAYED（返回原条目，
   * 台账零改动 —— 「重复回调/并发 release 产生一个台账结果与一个 provider
   * 操作」的验收基础）。
   */
  append(
    input: Omit<LedgerEntry, "entry_id" | "recorded_at"> & { recorded_at?: string },
  ): AppendOutcome {
    if (input.amount !== null && input.amount < 0) {
      return rejected("NEGATIVE_AMOUNT", "ledger amounts must be non-negative");
    }
    // entry_id 由服务端分配 —— 调用方侧多出的 entry_id（防御性运行时检查）拒绝。
    const smuggledEntryId = (input as { entry_id?: unknown }).entry_id;
    if (smuggledEntryId !== undefined && smuggledEntryId !== null) {
      return rejected("DUPLICATE_ENTRY_ID", "entry ids are server-assigned");
    }
    if (
      (input.kind === "RELEASE_OPERATION" || input.kind === "REFUND_OPERATION") &&
      (input.reservation_id === null || input.payment_operation_id === null)
    ) {
      return rejected(
        "UNKNOWN_RESERVATION",
        `${input.kind} entries must reference a reservation and carry a payment_operation_id`,
      );
    }
    if (input.reservation_id !== null && !this.hasReservation(input.reservation_id)) {
      return rejected("UNKNOWN_RESERVATION", "amount movement references an unknown reservation");
    }
    if (input.supersedes_entry_id === (input as { entry_id?: string }).entry_id) {
      return rejected("SUPERSEDES_SELF", "an entry cannot supersede itself");
    }
    if (input.supersedes_entry_id !== null && !this.byId.has(input.supersedes_entry_id)) {
      return rejected("SUPERSEDES_UNKNOWN_ENTRY", "correction references an unknown entry");
    }

    // 幂等键：同 operation_id 的金额移动 → 重放（唯一转账保证）。
    const isMovement = input.kind === "RELEASE_OPERATION" || input.kind === "REFUND_OPERATION";
    if (isMovement && input.payment_operation_id !== null) {
      const existing = this.movementsByOperation.get(input.payment_operation_id);
      if (existing !== undefined) {
        return { kind: "REPLAYED", entry: existing, reason: "duplicate_operation_id" };
      }
    }

    this.sequence += 1;
    const entry: LedgerEntry = {
      ...input,
      entry_id: `led_${String(this.sequence).padStart(8, "0")}`,
      recorded_at: input.recorded_at ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    };
    this.byId.set(entry.entry_id, entry);
    if (
      (entry.kind === "RELEASE_OPERATION" || entry.kind === "REFUND_OPERATION") &&
      entry.payment_operation_id !== null
    ) {
      this.movementsByOperation.set(entry.payment_operation_id, entry);
    }
    this.entries.push(entry);
    return { kind: "APPENDED", entry };
  }

  /** 只读视图（顺序 = 追加顺序）。 */
  all(): readonly LedgerEntry[] {
    return this.entries;
  }

  byEscalation(escalation_id: string): readonly LedgerEntry[] {
    return this.entries.filter((entry) => entry.escalation_id === escalation_id);
  }

  /** 该 operation id 的金额移动条目（无移动或仅观察类条目 → null）。 */
  byOperationId(payment_operation_id: string): LedgerEntry | null {
    return this.movementsByOperation.get(payment_operation_id) ?? null;
  }

  /** 对账查询：该 operation 是否已有 provider 确认（重试前必须先查）。 */
  providerAcked(payment_operation_id: string): boolean {
    const ack = this.entries.find(
      (entry) =>
        entry.payment_operation_id === payment_operation_id && entry.kind === "PROVIDER_ACK",
    );
    return ack !== undefined;
  }

  reservationOf(reservation_id: string): LedgerEntry | null {
    return this.byId.get(reservation_id) ?? null;
  }

  private hasReservation(reservation_id: string): boolean {
    const reservation = this.byId.get(reservation_id);
    return reservation !== undefined && reservation.kind === "BUDGET_RESERVED";
  }
}

function rejected(code: LedgerRejectionCode, message: string): AppendOutcome {
  return { kind: "REJECTED", code, message };
}
