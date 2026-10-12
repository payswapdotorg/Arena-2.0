import { z } from "zod";
import { arenaIdSchema } from "@arena/contracts";
import { nonEmptyMedium } from "./primitives.js";

/**
 * AR2-018 — typed error catalog for the UPG1.0 family (issue #34).
 *
 * House style: a stable, typed, exported error catalog (mirrors CF1.0
 * ARENA_* and ACQ1.0 ACQ_* discipline). The UPG_* code space is a NEW family
 * — frozen catalogs are never edited here. Codes are additive-only within
 * UPG1.0; HTTP mappings may evolve only through the recorded compatibility
 * policy. Every fail-closed rejection class in this plane carries its exact
 * code (spec §7: data quality and capability are SEPARATE acceptance
 * decisions; missing evidence is never success).
 */

export const upgErrorCodeSchema = z.enum([
  // trust-boundary shape errors (runtime validation is mandatory)
  "UPG_VALIDATION_FAILED",
  "UPG_UNKNOWN_FIELD",
  "UPG_SCHEMA_VERSION_UNSUPPORTED",
  // intake plane (stage-1/2 fail-closed reason codes)
  "UPG_PROVENANCE_INCOMPLETE",
  "UPG_RIGHTS_DENIED",
  "UPG_RIGHTS_UNKNOWN",
  "UPG_RIGHTS_EXPIRED",
  "UPG_RIGHTS_SCOPE_MISMATCH",
  "UPG_INTEGRITY_MISMATCH",
  "UPG_DATASET_SCHEMA_INVALID",
  "UPG_TENANT_SCOPE_MISMATCH",
  "UPG_SOURCE_POLICY_VIOLATION",
  // transformation plane
  "UPG_TRANSFORMATION_UNKNOWN_OPERATION",
  "UPG_TRANSFORMATION_REPLAY_MISMATCH",
  "UPG_TRANSFORMATION_IMMUTABLE",
  // strategy plane
  "UPG_STRATEGY_NOT_APPLICABLE",
  "UPG_STRATEGY_NOT_PERMITTED",
  "UPG_FINE_TUNING_NOT_AUTHORIZED",
  // proposal state machine
  "UPG_STATE_TRANSITION_ILLEGAL",
  "UPG_PROPOSAL_IMMUTABLE",
  // evaluation plane
  "UPG_EVALUATION_INCONCLUSIVE",
  "UPG_EVALUATION_THRESHOLDS_NOT_MET",
  "UPG_LEAKAGE_DETECTED",
  "UPG_GUARDRAIL_VIOLATED",
  "UPG_ENVIRONMENT_PIN_MISMATCH",
  // publication plane
  "UPG_PUBLICATION_BLOCKED",
  "UPG_PUBLISHED_VERSION_IMMUTABLE",
  "UPG_ROLLBACK_NOT_POSSIBLE",
  "UPG_CERTIFICATION_MISMATCH",
  // identity / idempotency / isolation (fail closed, no existence oracle)
  "UPG_TENANT_CONTEXT_INVALID",
  "UPG_TENANT_MISMATCH",
  "UPG_NOT_FOUND",
  "UPG_IDEMPOTENCY_DIGEST_MISMATCH",
  "UPG_IDEMPOTENCY_REPLAY",
  // popularity can never bypass verification/rights/certification (spec §3)
  "UPG_POPULARITY_IS_NOT_AUTHORITY",
  "UPG_INTERNAL_ERROR",
]);

export type UpgErrorCode = z.infer<typeof upgErrorCodeSchema>;

export interface UpgErrorCatalogEntry {
  http_status: number;
  retryable: boolean;
  description: string;
}

