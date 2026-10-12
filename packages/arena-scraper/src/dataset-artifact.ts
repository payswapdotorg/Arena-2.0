import { z } from "zod";
import {
  arenaIdSchema,
  digestSchema,
  isoTimestampSchema,
  redactionClassSchema,
} from "@arena/contracts";
import { SCRAPER_SCHEMA_FAMILY, nonEmptyShort, type SemanticIssue } from "./primitives.js";
import { classifyShapeIssues, type ScrpErrorCode } from "./errors.js";

/**
 * AR2-017 — DatasetArtifact (issue #33; spec §2/§6).
 *
 * An IMMUTABLE dataset record: per-item hashes, source URL, retrieval
 * timestamp, method/version, license and rights assessment, redaction class,
 * transformations and provenance lineage. Datasets are deduplicated
 * (URL + content hash) and every item carries full provenance.
 */

export const transformationStepSchema = z
  .object({
    step: z.enum([
      "FETCHED",
      "CHARSET_NORMALIZED",
      "SANITIZED",
      "INJECTION_ANNOTATED",
      "REDACTED",
      "SCHEMA_VALIDATED",
    ]),
    detail: nonEmptyShort,
  })
  .strict();

export type TransformationStep = z.infer<typeof transformationStepSchema>;

export const datasetItemSchema = z
  .object({
    item_id: arenaIdSchema,
    source_url: z.string().min(1).max(2048),
    content_hash: digestSchema,
    retrieved_at: isoTimestampSchema,
    method: z.enum(["HTTP_CRAWL", "API_CONNECTOR"]),
    method_version: nonEmptyShort,
    license_assessment: nonEmptyShort,
    rights_posture: z.enum(["PERMITTED", "RESTRICTED", "PROHIBITED", "UNKNOWN"]),
    redaction_class: redactionClassSchema,
    transformations: z.array(transformationStepSchema).max(32),
    /** Inert data annotations (prompt-injection text stays DATA, flagged). */
    quarantine_annotations: z.array(nonEmptyShort).max(32),
    content: z.string().max(1048576),
  })
  .strict();

export type DatasetItem = z.infer<typeof datasetItemSchema>;

export const datasetArtifactSchema = z
  .object({
    schema_version: z.literal(SCRAPER_SCHEMA_FAMILY),
    dataset_id: arenaIdSchema,
    tenant_id: arenaIdSchema,
    run_id: arenaIdSchema,
    scraper_version_id: arenaIdSchema,
    object_hash: digestSchema,
    items: z.array(datasetItemSchema).max(1000000),
    emitted_at: isoTimestampSchema,
    /** Provenance lineage: which immutable inputs produced this dataset. */
    provenance: z
      .object({
        definition_digest: digestSchema,
        build_digest: digestSchema,
        engine: nonEmptyShort,
        crawlee_version: nonEmptyShort,
        terminal_reason: nonEmptyShort,
      })
      .strict(),
  })
  .strict();

export type DatasetArtifact = z.infer<typeof datasetArtifactSchema>;

export type DatasetCheck =
  | { ok: true; dataset: DatasetArtifact }
  | { ok: false; code: ScrpErrorCode; issues: SemanticIssue[] };

export function checkDatasetArtifact(input: unknown): DatasetCheck {
  const parsed = datasetArtifactSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: classifyShapeIssues(parsed.error.issues),
      issues: parsed.error.issues.map((issue) => ({
        field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
        rule: `${issue.code}${issue.message ? ` — ${issue.message}` : ""}`,
      })),
    };
  }
  return { ok: true, dataset: parsed.data };
}

/** Immutability rule (mirrors CF1.0 evidence discipline). */
export const DATASET_IMMUTABILITY_RULE =
  "a DatasetArtifact is immutable once emitted: corrections produce a new artifact with new lineage; " +
  "item content hashes and the object hash anchor the emitted items for audit and replay detection";

/** Prompt-injection remains data (spec §6). */
export const INJECTION_IS_DATA_RULE =
  "prompt-injection text found in fetched content lands in the dataset as inert data with a " +
  "quarantine annotation: it can never override policy, invoke tools, change egress, select a " +
  "provider or access secrets — the quarantine layer only annotates, it never executes";
