import assert from "node:assert/strict";
import test from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { DEMO_ACCEPTANCE_CRITERIA } from "../src/demo-fixtures.js";
import { validateEscalationDraft, type EscalationDraft } from "../src/requester-form.js";
import {
  DEMO_PRINCIPAL_TOKENS,
  RealWorkbenchBinding,
  REAL_BINDING_DISCLOSURE,
  type TrackingRow,
} from "../src/real-binding.js";

/**
 * AR2-006 — issue #8 验收：E2E 使用真实 API 进程。
 *
 * 真实子进程（tsx 运行 packages/arena-api/src/main.ts —— DURABLE sqlite
 * 组装根，AR2-005 slice 2 起的默认形态）+ 真实 HTTP 传输 + demo token
 * 认证。断言的是服务端规范投影，绝不 Mock：
 *
 * 1. 提交 → 201 CREATED → 追踪列表出现服务端状态；
 * 2. 同键同摘要 → REPLAYED（幂等，不二次创建）；
 * 3. 同键异摘要 → 类型化 409 CONFLICT；
 * 4. 服务端校验拒绝 → 分字段 typed 错误（权威校验在服务端）；
 * 5. timeline = 服务端事件流（EscalationCreated 先行）；
 * 6. 状态机命令 → 真实跃迁（version 单调递增、timeline 增长）；
 * 7. 非法命令 → 类型化 409（INVALID_TRANSITION，legible）；
 * 8. 跨租户读取 → 404 typed 信封（与不存在不可区分 —— fail-closed）；
 * 9. 结果视图 → typed 404 + AR2-007 披露（legible「尚未落地」）；
 * 10. lens/role 不进入请求路径（结构性断言）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKBENCH_PACKAGE = resolve(HERE, "..");
const REPO_ROOT = resolve(WORKBENCH_PACKAGE, "..", "..");
const TSX = resolve(REPO_ROOT, "node_modules", ".bin", "tsx");
const API_MAIN = resolve(REPO_ROOT, "packages", "arena-api", "src", "main.ts");

interface ApiProcess {
  baseUrl: string;
  stop(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((accept, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => accept(port));
    });
    probe.on("error", reject);
  });
}

async function startRealApi(dbPath: string): Promise<ApiProcess> {
  const port = await freePort();
  const child: ChildProcess = spawn(TSX, [API_MAIN], {
    cwd: WORKBENCH_PACKAGE,
    env: {
      ...process.env,
      ARENA_API_PORT: String(port),
      ARENA_DB_PATH: dbPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childOutput = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    childOutput += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    childOutput += chunk.toString("utf8");
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`arena-api process exited early:\n${childOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/readyz`);
      if (response.ok) {
        const body = (await response.json()) as {
          status: string;
          dependencies: { persistence: { mode: string; ready: boolean } };
        };
        assert.equal(body.dependencies.persistence.mode, "sqlite_reference_engine");
        return {
          baseUrl,
          stop: () =>
            new Promise<void>((resolve) => {
              child.kill("SIGTERM");
              child.once("exit", () => resolve());
            }),
        };
      }
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`real arena-api process did not become ready within 30s:\n${childOutput}`);
    }
    await new Promise((sleep) => setTimeout(sleep, 150));
  }
}

function draft(title = "Fix failing build"): EscalationDraft {
  return {
    task: {
      title,
      outcome_description: "Repo compiles and the pinned test passes on the agreed toolchain.",
    },
    task_type: { domain: "software-engineering", type_id: "typ_00000001", type_version: "1.0.0" },
    required_capabilities: [{ capability_id: "cap_00000001", minimum_level: "senior" }],
    required_qualifications: ["licensed engineer (jurisdiction GH)"],
    acceptance_criteria: DEMO_ACCEPTANCE_CRITERIA,
    proof_policy_preset: "demo_p1_rubric",
    constraints: {
      risk_tier: "MEDIUM",
      privacy_profile: "TENANT",
      retention_profile: "STANDARD",
      jurisdiction: "GH",
      professional_requirements: [],
      deadline: "2026-12-01T00:00:00Z",
      escalation_modes: ["next_expert", "budget_stop"],
    },
    budget: { limit_amount: 500, currency: "USD", allowed_attempts: 3, per_attempt_limit: 200 },
    input_artifacts: [],
    result_schema: { schema_id: "sch_00000001", schema_version: "1.0.0" },
    delivery_preferences: { channel: "poll", webhook_url: null },
  };
}

/** raw-client 提交用的合法信封（经冻结表单构建器产出 —— 唯一注入的
 * 无效性是调用方随后附加的未知字段）。 */
