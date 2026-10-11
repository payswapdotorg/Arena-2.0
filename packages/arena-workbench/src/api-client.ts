import type { ArenaErrorEnvelope, EscalationRequest } from "@arena/contracts";
import { commandNameSchema, type TransitionCommand } from "@arena/contracts";
import type { FieldError } from "./requester-form.js";

/**
 * AR2-006 — 真实 API 的 typed 公共客户端（issue #8）。
 *
 * 契约纪律：
 * - 只消费服务端拥有的规范投影（status / version / timeline / typed 错误信封）；
 *   UI 侧绝不发明第二套生命周期状态（NO_UI_ONLY_LIFECYCLE）。
 * - 每个非 2xx 响应都解析为 ArenaErrorEnvelope（code/message/correlation_id/
 *   request_id/details）—— 类型化失败对 UI 可读（legible failures）。
 * - 认证 = Bearer token（服务端推导租户上下文）；lens/role 永不出现在
 *   请求路径上（ROLE_IS_NOT_AUTHORIZATION_RULE 的传输层形态）。
 * - 幂等：caller_idempotency_key 由调用方信封携带 → x-idempotency-key 头；
 *   同键同摘要 → REPLAYED（服务端 200 {replayed:true}）；同键异摘要 →
 *   类型化 409 冲突（fail-closed，绝不二次提交）。
 */

/** 认证材料（demo token —— 生产形态是凭据适配器，契约不变）。 */
export interface ApiCredentials {
  bearerToken: string;
}

export type SubmitApiOutcome =
  | { kind: "CREATED"; escalation_id: string; status: string; version: number }
  | { kind: "REPLAYED"; escalation_id: string; status: string; version: number }
  | { kind: "REJECTED"; fieldErrors: FieldError[] }
  | { kind: "CONFLICT"; message: string }
  | { kind: "UNAUTHENTICATED" }
  | { kind: "TRANSPORT_ERROR"; message: string };

export interface EscalationProjection {
  escalation_id: string;
  status: string;
  version: number;
  contract_version: string;
  updated_at: string;
}

export interface EscalationListItem {
  escalation_id: string;
  status: string;
  updated_at: string;
}

export type LookupApiOutcome =
  | { kind: "FOUND"; projection: EscalationProjection }
  | { kind: "NOT_FOUND"; envelope: ArenaErrorEnvelope }
  | { kind: "UNAUTHENTICATED" }
  | { kind: "TRANSPORT_ERROR"; message: string };

export interface TimelineEvent {
  event_type: string;
  occurred_at: string;
  actor: string;
}

export type TimelineOutcome =
  | { kind: "FOUND"; events: readonly TimelineEvent[] }
  | { kind: "NOT_FOUND"; envelope: ArenaErrorEnvelope }
  | { kind: "UNAUTHENTICATED" }
  | { kind: "TRANSPORT_ERROR"; message: string };

/** 结果视图（服务端 typed stub：legible「尚未落地」而非空白）。 */
export type ResultViewOutcome =
  | { kind: "NOT_AVAILABLE"; envelope: ArenaErrorEnvelope; disclosure: string }
  | { kind: "NOT_FOUND"; envelope: ArenaErrorEnvelope }
  | { kind: "UNAUTHENTICATED" }
  | { kind: "TRANSPORT_ERROR"; message: string };

export type CommandApiOutcome =
  | { kind: "ACCEPTED"; aggregate_id: string; from: string; to: string; version: number }
  | { kind: "INVALID_TRANSITION"; envelope: ArenaErrorEnvelope }
  | { kind: "INVARIANT_VIOLATION"; envelope: ArenaErrorEnvelope; failed_guards: readonly string[] }
  | { kind: "NOT_FOUND"; envelope: ArenaErrorEnvelope }
  | { kind: "UNKNOWN_COMMAND" }
  | { kind: "UNAUTHENTICATED" }
  | { kind: "TRANSPORT_ERROR"; message: string };

export interface ArenaApiClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export class ArenaApiClient {
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  constructor(options: ArenaApiClientOptions) {
    this.base = options.baseUrl.replace(/\/$/, "");
    this.doFetch = options.fetchImpl ?? fetch;
  }

