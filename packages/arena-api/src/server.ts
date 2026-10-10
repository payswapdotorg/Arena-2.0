import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  CONTRACT_CORPUS_VERSION,
  CONTRACT_VERSION,
  EVENT_SCHEMA_VERSION,
  PROOF_POLICY_VERSION,
  commandNameSchema,
  type TenantContext,
} from "@arena/contracts";
import {
  createEscalation,
  executeCommand,
  getEscalation,
  getTimeline,
  listEscalations,
  type InMemoryRuntime,
} from "@arena/application";
import { DEMO_AUTH_DISCLOSURE, deriveTenantContext, roleIsPresentationOnly } from "./auth.js";
import { errorResponseBody } from "./errors-mapping.js";

/**
 * Arena API edge（AR2-002，TL-direct 执行）。
 * 新的兄弟包 —— 绝不修改 packages/server（冻结决策 ar2-001-freeze.md §2.1）。
 * 组装：DEMO 认证适配器 + NON-DURABLE 进程内运行时（同一端口形状，
 * AR2-005 替换实现）。启动：
 *   node --experimental-strip-types packages/arena-api/src/main.ts
 * 或 tsx。默认端口 3901（ARENA_API_PORT 可覆盖）。
 */

export const API_DISCLOSURE =
  `${DEMO_AUTH_DISCLOSURE}; persistence is the NON-DURABLE in-memory runtime for this WO` as const;

export interface ArenaServerOptions {
  runtime: InMemoryRuntime;
}

export function createArenaServer(options: ArenaServerOptions): Server {
  const { runtime } = options;

  return createServer((request, response) => {
    void handle(request, response, runtime).catch((error: unknown) => {
      const mapped = errorResponseBody(error, "cor_serverfail", null);
      respondJson(response, mapped.status, mapped.body);
    });
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: InMemoryRuntime,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://arena.local");
  const path = url.pathname;
  const method = request.method ?? "GET";
  const requestId = firstHeader(request.headers["x-request-id"]);
  const correlationId = firstHeader(request.headers["x-correlation-id"]) ?? `cor_${randomHex()}`;

  // 健康与契约端点（无需认证）。
  if (method === "GET" && path === "/healthz") {
    return respondJson(response, 200, { status: "ok", process: "arena-api", pid: process.pid });
  }
  if (method === "GET" && path === "/readyz") {
    return respondJson(response, 200, {
      status: "ready",
      process: "arena-api",
      dependencies: {
        persistence: { mode: "in_memory_non_durable", ready: true },
        auth: { mode: "demo_registry", ready: true },
      },
    });
  }
  if (method === "GET" && path === "/v1/contract") {
    return respondJson(response, 200, {
      contract_version: CONTRACT_VERSION,
      corpus: CONTRACT_CORPUS_VERSION,
      proof_policy: PROOF_POLICY_VERSION,
      event_schema: EVENT_SCHEMA_VERSION,
      disclosures: [API_DISCLOSURE],
    });
  }

  // 认证（服务端推导租户上下文）。
  const tenant: TenantContext | null = deriveTenantContext(
    firstHeader(request.headers.authorization),
  );
  if (tenant === null) {
    const mapped = errorResponseBody(
      new Error("authentication required"),
      correlationId,
      requestId,
    );
    return respondJson(response, 401, mapped.body);
  }
  if (!roleIsPresentationOnly(tenant)) {
    return respondJson(response, 403, {
      code: "ARENA_AUTHORIZATION_DENIED",
      message: "invalid tenant context",
    });
  }

  if (method === "POST" && path === "/v1/escalations") {
    const body = await readBody(request);
    const digest = createHash("sha256").update(body).digest("hex");
    const outcome = await createEscalation(runtime, {
      request: safeJson(body),
      tenant,
      command: {
        request_id: requestId ?? `req_${randomHex()}`,
        idempotency_key:
          firstHeader(request.headers["x-idempotency-key"]) ?? `idem-${digest.slice(0, 24)}`,
        request_digest: digest,
        correlation_id: correlationId,
      },
    });
    if (outcome.kind === "REPLAY") {
      return respondJson(response, 200, { replayed: true, response: outcome.response });
    }
    return respondJson(response, 201, outcome);
  }

  const escalationMatch = /^\/v1\/escalations\/([^/]+)$/.exec(path);
  if (escalationMatch !== null && method === "GET") {
    const record = getEscalation(runtime, escalationMatch[1] ?? "", tenant.tenant_id);
    return respondJson(response, 200, {
      escalation_id: record.escalation_id,
      status: record.status,
      version: record.version,
      contract_version: record.contract_version,
      updated_at: record.updated_at,
    });
  }

  if (method === "GET" && path === "/v1/escalations") {
    return respondJson(response, 200, {
      items: listEscalations(runtime, tenant.tenant_id),
      tenant_scope: tenant.tenant_id,
    });
  }

  const timelineMatch = /^\/v1\/escalations\/([^/]+)\/timeline$/.exec(path);
  if (timelineMatch !== null && method === "GET") {
    return respondJson(response, 200, {
      events: getTimeline(runtime, timelineMatch[1] ?? "", tenant.tenant_id),
    });
  }

  const commandMatch = /^\/v1\/escalations\/([^/]+)\/commands\/([^/]+)$/.exec(path);
  if (commandMatch !== null && method === "POST") {
    const command = commandNameSchema.safeParse(commandMatch[2]);
    if (!command.success) {
      return respondJson(response, 404, {
        code: "ARENA_RESOURCE_NOT_FOUND",
        message: "unknown command",
        correlation_id: correlationId,
        request_id: requestId,
        details: null,
      });
    }
    const body = await readBody(request);
    const payload = safeJson(body);
    const facts = (
      payload !== null &&
      typeof payload === "object" &&
      "facts" in payload &&
      typeof (payload as { facts: unknown }).facts === "object"
        ? (payload as { facts: Record<string, boolean> }).facts
        : {}
    ) as Record<string, boolean>;
    // DEMO 守卫事实：生产接线中这些事实由匹配引擎/预算检查/capsule host 在服务端派生。
    const outcome = await executeCommand(runtime, {
      aggregate_type: "escalation",
      aggregate_id: commandMatch[1] ?? "",
      command: command.data,
      facts,
      actor: { type: tenant.role === "expert" ? "expert" : "requester", id: tenant.principal_id },
      tenant_id: tenant.tenant_id,
      request_id: requestId,
      correlation_id: correlationId,
    });
    return respondJson(response, 200, outcome);
  }

  return respondJson(response, 404, {
    code: "ARENA_RESOURCE_NOT_FOUND",
    message: "no such route",
    correlation_id: correlationId,
    request_id: requestId,
    details: null,
  });
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (chunks.reduce((sum, c) => sum + c.length, 0) > 5 * 1024 * 1024) {
        reject(new Error("body too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function safeJson(body: Buffer): unknown {
  if (body.length === 0) return {};
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    return { __invalid_json: body.toString("utf8").slice(0, 100) };
  }
}

function respondJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function randomHex(): string {
  return Math.random().toString(16).slice(2, 14).padEnd(12, "0");
}
