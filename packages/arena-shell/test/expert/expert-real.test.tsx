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
import { DEMO_PRINCIPAL_TOKENS, RealWorkbenchBinding } from "@arena/workbench";
import { RequesterController } from "../../src/screens/requester/controller.js";
import { initialFormState } from "../../src/screens/requester/formModel.js";
import {
  ExpertController,
  type ExpertCommandPort,
} from "../../src/screens/expert/controller.js";
import { ExpertScreen } from "../../src/screens/expert/ExpertScreen.js";
import { bindingCommandAdapter } from "../../src/screens/expert/registration.js";

/**
 * UIA-001 Lane B — 专家工位 REAL 组合测试（真实 arena-api 子进程 + 真实
 * HTTP 传输 + demo token 认证）。escalation 级命令通道 = 真实绑定的
 * command 路径；类型化 409/404 逐字上抛渲染（packet B2.3 的验收面）。
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
  lens: "expert" as const,
  port: {
    navigate: () => ({ kind: "navigated" as const, screen: "expert" as const }),
    activeScreen: () => "expert" as const,
  },
};

test("REAL command path: SubmitIntervention against a CREATED escalation → typed 409 verbatim on the surface", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-shell-c-"));
  const dbPath = join(dir, "arena.db");
  const api = await startRealApi(dbPath);
  try {
    const binding = new RealWorkbenchBinding({ baseUrl: api.baseUrl });
    const requesterAlpha = DEMO_PRINCIPAL_TOKENS[0]?.principal;
    assert.notEqual(requesterAlpha, undefined);

    // 经请求方控制器创建一个真实 escalation（服务端权威）。
    const requester = new RequesterController({ binding, principal: requesterAlpha });
    requester.setForm(validForm());
    await requester.submit();
    const submitted = requester.snapshot().submitOutcome;
    assert.equal(submitted.kind, "SUBMITTED");
    const escalationId = submitted.kind === "SUBMITTED" ? submitted.escalation_id : "";

    // 专家命令通道 = 真实绑定的 command 路径（principal 绑定）。
    const expert = DEMO_PRINCIPAL_TOKENS[2]?.principal ?? requesterAlpha;
    const commands: ExpertCommandPort = bindingCommandAdapter(binding, expert);
    const controller = new ExpertController({
      attempts: {
        listAssignments: async () => [],
        getAttempt: async () => ({ kind: "NOT_FOUND" }),
        submitCandidate: async () => ({ kind: "NOT_FOUND" }),
        submitSelfEvaluation: async () => ({ kind: "NOT_FOUND" }),
        escalationCriteria: async () => null,
      },
      commands,
      principal: expert,
    });
    controller.setInterventionEscalationId(escalationId);
    await controller.submitIntervention();

    const outcome = controller.snapshot().interventionOutcome ?? "";
    // CREATED 状态没有 SubmitIntervention 边 → 类型化 409（服务器状态机的
    // 权威裁决），逐字渲染（服务器的措辞不含 id —— 信封消息即规范文本）。
    assert.match(outcome, /INVALID_TRANSITION|INVARIANT_VIOLATION/);
    assert.match(outcome, /SubmitIntervention/);

    const html = renderToString(createElement(ExpertScreen, { host: HOST, controller })).replace(
      /<!--.*?-->/g,
      "",
    );
    assert.match(html, /INVALID_TRANSITION|INVARIANT_VIOLATION/);
    assert.match(html, /Canonical command path|canonical escalation command path/i);
    assert.doesNotMatch(html, /ZCode/i);
  } finally {
    await api.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("REAL command path: unknown escalation → typed 404 verbatim (indistinguishable from another tenant's)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-shell-c2-"));
  const dbPath = join(dir, "arena.db");
  const api = await startRealApi(dbPath);
  try {
    const binding = new RealWorkbenchBinding({ baseUrl: api.baseUrl });
    const expert = DEMO_PRINCIPAL_TOKENS[2]?.principal ?? {
      tenant_id: "tnt_00000001",
      user_id: "usr_00000003",
    };
    const commands: ExpertCommandPort = bindingCommandAdapter(binding, expert);
    const controller = new ExpertController({
      attempts: {
        listAssignments: async () => [],
        getAttempt: async () => ({ kind: "NOT_FOUND" }),
        submitCandidate: async () => ({ kind: "NOT_FOUND" }),
        submitSelfEvaluation: async () => ({ kind: "NOT_FOUND" }),
        escalationCriteria: async () => null,
      },
      commands,
      principal: expert,
    });
    controller.setInterventionEscalationId("esc_does_not_exist");
    await controller.submitIntervention();
    const outcome = controller.snapshot().interventionOutcome ?? "";
    assert.match(outcome, /NOT_FOUND ARENA_ESCALATION_NOT_FOUND/);
  } finally {
    await api.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("REAL structural assertion: the binding's request path carries no lens/role (transport-level ROLE_IS_NOT_AUTHORIZATION)", () => {
  // 结构性断言（镜像 workbench e2e 先例）：命令端口的公开签名只有
  // escalation_id / command / facts —— lens/role 永不进入请求路径。
  //（tsx 会用 __name 包装器包裹函数体，故用宽松匹配。）
  const source = bindingCommandAdapter.toString();
  assert.match(source, /escalationId,\s*command,\s*facts/);
  assert.doesNotMatch(source, /lens/);
  assert.doesNotMatch(source, /\brole\b/);
});
