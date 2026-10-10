import type { AggregateStorePort, SaveAggregateInput } from "@arena/contracts";
import type { SqliteEngine, Statement } from "./engine.js";

/**
 * AR2-005 — AggregateStorePort 的 SQLite 实现（乐观并发）。
 *
 * saveAggregate 在 BEGIN IMMEDIATE 事务内完成「读版本 → 校验 → 写聚合」；
 * expected_version 不匹配 → 抛 ARENA_CONCURRENT_WRITE_CONFLICT
 * （与 in-memory 运行时相同的错误名；目录码稳定性由契约层负责）。
 * record 以 JSON 列存储（引擎无关负载，PORT_NEUTRALITY_RULE）。
 */

export interface AggregateStoreDeps {
  /** outbox 行插入（同一事务内）—— 由 sqlite-runtime 注入以实现事务性 outbox。 */
  enqueueOutboxRows(
    events: SaveAggregateInput["events"],
    tx: { statement: (sql: string) => Statement },
  ): void;
}

export function createAggregateStore(
  engine: SqliteEngine,
  deps: AggregateStoreDeps,
): AggregateStorePort {
  return {
    async saveAggregate(input: SaveAggregateInput): Promise<{ new_version: number }> {
      const result = engine.transaction(() => {
        const existing = engine
          .statement(
            "SELECT version FROM arena_aggregates WHERE aggregate_type = ? AND aggregate_id = ?",
          )
          .get(input.ref.aggregate_type, input.ref.aggregate_id);
        if (existing !== undefined && Number(existing.version) !== input.ref.expected_version) {
          throw new Error(
            `ARENA_CONCURRENT_WRITE_CONFLICT: expected version ${input.ref.expected_version}, stored ${String(existing.version)}`,
          );
        }
        const newVersion = input.ref.expected_version + 1;
        const tenantId = (input.record as { tenant_id?: string }).tenant_id ?? "";
        engine
          .statement(
            `INSERT INTO arena_aggregates
               (aggregate_type, aggregate_id, version, tenant_id, record_json, recorded_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (aggregate_type, aggregate_id) DO UPDATE SET
               version = excluded.version,
               tenant_id = excluded.tenant_id,
               record_json = excluded.record_json,
               recorded_at = excluded.recorded_at`,
          )
          .run(
            input.ref.aggregate_type,
            input.ref.aggregate_id,
            newVersion,
            tenantId,
            JSON.stringify(input.record),
            input.recorded_at,
          );
        // 事务性 outbox：事件与状态变更同事务入队（architecture-lock 19）。
        deps.enqueueOutboxRows(input.events, { statement: (sql: string) => engine.statement(sql) });
        return newVersion;
      });
      return { new_version: result };
    },
    async loadAggregate(aggregate_type, aggregate_id) {
      const row = engine
        .statement(
          "SELECT version, record_json, recorded_at FROM arena_aggregates WHERE aggregate_type = ? AND aggregate_id = ?",
        )
        .get(aggregate_type, aggregate_id);
      if (row === undefined) return Promise.resolve(null);
      return Promise.resolve({
        aggregate_type,
        aggregate_id,
        version: Number(row.version),
        record: JSON.parse(String(row.record_json)) as unknown,
        recorded_at: String(row.recorded_at),
      });
    },
  };
}
