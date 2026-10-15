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
import { ReviewerController } from "../../src/screens/reviewer/controller.js";
import { ReviewerScreen } from "../../src/screens/reviewer/ReviewerScreen.js";
import { bindingReviewerAdapters } from "../../src/screens/reviewer/registration.js";

/**
 * UIA-001 Lane C — 评审 REAL 组合测试（真实 arena-api 子进程 + 真实 HTTP
 * 传输 + demo token 认证）。独立评审投票 = 真实绑定的 SubmitReviewerEvaluation
 * 命令路径；审计轨迹 = 服务端 timeline；类型化 409/404 逐字上抛渲染。
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

function validForm() {
  const form = initialFormState();
  form.title = "Fix failing build";
  form.outcomeDescription = "Repo compiles and the pinned test passes on the agreed toolchain.";
  return form;
}

const HOST = {
  lens: "reviewer" as const,
  port: {
    navigate: () => ({ kind: "navigated" as const, screen: "reviewer" as const }),
    activeScreen: () => "reviewer" as const,
  },
};

test("REAL command path: SubmitReviewerEvaluation against a CREATED escalation → typed 409 verbatim", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-shell-c3-"));
  const dbPath = join(dir, "arena.db");
  const api = await startRealApi(dbPath);
  try {
    const binding = new RealWorkbenchBinding({ baseUrl: api.baseUrl });
    const requesterAlpha = DEMO_PRINCIPAL_TOKENS[0]?.principal;
    const requester = new RequesterController({ binding, principal: requesterAlpha });
    requester.setForm(validForm());
    await requester.submit();
    const submitted = requester.snapshot().submitOutcome;
    assert.equal(submitted.kind, "SUBMITTED");
    const escalationId = submitted.kind === "SUBMITTED" ? submitted.escalation_id : "";

    const reviewer = DEMO_PRINCIPAL_TOKENS[2]?.principal ?? requesterAlpha;
    const { commands, audit } = bindingReviewerAdapters(binding, reviewer);
    const decks = {
      reviewableResultIds: async () => [],
      getReviewDeck: async () => ({ kind: "NOT_FOUND" }),
    };
    const controller = new ReviewerController({ decks, commands, audit, principal: reviewer });
    controller.setVoteEscalationId(escalationId);
    await controller.submitReviewVote();
    const outcome = controller.snapshot().voteOutcome ?? "";
    assert.match(outcome, /INVALID_TRANSITION|INVARIANT_VIOLATION/);
    assert.match(outcome, /SubmitReviewerEvaluation/);

    const html = renderToString(createElement(ReviewerScreen, { host: HOST, controller })).replace(
      /<!--.*?-->/g,
      "",
    );
    assert.match(html, /INVALID_TRANSITION|INVARIANT_VIOLATION/);
    assert.doesNotMatch(html, /ZCode/i);
  } finally {
    await api.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("REAL audit trail: the server-recorded timeline renders verbatim on the reviewer surface", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-shell-c4-"));
  const dbPath = join(dir, "arena.db");
  const api = await startRealApi(dbPath);
  try {
    const binding = new RealWorkbenchBinding({ baseUrl: api.baseUrl });
    const requesterAlpha = DEMO_PRINCIPAL_TOKENS[0]?.principal;
    const requester = new RequesterController({ binding, principal: requesterAlpha });
    requester.setForm(validForm());
    await requester.submit();
    const submitted = requester.snapshot().submitOutcome;
    const escalationId = submitted.kind === "SUBMITTED" ? submitted.escalation_id : "";

    const reviewer = DEMO_PRINCIPAL_TOKENS[2]?.principal ?? requesterAlpha;
    const { audit } = bindingReviewerAdapters(binding, reviewer);
    const controller = new ReviewerController({
      decks: {
        reviewableResultIds: async () => [],
        getReviewDeck: async () => ({ kind: "NOT_FOUND" }),
      },
      commands: { command: async () => ({ kind: "UNKNOWN_COMMAND" }) },
      audit,
      principal: reviewer,
    });
    await controller.loadAuditTrailFor(escalationId);
    const html = renderToString(createElement(ReviewerScreen, { host: HOST, controller })).replace(
      /<!--.*?-->/g,
      "",
    );
    assert.match(html, /EscalationCreated/);
  } finally {
    await api.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
