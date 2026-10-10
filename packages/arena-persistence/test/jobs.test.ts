import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteRuntime, JobFencedOutError, type SqliteRuntime } from "../src/contract.js";

/**
 * AR2-005 — durable jobs：租约 + fencing（验收场景「两 worker 抢占/fencing」）。
 *
 * - 两个 worker（两个连接）抢同一 job：只有一个成功；
 * - 租约过期 → 他人可回收（fencing_token 递增）；
 * - 旧 worker 的 complete/heartbeat 被 fencing 拒绝（ARENA_JOB_FENCED_OUT）；
 * - deadLetter 终态；schedule 支持延时运行。
 */

function tempRuntime(now: () => string): { runtime: SqliteRuntime; dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "arena-persistence-jobs-"));
  const path = join(dir, "arena.db");
  const runtime = createSqliteRuntime({ path, now });
  return { runtime, dir, path };
}

function cleanup(runtime: SqliteRuntime, dir: string): void {
  runtime.close();
  rmSync(dir, { recursive: true, force: true });
}

test("two workers race one job: exactly one claim succeeds", async () => {
  const at = (ms: number) => () => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  const { runtime, dir, path } = tempRuntime(at(Date.parse("2026-10-10T12:00:00Z")));
  try {
    const jobId = await runtime.jobs.schedule(
      "outbox.dispatch",
      { demo: true },
      "2026-10-10T12:00:00Z",
    );
    const workerA = createSqliteRuntime({ path, now: at(Date.parse("2026-10-10T12:00:01Z")) });
    const workerB = createSqliteRuntime({ path, now: at(Date.parse("2026-10-10T12:00:01Z")) });
    try {
      const claimA = await workerA.jobs.claim("outbox.dispatch", 10, 60, "wrk_aaaaaaaa01");
      const claimB = await workerB.jobs.claim("outbox.dispatch", 10, 60, "wrk_bbbbbbbb01");
      assert.equal(claimA.claimed.length, 1);
      assert.equal(claimA.claimed[0]?.job_id, jobId);
      assert.equal(claimB.claimed.length, 0); // 已被 A 租约占用
      // A 正常完成。
      await workerA.jobs.complete(jobId, "wrk_aaaaaaaa01");
    } finally {
      workerA.close();
      workerB.close();
    }
  } finally {
    cleanup(runtime, dir);
  }
});

test("lease expiry allows reclaim; stale worker is fenced out", async () => {
  const start = Date.parse("2026-10-10T12:00:00Z");
  let current = start;
  const at = () => new Date(current).toISOString().replace(/\.\d{3}Z$/, "Z");
  const { runtime, dir, path } = tempRuntime(at);
  try {
    const jobId = await runtime.jobs.schedule("attempt.expire", {}, "2026-10-10T12:00:00Z");
    const workerA = createSqliteRuntime({ path, now: at });
    try {
      // A 以 10 秒租约抢到。
      const claimA = await workerA.jobs.claim("attempt.expire", 10, 10, "wrk_aaaaaaaa01");
      assert.equal(claimA.claimed.length, 1);
      // 时间前进 11 秒 → 租约过期。
      current = start + 11_000;
      const workerB = createSqliteRuntime({ path, now: at });
      try {
        const claimB = await workerB.jobs.claim("attempt.expire", 10, 60, "wrk_bbbbbbbb01");
        assert.equal(claimB.claimed.length, 1); // 回收成功（租约已过期）
        assert.equal(claimB.claimed[0]?.job_id, jobId);
        // A 的延迟写被 fencing 拒绝。
        await assert.rejects(
          workerA.jobs.complete(jobId, "wrk_aaaaaaaa01"),
          (error: unknown) => error instanceof JobFencedOutError,
        );
        await assert.rejects(
          workerA.jobs.heartbeat([jobId], "wrk_aaaaaaaa01"),
          (error: unknown) => error instanceof JobFencedOutError,
        );
        // B 正常完成。
        await workerB.jobs.complete(jobId, "wrk_bbbbbbbb01");
      } finally {
        workerB.close();
      }
    } finally {
      workerA.close();
    }
  } finally {
    cleanup(runtime, dir);
  }
});

test("heartbeat extends an active lease", async () => {
  const start = Date.parse("2026-10-10T12:00:00Z");
  let current = start;
  const at = () => new Date(current).toISOString().replace(/\.\d{3}Z$/, "Z");
  const { runtime, dir } = tempRuntime(at);
  try {
    await runtime.jobs.schedule("learnings.publish", {}, "2026-10-10T12:00:00Z");
    const claim = await runtime.jobs.claim("learnings.publish", 10, 30, "wrk_aaaaaaaa01");
    assert.equal(claim.claimed.length, 1);
    // 心跳后 30 秒内不可被他人回收。
    await runtime.jobs.heartbeat(
      claim.claimed.map((job) => job.job_id),
      "wrk_aaaaaaaa01",
    );
    current = start + 29_000;
    const reclaimer = await runtime.jobs.claim("learnings.publish", 10, 30, "wrk_bbbbbbbb01");
    assert.equal(reclaimer.claimed.length, 0); // 租约仍有效
  } finally {
    cleanup(runtime, dir);
  }
});

test("deadLetter is terminal and reason is recorded", async () => {
  const { runtime, dir } = tempRuntime(() => "2026-10-10T12:00:00Z");
  try {
    const jobId = await runtime.jobs.schedule("capsule.teardown", {}, "2026-10-10T12:00:00Z");
    await runtime.jobs.deadLetter(jobId, "demo: unrecoverable provider error");
    // dead 终态：不可再被 claim。
    const claim = await runtime.jobs.claim("capsule.teardown", 10, 60, "wrk_aaaaaaaa01");
    assert.equal(claim.claimed.length, 0);
    const row = runtime.engine
      .statement("SELECT state, dead_reason FROM arena_jobs WHERE job_id = ?")
      .get(jobId) as { state: string; dead_reason: string };
    assert.equal(row.state, "dead");
    assert.match(row.dead_reason, /unrecoverable provider error/);
  } finally {
    cleanup(runtime, dir);
  }
});

test("scheduled jobs only become claimable at run_at", async () => {
  const at = (iso: string) => () => iso;
  const { runtime, dir } = tempRuntime(at("2026-10-10T12:00:00Z"));
  try {
    await runtime.jobs.schedule("payments.settle", {}, "2026-10-10T13:00:00Z");
    const early = await runtime.jobs.claim("payments.settle", 10, 60, "wrk_aaaaaaaa01");
    assert.equal(early.claimed.length, 0); // 未到 run_at
  } finally {
    cleanup(runtime, dir);
  }
});
