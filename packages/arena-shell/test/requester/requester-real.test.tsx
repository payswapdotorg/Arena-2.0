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
import { RealWorkbenchBinding, DEMO_PRINCIPAL_TOKENS } from "@arena/workbench";
import { RequesterController } from "../../src/screens/requester/controller.js";
import { RequesterScreen } from "../../src/screens/requester/RequesterScreen.js";
import { buildContext, buildDraft, initialFormState } from "../../src/screens/requester/formModel.js";
import { submitOutcomeViewModel, trackingViewModel } from "../../src/screens/requester/viewModel.js";

/**
 * UIA-001 Lane B — 请求方 REAL 组合测试（真实 arena-api 子进程 + 真实 HTTP
 * 传输 + demo token 认证；镜像 workbench 的 e2e-real-api 先例）。
 *
 * 断言服务端规范投影（绝不 Mock）：提交 → CREATED → 追踪 → timeline →
 * typed result stub → 渲染层逐字呈现。屏视图模型从 REAL 数据派生后经
 * react-dom/server 渲染（REAL-composition render）。
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

function validForm() {
  const form = initialFormState();
  form.title = "Fix failing build";
  form.outcomeDescription = "Repo compiles and the pinned test passes on the agreed toolchain.";
  return form;
}

const HOST = {
  lens: "requester" as const,
  port: {
    navigate: () => ({ kind: "navigated" as const, screen: "requester" as const }),
    activeScreen: () => "requester" as const,
  },
};

test("REAL composition: submit → server projection → tracking → timeline → typed result, rendered verbatim", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-shell-b-"));
  const dbPath = join(dir, "arena.db");
  const api = await startRealApi(dbPath);
  try {
    const binding = new RealWorkbenchBinding({ baseUrl: api.baseUrl });
    const requesterAlpha = DEMO_PRINCIPAL_TOKENS[0]?.principal;
    assert.notEqual(requesterAlpha, undefined);

    const controller = new RequesterController({ binding, principal: requesterAlpha });
    controller.setForm(validForm());
    await controller.submit();

    const snap = controller.snapshot();
    assert.equal(snap.submitOutcome.kind, "SUBMITTED");
    const escalationId =
      snap.submitOutcome.kind === "SUBMITTED" ? snap.submitOutcome.escalation_id : "";

    // 追踪 = 服务端投影（状态 CREATED 来自服务器；标题是提交回显）。
    const tracking = trackingViewModel(snap.tracking.kind === "ready" ? snap.tracking.data : []);
    assert.equal(tracking.kind, "ready");
    if (tracking.kind === "ready") {
      assert.equal(tracking.data.length, 1);
      assert.equal(tracking.data[0]?.state, "CREATED");
      assert.equal(tracking.data[0]?.title, "Fix failing build");
    }

    // timeline = 服务端规范事件流（EscalationCreated 先行）。
    assert.equal(snap.timeline.kind, "ready");
    if (snap.timeline.kind === "ready") {
      assert.ok(snap.timeline.data.some((event) => event.event_type === "EscalationCreated"));
    }

    // 结果视图 = typed stub + AR2-007 披露（legible「尚未落地」）。
    assert.equal(snap.result.kind, "not_available");
    if (snap.result.kind === "not_available") {
      assert.match(snap.result.disclosure ?? "", /AR2-007/);
    }

    // REAL-composition render：真数据驱动的渲染面逐字断言。
    const html = renderToString(createElement(RequesterScreen, { host: HOST, controller }));
    const normalized = html.replace(/<!--.*?-->/g, "");
    assert.match(normalized, new RegExp(escalationId));
    assert.match(normalized, /Created/);
    assert.match(normalized, /EscalationCreated/);
    assert.match(normalized, /AR2-007/);
    assert.match(normalized, /Routing transparency/);
    assert.doesNotMatch(normalized, /ZCode/i);
  } finally {
    await api.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("REAL composition: same idempotency key + same digest replays (never double-creates)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-shell-b2-"));
  const dbPath = join(dir, "arena.db");
  const api = await startRealApi(dbPath);
  try {
    const binding = new RealWorkbenchBinding({ baseUrl: api.baseUrl });
    const requesterAlpha = DEMO_PRINCIPAL_TOKENS[0]?.principal;
    const controller = new RequesterController({ binding, principal: requesterAlpha });
    controller.setForm(validForm());
    await controller.submit();
    const first = controller.snapshot().submitOutcome;
    assert.equal(first.kind, "SUBMITTED");
    const escalationId = first.kind === "SUBMITTED" ? first.escalation_id : "";
    assert.equal(first.replayed, false);

    // 同键同摘要 → REPLAYED（幂等 —— 绝不二次创建）；同键异摘要 → 类型化 CONFLICT。
    // 控制器首次提交的幂等键 = arena-shell-requester-1（计数器从 1 起）。
    const draft = buildDraft(validForm());
    const context = buildContext("arena-shell-requester-1");
    const replayed = await binding.submitDraft(draft, context, requesterAlpha);
    assert.equal(replayed.kind, "SUBMITTED");
    if (replayed.kind === "SUBMITTED") {
      assert.equal(replayed.replayed, true);
      assert.equal(replayed.escalation_id, escalationId);
    }
    const rows = (await binding.tracking(requesterAlpha)) ?? [];
    assert.equal(rows.length, 1);

    const conflictDraft = buildDraft({ ...validForm(), title: "Different digest title" });
    const conflicted = await binding.submitDraft(conflictDraft, context, requesterAlpha);
    assert.equal(conflicted.kind, "CONFLICT");
    if (conflicted.kind === "CONFLICT") {
      assert.match(conflicted.message, /digest/);
    }
    const view = submitOutcomeViewModel({ kind: "CONFLICT", message: conflicted.message });
    assert.equal(view.kind, "CONFLICT");
  } finally {
    await api.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
