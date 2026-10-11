import assert from "node:assert/strict";
import test from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { createSqliteRuntime } from "@arena/persistence";
import {
  ArenaSdkClient,
  buildGenericEscalationRequest,
  dispatchWebhookRound,
  InMemoryWebhookDedupeStore,
  runGenericExample,
  startWebhookReceiver,
} from "../src/contract.js";

/**
 * AR2-011 — issue #13 E2E 验收：外部进程调用真实 URL + 验签 + 重试零重复效应。
 *
 * 全链路真实组件（绝不 Mock 状态机/持久化/HTTP）：
 * 1. 真实 arena-api 子进程（tsx main.ts —— DURABLE sqlite 组装根）；
 * 2. runGenericExample：SDK quickstart（真实 URL）→ 提交落库 →
 *    事务性 outbox（同事务事件行）→ 第二个 sqlite 连接（同文件 WAL）上的
 *    签名 webhook 投递 → 真实 HTTP 接收端验签 → apply-once → 「丢确认」
 *    重试 → DUPLICATE（效应恰好一次 —— 重试零重复效应）；
 * 3. 真实 MCP 门面子进程（stdio JSON-RPC）—— 外部进程调用真实 URL：
 *    initialize → tools/call arena_get_escalation → 服务端投影 FOUND；
 *    tools/call arena_submit_escalation → CREATED（全链路 typed）；
 * 4. SDK 直接提交 → schema-valid 结果（CF1.0 投影字段齐全）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SDK_PACKAGE = resolve(HERE, "..");
const REPO_ROOT = resolve(SDK_PACKAGE, "..", "..");
const TSX = resolve(REPO_ROOT, "node_modules", ".bin", "tsx");
const API_MAIN = resolve(REPO_ROOT, "packages", "arena-api", "src", "main.ts");
const MCP_MAIN = resolve(SDK_PACKAGE, "src", "mcp-main.ts");

const ALPHA = { bearerToken: "demo-token-requester-alpha" };

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
    cwd: SDK_PACKAGE,
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
          dependencies: { persistence: { mode: string; ready: boolean } };
        };
        assert.equal(body.dependencies.persistence.mode, "sqlite_reference_engine");
        return {
          baseUrl,
          stop: () =>
            new Promise<void>((resolveStop) => {
              child.kill("SIGTERM");
              child.once("exit", () => resolveStop());
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

interface McpProcess {
  request(
    id: number,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  stop(): Promise<void>;
}

/** 真实 MCP 门面子进程（stdio 分帧 JSON-RPC —— 外部进程）。 */
async function startRealMcp(baseUrl: string, bearer: string): Promise<McpProcess> {
  const child: ChildProcess = spawn(TSX, [MCP_MAIN], {
    cwd: SDK_PACKAGE,
    env: { ...process.env, ARENA_SDK_BASE_URL: baseUrl, ARENA_SDK_BEARER: bearer },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let childOutput = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    childOutput += chunk.toString("utf8");
  });
  const pending = new Map<number, (response: Record<string, unknown>) => void>();
  let buffer = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) {
        try {
          const message = JSON.parse(line) as { id?: number; error?: { message: string } };
          if (message.id !== undefined) {
            const resolveOne = pending.get(message.id);
            if (resolveOne !== undefined) {
              pending.delete(message.id);
              resolveOne(JSON.parse(line) as Record<string, unknown>);
            }
          }
        } catch {
          // ignore non-JSON noise
        }
      }
      newline = buffer.indexOf("\n");
    }
  });
  const started = child.stdin !== null && child.stdout !== null;
  if (!started) throw new Error(`mcp facade failed to start:\n${childOutput}`);
  return {
    request(id, method, params) {
      return new Promise((resolveRequest, rejectRequest) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectRequest(new Error(`mcp request ${method} timed out:\n${childOutput}`));
        }, 30_000);
        pending.set(id, (response) => {
          clearTimeout(timer);
          resolveRequest(response);
        });
        const line = JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          ...(params === undefined ? {} : { params }),
        });
        child.stdin?.write(`${line}\n`);
      });
    },
    stop: () =>
      new Promise<void>((resolveStop) => {
        child.stdin?.end();
        child.kill("SIGTERM");
        child.once("exit", () => resolveStop());
      }),
  };
}

