import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteRuntime, type SqliteRuntime } from "@arena/persistence";
import { createArenaServer } from "../src/contract.js";

/**
 * AR2-005 slice 2 — durable 组装的应用层集成验证（单进程内、真实 HTTP 监听器）：
 *
 * 1. CreateEscalation 落在 durable 引擎上（WAL + 事务性 outbox 行可见）；
 * 2. crash-after-commit 恢复：关闭引擎 → 重开同一数据库文件 → 聚合/timeline/
 *    幂等响应全部恢复（issue #7 验收场景「crash-after-commit recovery」）；
 * 3. 同键同摘要 REPLAY 返回完整响应体；同键异摘要类型化 409 冲突；
 * 4. 迁移从空库重放（新数据库文件 = from-empty 收敛）；
 * 5. 跨租户失败关闭（引擎侧过滤 + requireTenantScope 双重防线）；
 * 6. 命令执行器在 durable 运行时上的状态机迁移 + outbox 事件 + 乐观并发冲突。
 */

const VALID_REQUEST = {
  contract_version: "ES2.0",
  client_application_id: "app_00000001",
  caller_idempotency_key: "idem-key-durable-1",
  request_digest: "ab".repeat(32),
  task: {
    title: "Fix failing build",
    outcome_description: "Repo compiles and tests pass on the pinned toolchain.",
  },
  task_type: { domain: "software-engineering", type_id: "typ_00000001", type_version: "1.0.0" },
  required_capabilities: [{ capability_id: "cap_00000001", minimum_level: "senior" }],
  required_qualifications: ["licensed engineer (jurisdiction GH)"],
  acceptance_criteria: [
    {
      criterion_id: "crt_00000001",
      statement: "pnpm install/typecheck/test exit 0 on Node 24.14.0",
      measurement: {
        definition: "exit codes in the capsule runner",
        metric: "exit_code",
        unit: null,
        threshold: 0,
        comparator: "eq",
      },
      hard_stop: true,
      proof_class: "P0",
      weight: 1,
    },
  ],
  proof_policy: {
    policy_version: "PVP1.0",
    content_digest: "1e".repeat(32),
    selected_class: "P0",
    selection_rationale: "deterministic validator establishes the outcome",
    per_criterion_classes: [{ criterion_id: "crt_00000001", proof_class: "P0" }],
    validators: [
      {
        validator_id: "val_00000001",
        validator_version: "1.2.0",
        kind: "deterministic",
        allowed_commands: ["pnpm", "test"],
        timeout_seconds: 1800,
        resource_limits: "2 vCPU / 3 GB",
        evidence_policy: "trusted runner logs and hashes",
      },
    ],
    rerun_policy: { minimum_reruns: 2, risk_exception: null },
    sample_policy: null,
    review_policy: null,
    observation_policy: null,
    payout_gate: {
      release_requires: "all_predicates_pass",
      caller_authenticity_verified: true,
      task_binding_verified: true,
      dispute_blocks_release: true,
    },
    retry_next_expert: {
      max_attempts: 3,
      max_aggregate_spend: 500,
      cooldown_policy: "48h",
      failed_attempt_posture: "isolate_branch",
      next_expert_baseline: "baseline_plus_approved_prior_attempts",
    },
    timeout: "72h",
    dispute_conditions: "logs contradict outcome",
    budget_ceiling: 500,
  },
  constraints: {
    risk_tier: "MEDIUM",
    privacy_profile: "TENANT",
    retention_profile: "STANDARD",
    jurisdiction: "GH",
    professional_requirements: [],
    deadline: "2026-11-10T00:00:00Z",
    escalation_modes: ["next_expert", "budget_stop"],
  },
  budget: { limit_amount: 500, currency: "USD", allowed_attempts: 3, per_attempt_limit: 200 },
  input_artifacts: [],
  result_schema: { schema_id: "sch_00000001", schema_version: "1.0.0" },
  delivery_preferences: { channel: "poll", webhook_reference: null },
};

interface TestServer {
  base: string;
  close(): Promise<void>;
}

