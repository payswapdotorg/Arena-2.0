import { z } from "zod";
import { arenaIdSchema } from "@arena/contracts";
import { nonEmptyMedium } from "./primitives.js";

/**
 * AR2-017 — typed error catalog for the SCRP1.0 family (issue #33).
 *
 * House style (mirrors CF1.0 ARENA_* and ACQ1.0 ACQ_* discipline): a stable,
 * typed, exported catalog. The SCRP_* code space is a NEW family; CF1.0's
 * ARENA_* and ACQ1.0's ACQ_* catalogs are frozen and never edited here.
 * Codes are additive-only within SCRP1.0.
 */

export const scrpErrorCodeSchema = z.enum([
  // trust-boundary shape errors
  "SCRP_VALIDATION_FAILED",
  "SCRP_UNKNOWN_FIELD",
  "SCRP_SCHEMA_VERSION_UNSUPPORTED",
  // identity and isolation (fail closed, no existence oracle)
  "SCRP_TENANT_CONTEXT_INVALID",
  "SCRP_TENANT_MISMATCH",
  "SCRP_NOT_FOUND",
  // idempotency
  "SCRP_IDEMPOTENCY_DIGEST_MISMATCH",
  "SCRP_IDEMPOTENCY_REPLAY",
  // factory lifecycle
  "SCRP_BUILD_STATE_INVALID",
  "SCRP_BUILD_GATE_REJECTED",
  "SCRP_ACTOR_NOT_AUTHORIZED",
  "SCRP_LICENSE_REVIEW_REJECTED",
  "SCRP_SOURCE_POLICY_REJECTED",
  "SCRP_BUDGET_CHECK_FAILED",
  "SCRP_VERSION_IMMUTABLE",
  "SCRP_VERSION_NOT_FOUND",
  // run lifecycle
  "SCRP_RUN_STATE_INVALID",
  "SCRP_RUN_LEASE_LOST",
  "SCRP_RUN_NOT_TERMINAL",
  "SCRP_CRAWL_BUDGET_EXCEEDED",
  "SCRP_EGRESS_DENIED",
  "SCRP_ROBOTS_DISALLOWED",
  "SCRP_DOMAIN_LIMIT_EXCEEDED",
  "SCRP_QUARANTINE_EXCESS",
  "SCRP_OUTPUT_SCHEMA_MISMATCH",
  "SCRP_CAPSULE_PROVISION_FAILED",
  "SCRP_CAPSULE_TEARDOWN_FAILED",
  // external API connector plane
  "SCRP_CONNECTOR_NOT_CONFIGURED",
  "SCRP_CONNECTOR_CREDENTIAL_MISSING",
  "SCRP_CONNECTOR_HOST_NOT_APPROVED",
  "SCRP_CONNECTOR_METHOD_NOT_ALLOWED",
  "SCRP_CONNECTOR_RATE_LIMITED",
  "SCRP_CONNECTOR_QUOTA_EXCEEDED",
  "SCRP_CONNECTOR_COST_CEILING_EXCEEDED",
  "SCRP_CONNECTOR_TIMEOUT_UNKNOWN",
  "SCRP_CONNECTOR_RETRY_EXCEEDED",
  "SCRP_CONNECTOR_SIGNATURE_INVALID",
  "SCRP_CONNECTOR_RESPONSE_INVALID",
  // unclassified
  "SCRP_INTERNAL_ERROR",
]);

export type ScrpErrorCode = z.infer<typeof scrpErrorCodeSchema>;

export interface ScrpErrorCatalogEntry {
  http_status: number;
  retryable: boolean;
  description: string;
}

