import assert from "node:assert/strict";
import test from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:net";

/**
 * AR2-005 slice 2 — issue #7 验收场景「concurrent admission from two API processes」：
 *
 * 两个真实子进程（tsx 运行 src/main.ts，各自独立 node 进程）共享同一个
 * node:sqlite 数据库文件（WAL + busy_timeout）。同一 idempotency key 的
 * 并发 CreateEscalation：
 * - 恰好一个进程 RESERVED → 201 CREATED；
 * - 另一进程 REPLAY(IN_PROGRESS) → 200 {replayed:true}（绝不二次执行命令；
 *   IN_PROGRESS 时响应体尚未写入 —— 冻结端口语义，slice 1 披露）；
 * - 完成后的第三次请求 → 200 REPLAY 携带完整响应体；
 * - 对端进程直接读取聚合（durable 跨进程可见性）；
 * - /readyz 报告 sqlite 引擎模式。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const API_PACKAGE = resolve(HERE, "..");
const TSX = resolve(API_PACKAGE, "..", "..", "node_modules", ".bin", "tsx");

const VALID_REQUEST = {
  contract_version: "ES2.0",
  client_application_id: "app_00000001",
  caller_idempotency_key: "idem-key-edge-1",
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

interface ApiProcess {
  child: ChildProcess;
  base: string;
  stdout: string;
}

function freePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server: Server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolvePromise(port));
    });
    server.on("error", reject);
  });
}

async function startApiProcess(port: number, dbPath: string): Promise<ApiProcess> {
  const child = spawn(TSX, ["src/main.ts"], {
    cwd: API_PACKAGE,
    env: {
      ...process.env,
      ARENA_API_PORT: String(port),
      ARENA_DB_PATH: dbPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`api process exited early (code ${child.exitCode}):\n${stdout}`);
    }
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`api process did not become healthy:\n${stdout}`);
    }
    await new Promise((sleep) => setTimeout(sleep, 150));
  }
  return {
    child,
    base,
    get stdout() {
      return stdout;
    },
  };
}

async function call(
  base: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: "Bearer demo-token-requester-alpha",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body: json };
}

function stopProcess(api: ApiProcess): Promise<void> {
  return new Promise((resolvePromise) => {
    const { child } = api;
    if (child.exitCode !== null) {
      resolvePromise();
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 3000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolvePromise();
    });
    child.kill("SIGTERM");
  });
}

test("two-process concurrent admission through the real API edge (durable)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-edge-"));
  const dbPath = join(dir, "arena.db");
  const portA = await freePort();
  const portB = await freePort();
  const processA = await startApiProcess(portA, dbPath);
  const processB = await startApiProcess(portB, dbPath);
  try {
    // readiness 报告 sqlite 引擎模式（durable 组装）。
    const readyA = await call(processA.base, "GET", "/readyz");
    assert.equal(readyA.status, 200);
    const deps = readyA.body.dependencies as Record<string, Record<string, unknown>>;
    assert.equal(deps.persistence?.mode, "sqlite_reference_engine");

    // 并发同键请求：恰好一个 201 CREATED；另一个 200 replayed（IN_PROGRESS）。
    const idempotencyKey = "edge-concurrent-key-1";
    const [fromA, fromB] = await Promise.all([
      call(processA.base, "POST", "/v1/escalations", VALID_REQUEST, {
        "x-idempotency-key": idempotencyKey,
      }),
      call(processB.base, "POST", "/v1/escalations", VALID_REQUEST, {
        "x-idempotency-key": idempotencyKey,
      }),
    ]);
    const outcomes = [fromA, fromB];
    const created = outcomes.filter((outcome) => outcome.status === 201);
    const replayed = outcomes.filter((outcome) => outcome.status === 200);
    assert.equal(
      created.length,
      1,
      `exactly one CREATED, got ${JSON.stringify(outcomes.map((o) => o.status))}`,
    );
    assert.equal(replayed.length, 1);
    const escalationId = String(created[0]?.body.escalation_id);
    assert.equal(created[0]?.body.kind, "CREATED");
    assert.equal(replayed[0]?.body.replayed, true);
    // IN_PROGRESS 重放的响应体尚未写入（冻结端口语义；slice 1 披露）。
    assert.equal(replayed[0]?.body.response, null);

    // 完成后的第三次请求：REPLAY 携带完整响应体（任一进程均可重放）。
    const third = await call(processB.base, "POST", "/v1/escalations", VALID_REQUEST, {
      "x-idempotency-key": idempotencyKey,
    });
    assert.equal(third.status, 200);
    assert.equal(third.body.replayed, true);
    assert.equal((third.body.response as Record<string, unknown>).escalation_id, escalationId);

    // 跨进程可见性：对端进程直接读取聚合与列表。
    const crossGet = await call(processB.base, "GET", `/v1/escalations/${escalationId}`);
    assert.equal(crossGet.status, 200);
    assert.equal(crossGet.body.status, "CREATED");
    const listA = await call(processA.base, "GET", "/v1/escalations");
    const listB = await call(processB.base, "GET", "/v1/escalations");
    assert.equal((listA.body.items as unknown[]).length, 1);
    assert.equal((listB.body.items as unknown[]).length, 1);

    // 跨租户在两个进程上均失败关闭。
    const crossTenant = await fetch(`${processB.base}/v1/escalations/${escalationId}`, {
      headers: { authorization: "Bearer demo-token-requester-beta" },
    });
    assert.equal(crossTenant.status, 404);
  } finally {
    await stopProcess(processA);
    await stopProcess(processB);
    rmSync(dir, { recursive: true, force: true });
  }
});
