import { z } from "zod";
import {
  arenaIdSchema,
  digestSchema,
  isoTimestampSchema,
  nonNegativeIntSchema,
  redactionClassSchema,
} from "@arena/contracts";
import { computeCanonicalDigest } from "@arena/acquisition";
import type { DatasetArtifact } from "@arena/scraper";
import {
  UPGRADE_SCHEMA_FAMILY,
  actorRefSchema,
  nonEmptyShort,
  type ActorRef,
  type SemanticIssue,
} from "./primitives.js";
import type { UpgErrorCode } from "./errors.js";

/**
 * AR2-018 — DatasetTransformationManifest (issue #34; spec §2/§7).
 *
 * Immutable, source-attributed record of the validated dataset AND every
 * transformation applied (normalize, filter, redact, deduplicate, re-shape).
 * Reproducible by construction: replaying the manifest against the source
 * digest MUST yield the same output digest — every operation is a pure,
 * versioned function over entries, and unknown operation ids/versions fail
 * closed.
 */

export const transformationOperationIdSchema = z.enum([
  "normalize",
  "filter",
  "redact",
  "deduplicate",
  "reshape",
]);

export type TransformationOperationId = z.infer<typeof transformationOperationIdSchema>;

const normalizeParamsSchema = z.object({}).strict();
const filterParamsSchema = z
  .object({ exclude_quarantined: z.boolean(), min_content_length: nonNegativeIntSchema })
  .strict();
const redactParamsSchema = z.object({ patterns: z.array(nonEmptyShort).min(1).max(64) }).strict();
const deduplicateParamsSchema = z.object({ key: z.literal("content") }).strict();
const reshapeParamsSchema = z.object({ preserve_fields: z.array(nonEmptyShort).max(32) }).strict();

export const transformationOperationSchema = z
  .object({
    op_id: transformationOperationIdSchema,
    op_version: nonEmptyShort,
    parameters: z.record(z.string(), z.unknown()),
    output_digest: digestSchema,
  })
  .strict();

export type TransformationOperation = z.infer<typeof transformationOperationSchema>;

export const transformedEntrySchema = z
  .object({
    entry_id: arenaIdSchema,
    source_url: z.string().min(1).max(2048),
    retrieved_at: isoTimestampSchema,
    license_assessment: nonEmptyShort,
    redaction_class: redactionClassSchema,
    quarantined: z.boolean(),
    content: z.string().max(1048576),
  })
  .strict();

export type TransformedEntry = z.infer<typeof transformedEntrySchema>;

export const datasetTransformationManifestSchema = z
  .object({
    schema_version: z.literal(UPGRADE_SCHEMA_FAMILY),
    manifest_id: arenaIdSchema,
    tenant_id: arenaIdSchema,
    dataset_id: arenaIdSchema,
    intake_id: arenaIdSchema,
    source_digest: digestSchema,
    operations: z.array(transformationOperationSchema).min(1).max(32),
    output_digest: digestSchema,
    created_at: isoTimestampSchema,
    created_by: actorRefSchema,
  })
  .strict();

export type DatasetTransformationManifest = z.infer<typeof datasetTransformationManifestSchema>;

export type TransformationOutcome =
  | { kind: "OK"; entries: TransformedEntry[] }
  | { kind: "FAILED"; code: UpgErrorCode; issues: SemanticIssue[] };

const OP_VERSIONS: Record<TransformationOperationId, string> = {
  normalize: "1",
  filter: "1",
  redact: "1",
  deduplicate: "1",
  reshape: "1",
};

/** Initial deterministic entry projection of a schema-valid dataset. */
export function initialEntries(dataset: DatasetArtifact): TransformedEntry[] {
  return dataset.items.map((item) => ({
    entry_id: item.item_id,
    source_url: item.source_url,
    retrieved_at: item.retrieved_at,
    license_assessment: item.license_assessment,
    redaction_class: item.redaction_class,
    quarantined: item.quarantine_annotations.length > 0,
    content: item.content,
  }));
}

export function entriesDigest(entries: TransformedEntry[]): string {
  return computeCanonicalDigest(entries);
}

/**
 * Execute one versioned operation (pure). Unknown op id/version or invalid
 * parameters fail closed with a typed code.
 */