export const SCRP_ERROR_CATALOG: Record<ScrpErrorCode, ScrpErrorCatalogEntry> = {
  SCRP_VALIDATION_FAILED: { http_status: 400, retryable: false, description: "payload failed SCRP1.0 contract validation" },
  SCRP_UNKNOWN_FIELD: { http_status: 400, retryable: false, description: "strict envelope rejected an unknown field" },
  SCRP_SCHEMA_VERSION_UNSUPPORTED: { http_status: 400, retryable: false, description: "schema_version not supported by this server" },
  SCRP_TENANT_CONTEXT_INVALID: { http_status: 401, retryable: false, description: "server-derived tenant context failed validation" },
  SCRP_TENANT_MISMATCH: { http_status: 403, retryable: false, description: "cross-tenant access fails closed and is indistinguishable from not-found" },
  SCRP_NOT_FOUND: { http_status: 404, retryable: false, description: "object not visible in tenant scope (no existence oracle)" },
  SCRP_IDEMPOTENCY_DIGEST_MISMATCH: { http_status: 409, retryable: false, description: "same idempotency key with a different command digest" },
  SCRP_IDEMPOTENCY_REPLAY: { http_status: 200, retryable: false, description: "stored outcome replayed for same key+digest" },
  SCRP_BUILD_STATE_INVALID: { http_status: 409, retryable: false, description: "factory transition not allowed from the current build state" },
  SCRP_BUILD_GATE_REJECTED: { http_status: 422, retryable: false, description: "factory gate rejected the transition (typed reason in the build record)" },
  SCRP_LICENSE_REVIEW_REJECTED: { http_status: 422, retryable: false, description: "dependency/source/license review failed (unknown or prohibited rights posture, unapproved license)" },
  SCRP_SOURCE_POLICY_REJECTED: { http_status: 422, retryable: false, description: "source policy gate rejected the definition (login-walled/private-data default-deny, robots posture)" },
  SCRP_BUDGET_CHECK_FAILED: { http_status: 422, retryable: false, description: "budget check gate rejected the definition (implausible or unbounded resource policy)" },
  SCRP_ACTOR_NOT_AUTHORIZED: { http_status: 403, retryable: false, description: "actor is not authorized for this transition" },
  SCRP_VERSION_IMMUTABLE: { http_status: 409, retryable: false, description: "released scraper versions are immutable (new behavior = new version)" },
  SCRP_VERSION_NOT_FOUND: { http_status: 404, retryable: false, description: "scraper version not visible in tenant scope" },
  SCRP_RUN_STATE_INVALID: { http_status: 409, retryable: false, description: "run command not allowed from the current run state" },
  SCRP_RUN_LEASE_LOST: { http_status: 409, retryable: false, description: "run lease not held or expired (fenced)" },
  SCRP_RUN_NOT_TERMINAL: { http_status: 409, retryable: false, description: "operation requires a terminal run" },
  SCRP_CRAWL_BUDGET_EXCEEDED: { http_status: 429, retryable: false, description: "crawl budget (pages/items/bytes/depth/wall-time) exhausted" },
  SCRP_EGRESS_DENIED: { http_status: 403, retryable: false, description: "egress guard denied the destination (SSRF/rebinding defense, fail closed)" },
  SCRP_ROBOTS_DISALLOWED: { http_status: 403, retryable: false, description: "robots.txt coordination disallows this path for the declared user agent" },
  SCRP_DOMAIN_LIMIT_EXCEEDED: { http_status: 429, retryable: false, description: "per-domain request limit exceeded" },
  SCRP_QUARANTINE_EXCESS: { http_status: 422, retryable: false, description: "too many quarantined records — dataset assembly fails closed" },
  SCRP_OUTPUT_SCHEMA_MISMATCH: { http_status: 422, retryable: false, description: "assembled dataset does not satisfy the output schema reference" },
  SCRP_CAPSULE_PROVISION_FAILED: { http_status: 503, retryable: true, description: "capsule provider refused or failed provisioning (fail closed)" },
  SCRP_CAPSULE_TEARDOWN_FAILED: { http_status: 503, retryable: true, description: "capsule teardown could not be verified" },
  SCRP_CONNECTOR_NOT_CONFIGURED: { http_status: 503, retryable: false, description: "adapter runs only when explicitly configured (inert otherwise, fail closed)" },
  SCRP_CONNECTOR_CREDENTIAL_MISSING: { http_status: 503, retryable: false, description: "credential reference could not be resolved from the secret store" },
  SCRP_CONNECTOR_HOST_NOT_APPROVED: { http_status: 403, retryable: false, description: "connector host/endpoint not in the descriptor's approved patterns" },
  SCRP_CONNECTOR_METHOD_NOT_ALLOWED: { http_status: 405, retryable: false, description: "HTTP method not in the descriptor's approved methods" },
  SCRP_CONNECTOR_RATE_LIMITED: { http_status: 429, retryable: true, description: "connector rate/concurrency limit reached" },
  SCRP_CONNECTOR_QUOTA_EXCEEDED: { http_status: 429, retryable: false, description: "connector call quota exhausted" },
  SCRP_CONNECTOR_COST_CEILING_EXCEEDED: { http_status: 409, retryable: false, description: "paid provider cost ceiling exceeded (fail closed)" },
  SCRP_CONNECTOR_TIMEOUT_UNKNOWN: { http_status: 504, retryable: false, description: "external provider timeout is an UNKNOWN outcome, not failure; operation identity persisted" },
  SCRP_CONNECTOR_RETRY_EXCEEDED: { http_status: 502, retryable: true, description: "retry cap exhausted on a retryable connector error" },
  SCRP_CONNECTOR_SIGNATURE_INVALID: { http_status: 401, retryable: false, description: "webhook/callback signature failed verification" },
  SCRP_CONNECTOR_RESPONSE_INVALID: { http_status: 422, retryable: false, description: "connector response violated the declared response schema" },
  SCRP_INTERNAL_ERROR: { http_status: 500, retryable: true, description: "unclassified scraper-plane error" },
};

