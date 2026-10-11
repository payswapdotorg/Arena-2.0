import { createHash } from "node:crypto";
import {
  escalationRequestSchema,
  commandNameSchema,
  type ArenaErrorEnvelope,
  type EscalationRequest,
  type TransitionCommand,
} from "@arena/contracts";

/**
 * AR2-011 — typed SDK 公共客户端（issue #13）。
 *
 * 纪律（write fence：adapter only，no alternate domain logic）：
 * - 只做传输适配：每个操作 1:1 映射 arena-api 边缘端点；服务端保持唯一
 *   权威（校验/状态机/租户推导都在服务端 —— 本客户端绝不本地裁决域语义）。
 * - 出站门：submit 前用冻结 CF1.0 zod（escalationRequestSchema）镜像校验，
 *   快速失败（服务端校验仍是权威 —— 两层校验同一契约，无第二套语义）。
 * - 入站：非 2xx 全部解析为 typed 错误信封（legible failures），绝不吞错。
 * - 认证：Bearer token；租户上下文只由服务端推导 —— SDK 请求路径上
 *   永不出现 tenant/lens/role（ROLE_IS_NOT_AUTHORIZATION_RULE）。
 * - 幂等：caller_idempotency_key → x-idempotency-key；同键同摘要 →
 *   REPLAYED；同键异摘要 → 类型化 CONFLICT（绝不二次提交）。
 */

export interface SdkCredentials {
  bearerToken: string;
}

export interface SdkErrorEnvelope extends ArenaErrorEnvelope {}

export interface SdkFieldIssue {
  field: string;
  rule: string;
}

export type SdkSubmitOutcome =
  | { kind: "CREATED"; escalation_id: string; status: string; version: number }
  | { kind: "REPLAYED"; escalation_id: string; status: string; version: number }
  | { kind: "REJECTED"; issues: readonly SdkFieldIssue[]; envelope: SdkErrorEnvelope | null }
  | { kind: "CONFLICT"; envelope: SdkErrorEnvelope }
  | { kind: "UNAUTHENTICATED" }
  | { kind: "TRANSPORT_ERROR"; message: string };

export interface SdkEscalationProjection {
  escalation_id: string;
  status: string;
  version: number;
  contract_version: string;
  updated_at: string;
}

export type SdkLookupOutcome =
  | { kind: "FOUND"; projection: SdkEscalationProjection }
  | { kind: "NOT_FOUND"; envelope: SdkErrorEnvelope }
  | { kind: "UNAUTHENTICATED" }
  | { kind: "TRANSPORT_ERROR"; message: string };

export interface SdkTimelineEvent {
  event_type: string;
  occurred_at: string;
  actor: string;
}

export type SdkTimelineOutcome =
  | { kind: "FOUND"; events: readonly SdkTimelineEvent[] }
  | { kind: "NOT_FOUND"; envelope: SdkErrorEnvelope }
  | { kind: "UNAUTHENTICATED" }
  | { kind: "TRANSPORT_ERROR"; message: string };

export type SdkCommandOutcome =
  | { kind: "ACCEPTED"; aggregate_id: string; from: string; to: string; version: number }
  | { kind: "INVALID_TRANSITION"; envelope: SdkErrorEnvelope }
  | { kind: "INVARIANT_VIOLATION"; envelope: SdkErrorEnvelope; failed_guards: readonly string[] }
  | { kind: "NOT_FOUND"; envelope: SdkErrorEnvelope }
  | { kind: "UNKNOWN_COMMAND" }
  | { kind: "UNAUTHENTICATED" }
  | { kind: "TRANSPORT_ERROR"; message: string };

export interface ArenaSdkClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export class ArenaSdkClient {
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  constructor(options: ArenaSdkClientOptions) {
    this.base = options.baseUrl.replace(/\/$/, "");
    this.doFetch = options.fetchImpl ?? fetch;
  }

  /** 组合根就绪面（无需认证；SDK quickstart 第一步）。 */
  async readiness(): Promise<{
    status: string;
    dependencies: { persistence: { mode: string; ready: boolean } };
  } | null> {
    const response = await this.raw("GET", "/readyz");
    if (response === null) return null;
    return (await response.json()) as {
      status: string;
      dependencies: { persistence: { mode: string; ready: boolean } };
    };
  }

