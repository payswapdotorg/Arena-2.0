import { createHash } from "node:crypto";
import type { DatasetArtifact } from "@arena/scraper";
import { computeCanonicalDigest } from "@arena/acquisition";
import type { TransformedEntry, DatasetTransformationManifest } from "../manifest.js";
import type { CapabilityUpgradeProposal, DeliveryStrategyId, UpgradePolicySnapshot } from "../proposal.js";
import type { CapabilityPack } from "../pack.js";
import type { UpgErrorCode } from "../errors.js";
import type { ActorRef } from "../primitives.js";

/**
 * AR2-018 — delivery strategy port (issue #34; spec §7 preferred order).
 *
 * A strategy receives (validated manifest, proposal, policy) and produces a
 * deterministic CapabilityPack build. Strategy selection records WHY: the first
 * applicable strategy in the spec §7 preferred order, with per-strategy reason
 * codes. Shared privacy plumbing lives here: entry scoping by redaction class,
 * credential scrubbing and PII redaction — retention/redaction classes
 * propagate from the source dataset into packs as policy requires.
 */

export interface StrategyBuildInput {
  dataset: DatasetArtifact;
  manifest: DatasetTransformationManifest;
  entries: TransformedEntry[];
  proposal: CapabilityUpgradeProposal;
  policy: UpgradePolicySnapshot;
  now: string;
  actor: ActorRef;
  pack_id: string;
  pack_version: number;
  /** Fine-tuning authorization chain (consumed only by the stub strategy). */
  fine_tuning_authorization?: FineTuningAuthorizationChainLike | null;
}

/** Structural contract for the fine-tuning authorization chain (stub gate input). */
export interface FineTuningAuthorizationChainLike {
  authorized: boolean;
  rights_documented: boolean;
  privacy_review_ref: string;
  dataset_validation_ref: string;
  model_target: { model_id: string; version: string; config_digest: string };
  rollback_provenance_ref: string;
}

export interface ScopedEntryExclusion {
  entry_id: string;
  reason_code: string;
}

export interface StrategyBuildLog {
  strategy: DeliveryStrategyId;
  included: number;
  excluded: readonly ScopedEntryExclusion[];
  notes: readonly string[];
}

export type StrategyBuildOutcome =
  | { kind: "BUILT"; pack: CapabilityPack; log: StrategyBuildLog }
  | { kind: "RECORDED_NOT_TRAINED"; record: FineTuningStubRecord }
  | { kind: "BLOCKED"; code: UpgErrorCode; issues: Array<{ field: string; rule: string }> };

/** Fine-tuning stub record: gates recorded, training never executed. */
export interface FineTuningStubRecord {
  trained: false;
  recorded: true;
  strategy: "AUTHORIZED_FINE_TUNING";
  gates: ReadonlyArray<{ gate: string; satisfied: boolean }>;
  model_target: { model_id: string; version: string; config_digest: string } | null;
  rollback_provenance_ref: string | null;
  note: string;
}

export interface StrategyApplicabilityInput {
  entries: readonly TransformedEntry[];
  policy: UpgradePolicySnapshot;
}

export interface CapabilityStrategy {
  readonly strategy: DeliveryStrategyId;
  applicable(input: StrategyApplicabilityInput): { applicable: boolean; reason_code: string };
  build(input: StrategyBuildInput): StrategyBuildOutcome;
}

const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bghp_[A-Za-z0-9]{16,}\b/g,
  /\bAKIA[A-Z0-9]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{10,}\b/g,
  /\bapify-token-[A-Za-z0-9-]{8,}\b/gi,
];

const PII_PATTERNS: readonly RegExp[] = [/\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g];

/** Credential values never survive into packs, records or logs. */
export function scrubSecrets(content: string): string {
  let scrubbed = content;
  for (const pattern of CREDENTIAL_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, "[REDACTED:credential]");
  }
  return scrubbed;
}

/** PII redaction (policy-gated; emails are the modeled class). */
export function redactPii(content: string): string {
  let redacted = content;
  for (const pattern of PII_PATTERNS) {
    redacted = redacted.replace(pattern, "[PII-REDACTED:email]");
  }
  return redacted;
}

export interface ScopeResult {
  included: Array<{ entry: TransformedEntry; content: string }>;
  excluded: ScopedEntryExclusion[];
}

/**
 * Shared privacy/rights scoping: entries whose redaction class is not
 * permitted by the policy snapshot are excluded (never silently included);
 * surviving content is credential-scrubbed always and PII-redacted when the
 * policy requires it.
 */
