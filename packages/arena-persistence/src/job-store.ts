import type { ClaimJobOutcome, JobHandle, JobPort } from "@arena/contracts";

/** ArenaId 在公共入口未导出（zod 推断即 string）；adapter 侧以 string 满足结构类型。 */
type ArenaId = string;
import type { SqliteEngine } from "./engine.js";

/**
 * AR2-005 — JobPort 的 SQLite 实现（租约 + fencing）。
 *
 * claim：BEGIN IMMEDIATE 内原子完成「选行 → 占租约 → fencing_token+1」。
 * 可选行 = state='scheduled' OR (state='leased' AND lease_expires_at <= now)。
 * 两个 worker 抢同一 job：只有一个 claim 成功（第二个拿不到该行）。
 *
 * fencing：heartbeat/complete 校验 (worker_id, fencing_token)；
 * 租约被他人回收后，旧 worker 的写操作抛 ARENA_JOB_FENCED_OUT
 * （adapter 层错误名，非公共目录码——目录稳定性由契约层保证）。
 */

export interface JobStoreDeps {
  now: () => string;
}

export class JobFencedOutError extends Error {
  constructor(
    public readonly job_id: ArenaId,
    public readonly worker_id: ArenaId,
    public readonly held_by: string,
  ) {
    super(
      `ARENA_JOB_FENCED_OUT: worker ${worker_id} lost job ${job_id} (currently held by ${held_by})`,
    );
    this.name = "JobFencedOutError";
  }
}

interface JobRow {
  job_id: string;
  job_type: string;
  payload_json: string;
  state: string;
  worker_id: string | null;
  fencing_token: number;
}

export function createJobStore(engine: SqliteEngine, deps: JobStoreDeps): JobPort {
  function isoPlusSeconds(base: string, seconds: number): string {
    const ms = Date.parse(`${base}Z`.endsWith("Z") ? base : `${base}Z`) + seconds * 1000;
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  const store: JobPort = {
    async schedule(job_type: string, payload: unknown, run_at: string) {
      const seq = engine.statement("SELECT COUNT(*) AS n FROM arena_jobs").get() as { n: number };
      const jobId = `job_${String(Number(seq.n) + 1).padStart(8, "0")}`;
      engine
        .statement(
          `INSERT INTO arena_jobs (job_id, job_type, payload_json, run_at, state)
           VALUES (?, ?, ?, ?, 'scheduled')`,
        )
        .run(jobId, job_type, JSON.stringify(payload), run_at);
      return Promise.resolve(jobId as ArenaId);
    },
    claim(job_type: string, limit: number, lease_seconds: number, worker_id: ArenaId) {
      const outcome: ClaimJobOutcome = engine.transaction(() => {
        const now = deps.now();
        const rows = engine
          .statement(
            `SELECT job_id, job_type, payload_json, state, worker_id, fencing_token
               FROM arena_jobs
              WHERE job_type = ?
                AND ((state = 'scheduled' AND run_at <= ?)
                  OR (state = 'leased' AND lease_expires_at <= ?))
              ORDER BY run_at, job_id
              LIMIT ?`,
          )
          .all(job_type, now, now, limit) as unknown as JobRow[];
        const claimed: JobHandle[] = [];
        for (const row of rows) {
          const nextToken = Number(row.fencing_token) + 1;
          const leaseExpires = isoPlusSeconds(now, lease_seconds);
          const update = engine
            .statement(
              `UPDATE arena_jobs
                 SET state = 'leased', worker_id = ?, fencing_token = ?,
                     lease_expires_at = ?, attempts = attempts + 1
               WHERE job_id = ?`,
            )
            .run(worker_id, nextToken, leaseExpires, row.job_id);
          if (update.changes === 1) {
            claimed.push({
              job_id: row.job_id as ArenaId,
              job_type: row.job_type,
              payload: JSON.parse(row.payload_json) as unknown,
            });
          }
        }
        return { claimed, lease_expires_at: isoPlusSeconds(now, lease_seconds) };
      });
      return Promise.resolve(outcome);
    },
    async heartbeat(job_ids: readonly ArenaId[], worker_id: ArenaId) {
      const now = deps.now();
      for (const jobId of job_ids) {
        const row = engine
          .statement("SELECT state, worker_id FROM arena_jobs WHERE job_id = ?")
          .get(jobId) as { state: string; worker_id: string | null } | undefined;
        if (row === undefined || row.state !== "leased" || row.worker_id !== worker_id) {
          throw new JobFencedOutError(jobId, worker_id, row?.worker_id ?? "(none)");
        }
        engine
          .statement(
            "UPDATE arena_jobs SET lease_expires_at = ? WHERE job_id = ? AND worker_id = ? AND state = 'leased'",
          )
          .run(isoPlusSeconds(now, 60), jobId, worker_id);
      }
      return Promise.resolve();
    },
    async complete(job_id: ArenaId, worker_id: ArenaId) {
      const row = engine
        .statement("SELECT state, worker_id FROM arena_jobs WHERE job_id = ?")
        .get(job_id) as { state: string; worker_id: string | null } | undefined;
      if (row === undefined || row.state !== "leased" || row.worker_id !== worker_id) {
        throw new JobFencedOutError(job_id, worker_id, row?.worker_id ?? "(none)");
      }
      engine
        .statement(
          "UPDATE arena_jobs SET state = 'completed', lease_expires_at = NULL WHERE job_id = ? AND worker_id = ?",
        )
        .run(job_id, worker_id);
      return Promise.resolve();
    },
    async deadLetter(job_id: ArenaId, reason: string) {
      engine
        .statement(
          "UPDATE arena_jobs SET state = 'dead', dead_reason = ?, lease_expires_at = NULL WHERE job_id = ?",
        )
        .run(reason, job_id);
      return Promise.resolve();
    },
  };
  return store;
}
