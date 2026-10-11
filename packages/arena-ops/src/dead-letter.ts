/**
 * AR2-013 — 死信视图（issue #15）。
 *
 * 冻结纪律：
 * - outbox 契约是「永不丢消息」（markFailed + 退避，无限重试）；
 *   死信视图只做「可见性分层」：attempts ≥ 阈值的消息被标记为
 *   dead-lettered（需要运维介入），但绝不从 outbox 删除 ——
 *   retained: true 是结构字面量；
 * - DLQ 大小/内容 = 可见指标（排空流程见 RUNBOOKS.md）。
 */

export interface OutboxMessageStat {
  outbox_id: string;
  attempts: number;
  next_attempt_at: string;
  dispatched_at: string | null;
  event_type: string;
}

export interface DeadLetterEntry {
  outbox_id: string;
  attempts: number;
  event_type: string;
  flagged_reason: "max_attempts_exceeded";
}

export interface DeadLetterReport {
  dead_lettered: readonly DeadLetterEntry[];
  in_flight: number;
  dispatched: number;
  /** 结构字面量：死信被标记但绝不被删除（outbox 永不丢消息）。 */
  retained: true;
}

/** 识别死信（可见性视图 —— 不修改任何状态）。 */
export function identifyDeadLetters(
  stats: readonly OutboxMessageStat[],
  options: { max_attempts: number },
): DeadLetterReport {
  const dispatched = stats.filter((stat) => stat.dispatched_at !== null).length;
  const open = stats.filter((stat) => stat.dispatched_at === null);
  const deadLettered = open
    .filter((stat) => stat.attempts >= options.max_attempts)
    .map((stat) => ({
      outbox_id: stat.outbox_id,
      attempts: stat.attempts,
      event_type: stat.event_type,
      flagged_reason: "max_attempts_exceeded" as const,
    }));
  return {
    dead_lettered: deadLettered,
    in_flight: open.length - deadLettered.length,
    dispatched,
    retained: true,
  };
}

export const DEAD_LETTER_DISCLOSURE =
  "Dead letters are a visibility layer over the durable outbox: messages past the attempt " +
  "threshold are flagged for operator intervention but never removed — the outbox contract " +
  "keeps them retrying until explicitly reconciled (see RUNBOOKS.md drain procedure)";
