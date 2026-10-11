import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import { McpFacade } from "../src/contract.js";
import { buildGenericEscalationRequest } from "../src/contract.js";
import { scriptedFetch } from "./helpers.js";

/**
 * AR2-011 — MCP 门面单元验收（issue #13）：
 * JSON-RPC 2.0 协议面（initialize 回显协议版本 / 通知不回应 / 未知方法
 * -32601 / 解析错误 -32700）；tools/list 完整描述符；tools/call 走同一
 * SDK 客户端（typed outcome 序列化为 MCP content，isError = 类型化失败）；
 * stdio 分帧（逐行）。
 */

const REQUEST = buildGenericEscalationRequest({
  title: "Classify the weekly ticket batch",
  outcome_description: "Each ticket gets exactly one primary label from the agreed taxonomy.",
  output_schema_id: "sch_generic_0001",
  caller_idempotency_key: "mcp-unit-key-1",
  client_application_id: "app_00000001",
});

function facade(script: ReadonlyArray<number | "network-error" | Response>): McpFacade {
  return new McpFacade({
    baseUrl: "http://api.local",
    credentials: { bearerToken: "demo-token-requester-alpha" },
    fetchImpl: scriptedFetch(script),
  });
}

test("initialize echoes the client protocol version and advertises tools capability", async () => {
  const response = await facade([200]).handleMessage(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25" },
    }),
  );
  assert.notEqual(response, null);
  const parsed = JSON.parse(response ?? "{}") as {
    result: {
      protocolVersion: string;
      capabilities: { tools: unknown };
      serverInfo: { name: string };
    };
  };
  assert.equal(parsed.result.protocolVersion, "2025-11-25");
  assert.ok(parsed.result.capabilities.tools !== undefined);
  assert.equal(parsed.result.serverInfo.name, "arena-mcp-facade");
});

test("notifications produce no response; unknown methods get -32601; parse errors -32700", async () => {
  const unit = facade([200]);
  assert.equal(
    await unit.handleMessage(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    ),
    null,
  );
  const unknown = await unit.handleMessage(
    JSON.stringify({ jsonrpc: "2.0", id: 7, method: "resources/list" }),
  );
  const parsedUnknown = JSON.parse(unknown ?? "{}") as { error: { code: number } };
  assert.equal(parsedUnknown.error.code, -32601);
  const malformed = await unit.handleMessage("not json at all");
  const parsedMalformed = JSON.parse(malformed ?? "{}") as { error: { code: number } };
  assert.equal(parsedMalformed.error.code, -32700);
});

test("tools/list returns the five Arena tool descriptors", async () => {
  const response = await facade([200]).handleMessage(
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  );
  const parsed = JSON.parse(response ?? "{}") as {
    result: { tools: Array<{ name: string; inputSchema: unknown }> };
  };
  assert.deepEqual(
    parsed.result.tools.map((tool) => tool.name),
    [
      "arena_submit_escalation",
      "arena_get_escalation",
      "arena_list_escalations",
      "arena_get_timeline",
      "arena_escalation_command",
    ],
  );
  for (const tool of parsed.result.tools) {
    assert.ok(tool.inputSchema !== undefined);
  }
});

test("tools/call submit returns a schema-valid CREATED outcome (isError=false)", async () => {
  const unit = facade([
    new Response(JSON.stringify({ escalation_id: "esc_00000001", status: "CREATED", version: 1 }), {
      status: 201,
    }),
  ]);
  const response = await unit.handleMessage(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "arena_submit_escalation", arguments: { request: REQUEST } },
    }),
  );
  const parsed = JSON.parse(response ?? "{}") as {
    result: { content: Array<{ type: string; text: string }>; isError: boolean };
  };
  assert.equal(parsed.result.isError, false);
  const outcome = JSON.parse(parsed.result.content[0]?.text ?? "{}") as {
    kind: string;
    escalation_id: string;
  };
  assert.equal(outcome.kind, "CREATED");
  assert.equal(outcome.escalation_id, "esc_00000001");
});

test("tools/call submit with a malformed envelope returns typed REJECTED (isError=true)", async () => {
  const unit = facade([201]);
  const response = await unit.handleMessage(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "arena_submit_escalation",
        arguments: { request: { ...REQUEST, task: { title: "", outcome_description: "x" } } },
      },
    }),
  );
  const parsed = JSON.parse(response ?? "{}") as {
    result: { content: Array<{ text: string }>; isError: boolean };
  };
  assert.equal(parsed.result.isError, true);
  const outcome = JSON.parse(parsed.result.content[0]?.text ?? "{}") as { kind: string };
  assert.equal(outcome.kind, "REJECTED");
});

test("tools/call get_escalation serializes the server projection; unknown tool is a typed tool error", async () => {
  const unit = facade([
    new Response(
      JSON.stringify({
        escalation_id: "esc_00000001",
        status: "CREATED",
        version: 1,
        contract_version: "CF1.0",
        updated_at: "2026-10-11T00:00:00Z",
      }),
      { status: 200 },
    ),
    200,
  ]);
  const found = await unit.handleMessage(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "arena_get_escalation", arguments: { escalation_id: "esc_00000001" } },
    }),
  );
  const parsedFound = JSON.parse(found ?? "{}") as {
    result: { isError: boolean; content: Array<{ text: string }> };
  };
  assert.equal(parsedFound.result.isError, false);
  const projection = JSON.parse(parsedFound.result.content[0]?.text ?? "{}") as {
    kind: string;
    projection: { status: string };
  };
  assert.equal(projection.kind, "FOUND");
  assert.equal(projection.projection.status, "CREATED");

  const unknownTool = await unit.handleMessage(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "arena_no_such_tool" },
    }),
  );
  const parsedUnknown = JSON.parse(unknownTool ?? "{}") as {
    result: { isError: boolean; content: Array<{ text: string }> };
  };
  assert.equal(parsedUnknown.result.isError, true);
  assert.match(parsedUnknown.result.content[0]?.text ?? "", /unknown tool/);
});

test("stdio framing: newline-delimited JSON-RPC over streams", async () => {
  const unit = facade([200]);
  const input = new PassThrough();
  const output = new PassThrough();
  const collected: string[] = [];
  output.setEncoding("utf8");
  let buffer = "";
  output.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      collected.push(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  });
  const finished = unit.startStdio(input, output);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 11, method: "ping" })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 12, method: "tools/list" })}\n`);
  input.end();
  await finished;
  assert.equal(
    collected.length,
    2,
    "notification got no response; ping + tools/list each one line",
  );
  const ping = JSON.parse(collected[0] ?? "{}") as { id: number; result: Record<string, unknown> };
  assert.equal(ping.id, 11);
  const list = JSON.parse(collected[1] ?? "{}") as { id: number; result: { tools: unknown[] } };
  assert.equal(list.id, 12);
  assert.equal(list.result.tools.length, 5);
});
