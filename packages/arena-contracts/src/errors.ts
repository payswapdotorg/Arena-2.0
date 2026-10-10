import { z } from "zod";
import { arenaIdSchema, nonEmptyMediumSchema } from "./common.js";

/**
 * A12 — API 错误目录：稳定类型化代码、HTTP 映射、可重试性、幂等语义。
 * 代码字符串是公共契约：只增不改（additive-only）；HTTP 状态映射可以按
 * 兼容性策略演进并记录。ARENA 前缀 + 下划线大写蛇形。
 */

export const arenaErrorCodeSchema = z.enum([
  "ARENA_VALIDATION_FAILED",
  "ARENA_UNKNOWN_FIELD",
  "ARENA_CONTRACT_VERSION_UNSUPPORTED",
  "ARENA_AUTHENTICATION_REQUIRED",
  "ARENA_AUTHORIZATION_DENIED",
  "ARENA_TENANT_MISMATCH",
  "ARENA_ESCALATION_NOT_FOUND",
  "ARENA_ATTEMPT_NOT_FOUND",
  "ARENA_RESOURCE_NOT_FOUND",
  "ARENA_IDEMPOTENCY_DIGEST_MISMATCH",
  "ARENA_IDEMPOTENCY_REPLAY",
  "ARENA_INVALID_TRANSITION",
  "ARENA_INVARIANT_VIOLATION",
  "ARENA_BUDGET_EXCEEDED",
  "ARENA_ATTEMPTS_EXHAUSTED",
  "ARENA_DEADLINE_EXCEEDED",
  "ARENA_PROOF_INCONCLUSIVE",
  "ARENA_EVIDENCE_REJECTED",
  "ARENA_EVIDENCE_STALE",
  "ARENA_PROOF_POLICY_VIOLATION",
  "ARENA_CAPSULE_MANIFEST_INVALID",
  "ARENA_CAPSULE_UNAVAILABLE",
  "ARENA_CAPSULE_TEARDOWN_FAILED",
  "ARENA_CLARIFICATION_REQUIRED",
  "ARENA_OFFER_EXPIRED",
  "ARENA_LEARNING_RIGHTS_MISSING",
  "ARENA_PROVIDER_TIMEOUT",
  "ARENA_PROVIDER_UNAVAILABLE",
  "ARENA_RATE_LIMITED",
  "ARENA_CONCURRENT_WRITE_CONFLICT",
  "ARENA_INTERNAL_ERROR",
]);

export type ArenaErrorCode = z.infer<typeof arenaErrorCodeSchema>;

export interface ErrorCatalogEntry {
  http_status: number;
  retryable: boolean;
  idempotent_replay_safe: boolean;
  description: string;
}

