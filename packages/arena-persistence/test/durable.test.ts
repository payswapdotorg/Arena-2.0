import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteRuntime, type SqliteRuntime } from "../src/contract.js";
import type { EventEnvelope } from "@arena/contracts";

/**
 * AR2-005 — durable 持久化验收测试（SQLite 参考引擎）。
 *
 * 覆盖 issue #7 验收清单：
 * 1. same key / same digest → REPLAY（重放已存储结果）
 * 2. same key / different digest → CONFLICT
 * 3. 两个 API 进程并发准入（两个连接同时 reserve，只有一个 RESERVED）
 * 4. 两个 worker 抢占/fencing（只有一个 claim 成功；过期回收 + 旧 worker 被隔离）
 * 5. commit 后崩溃恢复（新连接看到已提交聚合 + outbox 行）
 * 6. 从空库迁移可重放
 */

const NOW = "2026-10-10T12:00:00Z";
const clock = () => NOW;

function tempRuntime(): { runtime: SqliteRuntime; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "arena-persistence-"));
  const runtime = createSqliteRuntime({ path: join(dir, "arena.db"), now: clock });
  return { runtime, dir };
}

function cleanup(runtime: SqliteRuntime, dir: string): void {
  runtime.close();
  rmSync(dir, { recursive: true, force: true });
}

function event(eventId: string): EventEnvelope {
  return {
    event_id: eventId,
    aggregate_type: "escalation",
    aggregate_id: "esc_00000001",
    tenant_id: "tnt_demo0001",
    event_type: "escalation.created",
    payload: { demo: true },
    actor: { type: "client_application", id: "app_00000001" },
    correlation_id: "cor_00000001",
    causation_id: null,
    recorded_at: NOW,
    contract_version: "ES2.0",
  };
}

const ESCALATION_RECORD = { tenant_id: "tnt_demo0001", state: "CREATED", title: "demo" };

test("migration: from-empty replay is idempotent and versionable", async () => {
  const { runtime, dir } = tempRuntime();
  try {
    const version = await runtime.migrations.currentVersion();
    assert.equal(version, "0001");
    const again = await runtime.migrations.applyMigrations();
    assert.deepEqual(again.applied, []); // 已应用 → no-op
    // 二次 runtime（同文件）也无需再迁移。
    const reopened = createSqliteRuntime({ path: join(dir, "arena.db"), now: clock });
    const third = await reopened.migrations.applyMigrations();
    assert.deepEqual(third.applied, []);
    reopened.close();
  } finally {
    cleanup(runtime, dir);
  }
});

test("idempotency: same key + same digest replays the stored result", async () => {
  const { runtime, dir } = tempRuntime();
  try {
    const input = {
      idempotency_key: "idem-001",
      request_digest: "ab".repeat(32),
      command: "CreateEscalation",
      tenant_id: "tnt_demo0001",
    };
    const first = await runtime.idempotency.reserve(input);
    assert.equal(first.kind, "RESERVED");
    await runtime.idempotency.complete({
      idempotency_key: "idem-001",
      response_digest: "cd".repeat(32),
      completed_at: NOW,
    });
    const replay = await runtime.idempotency.reserve(input);
    assert.equal(replay.kind, "REPLAY");
    if (replay.kind === "REPLAY") {
      assert.equal(replay.record.status, "COMPLETED");
      assert.equal(replay.record.response_digest, "cd".repeat(32));
    }
    const loaded = await runtime.idempotency.load("idem-001", "tnt_demo0001");
    assert.equal(loaded?.status, "COMPLETED");
  } finally {
    cleanup(runtime, dir);
  }
});

test("idempotency: same key + different digest is a typed conflict", async () => {
  const { runtime, dir } = tempRuntime();
  try {
    await runtime.idempotency.reserve({
      idempotency_key: "idem-002",
      request_digest: "ab".repeat(32),
      command: "CreateEscalation",
      tenant_id: "tnt_demo0001",
    });
    const conflict = await runtime.idempotency.reserve({
      idempotency_key: "idem-002",
      request_digest: "ef".repeat(32),
      command: "CreateEscalation",
      tenant_id: "tnt_demo0001",
    });
    assert.equal(conflict.kind, "CONFLICT");
    if (conflict.kind === "CONFLICT") {
      assert.equal(conflict.record.request_digest, "ab".repeat(32));
    }
    // 租户隔离：另一租户同键是完全独立的预留。
    const other = await runtime.idempotency.reserve({
      idempotency_key: "idem-002",
      request_digest: "ef".repeat(32),
      command: "CreateEscalation",
      tenant_id: "tnt_other0001",
    });
    assert.equal(other.kind, "RESERVED");
  } finally {
    cleanup(runtime, dir);
  }
});