test("E2E (real processes): SDK + MCP external process + signed webhooks + retry without duplicate effects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-sdk-e2e-"));
  const dbPath = join(dir, "arena.db");
  const api = await startRealApi(dbPath);
  // 第二 sqlite 连接（同文件 WAL —— 多连接拓扑即 AR2-005 验收场景 3 基础）：
  // webhook 投递器从这里消费事务性 outbox。
  const consumerRuntime = createSqliteRuntime({ path: dbPath, busyTimeoutMs: 8000 });
  try {
    // ---- 1) 通用示例：提交（真实 URL）→ 签名投递 → 验签 → apply-once →
    // 丢确认重试 → DUPLICATE。效应恰好一次（重试零重复效应）。
    const report = await runGenericExample({
      baseUrl: api.baseUrl,
      bearerToken: ALPHA.bearerToken,
      spec: {
        title: "Classify the weekly ticket batch",
        outcome_description:
          "Each ticket in the fixture batch gets exactly one primary label from the agreed taxonomy.",
        output_schema_id: "sch_generic_0001",
        caller_idempotency_key: "sdk-e2e-generic-1",
        client_application_id: "app_00000001",
      },
      outbox: consumerRuntime.outbox,
      subscription: {
        subscription_id: "sub_generic_0001",
        secret: "whsec_e2e_generic_00000001",
        event_type_prefixes: [],
      },
    });
    assert.equal(report.disclosure.length > 0, true);
    assert.equal(
      report.quickstart.readiness?.dependencies.persistence.mode,
      "sqlite_reference_engine",
    );
    assert.equal(report.quickstart.submit.kind, "CREATED");
    assert.equal(report.quickstart.projection.kind, "FOUND");
    const genericEscalationId =
      report.quickstart.submit.kind === "CREATED" ? report.quickstart.submit.escalation_id : "";
    assert.match(genericEscalationId, /^esc_/);

    // 第一轮：丢确认（效应已施加、HTTP 500）→ FAILED + 退避。
    assert.equal(report.roundOne.processedCount, 1);
    assert.equal(report.roundOne.processed[0]?.kind, "FAILED");
    // 第二轮：同 delivery 重投 → 接收端 DUPLICATE → 200 → 终态。
    assert.equal(report.roundTwo.processedCount, 1);
    assert.equal(report.roundTwo.processed[0]?.kind, "DELIVERED");
    if (report.roundTwo.processed[0]?.kind === "DELIVERED") {
      assert.equal(report.roundTwo.processed[0].attempt, 2);
      assert.equal(
        report.roundTwo.processed[0].delivery_id,
        report.roundOne.processed[0]?.kind === "FAILED"
          ? report.roundOne.processed[0].delivery_id
          : "",
      );
    }
    // 效应恰好一次 + 判定序列 APPLIED → DUPLICATE（验签通过才可能走到去重）。
    assert.equal(report.effects.length, 1);
    assert.match(report.effects[0] ?? "", /^applied:evt_/);
    assert.deepEqual(
      report.verdicts.map((verdict) => verdict.kind),
      ["APPLIED", "DUPLICATE"],
    );

    // ---- 2) MCP 门面：真实子进程（stdio）—— 外部进程调用真实 URL。
    const mcp = await startRealMcp(api.baseUrl, ALPHA.bearerToken);
    try {
      const initialized = await mcp.request(1, "initialize", { protocolVersion: "2025-06-18" });
      const initResult = initialized.result as {
        protocolVersion: string;
        serverInfo: { name: string };
      };
      assert.equal(initResult.protocolVersion, "2025-06-18");
      assert.equal(initResult.serverInfo.name, "arena-mcp-facade");

      const tools = await mcp.request(2, "tools/list");
      const toolNames = (tools.result as { tools: Array<{ name: string }> }).tools.map(
        (tool) => tool.name,
      );
      assert.equal(toolNames.length, 5);

      const fetched = await mcp.request(3, "tools/call", {
        name: "arena_get_escalation",
        arguments: { escalation_id: genericEscalationId },
      });
      const fetchOutcome = JSON.parse(
        (fetched.result as { content: Array<{ text: string }> }).content[0]?.text ?? "{}",
      ) as { kind: string; projection: { status: string; contract_version: string } };
      assert.equal(fetchOutcome.kind, "FOUND");
      assert.equal(fetchOutcome.projection.status, "CREATED");
      assert.equal(fetchOutcome.projection.contract_version, "ES2.0");

      const timeline = await mcp.request(4, "tools/call", {
        name: "arena_get_timeline",
        arguments: { escalation_id: genericEscalationId },
      });
      const timelineOutcome = JSON.parse(
        (timeline.result as { content: Array<{ text: string }> }).content[0]?.text ?? "{}",
      ) as { kind: string; events: Array<{ event_type: string }> };
      assert.equal(timelineOutcome.kind, "FOUND");
      assert.ok(timelineOutcome.events.some((event) => event.event_type === "EscalationCreated"));

      const submitted = await mcp.request(5, "tools/call", {
        name: "arena_submit_escalation",
        arguments: {
          request: buildGenericEscalationRequest({
            title: "Normalize the product feed",
            outcome_description:
              "Every product row maps to the canonical catalog schema with zero unmatched fields.",
            output_schema_id: "sch_generic_0003",
            caller_idempotency_key: "sdk-e2e-mcp-1",
            client_application_id: "app_00000001",
          }),
        },
      });
      const submitOutcome = JSON.parse(
        (submitted.result as { content: Array<{ text: string }> }).content[0]?.text ?? "{}",
      ) as { kind: string; escalation_id: string };
      assert.equal(submitOutcome.kind, "CREATED");
      assert.match(submitOutcome.escalation_id, /^esc_/);
      const mcpSubmitError = (submitted.result as { isError?: boolean }).isError === true;
      assert.equal(mcpSubmitError, false);
    } finally {
      await mcp.stop();
    }

    // ---- 3) SDK 直连提交（第二个幂等键）→ schema-valid CREATED + 投影。
    const client = new ArenaSdkClient({ baseUrl: api.baseUrl });
    const secondSubmit = await client.submitEscalation(
      buildGenericEscalationRequest({
        title: "Deduplicate the vendor directory",
        outcome_description:
          "Each vendor record resolves to exactly one canonical entity with a stable id.",
        output_schema_id: "sch_generic_0002",
        caller_idempotency_key: "sdk-e2e-generic-2",
        client_application_id: "app_00000001",
      }),
      ALPHA,
    );
    assert.equal(secondSubmit.kind, "CREATED");
    if (secondSubmit.kind === "CREATED") {
      const looked = await client.getEscalation(secondSubmit.escalation_id, ALPHA);
      assert.equal(looked.kind, "FOUND");
      if (looked.kind === "FOUND") {
        assert.equal(looked.projection.status, "CREATED");
        assert.equal(looked.projection.contract_version, "ES2.0");
        assert.match(looked.projection.updated_at, /^\d{4}-\d{2}-\d{2}T/);
      }
      const timeline = await client.getTimeline(secondSubmit.escalation_id, ALPHA);
      assert.equal(timeline.kind === "FOUND", true);
    }

    // ---- 4) 收尾排空：后续提交（MCP + SDK）的事件也被投递（每次恰一次），
    // 新 sqlite 连接看到全部终态（投递不丢失不重复）。
    const drainEffects: string[] = [];
    const drainReceiver = await startWebhookReceiver({
      secret: "whsec_e2e_generic_00000001",
      dedupe: new InMemoryWebhookDedupeStore(),
      apply: (payload) => {
        drainEffects.push(payload.event_id);
      },
    });
    try {
      let drained = 0;
      for (let round = 0; round < 5; round += 1) {
        const reportRound = await dispatchWebhookRound({
          outbox: consumerRuntime.outbox,
          subscription: {
            subscription_id: "sub_generic_0001",
            endpoint_url: drainReceiver.url,
            secret: "whsec_e2e_generic_00000001",
            event_type_prefixes: [],
          },
        });
        if (reportRound.processedCount === 0) break;
        drained += reportRound.processedCount;
      }
      assert.equal(drained, 2, "the MCP submit + SDK submit events each delivered exactly once");
      assert.equal(drainEffects.length, 2);
      assert.equal(new Set(drainEffects).size, 2, "no delivery applied twice");
    } finally {
      await drainReceiver.stop();
    }
    const reopened = createSqliteRuntime({ path: dbPath, busyTimeoutMs: 8000 });
    try {
      const stillPending = await reopened.outbox.fetchDue(
        32,
        new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      );
      assert.equal(stillPending.length, 0, "no due outbox messages after terminal dispatch");
    } finally {
      reopened.close();
    }
  } finally {
    consumerRuntime.close();
    await api.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
