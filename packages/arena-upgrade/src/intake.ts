import { z } from "zod";
import {
  arenaIdSchema,
  isoTimestampSchema,
  nonNegativeIntSchema,
  privacyProfileSchema,
  redactionClassSchema,
  retentionProfileSchema,
  type TenantContext,
} from "@arena/contracts";
import { computeCanonicalDigest } from "@arena/acquisition";
import { checkDatasetArtifact, contentHashOf, type DatasetArtifact } from "@arena/scraper";
import { rightsScopeSchema, type RightsGrantRegistry, type RightsScope } from "@arena/learning";
import {
  UPGRADE_SCHEMA_FAMILY,
  actorRefSchema,
  boundedText,
  nonEmptyShort,
  type ActorRef,
  type SemanticIssue,
} from "./primitives.js";
import type { UpgErrorCode } from "./errors.js";

/**
 * AR2-018 — DatasetIntakeRecord (issue #34; spec §7).
 *
 * Stage-1/2 validation outcome for a source DatasetArtifact. THE LAW: a dataset
 * passing schema validation is NOT a capability upgrade — intake only decides
 * whether the dataset may ENTER the upgrade pipeline. Provenance completeness,
 * explicit RightsGrant linkage, source-policy compliance, tenant scope,
 * privacy/retention class, integrity (re-verified hashes) and content-quality
 * metrics are recorded; every rejection class carries its exact fail-closed
 * reason code. The record itself is immutable once written.
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

export interface IntakeInput {
  dataset: unknown;
  tenant_context: TenantContext;
  rights_registry: RightsGrantRegistry;
  policy: IntakePolicy;
  now: string;
  intake_id: string;
  correlation_id: string;
  causation_id?: string | null;
  recorded_by: ActorRef;
}

const RIGHTS_SCOPE_PROBE_ORDER: readonly RightsScope[] = [
  "single_tenant_reuse",
  "aggregated_anonymous",
  "marketplace_publication",
];

/** Host matches an exact or leftmost-wildcard pattern (mirror of SCRP domain allowlists). */
export function hostMatchesPattern(host: string, pattern: string): boolean {
  if (!pattern.startsWith("*.")) return host === pattern;
  const suffix = pattern.slice(2);
  const labels = host.split(".");
  return labels.length > 2 && host.endsWith(`.${suffix}`) && host !== suffix;
}

/** Explicit RightsGrant linkage across every recorded scope (AR2-014 registry). */
export function evaluateIntakeRights(
  registry: RightsGrantRegistry,
  tenantId: string,
  datasetId: string,
  now: string,
): IntakeRightsState {
  for (const scope of RIGHTS_SCOPE_PROBE_ORDER) {
    const evaluation = registry.evaluateReuseRight({ tenant_id: tenantId, artifact_id: datasetId, scope, now });
    if (evaluation.kind === "RIGHTS_GRANTED") {
      return { state: "LINKED", grant_id: evaluation.grant.grant_id, scope, reason: null };
    }
  }
  const probe = registry.evaluateReuseRight({
    tenant_id: tenantId,
    artifact_id: datasetId,
    scope: "single_tenant_reuse",
    now,
  });
  if (probe.kind === "RIGHTS_GRANTED") {
    return { state: "LINKED", grant_id: probe.grant.grant_id, scope: "single_tenant_reuse", reason: null };
  }
  switch (probe.reason) {
    case "grant_revoked":
      return { state: "DENIED", grant_id: null, scope: null, reason: "covering grant was revoked" };
    case "grant_expired":
      return { state: "EXPIRED", grant_id: null, scope: null, reason: "covering grant has expired" };
    case "scope_mismatch":
      return { state: "SCOPE_MISMATCH", grant_id: null, scope: null, reason: "no active grant in any recorded scope" };
    default:
      return { state: "UNKNOWN", grant_id: null, scope: null, reason: "no explicit RightsGrant linkage" };
  }
}

const STRUCTURED_LINE = /^[\w][\w ]{0,63}:[ \t].+$/;

function qualityMetricsOf(dataset: DatasetArtifact): DatasetQualityMetrics {
  const total = dataset.items.length;
  const urls = new Set<string>();
  const hashes = new Set<string>();
  let structured = 0;
  let quarantined = 0;
  let malformed = 0;
  for (const item of dataset.items) {
    urls.add(item.source_url);
    hashes.add(item.content_hash);
    if (item.quarantine_annotations.length > 0) quarantined += 1;
    const hasStructuredLine = item.content.split("\n").some((line) => STRUCTURED_LINE.test(line));
    if (hasStructuredLine) structured += 1;
    let wellFormed = true;
    try {
      void new URL(item.source_url);
    } catch {
      wellFormed = false;
    }
    if (item.retrieved_at > dataset.emitted_at) wellFormed = false;
    if (!wellFormed) malformed += 1;
  }
  const safe = (n: number) => (total > 0 ? n / total : 0);
  return {
    item_count: total,
    distinct_source_urls: urls.size,
    unique_content_hashes: hashes.size,
    dedup_ratio: total > 0 ? 1 - hashes.size / total : 0,
    field_completeness: safe(structured),
    malformed_item_ratio: safe(malformed),
    quarantined_item_ratio: safe(quarantined),
  };
}

