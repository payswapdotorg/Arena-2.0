import {
  CONTRACT_VERSION,
  EVENT_SCHEMA_VERSION,
  PROOF_POLICY_VERSION,
  escalationRequestSchema,
  tenantContextSchema,
  validateAcceptanceCriteriaSemantics,
  validateEscalationRequestSemantics,
  validateProofPolicySemantics,
  validateTenantContextSemantics,
  type EscalationRequest,
  type EventEnvelope,
} from "@arena/contracts";
import type { InMemoryRuntime } from "./inmemory-runtime.js";

/**
 * CreateEscalation 用例：信任边界之后的完整校验（结构 + 语义）、
 * 幂等预留/重放/冲突、聚合创建与 EscalationCreated 事件（同事务 outbox）。
 * 租户永远来自认证上下文，绝不来自请求体。
 */

export type CreateEscalationOutcome =
  | { kind: "CREATED"; escalation_id: string; status: string; version: number }
  | { kind: "REPLAY"; response: unknown }
  | { kind: "CONFLICT" };

export interface CreateEscalationInput {
  request: unknown;
  tenant: unknown;
  command: {
    request_id: string;
    idempotency_key: string;
    request_digest: string;
    correlation_id: string;
  };
}

export interface EscalationRecord {
  escalation_id: string;
  tenant_id: string;
  status: string;
  version: number;
  contract_version: string;
  request: EscalationRequest;
  created_at: string;
  updated_at: string;
  timeline: Array<{ event_type: string; occurred_at: string; actor: string }>;
}

export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export async function createEscalation(
  runtime: InMemoryRuntime,
  input: CreateEscalationInput,
  now: () => string = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
): Promise<CreateEscalationOutcome> {
  // 1) 认证上下文先行：租户永远来自服务端推导，绝不来自请求体。
  const tenant = tenantContextSchema.safeParse(input.tenant);
  if (!tenant.success) {
    throw new DomainError(
      "ARENA_AUTHENTICATION_REQUIRED",
      401,
      "tenant context failed contract validation",
      tenant.error.issues,
    );
  }
  const tenantIssues = validateTenantContextSemantics(tenant.data);
  if (tenantIssues.length > 0) {
    throw new DomainError(
      "ARENA_AUTHORIZATION_DENIED",
      403,
      "tenant context semantics failed",
      tenantIssues,
    );
  }

  // 2) 幂等：同键同摘要重放，同键异摘要类型化冲突。
  const reservation = await runtime.idempotency.reserve({
    idempotency_key: input.command.idempotency_key,
    request_digest: input.command.request_digest,
    command: "CreateEscalation",
    tenant_id: tenant.data.tenant_id,
  });
  if (reservation.kind === "REPLAY") {
    return {
      kind: "REPLAY",
      response: runtime.readIdempotentResponse(
        tenant.data.tenant_id,
        input.command.idempotency_key,
      ),
    };
  }
  if (reservation.kind === "CONFLICT") {
    throw new DomainError(
      "ARENA_IDEMPOTENCY_DIGEST_MISMATCH",
      409,
      "same idempotency key with a different request digest",
    );
  }

  // 3) 信任边界校验：结构（strict zod）→ 语义。
  const request = escalationRequestSchema.safeParse(input.request);
  if (!request.success) {
    const unknownField = request.error.issues.find((issue) => issue.code === "unrecognized_keys");
    if (unknownField !== undefined) {
      throw new DomainError(
        "ARENA_UNKNOWN_FIELD",
        400,
        "strict envelope rejected an unknown field (tenant is never caller input)",
        request.error.issues,
      );
    }
    throw new DomainError(
      "ARENA_VALIDATION_FAILED",
      400,
      "escalation request failed contract validation",
      request.error.issues,
    );
  }
  const requestIssues = [
    ...validateEscalationRequestSemantics(request.data),
    ...validateAcceptanceCriteriaSemantics(request.data.acceptance_criteria),
    ...validateProofPolicySemantics(request.data.proof_policy, request.data.acceptance_criteria),
  ];
  if (requestIssues.length > 0) {
    throw new DomainError(
      "ARENA_VALIDATION_FAILED",
      400,
      "escalation request failed semantic validation",
      requestIssues,
    );
  }

  // 3) 聚合创建 + 事件（同「事务」）。
  const escalationId = `esc_${randomId()}`;
  const timestamp = now();
  const record: EscalationRecord = {
    escalation_id: escalationId,
    tenant_id: tenant.data.tenant_id,
    status: "CREATED",
    version: 0,
    contract_version: CONTRACT_VERSION,
    request: request.data,
    created_at: timestamp,
    updated_at: timestamp,
    timeline: [
      {
        event_type: "EscalationCreated",
        occurred_at: timestamp,
        actor: `requester:${tenant.data.principal_id}`,
      },
    ],
  };
  const event: EventEnvelope = {
    event_id: `evt_${randomId()}`,
    schema_version: EVENT_SCHEMA_VERSION,
    tenant_id: tenant.data.tenant_id,
    aggregate: { type: "escalation", id: escalationId, version: 1 },
    event_type: "EscalationCreated",
    occurred_at: timestamp,
    recorded_at: timestamp,
    actor: { type: "requester", id: tenant.data.principal_id },
    correlation_id: input.command.correlation_id,
    causation_id: null,
    request_id: input.command.request_id,
    policy_version: PROOF_POLICY_VERSION,
    payload: { schema_id: "sch_escalationrecord1", redaction_class: "tenant" },
    immutable: true,
    correction: null,
  };
  await runtime.aggregates.saveAggregate({
    ref: { aggregate_type: "escalation", aggregate_id: escalationId, expected_version: 0 },
    record,
    events: [event],
    recorded_at: timestamp,
  });

  // 4) 幂等完成（摘要 + 响应体）。
  const response: { kind: "CREATED"; escalation_id: string; status: string; version: number } = {
    kind: "CREATED",
    escalation_id: escalationId,
    status: "CREATED",
    version: 1,
  };
  await runtime.idempotency.complete({
    idempotency_key: input.command.idempotency_key,
    response_digest: input.command.request_digest,
    completed_at: timestamp,
  });
  runtime.storeResponse(tenant.data.tenant_id, input.command.idempotency_key, response);

  return response;
}

export function randomId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 12; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