  /** 提交升级请求（CF1.0 镜像预检 → 服务端权威校验）。 */
  async submitEscalation(
    request: EscalationRequest,
    auth: SdkCredentials,
  ): Promise<SdkSubmitOutcome> {
    const parsed = escalationRequestSchema.safeParse(request);
    if (!parsed.success) {
      return {
        kind: "REJECTED",
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
          rule: issue.message,
        })),
        envelope: null,
      };
    }
    const response = await this.raw("POST", "/v1/escalations", JSON.stringify(parsed.data), {
      "content-type": "application/json",
      authorization: `Bearer ${auth.bearerToken}`,
      "x-idempotency-key": parsed.data.caller_idempotency_key,
    });
    if (response === null) return { kind: "TRANSPORT_ERROR", message: "network failure" };
    if (response.status === 401) return { kind: "UNAUTHENTICATED" };
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.status === 201) {
      return projectionOf(body, "CREATED");
    }
    if (response.status === 200 && body.replayed === true) {
      return projectionOf((body.response ?? {}) as Record<string, unknown>, "REPLAYED");
    }
    if (response.status === 409) {
      return { kind: "CONFLICT", envelope: asEnvelope(body) };
    }
    if (response.status === 400 || response.status === 422) {
      return {
        kind: "REJECTED",
        issues: issuesFromDetails(body.details),
        envelope: asEnvelope(body),
      };
    }
    return {
      kind: "REJECTED",
      issues: [
        {
          field: "(response)",
          rule: `${String(body.code ?? "unknown")}: ${String(body.message ?? "")}`,
        },
      ],
      envelope: asEnvelope(body),
    };
  }

  async getEscalation(escalation_id: string, auth: SdkCredentials): Promise<SdkLookupOutcome> {
    const response = await this.raw(
      "GET",
      `/v1/escalations/${encodeURIComponent(escalation_id)}`,
      undefined,
      { authorization: `Bearer ${auth.bearerToken}` },
    );
    if (response === null) return { kind: "TRANSPORT_ERROR", message: "network failure" };
    if (response.status === 401) return { kind: "UNAUTHENTICATED" };
    if (response.status === 404) {
      return { kind: "NOT_FOUND", envelope: await envelopeOf(response) };
    }
    const body = (await response.json()) as Record<string, unknown>;
    return {
      kind: "FOUND",
      projection: {
        escalation_id: String(body.escalation_id),
        status: String(body.status),
        version: Number(body.version),
        contract_version: String(body.contract_version),
        updated_at: String(body.updated_at),
      },
    };
  }

  async listEscalations(
    auth: SdkCredentials,
  ): Promise<{ items: readonly SdkEscalationProjection[]; tenant_scope: string } | null> {
    const response = await this.raw("GET", "/v1/escalations", undefined, {
      authorization: `Bearer ${auth.bearerToken}`,
    });
    if (response === null || response.status === 401) return null;
    const body = (await response.json()) as { items?: unknown[]; tenant_scope?: string };
    return {
      items: (body.items ?? []) as readonly SdkEscalationProjection[],
      tenant_scope: body.tenant_scope ?? "",
    };
  }

  async getTimeline(escalation_id: string, auth: SdkCredentials): Promise<SdkTimelineOutcome> {
    const response = await this.raw(
      "GET",
      `/v1/escalations/${encodeURIComponent(escalation_id)}/timeline`,
      undefined,
      { authorization: `Bearer ${auth.bearerToken}` },
    );
    if (response === null) return { kind: "TRANSPORT_ERROR", message: "network failure" };
    if (response.status === 401) return { kind: "UNAUTHENTICATED" };
    if (response.status === 404) {
      return { kind: "NOT_FOUND", envelope: await envelopeOf(response) };
    }
    const body = (await response.json()) as { events?: SdkTimelineEvent[] };
    return { kind: "FOUND", events: body.events ?? [] };
  }

  /** 状态机命令（唯一的服务端生命周期推进通道）。 */
  async escalationCommand(
    escalation_id: string,
    command: TransitionCommand,
    facts: Record<string, boolean>,
    auth: SdkCredentials,
  ): Promise<SdkCommandOutcome> {
    const parsed = commandNameSchema.safeParse(command);
    if (!parsed.success) return { kind: "UNKNOWN_COMMAND" };
    const response = await this.raw(
      "POST",
      `/v1/escalations/${encodeURIComponent(escalation_id)}/commands/${parsed.data}`,
      JSON.stringify({ facts }),
      {
        "content-type": "application/json",
        authorization: `Bearer ${auth.bearerToken}`,
      },
    );
    if (response === null) return { kind: "TRANSPORT_ERROR", message: "network failure" };
    if (response.status === 401) return { kind: "UNAUTHENTICATED" };
    if (response.status === 404) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      return String(body.message ?? "") === "unknown command"
        ? { kind: "UNKNOWN_COMMAND" }
        : { kind: "NOT_FOUND", envelope: asEnvelope(body) };
    }
    if (response.status === 409) {
      const envelope = await envelopeOf(response);
      if (envelope.code === "ARENA_INVARIANT_VIOLATION") {
        return { kind: "INVARIANT_VIOLATION", envelope, failed_guards: failedGuards(envelope) };
      }
      return { kind: "INVALID_TRANSITION", envelope };
    }
    if (response.status === 200) {
      const body = (await response.json()) as Record<string, unknown>;
      return {
        kind: "ACCEPTED",
        aggregate_id: String(body.aggregate_id),
        from: String(body.from),
        to: String(body.to),
        version: Number(body.version),
      };
    }
    return { kind: "TRANSPORT_ERROR", message: `unexpected status ${response.status}` };
  }

  private async raw(
    method: string,
    path: string,
    body?: string,
    headers: Record<string, string> = {},
  ): Promise<Response | null> {
    try {
      return await this.doFetch(this.base + path, { method, headers, body });
    } catch {
      return null;
    }
  }
}

