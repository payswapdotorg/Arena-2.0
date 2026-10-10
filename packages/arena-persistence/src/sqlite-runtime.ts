import type { EventEnvelope, IdempotencyRecord } from "@arena/contracts";
import { openEngine, type SqliteEngine } from "./engine.js";
import { createMigrationStore } from "./migrations.js";
import { createAggregateStore } from "./aggregate-store.js";
import { createIdempotencyStore } from "./idempotency-store.js";
import { createOutboxStore, type OutboxRowWriter } from "./outbox-store.js";
import { createJobStore, JobFencedOutError } from "./job-store.js";

/**
 * AR2-005 — durable SQLite runtime（冻结端口的参考引擎实现）。
 *
 * 组装五个端口：AggregateStore / Idempotency / Outbox / Job / Migration。
 * saveAggregate 的事件与聚合状态在同一 BEGIN IMMEDIATE 事务提交
 * （事务性 outbox，architecture-lock 19）。
 *
 * 引擎决策见 docs/adr-0001-sqlite-reference-engine.md：
 * node:sqlite 为参考引擎（dev/test + 单实例）；生产多实例引擎
 * （embedded Postgres 候选）保持开放，另行 ADR + 证据。
 */

export interface SqliteRuntimeOptions {
  path: string;
  now?: () => string;
  busyTimeoutMs?: number;
}

export interface StoredAggregateRow {
  aggregate_type: string;
  aggregate_id: string;
  version: number;
  record: unknown;
  tenant_id: string;
  recorded_at: string;
}

export interface SqliteRuntime {
  engine: SqliteEngine;
  aggregates: import("@arena/contracts").AggregateStorePort;
  idempotency: import("@arena/contracts").IdempotencyPort & {
    storeResponse(tenant_id: string, idempotency_key: string, response: unknown): void;
    readResponse(tenant_id: string, idempotency_key: string): unknown;
  };
  outbox: import("@arena/contracts").OutboxPort & OutboxRowWriter;
  jobs: import("@arena/contracts").JobPort;
  migrations: import("@arena/contracts").MigrationPort;
  /** 实现内部（非端口契约）：按类型（+可选租户，引擎侧过滤）枚举聚合。 */
  listAggregates(aggregate_type: string, tenant_id?: string): StoredAggregateRow[];
  close(): void;
}

export function createSqliteRuntime(options: SqliteRuntimeOptions): SqliteRuntime {
  const now = options.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
  const engine = openEngine({ path: options.path, busyTimeoutMs: options.busyTimeoutMs });
  const migrations = createMigrationStore(engine, { now });
  // 从空库（或既有库）收敛 schema；中断恢复协议见 migrations.ts 头注。
  // applyMigrations 是同步落地的迁移引导——构造时即执行。
  void migrations.applyMigrations();
  const outbox = createOutboxStore(engine, { now });
  const aggregates = createAggregateStore(engine, {
    enqueueOutboxRows: (events: readonly EventEnvelope[]) => {
      outbox.insertEventRows(events);
    },
  });
  const idempotency = createIdempotencyStore(engine);
  const jobs = createJobStore(engine, { now });
  const listAggregates = (aggregate_type: string, tenant_id?: string): StoredAggregateRow[] => {
    const sql =
      "SELECT aggregate_type, aggregate_id, version, tenant_id, record_json, recorded_at " +
      "FROM arena_aggregates WHERE aggregate_type = ?" +
      (tenant_id === undefined ? "" : " AND tenant_id = ?") +
      " ORDER BY recorded_at, aggregate_id";
    const rows =
      tenant_id === undefined
        ? (engine.statement(sql).all(aggregate_type) as unknown as Array<StoredAggregateSqlRow>)
        : (engine
            .statement(sql)
            .all(aggregate_type, tenant_id) as unknown as Array<StoredAggregateSqlRow>);
    return rows.map((row) => ({
      aggregate_type: row.aggregate_type,
      aggregate_id: row.aggregate_id,
      version: Number(row.version),
      record: JSON.parse(String(row.record_json)) as unknown,
      tenant_id: row.tenant_id,
      recorded_at: String(row.recorded_at),
    }));
  };
  return {
    engine,
    aggregates,
    idempotency,
    outbox,
    jobs,
    migrations,
    listAggregates,
    close: () => engine.close(),
  };
}

interface StoredAggregateSqlRow {
  aggregate_type: string;
  aggregate_id: string;
  version: number | string;
  tenant_id: string;
  record_json: string;
  recorded_at: string;
}

export { JobFencedOutError };
export type { IdempotencyRecord };
