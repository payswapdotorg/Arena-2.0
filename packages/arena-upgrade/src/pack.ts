import { z } from "zod";
import {
  arenaIdSchema,
  digestSchema,
  isoTimestampSchema,
  nonNegativeIntSchema,
  positiveIntSchema,
  privacyProfileSchema,
  redactionClassSchema,
  retentionProfileSchema,
} from "@arena/contracts";
import { computeCanonicalDigest } from "@arena/acquisition";
import { rightsScopeSchema } from "@arena/learning";
import { UPGRADE_SCHEMA_FAMILY, actorRefSchema, nonEmptyShort } from "./primitives.js";
import { deliveryStrategyIdSchema, type DeliveryStrategyId } from "./proposal.js";

/**
 * AR2-018 — CapabilityPack (issue #34; spec §7).
 *
 * The versioned immutable artifact a delivery strategy produces: strategy-
 * specific payload, source dataset digest, transformations manifest digest,
 * target capability composition digest, deterministic build provenance
 * (same inputs → same pack digest), compatibility scope (Body version range)
 * and retention/expiry class. Published pack versions are immutable: a change
 * is a new version, never an in-place edit. No FINE_TUNING payload exists —
 * the fine-tuning strategy is a recording stub by design.
 */

export const packScopeSchema = z
  .object({
    tenant_id: arenaIdSchema,
    rights_scope: rightsScopeSchema,
  })
  .strict();

export type PackScope = z.infer<typeof packScopeSchema>;

const citationSchema = z
  .object({
    source_url: z.string().min(1).max(2048),
    retrieved_at: isoTimestampSchema,
    license_assessment: nonEmptyShort,
  })
  .strict();

export type PackCitation = z.infer<typeof citationSchema>;

export const retrievalIndexEntrySchema = z
  .object({
    entry_id: arenaIdSchema,
    content_digest: digestSchema,
    terms: z.array(nonEmptyShort).max(256),
    content: z.string().max(1048576),
    source_url: z.string().min(1).max(2048),
    license_assessment: nonEmptyShort,
    redaction_class: redactionClassSchema,
  })
  .strict();

export const scopedRetrievalIndexPayloadSchema = z
  .object({
    kind: z.literal("SCOPED_RETRIEVAL_INDEX"),
    scope: packScopeSchema,
    entries: z.array(retrievalIndexEntrySchema).max(100000),
  })
  .strict();

export const knowledgePackEntrySchema = z
  .object({
    key: nonEmptyShort,
    fields: z.record(z.string(), z.string()),
    citation: citationSchema,
    redaction_class: redactionClassSchema,
  })
  .strict();

export const structuredKnowledgePackPayloadSchema = z
  .object({
    kind: z.literal("STRUCTURED_KNOWLEDGE_PACK"),
    scope: packScopeSchema,
    table: z.array(knowledgePackEntrySchema).max(100000),
  })
  .strict();

export const toolAdapterPayloadSchema = z
  .object({
    kind: z.literal("TOOL_ADAPTER"),
    scope: packScopeSchema,
    tool: z
      .object({
        tool_id: arenaIdSchema,
        interface: z
          .object({
            actions: z
              .array(z.object({ name: z.enum(["query"]), parameters: z.array(z.string().max(64)).max(16) }).strict())
              .min(1)
              .max(8),
          })
          .strict(),
        permissions: z.array(z.enum(["read_tenant_scoped"])).min(1).max(4),
        rate_limits: z.object({ max_calls_per_minute: positiveIntSchema.max(100000) }).strict(),
        dataset_digest: digestSchema,
      })
      .strict(),
    entries: z
      .array(
        z
          .object({
            entry_id: arenaIdSchema,
            content: z.string().max(1048576),
            source_url: z.string().min(1).max(2048),
            license_assessment: nonEmptyShort,
            redaction_class: redactionClassSchema,
          })
          .strict(),
      )
      .max(100000),
  })
  .strict();

export const rulesExamplesPayloadSchema = z
  .object({
    kind: z.literal("RULES_EXAMPLES"),
    scope: packScopeSchema,
    artifacts: z
      .array(
        z
          .object({
            artifact_id: arenaIdSchema,
            rule_text: nonEmptyShort,
            example_input: nonEmptyShort,
            example_output: nonEmptyShort,
            citation: citationSchema,
          })
          .strict(),
      )
      .max(10000),
  })
  .strict();

export const capabilityPackPayloadSchema = z.discriminatedUnion("kind", [
  scopedRetrievalIndexPayloadSchema,
  structuredKnowledgePackPayloadSchema,
  toolAdapterPayloadSchema,
  rulesExamplesPayloadSchema,
]);

export type CapabilityPackPayload = z.infer<typeof capabilityPackPayloadSchema>;

export const capabilityPackSchema = z
  .object({
    schema_version: z.literal(UPGRADE_SCHEMA_FAMILY),
    pack_id: arenaIdSchema,
    version: positiveIntSchema,
    tenant_id: arenaIdSchema,
    strategy: deliveryStrategyIdSchema,
    payload: capabilityPackPayloadSchema,
    source_dataset_digest: digestSchema,
    transformations_manifest_digest: digestSchema,
    target_capability_composition_digest: digestSchema,
    build_provenance: z
      .object({
        built_at: isoTimestampSchema,
        built_by: actorRefSchema,
        build_inputs_digest: digestSchema,
        deterministic: z.literal(true),
      })
      .strict(),
    compatibility_scope: z
      .object({
        body_id: arenaIdSchema,
        min_version: positiveIntSchema,
        max_version: positiveIntSchema,
      })
      .strict(),
    retention_expiry: z
      .object({
        retention_profile: retentionProfileSchema,
        privacy_profile: privacyProfileSchema,
        redaction_class: redactionClassSchema,
        excluded_entry_count: nonNegativeIntSchema,
        expires_at: isoTimestampSchema.nullable(),
      })
      .strict(),
    content_digest: digestSchema,
  })
  .strict();

export type CapabilityPack = z.infer<typeof capabilityPackSchema>;

/** Strategies that can materialize a pack payload (fine-tuning never does). */
export const PACKABLE_STRATEGIES: readonly DeliveryStrategyId[] = [
  "SCOPED_RETRIEVAL_INDEX",
  "STRUCTURED_KNOWLEDGE_PACK",
  "TOOL_ADAPTER",
  "RULES_EXAMPLES",
];

/**
 * Deterministic pack digest: computed over the pack's semantic content only —
 * build_provenance (built_at/built_by) is metadata and is deliberately EXCLUDED
 * so that rebuilding the same inputs at a different time yields the same
 * content digest (the deterministic-build contract).
 */
export function computePackContentDigest(pack: CapabilityPack): string {
  return computeCanonicalDigest({
    pack_id: pack.pack_id,
    version: pack.version,
    tenant_id: pack.tenant_id,
    strategy: pack.strategy,
    payload: pack.payload,
    source_dataset_digest: pack.source_dataset_digest,
    transformations_manifest_digest: pack.transformations_manifest_digest,
    target_capability_composition_digest: pack.target_capability_composition_digest,
    compatibility_scope: pack.compatibility_scope,
    retention_expiry: pack.retention_expiry,
  });
}

export const CAPABILITY_PACK_IMMUTABILITY_RULE =
  "CapabilityPack versions are immutable: (pack_id, version) is a unique frozen artifact and any change " +
  "is a NEW version with a higher number; published versions stay queryable forever — rollback appends " +
  "events and never rewrites history; content_digest anchors the deterministic build (same inputs → " +
  "same digest) and fine-tuning payloads are structurally absent (the strategy is a recording stub)";