export function scopeEntries(
  entries: readonly TransformedEntry[],
  policy: UpgradePolicySnapshot,
): ScopeResult {
  const included: Array<{ entry: TransformedEntry; content: string }> = [];
  const excluded: ScopedEntryExclusion[] = [];
  const permitted = new Set<string>(policy.permitted_redaction_classes);
  for (const entry of entries) {
    if (!permitted.has(entry.redaction_class)) {
      excluded.push({ entry_id: entry.entry_id, reason_code: "REDACTION_CLASS_NOT_PERMITTED" });
      continue;
    }
    let content = scrubSecrets(entry.content);
    if (policy.pii_redaction_required) content = redactPii(content);
    included.push({ entry, content });
  }
  return { included, excluded };
}

/** Deterministic tokenization for term indexes (no stopwords beyond syntax). */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
}

/** Deterministic content-addressed entry id (prefix + digest head, arena-id shape). */
export function derivedEntryId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\u0001"), "utf8").digest("hex");
  return `${prefix}${digest.slice(0, 16)}${digest.slice(16, 20)}`;
}

/** Build-inputs digest (deterministic build provenance anchor). */
export function computeBuildInputsDigest(input: StrategyBuildInput): string {
  return computeCanonicalDigest({
    manifest_digest: computeCanonicalDigest(input.manifest),
    dataset_digest: computeCanonicalDigest(input.dataset),
    strategy: input.proposal.delivery_strategy.strategy,
    policy_digest: computeCanonicalDigest(input.policy),
    pack_id: input.pack_id,
    pack_version: input.pack_version,
  });
}

export function baselinePackRecordFields(input: StrategyBuildInput) {
  return {
    schema_version: "UPG1.0" as const,
    pack_id: input.pack_id,
    version: input.pack_version,
    tenant_id: input.proposal.tenant_id,
    source_dataset_digest: computeCanonicalDigest(input.dataset),
    transformations_manifest_digest: computeCanonicalDigest(input.manifest),
    target_capability_composition_digest: input.proposal.target_capability.content_digest,
    build_provenance: {
      built_at: input.now,
      built_by: input.actor,
      build_inputs_digest: computeBuildInputsDigest(input),
      deterministic: true as const,
    },
    compatibility_scope: {
      body_id: input.proposal.target_capability.body_id,
      min_version: input.proposal.target_capability.body_version,
      max_version: input.proposal.target_capability.body_version,
    },
    retention_expiry: {
      retention_profile: input.policy.retention_profile,
      privacy_profile: input.policy.privacy_profile,
      redaction_class: "tenant",
      excluded_entry_count: 0,
      expires_at: null,
    },
  };
}

/** Most restrictive redaction class among the entries actually included. */
export function mostRestrictiveClass(
  classes: readonly string[],
): "public" | "tenant" | "reviewer_private" | "operator" {
  const order = ["public", "tenant", "reviewer_private", "operator"] as const;
  let strictest: "public" | "tenant" | "reviewer_private" | "operator" = "public";
  for (const candidate of order) {
    if (classes.includes(candidate)) {
      strictest = candidate;
    }
  }
  return strictest;
}

const PREFERRED_ORDER: readonly DeliveryStrategyId[] = [
  "SCOPED_RETRIEVAL_INDEX",
  "STRUCTURED_KNOWLEDGE_PACK",
  "TOOL_ADAPTER",
  "RULES_EXAMPLES",
  "AUTHORIZED_FINE_TUNING",
];

export interface StrategySelectionResult {
  strategy: DeliveryStrategyId;
  reason_code: string;
  applied_order: ReadonlyArray<{ strategy: DeliveryStrategyId; applicable: boolean; reason_code: string }>;
}

/**
 * First-applicable selection over the spec §7 preferred order given data
 * shape + policy. Deterministic: same entries + policy → same decision.
 */
export function selectStrategy(
  strategies: Readonly<Record<string, CapabilityStrategy>>,
  input: StrategyApplicabilityInput,
): StrategySelectionResult {
  const applied = PREFERRED_ORDER.map((id) => {
    const strategy = strategies[id];
    if (strategy === undefined) {
      return { strategy: id, applicable: false, reason_code: "strategy_not_registered" };
    }
    const verdict = strategy.applicable(input);
    return { strategy: id, applicable: verdict.applicable, reason_code: verdict.reason_code };
  });
  const first = applied.find((candidate) => candidate.applicable);
  if (first === undefined) {
    return {
      strategy: "SCOPED_RETRIEVAL_INDEX",
      reason_code: "no_strategy_applicable",
      applied_order: applied,
    };
  }
  return { strategy: first.strategy, reason_code: "first_applicable_preferred_order", applied_order: applied };
}