/** SDK quickstart 的三步报告（readiness → submit → 服务端投影）。 */
export interface QuickstartReport {
  readiness: {
    status: string;
    dependencies: { persistence: { mode: string; ready: boolean } };
  } | null;
  submit: SdkSubmitOutcome;
  projection: SdkLookupOutcome;
}

/** SDK quickstart：readyz → 提交（幂等键来自信封）→ 读回服务端投影。 */
export async function sdkQuickstart(
  options: ArenaSdkClientOptions,
  request: EscalationRequest,
  auth: SdkCredentials,
): Promise<QuickstartReport> {
  const client = new ArenaSdkClient(options);
  const readiness = await client.readiness();
  const submit = await client.submitEscalation(request, auth);
  const escalationId =
    submit.kind === "CREATED" || submit.kind === "REPLAYED" ? submit.escalation_id : null;
  const projection: SdkLookupOutcome =
    escalationId === null
      ? { kind: "TRANSPORT_ERROR", message: "submit did not produce an escalation id" }
      : await client.getEscalation(escalationId, auth);
  return { readiness, submit, projection };
}

/** 请求摘要（信封规范子集的 sha256 —— 与服务端 idempotency 摘要独立）。 */
export function canonicalRequestDigest(request: EscalationRequest): string {
  const payload = JSON.stringify({
    task: request.task,
    task_type: request.task_type,
    acceptance_criteria: request.acceptance_criteria,
    constraints: request.constraints,
    budget: request.budget,
  });
  return createHash("sha256").update(payload).digest("hex");
}

function projectionOf(
  body: Record<string, unknown>,
  kind: "CREATED" | "REPLAYED",
): SdkSubmitOutcome {
  return {
    kind,
    escalation_id: String(body.escalation_id),
    status: String(body.status),
    version: Number(body.version),
  };
}

async function envelopeOf(response: Response): Promise<SdkErrorEnvelope> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return asEnvelope(body);
}

function asEnvelope(body: Record<string, unknown>): SdkErrorEnvelope {
  return {
    code: String(body.code ?? "ARENA_INTERNAL_ERROR") as SdkErrorEnvelope["code"],
    message: String(body.message ?? ""),
    correlation_id: String(body.correlation_id ?? ""),
    request_id:
      body.request_id === null || body.request_id === undefined ? null : String(body.request_id),
    details: (body.details ?? null) as SdkErrorEnvelope["details"],
  };
}

function issuesFromDetails(details: unknown): SdkFieldIssue[] {
  if (!Array.isArray(details)) return [];
  const issues: SdkFieldIssue[] = [];
  for (const item of details) {
    if (typeof item !== "object" || item === null) continue;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.field === "string" && typeof candidate.rule === "string") {
      issues.push({ field: candidate.field, rule: candidate.rule });
    } else if (Array.isArray(candidate.path)) {
      issues.push({
        field: candidate.path.length > 0 ? candidate.path.map(String).join(".") : "(root)",
        rule: `${String(candidate.code ?? "invalid")}${candidate.message ? ` — ${String(candidate.message)}` : ""}`,
      });
    }
  }
  return issues;
}

function failedGuards(envelope: SdkErrorEnvelope): readonly string[] {
  const details = envelope.details;
  if (details !== null && typeof details === "object" && "failed_guards" in details) {
    const guards = (details as { failed_guards: unknown }).failed_guards;
    if (Array.isArray(guards)) return guards.map(String);
  }
  return [];
}
