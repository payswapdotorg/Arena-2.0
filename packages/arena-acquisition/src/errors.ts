import { z } from "zod";
import { arenaIdSchema } from "@arena/contracts";
import { nonEmptyMedium } from "./primitives.js";

/**
 * AR2-016 — typed error catalog for the ACQ1.0 family (issue #32).
 *
 * House style: a stable, typed, exported error catalog (mirrors CF1.0
 * ARENA_ERROR_CATALOG discipline). The ACQ_* code space is a NEW family —
 * CF1.0's ARENA_* catalog is frozen and is never edited or extended here.
 * Codes are additive-only within ACQ1.0; HTTP mappings may evolve only through
 * the recorded compatibility policy.
 */

export const acqErrorCodeSchema = z.enum([
  // trust-boundary shape errors (runtime validation is mandatory)
  "ACQ_VALIDATION_FAILED",
  "ACQ_UNKNOWN_FIELD",
  "ACQ_SCHEMA_VERSION_UNSUPPORTED",
  "ACQ_REPRO_CASE_MISSING",
  // identity and isolation (fail closed, no existence oracle)
  "ACQ_TENANT_CONTEXT_INVALID",
  "ACQ_TENANT_MISMATCH",
  "ACQ_PROVIDER_NOT_FOUND",
  // idempotency (same key + same digest => replay; different digest => conflict)
  "ACQ_IDEMPOTENCY_DIGEST_MISMATCH",
  "ACQ_IDEMPOTENCY_REPLAY",
  // typed routing outcomes — never a silent fallback or silent human escalation
  "ACQ_ROUTE_BLOCKED",
  "ACQ_ROUTE_INCONCLUSIVE",
  "ACQ_PINNED_PROVIDER_UNAVAILABLE",
  "ACQ_NO_ELIGIBLE_PROVIDER",
  "ACQ_FALLBACK_NOT_PERMITTED",
  "ACQ_BUDGET_EXCEEDED",
  "ACQ_DEADLINE_EXCEEDED",
  "ACQ_ATTEMPT_LIMIT_EXCEEDED",
  "ACQ_QUOTA_EXHAUSTED",
  "ACQ_SOURCE_RIGHTS_DENIED",
  "ACQ_REGION_NOT_COVERED",
  "ACQ_SCHEMA_MISMATCH",
  "ACQ_RISK_TIER_DISALLOWS",
  "ACQ_PROVIDER_STATUS_DISALLOWS",
  "ACQ_TENANT_NOT_AUTHORIZED",
  "ACQ_USE_NOT_PERMITTED",
  "ACQ_CAPABILITY_MISMATCH",
  "ACQ_COMPOSITE_PLAN_NOT_PERMITTED",
  "ACQ_INTERNAL_ERROR",
]);

export type AcqErrorCode = z.infer<typeof acqErrorCodeSchema>;

export interface AcqErrorCatalogEntry {
  http_status: number;
  retryable: boolean;
  description: string;
}