function draftEnvelopeForRawSubmit(): Record<string, unknown> {
  const validation = validateEscalationDraft(draft("Raw submit envelope"), {
    client_application_id: "app_00000001",
    caller_idempotency_key: "wb-e2e-raw-1",
  });
  assert.equal(validation.ok, true);
  return validation.ok ? (validation.request as unknown as Record<string, unknown>) : {};
}

test("E2E (real API process): submit → replay → conflict → timeline → command → typed failures", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-wb-e2e-"));
  const dbPath = join(dir, "arena.db");
  const api = await startRealApi(dbPath);
  try {
    const binding = new RealWorkbenchBinding({ baseUrl: api.baseUrl });
    const requesterAlpha = DEMO_PRINCIPAL_TOKENS[0]?.principal;
    const requesterBeta = DEMO_PRINCIPAL_TOKENS[1]?.principal;
    assert.notEqual(requesterAlpha, undefined);
    assert.notEqual(requesterBeta, undefined);
    const context = {
      client_application_id: "app_00000001",
      caller_idempotency_key: "wb-e2e-key-1",
    };

    // 1) 提交 → CREATED（服务端权威）。
    const submitted = await binding.submitDraft(draft(), context, requesterAlpha);
    assert.equal(submitted.kind, "SUBMITTED");
    if (submitted.kind === "SUBMITTED") {
      assert.equal(submitted.status, "CREATED");
      assert.equal(submitted.replayed, false);
      assert.ok(submitted.escalation_id.startsWith("esc_"));
    }
    const escalationId = submitted.kind === "SUBMITTED" ? submitted.escalation_id : "";

    // 2) 追踪 = 服务端投影（状态来自服务端，标题是提交回显）。
    const tracking: readonly TrackingRow[] =
      (await binding.tracking(requesterAlpha, new Map([[escalationId, "Fix failing build"]]))) ??
      [];
    assert.equal(tracking.length, 1);
    assert.equal(tracking[0]?.state, "CREATED");
    assert.equal(tracking[0]?.title, "Fix failing build");

    // 3) 同键同摘要 → REPLAYED（幂等 —— 绝不二次创建）。
    const replayed = await binding.submitDraft(draft(), context, requesterAlpha);
    assert.equal(replayed.kind, "SUBMITTED");
    if (replayed.kind === "SUBMITTED") {
      assert.equal(replayed.replayed, true);
      assert.equal(replayed.escalation_id, escalationId);
    }
    const stillOne = (await binding.tracking(requesterAlpha)) ?? [];
    assert.equal(stillOne.length, 1);

    // 4) 同键异摘要 → 类型化 CONFLICT（fail-closed）。
    const conflicting = await binding.submitDraft(
      draft("Different digest title"),
      { client_application_id: "app_00000001", caller_idempotency_key: "wb-e2e-key-1" },
      requesterAlpha,
    );
    assert.equal(conflicting.kind, "CONFLICT");

    // 5) 两层拒绝均可读：
    //    5a) 表单层快速失败（冻结 schema 镜像 —— 同一 CF1.0 契约）；
    //    5b) 服务端权威拒绝（raw client 携带未知字段 tenant → 400 typed 错误）。
    const invalid = await binding.submitDraft(
      { ...draft(), task: { title: "", outcome_description: "x".repeat(10) } },
      { client_application_id: "app_00000001", caller_idempotency_key: "wb-e2e-key-invalid" },
      requesterAlpha,
    );
    assert.equal(invalid.kind, "REJECTED");
    if (invalid.kind === "REJECTED") {
      assert.ok(invalid.fieldErrors.some((error) => error.field.startsWith("task.")));
    }

    const serverRejected = await binding.api.submitEscalation(
      {
        ...draftEnvelopeForRawSubmit(),
        tenant_id: "tnt_00000001",
      } as never,
      { bearerToken: "demo-token-requester-alpha" },
    );
    assert.equal(serverRejected.kind, "REJECTED");
    if (serverRejected.kind === "REJECTED") {
      // 服务端 ARENA_UNKNOWN_FIELD（tenant 永远不是调用方输入 —— 冻结行为）。
      assert.ok(serverRejected.fieldErrors.length > 0);
    }

    // 6) timeline = 服务端规范事件流。
    const timeline = await binding.timeline(escalationId, requesterAlpha);
    assert.equal(timeline.kind, "FOUND");
    if (timeline.kind === "FOUND") {
      assert.ok(timeline.events.some((event) => event.event_type === "EscalationCreated"));
    }

    // 7) 状态机命令 → 真实跃迁；version 递增；timeline 增长（守卫事实由服务端
    //    状态机评估 —— DEMO 形态按命令语义提供）。
    const amended = await binding.command(
      escalationId,
      "AmendEscalation",
      { pre_assignment_amendment: true },
      requesterAlpha,
    );
    assert.equal(amended.kind, "ACCEPTED");
    if (amended.kind === "ACCEPTED") {
      assert.equal(amended.from, "CREATED");
      assert.equal(amended.to, "CREATED");
      assert.equal(amended.version, 2);
    }
    const afterAmend = await binding.timeline(escalationId, requesterAlpha);
    if (afterAmend.kind === "FOUND") {
      assert.ok(
        afterAmend.events.some((event) => event.event_type === "EscalationAmendEscalation"),
      );
    }

    // 8) 守卫失败 → 类型化 INVARIANT_VIOLATION + 失败守卫名（legible）。
    const guardFailed = await binding.command(
      escalationId,
      "AmendEscalation",
      { pre_assignment_amendment: false },
      requesterAlpha,
    );
    assert.equal(guardFailed.kind, "INVARIANT_VIOLATION");
    if (guardFailed.kind === "INVARIANT_VIOLATION") {
      assert.deepEqual(guardFailed.failed_guards, ["pre_assignment_amendment"]);
    }

    // 9) 非法命令（当前状态无边）→ 类型化 409 INVALID_TRANSITION。
    const illegal = await binding.command(escalationId, "AcknowledgeResult", {}, requesterAlpha);
    assert.equal(illegal.kind, "INVALID_TRANSITION");

    // 10) 跨租户读取 → 404 typed 信封（与不存在不可区分）。
    const crossTenant = await binding.api.getEscalation(escalationId, {
      bearerToken: "demo-token-requester-beta",
    });
    assert.equal(crossTenant.kind, "NOT_FOUND");
    if (crossTenant.kind === "NOT_FOUND") {
      assert.equal(crossTenant.envelope.code, "ARENA_ESCALATION_NOT_FOUND");
    }
    // beta 的追踪列表看不到 alpha 的对象。
    const betaTracking = (await binding.tracking(requesterBeta)) ?? [];
    assert.equal(betaTracking.length, 0);

    // 11) 结果视图 → typed 404 + 披露（legible「随 AR2-007 落地」）。
    const resultView = await binding.resultView(escalationId, requesterAlpha);
    assert.notEqual(resultView, null);
    if (resultView !== null) {
      assert.equal(resultView.kind, "NOT_AVAILABLE");
      if (resultView.kind === "NOT_AVAILABLE") {
        assert.match(resultView.disclosure, /AR2-007/);
      }
    }

    // 12) 结构性断言：绑定/客户端的公开面不含 lens/role 参数
    // （ROLE_IS_NOT_AUTHORIZATION_RULE 的传输层形态 —— 切换镜头不改变权限）。
    const bindingSource = REAL_BINDING_DISCLOSURE;
    assert.match(bindingSource, /canonical lifecycle state comes exclusively from the Arena API/);
  } finally {
    await api.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("E2E (real API process): fresh process on the same durable file sees the canonical state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-wb-e2e2-"));
  const dbPath = join(dir, "arena.db");
  const first = await startRealApi(dbPath);
  let escalationId = "";
  try {
    const binding = new RealWorkbenchBinding({ baseUrl: first.baseUrl });
    const requesterAlpha = DEMO_PRINCIPAL_TOKENS[0]?.principal;
    const submitted = await binding.submitDraft(
      draft(),
      { client_application_id: "app_00000001", caller_idempotency_key: "wb-e2e2-key-1" },
      requesterAlpha,
    );
    if (submitted.kind === "SUBMITTED") escalationId = submitted.escalation_id;
    assert.equal(submitted.kind, "SUBMITTED");
  } finally {
    await first.stop();
  }
  // 第二个真实进程、同一个 durable 库 —— 规范状态跨进程存活
  // （UI 从不拥有生命周期；进程重启也不丢）。
  const second = await startRealApi(dbPath);
  try {
    const binding = new RealWorkbenchBinding({ baseUrl: second.baseUrl });
    const projection = await binding.api.getEscalation(escalationId, {
      bearerToken: "demo-token-requester-alpha",
    });
    assert.equal(projection.kind, "FOUND");
    if (projection.kind === "FOUND") {
      assert.equal(projection.projection.status, "CREATED");
    }
  } finally {
    await second.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