function provenanceChecksOf(dataset: DatasetArtifact): IntakeProvenanceCheck[] {
  const items = dataset.items;
  const all = (predicate: (item: DatasetArtifact["items"][number]) => boolean) => items.every(predicate);
  let urlConsistent = true;
  for (const item of items) {
    try {
      void new URL(item.source_url);
    } catch {
      urlConsistent = false;
    }
  }
  const lineageConsistent = items.every(
    (item) =>
      item.quarantine_annotations.length === 0 ||
      item.transformations.some((step) => step.step === "INJECTION_ANNOTATED"),
  );
  const p = dataset.provenance;
  return [
    { field: "items[].source_url", present: all((i) => i.source_url.length > 0), consistent: urlConsistent },
    { field: "items[].retrieved_at", present: all((i) => i.retrieved_at.length > 0), consistent: all((i) => i.retrieved_at <= dataset.emitted_at) },
    { field: "items[].method+method_version", present: all((i) => i.method.length > 0 && i.method_version.length > 0), consistent: true },
    { field: "items[].license_assessment", present: all((i) => i.license_assessment.length > 0), consistent: true },
    { field: "items[].rights_posture", present: all((i) => i.rights_posture.length > 0), consistent: true },
    { field: "items[].transformations (lineage)", present: all((i) => i.transformations.length >= 1), consistent: lineageConsistent },
    { field: "provenance (engine/crawlee/terminal/digests)", present: p.engine.length > 0 && p.crawlee_version.length > 0 && p.terminal_reason.length > 0 && p.definition_digest.length > 0 && p.build_digest.length > 0, consistent: true },
  ];
}

/**
 * Trust-boundary intake: stage-1 (SCRP1.0 schema) then stage-2 (tenant scope,
 * integrity, provenance, rights, source policy, quality). Always returns a
 * complete immutable record; every rejection class lands in
 * stage2_semantics.reason_codes (fail closed — no partial acceptance).
 */
export function validateDatasetIntake(input: IntakeInput): DatasetIntakeRecord {
  const issues: SemanticIssue[] = [];
  const reasonCodes: UpgErrorCode[] = [];
  const shape = checkDatasetArtifact(input.dataset);
  if (!shape.ok) {
    return blockedShape(input, shape.issues, shape.code);
  }
  const dataset = shape.dataset;
  const tenantId = input.tenant_context.tenant_id;
  if (dataset.tenant_id !== tenantId) {
    issues.push({ field: "tenant_id", rule: "dataset tenant does not match the authenticated tenant context" });
    reasonCodes.push("UPG_TENANT_SCOPE_MISMATCH");
  }

  let perItemVerified = true;
  for (const item of dataset.items) {
    if (contentHashOf(item.content) !== item.content_hash) {
      perItemVerified = false;
      issues.push({ field: `items.${item.item_id}.content_hash`, rule: "content hash re-verification failed" });
    }
  }
  const computedObjectHash = computeCanonicalDigest(dataset.items);
  const objectVerified = computedObjectHash === dataset.object_hash;
  if (!objectVerified) {
    issues.push({ field: "object_hash", rule: "object hash re-verification failed" });
  }
  if (!perItemVerified || !objectVerified) reasonCodes.push("UPG_INTEGRITY_MISMATCH");

  const checks = provenanceChecksOf(dataset);
  const provenanceComplete = checks.every((check) => check.present && check.consistent);
  if (!provenanceComplete) {
    reasonCodes.push("UPG_PROVENANCE_INCOMPLETE");
    for (const check of checks) {
      if (!check.present) issues.push({ field: check.field, rule: "required provenance field is missing" });
      else if (!check.consistent) issues.push({ field: check.field, rule: "provenance fields are internally inconsistent" });
    }
  }

  const rights = evaluateIntakeRights(input.rights_registry, tenantId, dataset.dataset_id, input.now);
  if (rights.state === "UNKNOWN" || rights.state === "SCOPE_MISMATCH") reasonCodes.push("UPG_RIGHTS_UNKNOWN");
  if (rights.state === "DENIED") reasonCodes.push("UPG_RIGHTS_DENIED");
  if (rights.state === "EXPIRED") reasonCodes.push("UPG_RIGHTS_EXPIRED");
  if (dataset.items.some((item) => item.rights_posture === "PROHIBITED")) {
    reasonCodes.push("UPG_RIGHTS_DENIED");
    issues.push({ field: "items[].rights_posture", rule: "an item declares PROHIBITED source rights" });
  }
  if (dataset.items.some((item) => item.rights_posture === "UNKNOWN")) {
    reasonCodes.push("UPG_RIGHTS_UNKNOWN");
    issues.push({ field: "items[].rights_posture", rule: "an item declares UNKNOWN source rights" });
  }

  const violations: Array<{ item_id: string; url: string; rule: string }> = [];
  for (const item of dataset.items) {
    let host: string;
    try {
      host = new URL(item.source_url).hostname.toLowerCase();
    } catch {
      continue;
    }
    const allowed = input.policy.permitted_source_patterns.some((pattern) =>
      hostMatchesPattern(host, pattern.toLowerCase()),
    );
    if (!allowed) violations.push({ item_id: item.item_id, url: item.source_url, rule: "source host outside permitted patterns" });
  }
  if (violations.length > 0) reasonCodes.push("UPG_SOURCE_POLICY_VIOLATION");

  const outcome = issues.length === 0 && reasonCodes.length === 0 && violations.length === 0 ? "ACCEPTED" : "BLOCKED";
  return {
    schema_version: UPGRADE_SCHEMA_FAMILY,
    intake_id: input.intake_id,
    tenant_id: tenantId,
    dataset_id: dataset.dataset_id,
    run_id: dataset.run_id,
    correlation_id: input.correlation_id,
    causation_id: input.causation_id ?? null,
    recorded_at: input.now,
    recorded_by: input.recorded_by,
    outcome,
    stage1_schema: { passed: true, issues: [] },
    stage2_semantics: {
      passed: outcome === "ACCEPTED",
      reason_codes: dedupe(reasonCodes),
      issues: issues.map((issue) => ({ field: issue.field, rule: issue.rule })),
    },
    provenance_completeness: { checks, complete: provenanceComplete },
    rights,
    source_policy: { verdict: violations.length > 0 ? "VIOLATION" : "COMPLIANT", violations },
    privacy_retention: {
      privacy_profile: input.policy.privacy_profile,
      retention_profile: input.policy.retention_profile,
      redaction_classes_observed: [...new Set(dataset.items.map((item) => item.redaction_class))],
    },
    integrity: {
      per_item_verified: perItemVerified,
      object_hash_verified: objectVerified,
      expected_object_hash: dataset.object_hash,
      computed_object_hash: computedObjectHash,
    },
    quality: qualityMetricsOf(dataset),
  };
}

