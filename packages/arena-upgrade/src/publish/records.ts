import { z } from "zod";
import { arenaIdSchema, isoTimestampSchema } from "@arena/contracts";
import { rightsScopeSchema } from "@arena/learning";
import {
  UPGRADE_SCHEMA_FAMILY,
  actorRefSchema,
  boundedText,
  nonEmptyShort,
} from "../primitives.js";

/**
 * AR2-018 — publication record contracts (issue #34; spec §7).
 *
 * PublicationDecision / RollbackRecord / AdoptionRecord and their zod schemas
 * live in this module, separate from the flow, so the dependency arrow stays
 * one-way: the store and CapabilityPublicationFlow both import THIS module,
 * and records.ts never imports the store or the flow (station review finding:
 * forbidCycles). publication.ts re-exports this surface so consumers are
 * unaffected. No behavior change — the schemas are byte-identical moves.
 */

export const publicationThresholdEvaluationSchema = z
  .object({
    thresholds: z
      .object({
        min_target_metric_delta: z.number().min(0).max(1),
        max_regression_failures: z.number().int().min(0).max(64),
        require_leakage_pass: z.boolean(),
        require_guardrail_pass: z.boolean(),
      })
      .strict(),
    observed: z
      .object({
        target_delta: z.number().min(-1).max(1),
        new_regression_failures: z.number().int().min(0).max(128),
        leakage_passed: z.boolean(),
        guardrails_passed: z.boolean(),
      })
      .strict(),
    met: z.boolean(),
  })
  .strict();

export const publicationRightsSnapshotSchema = z
  .object({
    evaluated_at: isoTimestampSchema,
    state: z.enum(["LINKED", "DENIED", "UNKNOWN", "EXPIRED", "SCOPE_MISMATCH"]),
    grant_id: arenaIdSchema.nullable(),
    scope: rightsScopeSchema.nullable(),
    reason: boundedText.nullable(),
  })
  .strict();

const digest64 = z.string().regex(/^[a-f0-9]{64}$/, "digest must be lowercase sha256 hex (64 chars)");
const positiveVersion = z.number().int().positive();

export const publicationDecisionSchema = z
  .object({
    schema_version: z.literal(UPGRADE_SCHEMA_FAMILY),
    decision_id: arenaIdSchema,
    tenant_id: arenaIdSchema,
    proposal_id: arenaIdSchema,
    outcome: z.enum(["PUBLISHED", "INCONCLUSIVE", "FAILED", "BLOCKED"]),
    reason_code: nonEmptyShort,
    threshold_evaluation: publicationThresholdEvaluationSchema,
    rights_snapshot: publicationRightsSnapshotSchema,
    published_pack: z
      .object({ pack_id: arenaIdSchema, version: positiveVersion, content_digest: digest64 })
      .strict()
      .nullable(),
    rollback_pointer: z
      .object({ pack_id: arenaIdSchema, version: positiveVersion })
      .strict()
      .nullable(),
    adopting_client: z
      .object({ client_application_id: arenaIdSchema, agent_id: arenaIdSchema })
      .strict()
      .nullable(),
    scope: z.object({ tenant_id: arenaIdSchema, rights_scope: rightsScopeSchema }).strict(),
    evidence: z
      .array(z.object({ stage: z.string(), ref_id: z.string(), content_digest: z.string(), recorded_at: z.string() }).strict())
      .max(32),
    decided_at: isoTimestampSchema,
    decided_by: actorRefSchema,
    feedback: z
      .object({ usage_counter_at_decision: z.number().int().min(0), note: boundedText })
      .strict(),
  })
  .strict();

export type PublicationDecision = z.infer<typeof publicationDecisionSchema>;

export const rollbackRecordSchema = z
  .object({
    schema_version: z.literal(UPGRADE_SCHEMA_FAMILY),
    rollback_id: arenaIdSchema,
    tenant_id: arenaIdSchema,
    pack_id: arenaIdSchema,
    from_version: z.number().int().positive(),
    to_version: z.number().int().positive(),
    reason: nonEmptyShort,
    at: isoTimestampSchema,
    actor: actorRefSchema,
    evidence_refs: z.array(z.object({ stage: nonEmptyShort, ref_id: arenaIdSchema }).strict()).max(16),
  })
  .strict();

export type RollbackRecord = z.infer<typeof rollbackRecordSchema>;

export const adoptionRecordSchema = z
  .object({
    schema_version: z.literal(UPGRADE_SCHEMA_FAMILY),
    adoption_id: arenaIdSchema,
    tenant_id: arenaIdSchema,
    pack_id: arenaIdSchema,
    version: z.number().int().positive(),
    decision_id: arenaIdSchema,
    client: z.object({ client_application_id: arenaIdSchema, agent_id: arenaIdSchema }).strict(),
    adopted_at: isoTimestampSchema,
    active: z.boolean(),
  })
  .strict();

export type AdoptionRecord = z.infer<typeof adoptionRecordSchema>;

export const POPULARITY_BYPASS_GUARD_RULE =
  "usage counters and popularity signals are recorded as feedback only: no publication code path " +
  "consults them, and any attempt to supply them as decision input is a typed " +
  "UPG_POPULARITY_IS_NOT_AUTHORITY rejection — verification, rights and certification gates always run";
