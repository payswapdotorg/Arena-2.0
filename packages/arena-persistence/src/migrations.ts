import type { SqliteEngine } from "./engine.js";
import type { MigrationPort } from "@arena/contracts";

/**
 * AR2-005 — 迁移（MigrationPort）。
 *
 * 从空库可重放：arena_schema_migrations 记录已应用版本，重复调用为 no-op。
 * 中断恢复协议（G3）：每条迁移是单个事务（DDL + 版本行同事务提交）；
 * SQLite WAL 保证已提交即持久 —— 崩溃后重放 applyMigrations() 即收敛。
 */

export interface MigrationSpec {
  version: string;
  description: string;
  up: string;
}

/**
 * 0001 — 初始 schema：
 * - aggregates：乐观并发（(type,id) 唯一 + version 单调）；
 * - idempotency：(tenant,key) 唯一 → 原子预留；
 * - outbox：事务性出队（attempts/next_attempt_at 退避，dispatched_at 终态）；
 * - jobs：租约 + fencing（lease_expires_at、worker_id、fencing_token 单调递增）。
 */
export const MIGRATIONS: readonly MigrationSpec[] = [
  {
    version: "0001",
    description: "initial durable schema: aggregates, idempotency, outbox, jobs",
    up: `
      CREATE TABLE IF NOT EXISTS arena_schema_migrations (
        version TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS arena_aggregates (
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT '',
        record_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        PRIMARY KEY (aggregate_type, aggregate_id)
      );
      CREATE TABLE IF NOT EXISTS arena_idempotency (
        tenant_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        command TEXT NOT NULL,
        request_digest TEXT NOT NULL,
        status TEXT NOT NULL,
        response_digest TEXT,
        completed_at TEXT,
        response_json TEXT,
        PRIMARY KEY (tenant_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS arena_outbox (
        outbox_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        event_json TEXT NOT NULL,
        delivery_identity TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        dispatched_at TEXT
      );
      CREATE INDEX IF NOT EXISTS arena_outbox_due_idx
        ON arena_outbox (dispatched_at, next_attempt_at);
      CREATE TABLE IF NOT EXISTS arena_jobs (
        job_id TEXT PRIMARY KEY,
        job_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        run_at TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'scheduled',
        lease_expires_at TEXT,
        worker_id TEXT,
        fencing_token INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        dead_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS arena_jobs_claim_idx
        ON arena_jobs (job_type, state, run_at);
    `,
  },
];

export interface MigrationStoreDeps {
  now: () => string;
}

export function createMigrationStore(
  engine: SqliteEngine,
  deps: MigrationStoreDeps,
): MigrationPort {
  // 版本表先行（0001 内 IF NOT EXISTS 双保险：首次运行时表尚不存在）。
  engine.exec(
    `CREATE TABLE IF NOT EXISTS arena_schema_migrations (
       version TEXT PRIMARY KEY,
       description TEXT NOT NULL,
       applied_at TEXT NOT NULL
     );`,
  );
  return {
    async applyMigrations(): Promise<{ applied: string[] }> {
      const applied: string[] = [];
      for (const migration of MIGRATIONS) {
        const existing = engine
          .statement("SELECT version FROM arena_schema_migrations WHERE version = ?")
          .get(migration.version);
        if (existing !== undefined) continue;
        engine.transaction(() => {
          engine.exec(migration.up);
          engine
            .statement(
              "INSERT INTO arena_schema_migrations (version, description, applied_at) VALUES (?, ?, ?)",
            )
            .run(migration.version, migration.description, deps.now());
        });
        applied.push(migration.version);
      }
      return { applied };
    },
    async currentVersion(): Promise<string> {
      const row = engine
        .statement("SELECT version FROM arena_schema_migrations ORDER BY version DESC LIMIT 1")
        .get();
      return row === undefined ? "(empty)" : String(row.version);
    },
  };
}