const EMPTY_QUALITY: DatasetQualityMetrics = {
  item_count: 0,
  distinct_source_urls: 0,
  unique_content_hashes: 0,
  dedup_ratio: 0,
  field_completeness: 0,
  malformed_item_ratio: 0,
  quarantined_item_ratio: 0,
};

function blockedShape(input: IntakeInput, issues: SemanticIssue[], code: string): DatasetIntakeRecord {
  return {
    schema_version: UPGRADE_SCHEMA_FAMILY,
    intake_id: input.intake_id,
    tenant_id: input.tenant_context.tenant_id,
    dataset_id: "dst_unknown000",
    run_id: "run_unknown000",
    correlation_id: input.correlation_id,
    causation_id: input.causation_id ?? null,
    recorded_at: input.now,
    recorded_by: input.recorded_by,
    outcome: "BLOCKED",
    stage1_schema: {
      passed: false,
      issues: issues.map((issue) => ({ field: issue.field, rule: issue.rule })).slice(0, 64),
    },
    stage2_semantics: {
      passed: false,
      reason_codes: code === "SCRP_SCHEMA_VERSION_UNSUPPORTED" ? ["UPG_SCHEMA_VERSION_UNSUPPORTED"] : ["UPG_DATASET_SCHEMA_INVALID"],
      issues: [],
    },
    provenance_completeness: { checks: [], complete: false },
    rights: { state: "UNKNOWN", grant_id: null, scope: null, reason: "intake blocked before rights evaluation" },
    source_policy: { verdict: "VIOLATION", violations: [] },
    privacy_retention: {
      privacy_profile: input.policy.privacy_profile,
      retention_profile: input.policy.retention_profile,
      redaction_classes_observed: [],
    },
    integrity: {
      per_item_verified: false,
      object_hash_verified: false,
      expected_object_hash: "0".repeat(64),
      computed_object_hash: "0".repeat(64),
    },
    quality: EMPTY_QUALITY,
  };
}

function dedupe(codes: UpgErrorCode[]): string[] {
  return [...new Set(codes)];
}

/** Ingestion alone is never completion (spec §7 — THE LAW, recorded on the family). */
export const INTAKE_IS_NOT_CAPABILITY_RULE =
  "a DatasetIntakeRecord, even ACCEPTED, only admits a dataset into the upgrade pipeline; it is never " +
  "evidence that an agent capability improved — only a measured before/after delta on a pinned " +
  "evaluation suite can ground that claim, scoped to exactly what was measured";