export const UPG_ERROR_CATALOG: Record<UpgErrorCode, UpgErrorCatalogEntry> = {
  UPG_VALIDATION_FAILED: { http_status: 400, retryable: false, description: "payload failed UPG1.0 contract validation" },
  UPG_UNKNOWN_FIELD: { http_status: 400, retryable: false, description: "strict envelope rejected an unknown field" },
  UPG_SCHEMA_VERSION_UNSUPPORTED: { http_status: 400, retryable: false, description: "schema_version not supported by this server" },
  UPG_PROVENANCE_INCOMPLETE: { http_status: 422, retryable: false, description: "dataset provenance is missing a required lineage field or is internally inconsistent" },
  UPG_RIGHTS_DENIED: { http_status: 422, retryable: false, description: "rights posture or grant state denies reuse (fail closed)" },
  UPG_RIGHTS_UNKNOWN: { http_status: 422, retryable: false, description: "no explicit RightsGrant linkage covers this dataset (unknown rights block reuse)" },
  UPG_RIGHTS_EXPIRED: { http_status: 422, retryable: false, description: "the covering RightsGrant has expired" },
  UPG_RIGHTS_SCOPE_MISMATCH: { http_status: 422, retryable: false, description: "the covering RightsGrant does not match the requested scope" },
  UPG_INTEGRITY_MISMATCH: { http_status: 422, retryable: false, description: "dataset integrity re-verification failed (item or object hash mismatch)" },
  UPG_DATASET_SCHEMA_INVALID: { http_status: 422, retryable: false, description: "the source payload is not a valid SCRP1.0 DatasetArtifact" },
  UPG_TENANT_SCOPE_MISMATCH: { http_status: 403, retryable: false, description: "dataset tenant does not match the authenticated tenant context" },
  UPG_SOURCE_POLICY_VIOLATION: { http_status: 422, retryable: false, description: "a dataset item originates outside the permitted source patterns" },
  UPG_TRANSFORMATION_UNKNOWN_OPERATION: { http_status: 422, retryable: false, description: "manifest references an unknown operation id or version (fail closed)" },
  UPG_TRANSFORMATION_REPLAY_MISMATCH: { http_status: 409, retryable: false, description: "replaying the manifest did not reproduce the recorded output digest" },
  UPG_TRANSFORMATION_IMMUTABLE: { http_status: 409, retryable: false, description: "transformation manifests are immutable; corrections produce a new manifest" },
  UPG_STRATEGY_NOT_APPLICABLE: { http_status: 422, retryable: false, description: "the strategy cannot be applied to this dataset shape/policy" },
  UPG_STRATEGY_NOT_PERMITTED: { http_status: 403, retryable: false, description: "the strategy is not within the permitted use kinds" },
  UPG_FINE_TUNING_NOT_AUTHORIZED: { http_status: 403, retryable: false, description: "fine-tuning requires the full authorization chain and stays a recording stub by default" },
  UPG_STATE_TRANSITION_ILLEGAL: { http_status: 409, retryable: false, description: "proposal state machine rejects this transition (reason code recorded)" },
  UPG_PROPOSAL_IMMUTABLE: { http_status: 409, retryable: false, description: "proposals are immutable once submitted; corrections append events" },
  UPG_EVALUATION_INCONCLUSIVE: { http_status: 422, retryable: true, description: "evaluation could not establish a verdict (fail closed, never auto-pass)" },
  UPG_EVALUATION_THRESHOLDS_NOT_MET: { http_status: 422, retryable: false, description: "the before/after delta does not meet the suite thresholds" },
  UPG_LEAKAGE_DETECTED: { http_status: 422, retryable: false, description: "a leakage probe surfaced a forbidden string in a pack-mediated answer" },
  UPG_GUARDRAIL_VIOLATED: { http_status: 422, retryable: false, description: "a guardrail case failed (refusal or inertness)" },
  UPG_ENVIRONMENT_PIN_MISMATCH: { http_status: 409, retryable: false, description: "the pinned evaluation environment digest does not match the recorded pin" },
  UPG_PUBLICATION_BLOCKED: { http_status: 403, retryable: false, description: "publication failed a fail-closed gate (rights/certification/scope)" },
  UPG_PUBLISHED_VERSION_IMMUTABLE: { http_status: 409, retryable: false, description: "published pack versions are immutable; a change is a new version" },
  UPG_ROLLBACK_NOT_POSSIBLE: { http_status: 409, retryable: false, description: "no published earlier version exists to roll back to" },
  UPG_CERTIFICATION_MISMATCH: { http_status: 422, retryable: false, description: "certification does not bind the published composition/policy/environment/scope" },
  UPG_TENANT_CONTEXT_INVALID: { http_status: 401, retryable: false, description: "server-derived tenant context failed validation" },
  UPG_TENANT_MISMATCH: { http_status: 403, retryable: false, description: "cross-tenant write attempt (fail closed)" },
  UPG_NOT_FOUND: { http_status: 404, retryable: false, description: "record not visible in tenant scope (indistinguishable from missing)" },
  UPG_IDEMPOTENCY_DIGEST_MISMATCH: { http_status: 409, retryable: false, description: "same idempotency key with a different proposal digest" },
  UPG_IDEMPOTENCY_REPLAY: { http_status: 200, retryable: false, description: "stored outcome replayed for same key+digest" },
  UPG_POPULARITY_IS_NOT_AUTHORITY: { http_status: 403, retryable: false, description: "usage counters can never short-circuit rights/verification/certification gates" },
  UPG_INTERNAL_ERROR: { http_status: 500, retryable: true, description: "unclassified upgrade-plane error" },
};

