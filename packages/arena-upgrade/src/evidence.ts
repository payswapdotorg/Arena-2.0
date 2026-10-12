import { z } from "zod";
import { digestSchema, evidenceObjectSchema, isoTimestampSchema } from "@arena/contracts";
import { nonEmptyShort } from "./primitives.js";

/**
 * AR2-018 — evidence chain records (issue #34; spec §7/§8).
 *
 * Every publication decision carries the linked evidence records (source
 * capture → transformations → pack build → evaluation runs → decision), each
 * with a content digest, so an auditor can walk the chain. Each record
 * renders into the frozen CF1.0 evidence-object shape (content_digest,
 * size_bytes, media_type, storage_ref) — the exact convention
 * @arena/evidence's EvidenceStore accepts for its `object` field — so UPG
 * evidence is recordable as evidence records downstream.
 */

export const evidenceStageSchema = z.enum([
  "SOURCE_CAPTURE",
  "TRANSFORMATION",
  "PACK_BUILD",
  "TARGET_CAPABILITY_VERSION",
  "EVALUATION_BASELINE",
  "EVALUATION_CANDIDATE",
  "DECISION",
]);

export type EvidenceStage = z.infer<typeof evidenceStageSchema>;

export const evidenceChainRecordSchema = z
  .object({
    stage: evidenceStageSchema,
    ref_id: nonEmptyShort,
    content_digest: digestSchema,
    recorded_at: isoTimestampSchema,
  })
  .strict();

export type EvidenceChainRecord = z.infer<typeof evidenceChainRecordSchema>;

export type RenderedEvidenceObject = z.infer<typeof evidenceObjectSchema>;

/** Render a chain record into the frozen CF1.0 evidence-object shape. */
export function renderEvidenceObject(record: EvidenceChainRecord): RenderedEvidenceObject {
  const object: RenderedEvidenceObject = {
    content_digest: record.content_digest,
    size_bytes: JSON.stringify(record).length + 1,
    media_type: "application/json",
    storage_ref: `arena-upgrade://evidence/${record.stage.toLowerCase()}/${record.ref_id}`,
  };
  return object;
}

/** Recordability check against the frozen CF1.0 evidence-object schema. */
export function isRecordableAsEvidence(record: EvidenceChainRecord): boolean {
  return evidenceObjectSchema.safeParse(renderEvidenceObject(record)).success;
}

/** Deterministic auditor-facing rendering of a chain. */
export function describeEvidenceChain(records: readonly EvidenceChainRecord[]): string {
  return records
    .map((record) => `${record.stage}[${record.ref_id}]=${record.content_digest.slice(0, 16)}…`)
    .join(" -> ");
}