  /** 组合根就绪面（无需认证）。 */
  async readiness(): Promise<{
    status: string;
    persistence: { mode: string; ready: boolean };
  } | null> {
    const response = await this.raw("GET", "/readyz");
    if (response === null) return null;
    return (await response.json()) as {
      status: string;
      persistence: { mode: string; ready: boolean };
    };
  }

  /** 提交升级请求（信封携带 caller_idempotency_key —— 幂等键的来源）。 */
  async submitEscalation(
    request: EscalationRequest,
    auth: ApiCredentials,
  ): Promise<SubmitApiOutcome> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${auth.bearerToken}`,
      "x-idempotency-key": request.caller_idempotency_key,
    };
    const response = await this.raw("POST", "/v1/escalations", JSON.stringify(request), headers);
    if (response === null) return { kind: "TRANSPORT_ERROR", message: "network failure" };
    if (response.status === 401) return { kind: "UNAUTHENTICATED" };
    const body = (await response.json()) as Record<string, unknown>;
    if (response.status === 201) {
      return {
        kind: "CREATED",
        escalation_id: String(body.escalation_id),
        status: String(body.status),
        version: Number(body.version),
      };
    }
    if (response.status === 200 && body.replayed === true) {
      const inner = (body.response ?? {}) as Record<string, unknown>;
      return {
        kind: "REPLAYED",
        escalation_id: String(inner.escalation_id),
        status: String(inner.status),
        version: Number(inner.version),
      };
    }
    if (response.status === 409) {
      return { kind: "CONFLICT", message: String(body.message ?? "idempotency digest mismatch") };
    }
    if (response.status === 400 || response.status === 422) {
      return {
        kind: "REJECTED",
        fieldErrors: fieldErrorsFromDetails(body.details),
      };
    }
    return { kind: "REJECTED", fieldErrors: envelopeFallbackErrors(body) };
  }

  async listEscalations(auth: ApiCredentials): Promise<{
    items: readonly EscalationListItem[];
    tenant_scope: string;
  } | null> {
    const response = await this.raw("GET", "/v1/escalations", undefined, {
      authorization: `Bearer ${auth.bearerToken}`,
    });
    if (response === null || response.status === 401) return null;
    const body = (await response.json()) as { items?: EscalationListItem[]; tenant_scope?: string };
    return { items: body.items ?? [], tenant_scope: body.tenant_scope ?? "" };
  }

  async getEscalation(escalation_id: string, auth: ApiCredentials): Promise<LookupApiOutcome> {
    const response = await this.raw(
      "GET",
      `/v1/escalations/${encodeURIComponent(escalation_id)}`,
      undefined,
      { authorization: `Bearer ${auth.bearerToken}` },
    );
    return lookupOutcome(response);
  }

  async getTimeline(escalation_id: string, auth: ApiCredentials): Promise<TimelineOutcome> {
    const response = await this.raw(
      "GET",
      `/v1/escalations/${encodeURIComponent(escalation_id)}/timeline`,
      undefined,
      { authorization: `Bearer ${auth.bearerToken}` },
    );
    if (response === null) return { kind: "TRANSPORT_ERROR", message: "network failure" };
    if (response.status === 401) return { kind: "UNAUTHENTICATED" };
    if (response.status === 404) {
      return { kind: "NOT_FOUND", envelope: await errorEnvelope(response) };
    }
    const body = (await response.json()) as { events?: TimelineEvent[] };
    return { kind: "FOUND", events: body.events ?? [] };
  }

  async getResultView(escalation_id: string, auth: ApiCredentials): Promise<ResultViewOutcome> {
    const response = await this.raw(
      "GET",
      `/v1/escalations/${encodeURIComponent(escalation_id)}/result`,
      undefined,
      { authorization: `Bearer ${auth.bearerToken}` },
    );
    if (response === null) return { kind: "TRANSPORT_ERROR", message: "network failure" };
    if (response.status === 401) return { kind: "UNAUTHENTICATED" };
    if (response.status === 404) {
      const envelope = await errorEnvelope(response);
      const disclosure = typedDisclosure(envelope);
      return disclosure === null
        ? { kind: "NOT_FOUND", envelope }
        : { kind: "NOT_AVAILABLE", envelope, disclosure };
    }
    return { kind: "NOT_FOUND", envelope: await errorEnvelope(response) };
  }

  /** 状态机命令（唯一的服务端生命周期推进通道）。 */
  async escalationCommand(
    escalation_id: string,
    command: TransitionCommand,
    facts: Record<string, boolean>,
    auth: ApiCredentials,
  ): Promise<CommandApiOutcome> {
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
      const body = (await response.json()) as Record<string, unknown>;
      return String(body.message ?? "") === "unknown command"
        ? { kind: "UNKNOWN_COMMAND" }
        : { kind: "NOT_FOUND", envelope: asEnvelope(body) };
    }
    if (response.status === 409) {
      const envelope = await errorEnvelope(response);
      if (envelope.code === "ARENA_INVARIANT_VIOLATION") {
        const failed = failedGuards(envelope);
        return { kind: "INVARIANT_VIOLATION", envelope, failed_guards: failed };
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
      return await this.doFetch(this.base + path, {
        method,
        headers,
        body,
      });
    } catch {
      return null;
    }
  }
}

async function lookupOutcome(response: Response | null): Promise<LookupApiOutcome> {
  if (response === null) return { kind: "TRANSPORT_ERROR", message: "network failure" };
  if (response.status === 401) return { kind: "UNAUTHENTICATED" };
  if (response.status === 404)
    return { kind: "NOT_FOUND", envelope: await errorEnvelope(response) };
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

async function errorEnvelope(response: Response): Promise<ArenaErrorEnvelope> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return asEnvelope(body);
}

function asEnvelope(body: Record<string, unknown>): ArenaErrorEnvelope {
  return {
    code: String(body.code ?? "ARENA_INTERNAL_ERROR") as ArenaErrorEnvelope["code"],
    message: String(body.message ?? ""),
    correlation_id: String(body.correlation_id ?? ""),
    request_id:
      body.request_id === null || body.request_id === undefined ? null : String(body.request_id),
    details: (body.details ?? null) as ArenaErrorEnvelope["details"],
  };
}

/**
 * 服务端 details 的两种形态归一化为 FieldError：
 * - zod issue（结构校验）：{path: [...], code, message} → field = path.join(".");
 * - 语义 issue：{field, rule}（validate*Semantics 的返回形态）。
 */
function fieldErrorsFromDetails(details: unknown): FieldError[] {
  if (!Array.isArray(details)) return [];
  const errors: FieldError[] = [];
  for (const item of details) {
    if (typeof item !== "object" || item === null) continue;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.field === "string" && typeof candidate.rule === "string") {
      errors.push({ field: candidate.field, rule: candidate.rule });
    } else if (Array.isArray(candidate.path)) {
      errors.push({
        field: candidate.path.length > 0 ? candidate.path.map(String).join(".") : "(root)",
        rule: `${String(candidate.code ?? "invalid")}${candidate.message ? ` — ${String(candidate.message)}` : ""}`,
      });
    }
  }
  return errors;
}

function envelopeFallbackErrors(body: Record<string, unknown>): FieldError[] {
  return [
    {
      field: "(response)",
      rule: `${String(body.code ?? "unknown")}: ${String(body.message ?? "")}`,
    },
  ];
}

function failedGuards(envelope: ArenaErrorEnvelope): readonly string[] {
  const details = envelope.details;
  if (details !== null && typeof details === "object" && "failed_guards" in details) {
    const guards = (details as { failed_guards: unknown }).failed_guards;
    if (Array.isArray(guards)) return guards.map(String);
  }
  return [];
}

function typedDisclosure(envelope: ArenaErrorEnvelope): string | null {
  const details = envelope.details;
  if (details !== null && typeof details === "object" && "disclosure" in details) {
    return String((details as { disclosure: unknown }).disclosure);
  }
  return null;
}