/** Error-envelope code stability rule (UPG1.0 counterpart of CF1.0's). */
export const UPG_ERROR_CATALOG_STABILITY_RULE =
  "UPG_* error codes are part of the UPG1.0 public contract: additive-only within the family; " +
  "HTTP mappings and retryability may evolve only through the recorded compatibility policy; the " +
  "frozen CF1.0/ACQ1.0/SCRP1.0 catalogs are never edited from this package";

export const upgErrorEnvelopeSchema = z
  .object({
    code: upgErrorCodeSchema,
    message: nonEmptyMedium,
    correlation_id: arenaIdSchema.nullable(),
    details: z.unknown().nullable(),
  })
  .strict();

export type UpgErrorEnvelope = z.infer<typeof upgErrorEnvelopeSchema>;

export function upgError(
  code: UpgErrorCode,
  message: string,
  correlationId: string | null = null,
  details: unknown = null,
): UpgErrorEnvelope {
  return { code, message, correlation_id: correlationId, details };
}

export function upgHttpStatusFor(code: UpgErrorCode): number {
  return UPG_ERROR_CATALOG[code].http_status;
}

export function isUpgRetryable(code: UpgErrorCode): boolean {
  return UPG_ERROR_CATALOG[code].retryable;
}

/** Typed thrown error carrying a UPG1.0 envelope (used by the fine-tuning stub gate). */
export class UpgradeTypedError extends Error {
  readonly envelope: UpgErrorEnvelope;
  constructor(envelope: UpgErrorEnvelope) {
    super(envelope.message);
    this.name = "UpgradeTypedError";
    this.envelope = envelope;
  }
}

/** Structural issue shape accepted by the discriminator below. */
export interface ShapeIssue {
  code: string;
  path: ReadonlyArray<PropertyKey>;
  message: string;
}

/**
 * Discriminate strict-schema failures into typed UPG codes with a fixed
 * precedence: version gate -> unknown field -> generic validation.
 * Deterministic and testable (mirrors ACQ1.0 classifyShapeIssues).
 */
export function classifyShapeIssues(
  issues: ReadonlyArray<ShapeIssue>,
  options: { versionField?: string } = {},
): UpgErrorCode {
  const versionField = options.versionField ?? "schema_version";
  if (issues.some((issue) => issue.path[0] === versionField)) {
    return "UPG_SCHEMA_VERSION_UNSUPPORTED";
  }
  if (issues.some((issue) => issue.code === "unrecognized_keys")) {
    return "UPG_UNKNOWN_FIELD";
  }
  return "UPG_VALIDATION_FAILED";
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
