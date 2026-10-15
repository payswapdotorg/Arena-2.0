/**
 * UIA-003 — 运维/治理：@arena/ops 真实挂接面视图模型（容量/死信/看门人）。
 *
 * 冻结纪律（诚实状态法 §2.3）：
 * - 三个披露（CAPACITY/DEAD_LETTER/CUSTODIAN）从 @arena/ops 公开契约
 *   **逐字** 流转；
 * - typed 报告形状 = 真实函数（computeQueueLag / identifyDeadLetters /
 *   CapsuleCustodian.detectTeardownDrift）在 **显式标注 EMPTY** 的输入上
 *   的真实输出 —— 本表面没有接线 live outbox/capsule provider 订阅，
 *   EMPTY 输入永不伪装成运行时状态；
 * - 队列滞后分级阈值（60s/600s）来自真实 computeQueueLag 语义。
 */
import {
  CapsuleCustodian,
  computeQueueLag,
  identifyDeadLetters,
  type DeadLetterReport,
  type QueueLagReport,
} from "@arena/ops";

/** EMPTY 输入标注（诚实标签 —— 绝不呈现为运行时状态）。 */
export const OPS_EMPTY_INPUT_LABEL =
  "EMPTY input (no live outbox/capsule feed is wired to this surface — the typed shapes below are " +
  "computed over an explicitly EMPTY input and never presented as runtime state)";

/** 死信识别的演示阈值（EMPTY 输入上的常量 —— 如实标注）。 */
export const DEAD_LETTER_MAX_ATTEMPTS = 5;

/** 容量面板视图模型（真实 computeQueueLag × EMPTY stats）。 */
export interface CapacityPanelViewModel {
  emptyInputLabel: string;
  queueLag: QueueLagReport;
}

export function capacityPanelViewModel(): CapacityPanelViewModel {
  const queueLag = computeQueueLag({ due_count: 0, oldest_due_at: null }, "2026-01-01T00:00:00Z");
  return { emptyInputLabel: OPS_EMPTY_INPUT_LABEL, queueLag };
}

/** 死信面板视图模型（真实 identifyDeadLetters × EMPTY stats）。 */
export interface DeadLetterPanelViewModel {
  emptyInputLabel: string;
  maxAttempts: number;
  report: DeadLetterReport;
}

export function deadLetterPanelViewModel(): DeadLetterPanelViewModel {
  const report = identifyDeadLetters([], { max_attempts: DEAD_LETTER_MAX_ATTEMPTS });
  return { emptyInputLabel: OPS_EMPTY_INPUT_LABEL, maxAttempts: DEAD_LETTER_MAX_ATTEMPTS, report };
}

/** 看门人面板视图模型（真实 CapsuleCustodian × 空台账）。 */
export interface CustodianPanelViewModel {
  emptyInputLabel: string;
  ledgerEntries: number;
  teardownDrift: number;
}

export function custodianPanelViewModel(now: string): CustodianPanelViewModel {
  const custodian = new CapsuleCustodian();
  return {
    emptyInputLabel: OPS_EMPTY_INPUT_LABEL,
    ledgerEntries: custodian.entriesSnapshot().length,
    teardownDrift: custodian.detectTeardownDrift(now).length,
  };
}