export function executeTransformationOperation(
  op: TransformationOperation,
  entries: TransformedEntry[],
): TransformationOutcome {
  const expected = OP_VERSIONS[op.op_id];
  if (expected === undefined || op.op_version !== expected) {
    return {
      kind: "FAILED",
      code: "UPG_TRANSFORMATION_UNKNOWN_OPERATION",
      issues: [{ field: "op_version", rule: `unsupported ${op.op_id}@${op.op_version}` }],
    };
  }
  switch (op.op_id) {
    case "normalize": {
      const parsed = normalizeParamsSchema.safeParse(op.parameters);
      if (!parsed.success) return invalidParams(op, parsed.error.issues);
      return {
        kind: "OK",
        entries: entries.map((entry) => ({
          ...entry,
          content: entry.content
            .split("\n")
            .map((line) => line.replace(/[ \t]+/g, " ").trim())
            .filter((line) => line.length > 0)
            .join("\n"),
        })),
      };
    }
    case "filter": {
      const parsed = filterParamsSchema.safeParse(op.parameters);
      if (!parsed.success) return invalidParams(op, parsed.error.issues);
      return {
        kind: "OK",
        entries: entries.filter(
          (entry) =>
            (!parsed.data.exclude_quarantined || !entry.quarantined) &&
            entry.content.length >= parsed.data.min_content_length,
        ),
      };
    }
    case "redact": {
      const parsed = redactParamsSchema.safeParse(op.parameters);
      if (!parsed.success) return invalidParams(op, parsed.error.issues);
      return {
        kind: "OK",
        entries: entries.map((entry) => {
          let content = entry.content;
          for (const pattern of parsed.data.patterns) {
            content = content.split(pattern).join("[REDACTED]");
          }
          return { ...entry, content };
        }),
      };
    }
    case "deduplicate": {
      const parsed = deduplicateParamsSchema.safeParse(op.parameters);
      if (!parsed.success) return invalidParams(op, parsed.error.issues);
      const seen = new Set<string>();
      return {
        kind: "OK",
        entries: entries.filter((entry) => {
          const key = entry.content;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      };
    }
    case "reshape": {
      const parsed = reshapeParamsSchema.safeParse(op.parameters);
      if (!parsed.success) return invalidParams(op, parsed.error.issues);
      const fields = new Set(parsed.data.preserve_fields.map((field) => field.toLowerCase()));
      return {
        kind: "OK",
        entries: entries.map((entry) => ({
          ...entry,
          content: entry.content
            .split("\n")
            .filter((line) => {
              const match = /^([\w][\w ]{0,63}):/.exec(line);
              return match === null ? true : fields.size === 0 || fields.has(match[1]!.trim().toLowerCase());
            })
            .join("\n"),
        })),
      };
    }
  }
}

function invalidParams(op: TransformationOperation, issues: z.ZodIssue[]): TransformationOutcome {
  return {
    kind: "FAILED",
    code: "UPG_VALIDATION_FAILED",
    issues: issues.map((issue) => ({
      field: `operations.${op.op_id}.parameters.${issue.path.map(String).join(".") || "(root)"}`,
      rule: `${issue.code}${issue.message ? ` — ${issue.message}` : ""}`,
    })),
  };
}

export interface ManifestBuildInput {
  dataset: DatasetArtifact;
  intake_id: string;
  manifest_id: string;
  ops: TransformationOperation[];
  now: string;
  created_by: ActorRef;
}

/** Build a manifest by executing the operations and recording each digest. */
export function buildTransformationManifest(input: ManifestBuildInput): {
  outcome: TransformationOutcome;
  manifest: DatasetTransformationManifest | null;
  entries: TransformedEntry[];
} {
  let entries = initialEntries(input.dataset);
  const operations: TransformationOperation[] = [];
  for (const raw of input.ops) {
    const result = executeTransformationOperation(raw, entries);
    if (result.kind === "FAILED") return { outcome: result, manifest: null, entries: [] };
    entries = result.entries;
    const op: TransformationOperation = { ...raw, output_digest: entriesDigest(entries) };
    operations.push(op);
  }
  const manifest: DatasetTransformationManifest = {
    schema_version: UPGRADE_SCHEMA_FAMILY,
    manifest_id: input.manifest_id,
    tenant_id: input.dataset.tenant_id,
    dataset_id: input.dataset.dataset_id,
    intake_id: input.intake_id,
    source_digest: computeCanonicalDigest(input.dataset),
    operations,
    output_digest: entriesDigest(entries),
    created_at: input.now,
    created_by: input.created_by,
  };
  return { outcome: { kind: "OK", entries }, manifest, entries };
}

/**
 * Replay: the same source digest + the same manifest MUST yield the same
 * output digest. Any divergence is a typed UPG_TRANSFORMATION_REPLAY_MISMATCH.
 */
export function replayManifest(
  dataset: DatasetArtifact,
  manifest: DatasetTransformationManifest,
): { outcome: TransformationOutcome; entries: TransformedEntry[] } {
  const sourceDigest = computeCanonicalDigest(dataset);
  if (sourceDigest !== manifest.source_digest) {
    return {
      outcome: {
        kind: "FAILED",
        code: "UPG_INTEGRITY_MISMATCH",
        issues: [{ field: "source_digest", rule: "dataset does not match the manifest's pinned source digest" }],
      },
      entries: [],
    };
  }
  let entries = initialEntries(dataset);
  for (const op of manifest.operations) {
    const result = executeTransformationOperation(op, entries);
    if (result.kind === "FAILED") return { outcome: result, entries: [] };
    entries = result.entries;
    if (entriesDigest(entries) !== op.output_digest) {
      return {
        outcome: {
          kind: "FAILED",
          code: "UPG_TRANSFORMATION_REPLAY_MISMATCH",
          issues: [{ field: `operations.${op.op_id}.output_digest`, rule: "replay produced a different digest" }],
        },
        entries: [],
      };
    }
  }
  if (entriesDigest(entries) !== manifest.output_digest) {
    return {
      outcome: {
        kind: "FAILED",
        code: "UPG_TRANSFORMATION_REPLAY_MISMATCH",
        issues: [{ field: "output_digest", rule: "final replay digest differs from the recorded manifest digest" }],
      },
      entries: [],
    };
  }
  return { outcome: { kind: "OK", entries }, entries };
}

export function computeManifestDigest(manifest: DatasetTransformationManifest): string {
  return computeCanonicalDigest(manifest);
}

export const TRANSFORMATION_REPLAY_RULE =
  "a DatasetTransformationManifest is immutable and reproducible: replaying its recorded operations " +
  "against the pinned source digest must reproduce every recorded output digest exactly; unknown " +
  "operation ids or versions fail closed and corrections produce a new manifest, never an edit";