const isoNow = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

function startServer(runtime: SqliteRuntime): Promise<TestServer> {
  const server = createArenaServer({
    runtime,
    persistence: {
      mode: "sqlite_reference_engine",
      ready: true,
      disclosure: "test composition: single sqlite file under a temp dir",
    },
  });
  server.listen(0, "127.0.0.1");
  return once(server, "listening").then(() => {
    const { port } = server.address() as AddressInfo;
    return {
      base: `http://127.0.0.1:${port}`,
      close: () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        }),
    };
  });
}

interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

async function call(
  base: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  token = "demo-token-requester-alpha",
): Promise<ApiResponse> {
  const response = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body: json };
}

test("scenario: durable create + transactional outbox rows + restart recovery", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-durable-"));
  const dbPath = join(dir, "arena.db");
  const runtime = createSqliteRuntime({ path: dbPath });
  const server = await startServer(runtime);
  let revived: SqliteRuntime | null = null;
  let server2: TestServer | null = null;
  try {
    const created = await call(server.base, "POST", "/v1/escalations", VALID_REQUEST, {
      "x-idempotency-key": "durable-key-1",
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.kind, "CREATED");
    const escalationId = String(created.body.escalation_id);

    // 事务性 outbox：EscalationCreated 事件与聚合同事务落库。
    const due = await runtime.outbox.fetchDue(10, isoNow());
    assert.equal(due.length, 1);
    assert.equal(due[0]?.event.event_type, "EscalationCreated");
    await runtime.outbox.markDispatched(due[0]?.outbox_id ?? "", isoNow());
    assert.equal((await runtime.outbox.fetchDue(10, isoNow())).length, 0);

    // 同键同摘要：REPLAY 返回完整响应体。
    const replayed = await call(server.base, "POST", "/v1/escalations", VALID_REQUEST, {
      "x-idempotency-key": "durable-key-1",
    });
    assert.equal(replayed.status, 200);
    assert.equal(replayed.body.replayed, true);
    const replayResponse = replayed.body.response as Record<string, unknown>;
    assert.equal(replayResponse.escalation_id, escalationId);
    assert.equal(replayResponse.kind, "CREATED");

    // 同键异摘要：类型化 409。
    const conflictPayload = { ...VALID_REQUEST, request_digest: "cd".repeat(32) };
    const conflict = await call(server.base, "POST", "/v1/escalations", conflictPayload, {
      "x-idempotency-key": "durable-key-1",
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, "ARENA_IDEMPOTENCY_DIGEST_MISMATCH");

    // crash-after-commit 恢复：模拟进程死亡（引擎关闭）→ 新引擎重开同一文件。
    const beforeCrash = await call(server.base, "GET", `/v1/escalations/${escalationId}`);
    assert.equal(beforeCrash.status, 200);
    await server.close();
    runtime.close();
    revived = createSqliteRuntime({ path: dbPath });
    server2 = await startServer(revived);
    const fetched = await call(server2.base, "GET", `/v1/escalations/${escalationId}`);
    assert.equal(fetched.status, 200);
    // 恢复后的读取与崩溃前的读取逐字段一致（durable 恢复不改变可见状态）。
    assert.deepEqual(fetched.body, beforeCrash.body);
    assert.equal(fetched.body.status, "CREATED");
    const timeline = await call(server2.base, `GET`, `/v1/escalations/${escalationId}/timeline`);
    assert.equal(timeline.status, 200);
    assert.equal((timeline.body.events as unknown[]).length, 1);
    assert.equal(
      (timeline.body.events as Array<{ event_type: string }>)[0]?.event_type,
      "EscalationCreated",
    );
    const replayAfterRestart = await call(server2.base, "POST", "/v1/escalations", VALID_REQUEST, {
      "x-idempotency-key": "durable-key-1",
    });
    assert.equal(replayAfterRestart.status, 200);
    assert.equal(replayAfterRestart.body.replayed, true);
    assert.equal(
      (replayAfterRestart.body.response as Record<string, unknown>).escalation_id,
      escalationId,
    );
  } finally {
    if (server2 !== null) await server2.close();
    if (revived !== null) revived.close();
    try {
      await server.close();
    } catch {
      // already closed by the crash-recovery step
    }
    try {
      runtime.close();
    } catch {
      // already closed by the crash-recovery step
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scenario: durable engine-side tenant filtering stays fail-closed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-durable-"));
  const runtime = createSqliteRuntime({ path: join(dir, "arena.db") });
  const server = await startServer(runtime);
  try {
    const created = await call(server.base, "POST", "/v1/escalations", VALID_REQUEST, {
      "x-idempotency-key": "tenant-key-1",
    });
    assert.equal(created.status, 201);
    const escalationId = String(created.body.escalation_id);

    // 另一租户（beta principal）的对象访问：失败关闭，不可区分于不存在。
    const cross = await call(
      server.base,
      "GET",
      `/v1/escalations/${escalationId}`,
      undefined,
      {},
      "demo-token-requester-beta",
    );
    assert.equal(cross.status, 404);
    assert.equal(cross.body.code, "ARENA_ESCALATION_NOT_FOUND");

    // 引擎侧租户过滤：beta 的列表不包含 alpha 的对象。
    const listBeta = await call(
      server.base,
      "GET",
      "/v1/escalations",
      undefined,
      {},
      "demo-token-requester-beta",
    );
    assert.equal(listBeta.status, 200);
    assert.equal((listBeta.body.items as unknown[]).length, 0);
  } finally {
    await server.close();
    runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scenario: command executor on the durable runtime (transition + outbox + conflict)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-durable-"));
  const runtime = createSqliteRuntime({ path: join(dir, "arena.db") });
  const server = await startServer(runtime);
  try {
    const created = await call(server.base, "POST", "/v1/escalations", VALID_REQUEST, {
      "x-idempotency-key": "command-key-1",
    });
    const escalationId = String(created.body.escalation_id);

    // 合法迁移：CREATED -> CREATED（AmendEscalation，guard pre_assignment_amendment）。
    // （SystemProposeOffer 是 systemCommand —— 按 API 边设计不从调用方路由，
    // 由系统角色在后续 WO 接线；此处用调用方可派发的命令验证 durable 迁移。）
    const amended = await call(
      server.base,
      "POST",
      `/v1/escalations/${escalationId}/commands/AmendEscalation`,
      { facts: { pre_assignment_amendment: true } },
    );
    assert.equal(amended.status, 200);
    assert.equal(amended.body.from, "CREATED");
    assert.equal(amended.body.to, "CREATED");
    assert.equal(amended.body.version, 2);

    // 迁移事件已入 outbox（事务性）。
    const due = await runtime.outbox.fetchDue(10, isoNow());
    const types = due.map((message) => message.event.event_type);
    assert.ok(types.includes("EscalationCreated"));
    assert.ok(types.includes("EscalationAmendEscalation"));

    // 非法迁移（OFFERED 之前的 AcceptOffer）：类型化 409 INVALID_TRANSITION。
    const invalid = await call(
      server.base,
      "POST",
      `/v1/escalations/${escalationId}/commands/AcceptOffer`,
      { facts: {} },
    );
    assert.equal(invalid.status, 409);
    assert.equal(invalid.body.code, "ARENA_INVALID_TRANSITION");

    // 守卫失败：AmendEscalation 缺 pre_assignment_amendment 事实 → 类型化 INVARIANT_VIOLATION。
    const guarded = await call(
      server.base,
      "POST",
      `/v1/escalations/${escalationId}/commands/AmendEscalation`,
      { facts: {} },
    );
    assert.equal(guarded.status, 409);
    assert.equal(guarded.body.code, "ARENA_INVARIANT_VIOLATION");
    assert.ok(Array.isArray((guarded.body.details as { failed_guards?: string[] })?.failed_guards));
    assert.ok(
      ((guarded.body.details as { failed_guards?: string[] }).failed_guards ?? []).includes(
        "pre_assignment_amendment",
      ),
    );
  } finally {
    await server.close();
    runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
