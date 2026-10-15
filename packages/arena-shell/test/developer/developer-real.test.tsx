import assert from "node:assert/strict";
import test from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { DEMO_PRINCIPAL_TOKENS } from "@arena/workbench";
import {
  MCP_DEFAULT_PROTOCOL_VERSION,
  MCP_FACADE_DISCLOSURE,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  SDK_DISCLOSURE,
  SDK_TEST_MODE_DISCLOSURE,
  canonicalRequestDigest,
} from "@arena/sdk";
import { DeveloperController, buildExampleRequest } from "../../src/screens/developer/sdkMount.js";
import { realSdkBinding } from "../../src/screens/developer/sdkBinding.js";
import { DeveloperScreen } from "../../src/screens/developer/DeveloperScreen.js";
import { developerRegistration } from "../../src/screens/developer/registration.js";
import type { ArenaScreenHost } from "../../src/contract.js";

/**
 * UIA-003 — 开发者门户 REAL 组合测试（真实 arena-api 子进程 + 真实 HTTP
 * 传输 + demo token 认证 + 真实 @arena/sdk 公开导出驱动）。
 *
 * 断言服务端规范投影（绝不 Mock）：quickstart（readiness → submit → 投影
 * → timeline）、幂等重放（同键同摘要 REPLAYED）、类型化冲突信封（同键异
 * 摘要 CONFLICT —— 真实错误信封逐字渲染）、MCP 工具词表（真实描述符 +
 * 披露逐字）、摘要语义（真实 canonicalRequestDigest 行为）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SHELL_PACKAGE = resolve(HERE, "..", "..");
const REPO_ROOT = resolve(SHELL_PACKAGE, "..", "..");
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
    cwd: SHELL_PACKAGE,
    env: { ...process.env, ARENA_API_PORT: String(port), ARENA_DB_PATH: dbPath },
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
          dependencies: { persistence: { mode: string } };
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

const HOST: ArenaScreenHost = {
  lens: "developer",
  port: {
    navigate: () => ({ kind: "navigated", screen: "developer" }),
    activeScreen: () => "developer",
  },
};

/** 渲染文本归一（剥 React 注释 + HTML 实体还原 —— 逐字断言口径）。 */
function visible(html: string): string {
  return html
    .replace(/<!--.*?-->/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

test("REAL composition: quickstart submit → server projection → timeline, rendered verbatim", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-shell-uia003-dev-"));
  const api = await startRealApi(join(dir, "arena.db"));
  try {
    const binding = realSdkBinding({ baseUrl: api.baseUrl });
    const principal = DEMO_PRINCIPAL_TOKENS[0]?.principal;
    assert.notEqual(principal, undefined);

    const controller = new DeveloperController({ binding, principal });
    await controller.run({ idempotencyKey: "arena-shell-dev-real-1" });

    const snap = controller.snapshot();
    assert.equal(snap.wiring.kind, "wired");
    assert.equal(snap.quickstart.kind, "ready");
    if (snap.quickstart.kind !== "ready") return;
    const { report, timeline } = snap.quickstart;

    // readiness = 真实 /readyz 投影（sqlite_reference_engine）。
    assert.notEqual(report.readiness, null);
    assert.equal(report.readiness?.status, "ready");
    assert.equal(report.readiness?.dependencies.persistence.mode, "sqlite_reference_engine");

    // submit = 服务端权威（CREATED + 真实 id）。
    assert.equal(report.submit.kind, "CREATED");
    const escalationId = report.submit.kind === "CREATED" ? report.submit.escalation_id : "";
    assert.match(escalationId, /^esc_/);

    // lookup projection = 服务端规范投影（FOUND + CREATED + 契约版本）。
    assert.equal(report.projection.kind, "FOUND");
    if (report.projection.kind === "FOUND") {
      assert.equal(report.projection.projection.escalation_id, escalationId);
      assert.equal(report.projection.projection.status, "CREATED");
    }

    // timeline projection = 服务端规范事件流（EscalationCreated 先行）。
    assert.notEqual(timeline, null);
    assert.equal(timeline?.kind, "FOUND");
    assert.ok(timeline?.kind === "FOUND" && timeline.events.some((event) => event.event_type === "EscalationCreated"));

    // REAL-composition render：真数据驱动的渲染面逐字断言。
    const html = visible(renderToString(createElement(DeveloperScreen, { host: HOST, controller })));
    assert.match(html, new RegExp(escalationId));
    assert.match(html, /sqlite_reference_engine/);
    assert.match(html, /data-submit-outcome="CREATED"/);
    assert.match(html, /data-readiness-status="ready"/);
    assert.match(html, /EscalationCreated/);
    assert.match(html, new RegExp(SDK_DISCLOSURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, new RegExp(SDK_TEST_MODE_DISCLOSURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(html, /ZCode/i);
  } finally {
    await api.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("REAL composition: same idempotency key + same digest replays (never double-creates)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-shell-uia003-dev2-"));
  const api = await startRealApi(join(dir, "arena.db"));
  try {
    const binding = realSdkBinding({ baseUrl: api.baseUrl });
    const principal = DEMO_PRINCIPAL_TOKENS[0]?.principal;
    const controller = new DeveloperController({ binding, principal });

    await controller.run({ idempotencyKey: "arena-shell-dev-real-replay" });
    const first = controller.snapshot().quickstart;
    assert.equal(first.kind, "ready");
    const escalationId = first.kind === "ready" && first.report.submit.kind === "CREATED"
      ? first.report.submit.escalation_id
      : "";

    // 同键同摘要 → REPLAYED（幂等 —— 绝不二次创建）。
    await controller.run({ idempotencyKey: "arena-shell-dev-real-replay" });
    const second = controller.snapshot().quickstart;
    assert.equal(second.kind, "ready");
    if (second.kind === "ready") {
      assert.equal(second.report.submit.kind, "REPLAYED");
      if (second.report.submit.kind === "REPLAYED") {
        assert.equal(second.report.submit.escalation_id, escalationId);
      }
    }

    // 同键异摘要 → 类型化 CONFLICT（真实错误信封 —— 绝不二次提交）。
    controller.setTitle("Different digest title (typed conflict path)");
    await controller.run({ idempotencyKey: "arena-shell-dev-real-replay" });
    const third = controller.snapshot().quickstart;
    assert.equal(third.kind, "ready");
    if (third.kind === "ready") {
      assert.equal(third.report.submit.kind, "CONFLICT");
      if (third.report.submit.kind === "CONFLICT") {
        assert.equal(third.report.submit.envelope.code, "ARENA_IDEMPOTENCY_DIGEST_MISMATCH");
        assert.match(third.report.submit.envelope.message, /different request digest/);
      }
      // quickstart 的 lookup 投影在无 escalation id 时如实失败（TRANSPORT_ERROR
      // —— SDK 自身的诚实行为，视图层逐字渲染）。
      assert.equal(third.report.projection.kind, "TRANSPORT_ERROR");
    }

    // 冲突信封逐字渲染（真实 code + message + correlation）。
    const html = visible(renderToString(createElement(DeveloperScreen, { host: HOST, controller })));
    assert.match(html, /ARENA_IDEMPOTENCY_DIGEST_MISMATCH: same idempotency key with a different request digest/);
  } finally {
    await api.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("REAL typed 404 envelope: timeline of an unknown escalation fails legibly", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-shell-uia003-dev3-"));
  const api = await startRealApi(join(dir, "arena.db"));
  try {
    const binding = realSdkBinding({ baseUrl: api.baseUrl });
    const principal = DEMO_PRINCIPAL_TOKENS[0]?.principal;
    assert.notEqual(principal, undefined);
    const auth = binding.credentialsFor(principal);
    assert.notEqual(auth, null);
    if (auth === null) return;

    // 真实服务器对未知 escalation 的类型化 404（失败关闭：不存在与跨租户不可
    // 区分）—— 真实错误信封原样上抛，绝不吞错。
    const missing = await binding.timeline("esc_does_not_exist", auth);
    assert.equal(missing.kind, "NOT_FOUND");
    if (missing.kind === "NOT_FOUND") {
      assert.equal(missing.envelope.code, "ARENA_ESCALATION_NOT_FOUND");
    }
  } finally {
    await api.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("REAL MCP facade + digest surface: real descriptors and real canonicalRequestDigest semantics", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-shell-uia003-dev4-"));
  const api = await startRealApi(join(dir, "arena.db"));
  try {
    const binding = realSdkBinding({ baseUrl: api.baseUrl });
    const principal = DEMO_PRINCIPAL_TOKENS[0]?.principal;

    // MCP 门面元数据 = 真实公开导出常量（逐字）。
    assert.equal(binding.mcpServer.name, MCP_SERVER_NAME);
    assert.equal(binding.mcpServer.version, MCP_SERVER_VERSION);
    assert.equal(binding.mcpServer.protocolVersion, MCP_DEFAULT_PROTOCOL_VERSION);

    // 工具词表 = 真实 McpFacade 描述符（5 个；提交工具描述内嵌披露逐字）。
    const tools = binding.toolDescriptors();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [
        "arena_submit_escalation",
        "arena_get_escalation",
        "arena_list_escalations",
        "arena_get_timeline",
        "arena_escalation_command",
      ],
    );
    const submitTool = tools.find((tool) => tool.name === "arena_submit_escalation");
    assert.match(submitTool?.description ?? "", new RegExp(MCP_FACADE_DISCLOSURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    // 摘要语义（真实函数行为）：标题变化 → 摘要变化；幂等键变化 → 摘要不变。
    const a = buildExampleRequest("Title A", "key-a");
    const b = buildExampleRequest("Title A", "key-b");
    const c = buildExampleRequest("Title B", "key-a");
    assert.ok(a.ok && b.ok && c.ok);
    if (!(a.ok && b.ok && c.ok)) return;
    assert.equal(binding.digest(a.request), binding.digest(b.request));
    assert.notEqual(binding.digest(a.request), binding.digest(c.request));
    assert.equal(binding.digest(a.request), canonicalRequestDigest(a.request));

    // 控制器快照的摘要 = 真实函数输出；标题输入改变摘要（交互面真实）。
    const controller = new DeveloperController({ binding, principal });
    const initialSnap = controller.snapshot();
    assert.notEqual(initialSnap.exampleRequest, null);
    if (initialSnap.exampleRequest !== null) {
      assert.equal(initialSnap.digest, binding.digest(initialSnap.exampleRequest));
    }
    controller.setTitle("Changed title");
    const changedSnap = controller.snapshot();
    assert.notEqual(changedSnap.digest, null);
    if (changedSnap.digest !== null) {
      assert.notEqual(changedSnap.digest, initialSnap.digest);
    }

    // REAL-composition render：工具词表 + 摘要 + 门面披露逐字呈现。
    const html = visible(renderToString(createElement(DeveloperScreen, { host: HOST, controller })));
    assert.match(html, /arena-mcp-facade/);
    assert.match(html, /arena_submit_escalation/);
    assert.match(html, new RegExp(MCP_FACADE_DISCLOSURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const digest = controller.snapshot().digest ?? "";
    assert.match(html, new RegExp(digest.slice(0, 16)));
  } finally {
    await api.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("REAL registration wiring: developerRegistration({ binding, principal }) renders the wired portal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-shell-uia003-dev5-"));
  const api = await startRealApi(join(dir, "arena.db"));
  try {
    const binding = realSdkBinding({ baseUrl: api.baseUrl });
    const principal = DEMO_PRINCIPAL_TOKENS[0]?.principal;
    const registration = developerRegistration({ binding, principal });
    assert.equal(registration.screen, "developer");
    const html = renderToString(registration.render(HOST) as never).replace(/<!--.*?-->/g, "");
    assert.match(html, new RegExp(api.baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, /binding baseUrl/);
  } finally {
    await api.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
