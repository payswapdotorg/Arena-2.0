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
  return {
    engine,
    aggregates,
    idempotency,
    outbox,
    jobs,
    migrations,
    close: () => engine.close(),
  };
}

export { JobFencedOutError };
export type { IdempotencyRecord };
