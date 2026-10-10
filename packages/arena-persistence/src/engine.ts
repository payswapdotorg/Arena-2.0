import { DatabaseSync } from "node:sqlite";

/**
 * AR2-005 — SQLite 引擎壳（node:sqlite，零依赖）。
 *
 * 只做三件事：打开文件/WAL、提供 BEGIN IMMEDIATE 事务、暴露 prepare。
 * DDL 与语义都住在 migrations/store 模块；本文件不含任何领域知识
 * （PORT_NEUTRALITY_RULE：引擎类型不越过 adapter 边界）。
 *
 * 多连接（两个 API 进程的替身）：同一文件多个 DatabaseSync 实例，
 * busy_timeout + BEGIN IMMEDIATE 保证写事务串行化 —— 并发准入与
 * 两 worker 抢占测试以真实的多连接 exercised。
 */

export interface SqliteEngine {
  /** 预编译并缓存语句（键 = SQL 文本）。 */
  statement(sql: string): Statement;
  /** BEGIN IMMEDIATE 事务：fn 抛错即 ROLLBACK，否则 COMMIT。 */
  transaction<T>(fn: () => T): T;
  exec(sql: string): void;
  close(): void;
  /** 测试/诊断：底层句柄（不进入公共导出）。 */
  raw(): DatabaseSync;
}

export interface Statement {
  run(...params: ReadonlyArray<unknown>): { changes: number; lastInsertRowid: number | bigint };
  get(...params: ReadonlyArray<unknown>): Record<string, unknown> | undefined;
  all(...params: ReadonlyArray<unknown>): Array<Record<string, unknown>>;
}

export interface EngineOptions {
  /** 数据库文件路径；":memory:" 为进程内库（测试默认）。 */
  path: string;
  /** 写锁等待毫秒（默认 5000）。 */
  busyTimeoutMs?: number;
}

export function openEngine(options: EngineOptions): SqliteEngine {
  const db = new DatabaseSync(options.path);
  db.exec(`PRAGMA journal_mode = WAL;`);
  db.exec(`PRAGMA synchronous = FULL;`);
  db.exec(`PRAGMA foreign_keys = ON;`);
  db.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs ?? 5000};`);
  const cache = new Map<string, Statement>();
  return {
    statement(sql: string): Statement {
      const cached = cache.get(sql);
      if (cached !== undefined) return cached;
      const prepared = db.prepare(sql);
      const wrapped: Statement = {
        run: (...params: ReadonlyArray<unknown>) => {
          const result = prepared.run(
            ...(params as ReadonlyArray<string | number | bigint | null>),
          );
          return {
            changes: Number(result.changes),
            lastInsertRowid: Number(result.lastInsertRowid),
          };
        },
        get: (...params: ReadonlyArray<unknown>) =>
          prepared.get(...(params as ReadonlyArray<string | number | bigint | null>)) as
            | Record<string, unknown>
            | undefined,
        all: (...params: ReadonlyArray<unknown>) =>
          prepared.all(...(params as ReadonlyArray<string | number | bigint | null>)) as Array<
            Record<string, unknown>
          >,
      };
      cache.set(sql, wrapped);
      return wrapped;
    },
    transaction<T>(fn: () => T): T {
      db.exec("BEGIN IMMEDIATE;");
      try {
        const result = fn();
        db.exec("COMMIT;");
        return result;
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }
    },
    exec: (sql: string) => db.exec(sql),
    close: () => db.close(),
    raw: () => db,
  };
}
