import type { IdempotencyPort, IdempotencyRecord, ReserveIdempotencyInput } from "@arena/contracts";
import type { SqliteEngine } from "./engine.js";

/**
 * AR2-005 — IdempotencyPort 的 SQLite 实现（原子预留）。
 *
 * 冻结端口语义（ports.ts 注释）：「并发同键只有一个 RESERVED」。
 * 原子性来自 (tenant_id, idempotency_key) 主键 + BEGIN IMMEDIATE：
 * - 无行 → INSERT IN_PROGRESS → RESERVED；
 * - 有行且摘要不同 → CONFLICT（ARENA_IDEMPOTENCY_DIGEST_MISMATCH 语义）；
 * - 有行且摘要相同 → REPLAY（记录状态如实返回：IN_PROGRESS 或 COMPLETED）。
 *
 * 与 AR2-002 in-memory 演示实现的偏差（在 ADR 与交付报告中披露）：
 * 演示实现对 IN_PROGRESS 同摘要返回 RESERVED（进程内无并发）；
 * durable 实现按冻结端口注释返回 REPLAY —— 第二个 API 进程绝不
 * 二次执行命令，调用方据 record.status 自行决定重试或等待。
 */

interface IdempotencyRow {
  idempotency_key: string;
  request_digest: string;
  status: string;
  response_digest: string | null;
  completed_at: string | null;
  response_json: string | null;
}

export function createIdempotencyStore(engine: SqliteEngine): IdempotencyPort & {
  /** 实现内部（非端口契约）：REPLAY 重放的完整响应体存储。 */
  storeResponse(tenant_id: string, idempotency_key: string, response: unknown): void;
  readResponse(tenant_id: string, idempotency_key: string): unknown;
} {
  const selectRow = (tenant_id: string, idempotency_key: string): IdempotencyRow | undefined =>
    engine
      .statement(
        "SELECT idempotency_key, request_digest, status, response_digest, completed_at, response_json FROM arena_idempotency WHERE tenant_id = ? AND idempotency_key = ?",
      )
      .get(tenant_id, idempotency_key) as IdempotencyRow | undefined;

  const toRecord = (row: IdempotencyRow): IdempotencyRecord => ({
    idempotency_key: row.idempotency_key,
    request_digest: row.request_digest,
    status: row.status as IdempotencyRecord["status"],
    response_digest: row.response_digest,
    completed_at: row.completed_at,
  });

  return {
    reserve(input: ReserveIdempotencyInput) {
      const outcome = engine.transaction(() => {
        const existing = selectRow(input.tenant_id, input.idempotency_key);
        if (existing === undefined) {
          engine
            .statement(
              `INSERT INTO arena_idempotency
                 (tenant_id, idempotency_key, command, request_digest, status)
               VALUES (?, ?, ?, ?, 'IN_PROGRESS')`,
            )
            .run(input.tenant_id, input.idempotency_key, input.command, input.request_digest);
          return { kind: "RESERVED" as const };
        }
        if (existing.request_digest !== input.request_digest) {
          return { kind: "CONFLICT" as const, record: toRecord(existing) };
        }
        return { kind: "REPLAY" as const, record: toRecord(existing) };
      });
      return Promise.resolve(outcome);
    },
    complete(input) {
      engine
        .statement(
          `UPDATE arena_idempotency
             SET status = 'COMPLETED', response_digest = ?, completed_at = ?
           WHERE idempotency_key = ? AND status = 'IN_PROGRESS'`,
        )
        .run(input.response_digest, input.completed_at, input.idempotency_key);
      return Promise.resolve();
    },
    load(idempotency_key: string, tenant_id: string) {
      const row = selectRow(tenant_id, idempotency_key);
      return Promise.resolve(row === undefined ? null : toRecord(row));
    },
    storeResponse(tenant_id: string, idempotency_key: string, response: unknown): void {
      engine
        .statement(
          "UPDATE arena_idempotency SET response_json = ? WHERE tenant_id = ? AND idempotency_key = ?",
        )
        .run(JSON.stringify(response), tenant_id, idempotency_key);
    },
    readResponse(tenant_id: string, idempotency_key: string): unknown {
      const row = selectRow(tenant_id, idempotency_key);
      return row?.response_json === null || row === undefined
        ? null
        : JSON.parse(row.response_json);
    },
  };
}