/** Error-envelope code stability rule (SCRP1.0 family counterpart of CF1.0's). */
export const SCRP_ERROR_CATALOG_STABILITY_RULE =
  "SCRP_* error codes are part of the SCRP1.0 public contract: additive-only within the family; " +
  "HTTP mappings and retryability may evolve only through the recorded compatibility policy; " +
  "the frozen CF1.0 ARENA_* and ACQ1.0 ACQ_* catalogs are never edited from this package";

export const scrpErrorEnvelopeSchema = z
  .object({
    code: scrpErrorCodeSchema,
    message: nonEmptyMedium,
    correlation_id: arenaIdSchema.nullable(),
    details: z.unknown().nullable(),
  })
  .strict();

export type ScrpErrorEnvelope = z.infer<typeof scrpErrorEnvelopeSchema>;

export function scrpError(
  code: ScrpErrorCode,
  message: string,
  correlationId: string | null = null,
  details: unknown = null,
): ScrpErrorEnvelope {
  return { code, message, correlation_id: correlationId, details };
}

export function scrpHttpStatusFor(code: ScrpErrorCode): number {
  return SCRP_ERROR_CATALOG[code].http_status;
}

export function isScrpRetryable(code: ScrpErrorCode): boolean {
  return SCRP_ERROR_CATALOG[code].retryable;
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
 * Discriminate strict-schema failures into typed SCRP codes with a fixed
 * precedence: version gate -> unknown field -> generic validation.
 */
export function classifyShapeIssues(
  issues: ReadonlyArray<ShapeIssue>,
  options: { versionField?: string } = {},
): ScrpErrorCode {
  const versionField = options.versionField ?? "schema_version";
  if (issues.some((issue) => issue.path[0] === versionField)) {
    return "SCRP_SCHEMA_VERSION_UNSUPPORTED";
  }
  if (issues.some((issue) => issue.code === "unrecognized_keys")) {
    return "SCRP_UNKNOWN_FIELD";
  }
  return "SCRP_VALIDATION_FAILED";
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