export const ACQ_ERROR_CATALOG: Record<AcqErrorCode, AcqErrorCatalogEntry> = {
  ACQ_VALIDATION_FAILED: {
    http_status: 400,
    retryable: false,
    description: "payload failed ACQ1.0 contract validation",
  },
  ACQ_UNKNOWN_FIELD: {
    http_status: 400,
    retryable: false,
    description: "strict envelope rejected an unknown field",
  },
  ACQ_SCHEMA_VERSION_UNSUPPORTED: {
    http_status: 400,
    retryable: false,
    description: "schema_version not supported by this server",
  },
  ACQ_REPRO_CASE_MISSING: {
    http_status: 400,
    retryable: false,
    description: "gap report is missing the minimal reproducible failure/evaluation case",
  },
  ACQ_TENANT_CONTEXT_INVALID: {
    http_status: 401,
    retryable: false,
    description: "server-derived tenant context failed validation",
  },
  ACQ_TENANT_MISMATCH: {
    http_status: 403,
    retryable: false,
    description:
      "request claims a different application than the authenticated principal (fail closed)",
  },
  ACQ_PROVIDER_NOT_FOUND: {
    http_status: 404,
    retryable: false,
    description: "provider not visible in tenant scope",
  },
  ACQ_IDEMPOTENCY_DIGEST_MISMATCH: {
    http_status: 409,
    retryable: false,
    description: "same idempotency key with a different request digest",
  },
  ACQ_IDEMPOTENCY_REPLAY: {
    http_status: 200,
    retryable: false,
    description: "stored outcome replayed for same key+digest",
  },
  ACQ_ROUTE_BLOCKED: {
    http_status: 403,
    retryable: false,
    description: "routing blocked by policy; explanation is in the decision record",
  },
  ACQ_ROUTE_INCONCLUSIVE: {
    http_status: 422,
    retryable: true,
    description:
      "no route could be decided within budget/quota/deadline; explanation is in the decision record",
  },
  ACQ_PINNED_PROVIDER_UNAVAILABLE: {
    http_status: 404,
    retryable: true,
    description: "pinned provider unavailable or not visible in tenant scope",
  },
  ACQ_NO_ELIGIBLE_PROVIDER: {
    http_status: 404,
    retryable: true,
    description: "no tenant-authorized provider is registered for this capability",
  },
  ACQ_FALLBACK_NOT_PERMITTED: {
    http_status: 403,
    retryable: false,
    description: "pinned route failed and the request policy does not permit fallback",
  },
  ACQ_BUDGET_EXCEEDED: {
    http_status: 409,
    retryable: false,
    description: "estimated plan cost exceeds the remaining budget ceiling",
  },
  ACQ_DEADLINE_EXCEEDED: {
    http_status: 410,
    retryable: false,
    description: "estimated plan latency would pass the request deadline",
  },
  ACQ_ATTEMPT_LIMIT_EXCEEDED: {
    http_status: 409,
    retryable: false,
    description: "authorized attempt limit already exhausted",
  },
  ACQ_QUOTA_EXHAUSTED: {
    http_status: 429,
    retryable: true,
    description: "provider quota exhausted",
  },
  ACQ_SOURCE_RIGHTS_DENIED: {
    http_status: 422,
    retryable: false,
    description: "provider source-rights posture disallows this request (fail closed)",
  },
  ACQ_REGION_NOT_COVERED: {
    http_status: 422,
    retryable: false,
    description: "provider does not cover a required region",
  },
  ACQ_SCHEMA_MISMATCH: {
    http_status: 422,
    retryable: false,
    description: "provider output schema incompatible with the desired output schema",
  },
  ACQ_RISK_TIER_DISALLOWS: {
    http_status: 422,
    retryable: false,
    description: "request risk tier exceeds the provider's declared appetite",
  },
  ACQ_PROVIDER_STATUS_DISALLOWS: {
    http_status: 503,
    retryable: true,
    description: "provider status is not ACTIVE",
  },
  ACQ_TENANT_NOT_AUTHORIZED: {
    http_status: 403,
    retryable: false,
    description: "tenant lacks an entitlement the provider requires",
  },
  ACQ_USE_NOT_PERMITTED: {
    http_status: 422,
    retryable: false,
    description: "intended use is not within the provider's allowed use",
  },
  ACQ_CAPABILITY_MISMATCH: {
    http_status: 422,
    retryable: false,
    description: "provider does not satisfy the requested capability at the required level",
  },
  ACQ_COMPOSITE_PLAN_NOT_PERMITTED: {
    http_status: 422,
    retryable: false,
    description: "composite plans are not permitted by the request policy",
  },
  ACQ_INTERNAL_ERROR: {
    http_status: 500,
    retryable: true,
    description: "unclassified acquisition error",
  },
};

/** Error-envelope code stability rule (ACQ1.0 family counterpart of CF1.0's). */
export const ACQ_ERROR_CATALOG_STABILITY_RULE =
  "ACQ_* error codes are part of the ACQ1.0 public contract: additive-only within the family; " +
  "HTTP mappings and retryability may evolve only through the recorded compatibility policy; " +
  "the frozen CF1.0 ARENA_* catalog is never edited from this package";

export const acqErrorEnvelopeSchema = z
  .object({
    code: acqErrorCodeSchema,
    message: nonEmptyMedium,
    correlation_id: arenaIdSchema.nullable(),
    details: z.unknown().nullable(),
  })
  .strict();

export type AcqErrorEnvelope = z.infer<typeof acqErrorEnvelopeSchema>;

export function acqError(
  code: AcqErrorCode,
  message: string,
  correlationId: string | null = null,
  details: unknown = null,
): AcqErrorEnvelope {
  return { code, message, correlation_id: correlationId, details };
}

export function acqHttpStatusFor(code: AcqErrorCode): number {
  return ACQ_ERROR_CATALOG[code].http_status;
}

export function isAcqRetryable(code: AcqErrorCode): boolean {
  return ACQ_ERROR_CATALOG[code].retryable;
}

/**
 * Structural issue shape accepted by the discriminator below (zod safeParse
 * issues are a structural subtype of this).
 */
export interface ShapeIssue {
  code: string;
  path: ReadonlyArray<PropertyKey>;
  message: string;
}

/**
 * Discriminate strict-schema failures into typed ACQ codes with a fixed
 * precedence: version gate -> unknown field -> missing required marker ->
 * generic validation. Deterministic and testable.
 */
export function classifyShapeIssues(
  issues: ReadonlyArray<ShapeIssue>,
  options: { versionField?: string; missingField?: string } = {},
): AcqErrorCode {
  const versionField = options.versionField ?? "schema_version";
  const has = (issue: ShapeIssue, field: string) => issue.path[0] === field;
  if (issues.some((issue) => has(issue, versionField))) {
    return "ACQ_SCHEMA_VERSION_UNSUPPORTED";
  }
  if (issues.some((issue) => issue.code === "unrecognized_keys")) {
    return "ACQ_UNKNOWN_FIELD";
  }
  if (
    options.missingField !== undefined &&
    issues.some((issue) => has(issue, options.missingField!))
  ) {
    return "ACQ_REPRO_CASE_MISSING";
  }
  return "ACQ_VALIDATION_FAILED";
}

/** Render issues into a bounded, deterministic detail string for envelopes. */
export function describeShapeIssues(issues: ReadonlyArray<ShapeIssue>): string {
  return (
    issues
      .slice(0, 8)
      .map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`)
      .join("; ")
      .slice(0, 2000) || "payload failed schema validation"
  );
}