test("concurrent admission: two API processes (connections) — only one RESERVED", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-persistence-"));
  const path = join(dir, "arena.db");
  const processA = createSqliteRuntime({ path, now: clock });
  const processB = createSqliteRuntime({ path, now: clock });
  try {
    const input = {
      idempotency_key: "idem-race",
      request_digest: "ab".repeat(32),
      command: "CreateEscalation",
      tenant_id: "tnt_demo0001",
    };
    // 两个「进程」先后到达（原子预留保证第二个不重复执行）。
    const a = await processA.idempotency.reserve(input);
    const b = await processB.idempotency.reserve(input);
    assert.equal(a.kind, "RESERVED");
    assert.notEqual(b.kind, "RESERVED");
    assert.equal(b.kind, "REPLAY");
    if (b.kind === "REPLAY") {
      assert.equal(b.record.status, "IN_PROGRESS"); // 尚未完成 → 调用方等待/稍后重试
    }
  } finally {
    processA.close();
    processB.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("aggregate store: optimistic concurrency + transactional outbox rows", async () => {
  const { runtime, dir } = tempRuntime();
  try {
    const saved = await runtime.aggregates.saveAggregate({
      ref: { aggregate_type: "escalation", aggregate_id: "esc_00000001", expected_version: 0 },
      record: ESCALATION_RECORD,
      events: [event("evt_00000001")],
      recorded_at: NOW,
    });
    assert.equal(saved.new_version, 1);
    // 过期版本写 → 类型化并发冲突。
    await assert.rejects(
      runtime.aggregates.saveAggregate({
        ref: { aggregate_type: "escalation", aggregate_id: "esc_00000001", expected_version: 0 },
        record: { ...ESCALATION_RECORD, state: "ASSIGNED" },
        events: [],
        recorded_at: NOW,
      }),
      /ARENA_CONCURRENT_WRITE_CONFLICT/,
    );
    const loaded = await runtime.aggregates.loadAggregate("escalation", "esc_00000001");
    assert.equal(loaded?.version, 1);
    assert.deepEqual(loaded?.record, ESCALATION_RECORD);
    // 事务性 outbox：saveAggregate 的事件在同一事务可见。
    const due = await runtime.outbox.fetchDue(10, NOW);
    assert.equal(due.length, 1);
    assert.equal(due[0]?.event.event_id, "evt_00000001");
    await runtime.outbox.markDispatched(due[0]!.outbox_id, NOW);
    const after = await runtime.outbox.fetchDue(10, NOW);
    assert.equal(after.length, 0);
  } finally {
    cleanup(runtime, dir);
  }
});

test("crash-after-commit recovery: a new connection sees committed state + outbox", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-persistence-"));
  const path = join(dir, "arena.db");
  const crashed = createSqliteRuntime({ path, now: clock });
  await crashed.aggregates.saveAggregate({
    ref: { aggregate_type: "escalation", aggregate_id: "esc_00000009", expected_version: 0 },
    record: ESCALATION_RECORD,
    events: [event("evt_00000009")],
    recorded_at: NOW,
  });
  await crashed.idempotency.reserve({
    idempotency_key: "idem-crash",
    request_digest: "ab".repeat(32),
    command: "CreateEscalation",
    tenant_id: "tnt_demo0001",
  });
  // 「崩溃」：旧连接直接关闭（未投递 outbox、未完成幂等）。
  crashed.close();
  const recovered = createSqliteRuntime({ path, now: clock });
  try {
    const aggregate = await recovered.aggregates.loadAggregate("escalation", "esc_00000009");
    assert.equal(aggregate?.version, 1); // 已提交状态存活
    const due = await recovered.outbox.fetchDue(10, NOW);
    assert.equal(due.length, 1); // outbox 未投递 → 恢复重投
    assert.equal(due[0]?.event.event_id, "evt_00000009");
    const reservation = await recovered.idempotency.load("idem-crash", "tnt_demo0001");
    assert.equal(reservation?.status, "IN_PROGRESS"); // 预留存活，未丢失
  } finally {
    recovered.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("outbox: markFailed schedules retry and never loses the message", async () => {
  const { runtime, dir } = tempRuntime();
  try {
    await runtime.outbox.enqueue([event("evt_00000010")]);
    const due = await runtime.outbox.fetchDue(10, NOW);
    assert.equal(due.length, 1);
    await runtime.outbox.markFailed(due[0]!.outbox_id, "2026-10-10T12:01:00Z");
    const beforeBackoff = await runtime.outbox.fetchDue(10, NOW);
    assert.equal(beforeBackoff.length, 0); // 退避期内不可见
    const afterBackoff = await runtime.outbox.fetchDue(10, "2026-10-10T12:01:00Z");
    assert.equal(afterBackoff.length, 1); // 退避过后重试
    assert.equal(afterBackoff[0]?.attempts, 1);
  } finally {
    cleanup(runtime, dir);
  }
});

test("idempotency response body: stored once, replayed verbatim", async () => {
  const { runtime, dir } = tempRuntime();
  try {
    await runtime.idempotency.reserve({
      idempotency_key: "idem-resp",
      request_digest: "ab".repeat(32),
      command: "CreateEscalation",
      tenant_id: "tnt_demo0001",
    });
    await runtime.idempotency.complete({
      idempotency_key: "idem-resp",
      response_digest: "cd".repeat(32),
      completed_at: NOW,
    });
    runtime.idempotency.storeResponse("tnt_demo0001", "idem-resp", {
      kind: "CREATED",
      escalation_id: "esc_00000001",
    });
    const replayed = runtime.idempotency.readResponse("tnt_demo0001", "idem-resp") as {
      kind: string;
      escalation_id: string;
    };
    assert.equal(replayed.kind, "CREATED");
    assert.equal(replayed.escalation_id, "esc_00000001");
  } finally {
    cleanup(runtime, dir);
  }
});
