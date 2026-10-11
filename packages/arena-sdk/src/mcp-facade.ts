import type { Readable, Writable } from "node:stream";
import type { EscalationRequest, TransitionCommand } from "@arena/contracts";
import { ArenaSdkClient, type ArenaSdkClientOptions, type SdkCredentials } from "./sdk-client.js";
import { MCP_FACADE_DISCLOSURE } from "./disclosures.js";

/**
 * AR2-011 — MCP 门面（issue #13）：JSON-RPC 2.0 over stdio。
 *
 * 相同用例/相同授权（冻结纪律）：门面绝不绕过 API 边缘 —— 每个工具调用
 * 都经 ArenaSdkClient 走真实 URL + Bearer token（服务端推导租户上下文，
 * 同一套 use cases / 同一套错误信封）。门面不发明第二个生命周期语义，
 * 只把 typed outcome 序列化为 MCP content（isError = 类型化失败可读）。
 *
 * 协议面（MCP 最小规范子集）：initialize / notifications/initialized /
 * ping / tools/list / tools/call；未知方法 → -32601；通知不回应；
 * 每行一个 JSON 消息（stdio 分帧）。
 */

export const MCP_SERVER_NAME = "arena-mcp-facade" as const;
export const MCP_SERVER_VERSION = "1.0.0" as const;
export const MCP_DEFAULT_PROTOCOL_VERSION = "2025-06-18" as const;

export interface McpFacadeOptions extends ArenaSdkClientOptions {
  credentials: SdkCredentials;
}

interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown> | null;
}

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class McpFacade {
  private readonly client: ArenaSdkClient;
  private readonly credentials: SdkCredentials;
  private protocolVersion: string = MCP_DEFAULT_PROTOCOL_VERSION;

  constructor(options: McpFacadeOptions) {
    this.client = new ArenaSdkClient({ baseUrl: options.baseUrl, fetchImpl: options.fetchImpl });
    this.credentials = options.credentials;
  }

  /** 处理一行 JSON 消息；返回应答行（通知/非法输入返回 null）。 */
  async handleMessage(raw: string): Promise<string | null> {
    let message: JsonRpcRequest;
    try {
      message = JSON.parse(raw) as JsonRpcRequest;
    } catch {
      return JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "parse error" },
      });
    }
    if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return message.id === undefined
        ? null
        : JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32600, message: "invalid request" },
          });
    }
    if (message.id === undefined || message.id === null) {
      return null; // notification — no response per JSON-RPC 2.0
    }
    const result = await this.dispatch(message.method, message.params ?? {});
    if (result === null) {
      return JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `method not found: ${message.method}` },
      });
    }
    return JSON.stringify({ jsonrpc: "2.0", id: message.id, result });
  }

  /** stdio 入口（mcp-main.ts 使用；逐行读取 stdin → 应答写 stdout）。 */
  async startStdio(input: Readable, output: Writable): Promise<void> {
    let buffer = "";
    input.setEncoding("utf8");
    await new Promise<void>((accept) => {
      input.on("data", (chunk: string) => {
        buffer += chunk;
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line.length > 0) {
            void this.handleMessage(line).then((response) => {
              if (response !== null) {
                output.write(`${response}\n`);
              }
            });
          }
          newline = buffer.indexOf("\n");
        }
      });
      input.on("end", () => accept());
      input.on("error", () => accept());
    });
  }

  toolDescriptors(): readonly McpToolDescriptor[] {
    return [
      {
        name: "arena_submit_escalation",
        description: `Submit a CF1.0 EscalationRequest through the real Arena API (idempotent by caller_idempotency_key). The request object is validated against the frozen escalationRequestSchema — malformed requests return a typed REJECTED outcome. ${MCP_FACADE_DISCLOSURE}`,
        inputSchema: {
          type: "object",
          properties: {
            request: { type: "object", description: "CF1.0 EscalationRequest envelope" },
          },
          required: ["request"],
        },
      },
      {
        name: "arena_get_escalation",
        description:
          "Fetch the server-canonical projection (status/version/updated_at) of one escalation by id, tenant-scoped by the authenticated credentials.",
        inputSchema: {
          type: "object",
          properties: { escalation_id: { type: "string" } },
          required: ["escalation_id"],
        },
      },
      {
        name: "arena_list_escalations",
        description: "List escalations visible to the authenticated tenant (server-derived scope).",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "arena_get_timeline",
        description: "Fetch the server event stream (timeline) of one escalation.",
        inputSchema: {
          type: "object",
          properties: { escalation_id: { type: "string" } },
          required: ["escalation_id"],
        },
      },
      {
        name: "arena_escalation_command",
        description:
          "Execute a frozen state-machine command against one escalation. facts are the guard inputs (server-side derived in production wiring).",
        inputSchema: {
          type: "object",
          properties: {
            escalation_id: { type: "string" },
            command: { type: "string", description: "CF1.0 command name" },
            facts: { type: "object", additionalProperties: { type: "boolean" } },
          },
          required: ["escalation_id", "command"],
        },
      },
    ];
  }

  private async dispatch(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    if (method === "initialize") {
      const requested = params.protocolVersion;
      if (typeof requested === "string" && requested.length > 0) this.protocolVersion = requested;
      return {
        protocolVersion: this.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        instructions: MCP_FACADE_DISCLOSURE,
      };
    }
    if (method === "ping") return {};
    if (method === "tools/list") {
      return { tools: this.toolDescriptors() };
    }
    if (method === "tools/call") {
      const name = params.name;
      const args = params.arguments;
      if (typeof name !== "string") return toolError("tool name required");
      return this.callTool(
        name,
        (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>,
      );
    }
    return null;
  }

  private async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (name === "arena_submit_escalation") {
      const outcome = await this.client.submitEscalation(
        args.request as EscalationRequest,
        this.credentials,
      );
      return toolResult(outcome, outcome.kind === "CREATED" || outcome.kind === "REPLAYED");
    }
    if (name === "arena_get_escalation") {
      const escalationId = args.escalation_id;
      if (typeof escalationId !== "string") return toolError("escalation_id required");
      const outcome = await this.client.getEscalation(escalationId, this.credentials);
      return toolResult(outcome, outcome.kind === "FOUND");
    }
    if (name === "arena_list_escalations") {
      const outcome = await this.client.listEscalations(this.credentials);
      return toolResult(outcome, outcome !== null);
    }
    if (name === "arena_get_timeline") {
      const escalationId = args.escalation_id;
      if (typeof escalationId !== "string") return toolError("escalation_id required");
      const outcome = await this.client.getTimeline(escalationId, this.credentials);
      return toolResult(outcome, outcome.kind === "FOUND");
    }
    if (name === "arena_escalation_command") {
      const escalationId = args.escalation_id;
      const command = args.command;
      if (typeof escalationId !== "string" || typeof command !== "string") {
        return toolError("escalation_id and command required");
      }
      const facts =
        typeof args.facts === "object" && args.facts !== null
          ? (args.facts as Record<string, unknown>)
          : {};
      const outcome = await this.client.escalationCommand(
        escalationId,
        command as TransitionCommand,
        facts as Record<string, boolean>,
        this.credentials,
      );
      return toolResult(outcome, outcome.kind === "ACCEPTED");
    }
    return toolError(`unknown tool: ${name}`);
  }
}

function toolResult(outcome: unknown, ok: boolean): Record<string, unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(outcome) }],
    isError: !ok,
  };
}

function toolError(message: string): Record<string, unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify({ kind: "TOOL_ERROR", message }) }],
    isError: true,
  };
}
