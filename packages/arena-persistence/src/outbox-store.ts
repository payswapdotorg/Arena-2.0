import type { EventEnvelope, OutboxMessage, OutboxPort } from "@arena/contracts";

type ArenaId = string;
import type { SqliteEngine } from "./engine.js";

/**
 * AR2-005 — OutboxPort 的 SQLite 实现。
 *
 * - enqueue：独立入队（无聚合事务上下文时使用）；
 *   saveAggregate 的事件行由 runtime 在同一事务内直插（事务性 outbox 本体）；
 * - fetchDue：未投递且 next_attempt_at ≤ now，按序取 limit 条；
 * - markDispatched：终态（写 dispatched_at）；
 * - markFailed：attempts+1 + 调用方给出的退避 next_attempt_at（永不丢失）。
 */

export interface OutboxStoreDeps {
  now: () => string;
}

export interface OutboxRowWriter {
  /** 事务性 outbox：在调用方事务内插入事件行（aggregate-store 使用）。 */
  insertEventRows(events: readonly EventEnvelope[]): void;
}

export function createOutboxStore(
  engine: SqliteEngine,
  deps: OutboxStoreDeps,
): OutboxPort & OutboxRowWriter {
  const insertSql = `INSERT INTO arena_outbox
      (outbox_id, event_id, event_json, delivery_identity, attempts, next_attempt_at)
    VALUES (?, ?, ?, ?, 0, ?)`;

  function nextOutboxId(event: EventEnvelope): string {
    // 确定性 ID：事件 ID + 单调序列（哈希碰撞安全）。
    const seq = engine.statement("SELECT COUNT(*) AS n FROM arena_outbox").get() as { n: number };
    return `obx_${String(Number(seq.n) + 1).padStart(8, "0")}_${event.event_id}`;
  }

  const store: OutboxPort & OutboxRowWriter = {
    enqueue(events: readonly EventEnvelope[]) {
      engine.transaction(() => {
        store.insertEventRows(events);
      });
      return Promise.resolve();
    },
    insertEventRows(events: readonly EventEnvelope[]) {
      for (const event of events) {
        const outboxId = nextOutboxId(event);
        engine
          .statement(insertSql)
          .run(outboxId, event.event_id, JSON.stringify(event), `delivery:${outboxId}`, deps.now());
      }
    },
    fetchDue(limit: number, now: string) {
      const rows = engine
        .statement(
          `SELECT outbox_id, event_json, delivery_identity, attempts, next_attempt_at
             FROM arena_outbox
            WHERE dispatched_at IS NULL AND next_attempt_at <= ?
            ORDER BY next_attempt_at, outbox_id
            LIMIT ?`,
        )
        .all(now, limit);
      const messages: OutboxMessage[] = rows.map((row) => ({
        outbox_id: String(row.outbox_id),
        event: JSON.parse(String(row.event_json)) as EventEnvelope,
        delivery_identity: String(row.delivery_identity),
        attempts: Number(row.attempts),
        next_attempt_at: String(row.next_attempt_at),
      }));
      return Promise.resolve(messages);
    },
    markDispatched(outbox_id: ArenaId, delivered_at: string) {
      engine
        .statement("UPDATE arena_outbox SET dispatched_at = ? WHERE outbox_id = ?")
        .run(delivered_at, outbox_id);
      return Promise.resolve();
    },
    markFailed(outbox_id: ArenaId, next_attempt_at: string) {
      engine
        .statement(
          "UPDATE arena_outbox SET attempts = attempts + 1, next_attempt_at = ? WHERE outbox_id = ?",
        )
        .run(next_attempt_at, outbox_id);
      return Promise.resolve();
    },
  };
  return store;
}