export const ARENA_ERROR_CATALOG: Record<ArenaErrorCode, ErrorCatalogEntry> = {
  ARENA_VALIDATION_FAILED: {
    http_status: 400,
    retryable: false,
    idempotent_replay_safe: true,
    description: "payload failed contract validation",
  },
  ARENA_UNKNOWN_FIELD: {
    http_status: 400,
    retryable: false,
    idempotent_replay_safe: true,
    description: "strict envelope rejected an unknown field",
  },
  ARENA_CONTRACT_VERSION_UNSUPPORTED: {
    http_status: 400,
    retryable: false,
    idempotent_replay_safe: true,
    description: "contract_version not supported by this server",
  },
  ARENA_AUTHENTICATION_REQUIRED: {
    http_status: 401,
    retryable: false,
    idempotent_replay_safe: true,
    description: "no or invalid credentials",
  },
  ARENA_AUTHORIZATION_DENIED: {
    http_status: 403,
    retryable: false,
    idempotent_replay_safe: true,
    description: "principal not authorized for this object/operation",
  },
  ARENA_TENANT_MISMATCH: {
    http_status: 403,
    retryable: false,
    idempotent_replay_safe: true,
    description: "object belongs to another tenant (fail closed)",
  },
  ARENA_ESCALATION_NOT_FOUND: {
    http_status: 404,
    retryable: false,
    idempotent_replay_safe: true,
    description: "escalation id not visible in tenant scope",
  },
  ARENA_ATTEMPT_NOT_FOUND: {
    http_status: 404,
    retryable: false,
    idempotent_replay_safe: true,
    description: "attempt id not visible in tenant scope",
  },
  ARENA_RESOURCE_NOT_FOUND: {
    http_status: 404,
    retryable: false,
    idempotent_replay_safe: true,
    description: "referenced resource not visible in tenant scope",
  },
  ARENA_IDEMPOTENCY_DIGEST_MISMATCH: {
    http_status: 409,
    retryable: false,
    idempotent_replay_safe: true,
    description: "same idempotency key with a different request digest",
  },
  ARENA_IDEMPOTENCY_REPLAY: {
    http_status: 200,
    retryable: false,
    idempotent_replay_safe: true,
    description: "stored outcome replayed for same key+digest",
  },
  ARENA_INVALID_TRANSITION: {
    http_status: 409,
    retryable: false,
    idempotent_replay_safe: true,
    description: "command not valid in the current state",
  },
  ARENA_INVARIANT_VIOLATION: {
    http_status: 409,
    retryable: false,
    idempotent_replay_safe: true,
    description: "transition guard failed (ES2.0 §6 invariant)",
  },
  ARENA_BUDGET_EXCEEDED: {
    http_status: 409,
    retryable: false,
    idempotent_replay_safe: true,
    description: "aggregate or per-attempt budget exhausted",
  },
  ARENA_ATTEMPTS_EXHAUSTED: {
    http_status: 409,
    retryable: false,
    idempotent_replay_safe: true,
    description: "authorized attempt count exhausted",
  },
  ARENA_DEADLINE_EXCEEDED: {
    http_status: 410,
    retryable: false,
    idempotent_replay_safe: true,
    description: "escalation deadline passed",
  },
  ARENA_PROOF_INCONCLUSIVE: {
    http_status: 422,
    retryable: true,
    idempotent_replay_safe: true,
    description: "evidence inconclusive; retry within budget or route onward",
  },
  ARENA_EVIDENCE_REJECTED: {
    http_status: 422,
    retryable: false,
    idempotent_replay_safe: true,
    description: "evidence failed provenance/binding/replay checks",
  },
  ARENA_EVIDENCE_STALE: {
    http_status: 422,
    retryable: false,
    idempotent_replay_safe: true,
    description: "evidence timestamp outside acceptance window",
  },
  ARENA_PROOF_POLICY_VIOLATION: {
    http_status: 422,
    retryable: false,
    idempotent_replay_safe: true,
    description: "payout gate attempted without policy satisfaction",
  },
  ARENA_CAPSULE_MANIFEST_INVALID: {
    http_status: 422,
    retryable: false,
    idempotent_replay_safe: true,
    description: "capsule manifest failed fail-closed validation",
  },
  ARENA_CAPSULE_UNAVAILABLE: {
    http_status: 503,
    retryable: true,
    idempotent_replay_safe: false,
    description: "capsule host unavailable; retry may re-provision",
  },
  ARENA_CAPSULE_TEARDOWN_FAILED: {
    http_status: 500,
    retryable: true,
    idempotent_replay_safe: false,
    description: "teardown incomplete; drift detection required",
  },
  ARENA_CLARIFICATION_REQUIRED: {
    http_status: 409,
    retryable: false,
    idempotent_replay_safe: true,
    description: "escalation awaiting requester clarification",
  },
  ARENA_OFFER_EXPIRED: {
    http_status: 410,
    retryable: false,
    idempotent_replay_safe: true,
    description: "expert offer expired before acceptance",
  },
  ARENA_LEARNING_RIGHTS_MISSING: {
    http_status: 422,
    retryable: false,
    idempotent_replay_safe: true,
    description: "learning publication blocked on rights/provenance/consent",
  },
  ARENA_PROVIDER_TIMEOUT: {
    http_status: 504,
    retryable: true,
    idempotent_replay_safe: false,
    description: "external provider timeout; reconcile by operation id before retry",
  },
  ARENA_PROVIDER_UNAVAILABLE: {
    http_status: 503,
    retryable: true,
    idempotent_replay_safe: false,
    description: "external provider unavailable",
  },
  ARENA_RATE_LIMITED: {
    http_status: 429,
    retryable: true,
    idempotent_replay_safe: true,
    description: "client rate limit exceeded",
  },
  ARENA_CONCURRENT_WRITE_CONFLICT: {
    http_status: 409,
    retryable: true,
    idempotent_replay_safe: true,
    description: "optimistic concurrency conflict; re-read and retry",
  },
  ARENA_INTERNAL_ERROR: {
    http_status: 500,
    retryable: true,
    idempotent_replay_safe: false,
    description: "unclassified server error",
  },
};

export const arenaErrorEnvelopeSchema = z
  .object({
    code: arenaErrorCodeSchema,
    message: nonEmptyMediumSchema,
    correlation_id: arenaIdSchema,
    request_id: arenaIdSchema.nullable(),
    details: z.unknown().nullable(),
  })
  .strict();

export type ArenaErrorEnvelope = z.infer<typeof arenaErrorEnvelopeSchema>;

/** 错误目录稳定性规则。 */
export const ERROR_CATALOG_STABILITY_RULE =
  "error codes are part of the public contract: additive-only within CF1.0; HTTP mappings and retryability " +
  "may evolve only through the recorded compatibility policy";

export function httpStatusFor(code: ArenaErrorCode): number {
  return ARENA_ERROR_CATALOG[code].http_status;
}

export function isRetryable(code: ArenaErrorCode): boolean {
  return ARENA_ERROR_CATALOG[code].retryable;
}

export function isIdempotentReplaySafe(code: ArenaErrorCode): boolean {
  return ARENA_ERROR_CATALOG[code].idempotent_replay_safe;
}
