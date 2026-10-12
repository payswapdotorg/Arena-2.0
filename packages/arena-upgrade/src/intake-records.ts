import { z } from "zod";
import {
  arenaIdSchema,
  isoTimestampSchema,
  nonNegativeIntSchema,
  privacyProfileSchema,
  redactionClassSchema,
  retentionProfileSchema,
} from "@arena/contracts";
import { rightsScopeSchema } from "@arena/learning";
import {
  UPGRADE_SCHEMA_FAMILY,
  actorRefSchema,
  boundedText,
  nonEmptyShort,
} from "./primitives.js";

/**
 * AR2-018 — intake record contracts (issue #34; spec §7).
 *
 * The DatasetIntakeRecord family (intake policy, provenance checks, rights
 * state, quality metrics and the record itself) lives in this module,
 * separate from the validation flow in intake.ts, so each file stays under
 * the 400-line house law. intake.ts re-exports this surface so consumers
 * are unaffected. No behavior change — the schemas are byte-identical moves.
 */

export const intakePolicySchema = z
  .object({
    /** Allowed source hosts: exact ("docs.example.org") or leftmost-wildcard ("*.example.org"). */
    permitted_source_patterns: z.array(nonEmptyShort).min(1).max(64),
    privacy_profile: privacyProfileSchema,
    retention_profile: retentionProfileSchema,
  })
  .strict();

export type IntakePolicy = z.infer<typeof intakePolicySchema>;

export const intakeProvenanceCheckSchema = z
  .object({
    field: nonEmptyShort,
    present: z.boolean(),
    consistent: z.boolean(),
  })
  .strict();

export type IntakeProvenanceCheck = z.infer<typeof intakeProvenanceCheckSchema>;

export const intakeRightsStateSchema = z
  .object({
    state: z.enum(["LINKED", "DENIED", "UNKNOWN", "EXPIRED", "SCOPE_MISMATCH"]),
    grant_id: arenaIdSchema.nullable(),
    scope: rightsScopeSchema.nullable(),
    reason: boundedText.nullable(),
  })
  .strict();

export type IntakeRightsState = z.infer<typeof intakeRightsStateSchema>;

export const datasetQualityMetricsSchema = z
  .object({
    item_count: nonNegativeIntSchema,
    distinct_source_urls: nonNegativeIntSchema,
    unique_content_hashes: nonNegativeIntSchema,
    dedup_ratio: z.number().min(0).max(1),
    field_completeness: z.number().min(0).max(1),
    malformed_item_ratio: z.number().min(0).max(1),
    quarantined_item_ratio: z.number().min(0).max(1),
  })
  .strict();

export type DatasetQualityMetrics = z.infer<typeof datasetQualityMetricsSchema>;

export const datasetIntakeRecordSchema = z
  .object({
    schema_version: z.literal(UPGRADE_SCHEMA_FAMILY),
    intake_id: arenaIdSchema,
    tenant_id: arenaIdSchema,
    dataset_id: arenaIdSchema,
    run_id: arenaIdSchema,
    correlation_id: arenaIdSchema,
    causation_id: arenaIdSchema.nullable(),
    recorded_at: isoTimestampSchema,
    recorded_by: actorRefSchema,
    outcome: z.enum(["ACCEPTED", "BLOCKED"]),
    stage1_schema: z
      .object({
        passed: z.boolean(),
        issues: z.array(z.object({ field: z.string(), rule: z.string() }).strict()).max(64),
      })
      .strict(),
    stage2_semantics: z
      .object({
        passed: z.boolean(),
        reason_codes: z.array(z.string().min(1)).max(32),
        issues: z.array(z.object({ field: z.string(), rule: z.string() }).strict()).max(64),
      })
      .strict(),
    provenance_completeness: z
      .object({
        checks: z.array(intakeProvenanceCheckSchema).max(16),
        complete: z.boolean(),
      })
      .strict(),
    rights: intakeRightsStateSchema,
    source_policy: z
      .object({
        verdict: z.enum(["COMPLIANT", "VIOLATION"]),
        violations: z
          .array(z.object({ item_id: arenaIdSchema, url: z.string().max(2048), rule: z.string() }).strict())
          .max(256),
      })
      .strict(),
    privacy_retention: z
      .object({
        privacy_profile: privacyProfileSchema,
        retention_profile: retentionProfileSchema,
        redaction_classes_observed: z.array(redactionClassSchema).max(4),
      })
      .strict(),
    integrity: z
      .object({
        per_item_verified: z.boolean(),
        object_hash_verified: z.boolean(),
        expected_object_hash: z.string().regex(/^[a-f0-9]{64}$/),
        computed_object_hash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    quality: datasetQualityMetricsSchema,
  })
  .strict();

export type DatasetIntakeRecord = z.infer<typeof datasetIntakeRecordSchema>;
