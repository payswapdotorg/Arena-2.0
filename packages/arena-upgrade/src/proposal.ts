import { z } from "zod";
import {
  arenaIdSchema,
  currencyCodeSchema,
  digestSchema,
  isoTimestampSchema,
  nonNegativeAmountSchema,
  nonNegativeIntSchema,
  positiveIntSchema,
  privacyProfileSchema,
  redactionClassSchema,
  retentionProfileSchema,
  riskTierSchema,
} from "@arena/contracts";
import { computeCanonicalDigest } from "@arena/acquisition";
import { rightsScopeSchema } from "@arena/learning";
import {
  UPGRADE_SCHEMA_FAMILY,
  actorRefSchema,
  boundedText,
  nonEmptyShort,
  useKindSchema,
  type SemanticIssue,
} from "./primitives.js";
import type { UpgErrorCode } from "./errors.js";

/**
 * AR2-018 — CapabilityUpgradeProposal (issue #34; spec §2/§7).
 *
 * The central record linking a validated dataset (via its transformation
 * manifest) to the capability gap it claims to reduce. Immutable once
 * submitted: the state machine SUBMITTED → EVALUATED → (PUBLISHED |
 * INCONCLUSIVE | FAILED | REJECTED) progresses only through append-only
 * events; a proposal never rewrites its own history.
 */

export const deliveryStrategyIdSchema = z.enum([
  "SCOPED_RETRIEVAL_INDEX",
  "STRUCTURED_KNOWLEDGE_PACK",
  "TOOL_ADAPTER",
  "RULES_EXAMPLES",
  "AUTHORIZED_FINE_TUNING",
]);

export type DeliveryStrategyId = z.infer<typeof deliveryStrategyIdSchema>;

export const strategyApplicabilitySchema = z
  .object({
    strategy: deliveryStrategyIdSchema,
    applicable: z.boolean(),
    reason_code: nonEmptyShort,
  })
  .strict();

export type StrategyApplicability = z.infer<typeof strategyApplicabilitySchema>;

export const strategySelectionSchema = z
  .object({
    strategy: deliveryStrategyIdSchema,
    reason_code: nonEmptyShort,
    applied_order: z.array(strategyApplicabilitySchema).max(5),
  })
  .strict();

export type StrategySelection = z.infer<typeof strategySelectionSchema>;

export const upgradePolicySnapshotSchema = z
  .object({
    policy_version: nonEmptyShort,
    permitted_use_kinds: z.array(useKindSchema).min(1).max(6),
    min_target_metric_delta: z.number().min(0).max(1),
    max_regression_failures: nonNegativeIntSchema,
    require_leakage_pass: z.boolean(),
    require_guardrail_pass: z.boolean(),
    permitted_redaction_classes: z.array(redactionClassSchema).min(1).max(4),
    pii_redaction_required: z.boolean(),
    fine_tuning_authorized: z.boolean(),
    fine_tuning_approval_ref: boundedText.nullable(),
    retention_profile: retentionProfileSchema,
    privacy_profile: privacyProfileSchema,
    risk_tier: riskTierSchema,
  })
  .strict();

export type UpgradePolicySnapshot = z.infer<typeof upgradePolicySnapshotSchema>;

export const proposalSourceReferenceSchema = z
  .object({
    dataset_id: arenaIdSchema,
    intake_id: arenaIdSchema,
    manifest_id: arenaIdSchema,
    manifest_digest: digestSchema,
    source_digest: digestSchema,
  })
  .strict();

export type ProposalSourceReference = z.infer<typeof proposalSourceReferenceSchema>;

export const proposalTargetCapabilitySchema = z
  .object({
    body_id: arenaIdSchema,
    body_version: positiveIntSchema,
    content_digest: digestSchema,
  })
  .strict();

export type ProposalTargetCapability = z.infer<typeof proposalTargetCapabilitySchema>;

export const evaluationSuiteReferenceSchema = z
  .object({
    suite_id: arenaIdSchema,
    suite_version: nonEmptyShort,
    suite_digest: digestSchema,
  })
  .strict();

export type EvaluationSuiteReference = z.infer<typeof evaluationSuiteReferenceSchema>;

export const proposalEventSchema = z
  .object({
    event_id: arenaIdSchema,
    at: isoTimestampSchema,
    from: z.enum(["SUBMITTED", "EVALUATED", "PUBLISHED", "INCONCLUSIVE", "FAILED", "REJECTED"]),
    to: z.enum(["SUBMITTED", "EVALUATED", "PUBLISHED", "INCONCLUSIVE", "FAILED", "REJECTED"]),
    reason_code: nonEmptyShort,
    actor: actorRefSchema,
    evidence: z
      .array(z.object({ ref_kind: nonEmptyShort, ref_id: arenaIdSchema, digest: digestSchema }).strict())
      .max(16),
  })
  .strict();

export type ProposalEvent = z.infer<typeof proposalEventSchema>;

export const proposalStateSchema = z.enum([
  "SUBMITTED",
  "EVALUATED",
  "PUBLISHED",
  "INCONCLUSIVE",
  "FAILED",
  "REJECTED",
]);

export type ProposalState = z.infer<typeof proposalStateSchema>;

export const capabilityUpgradeProposalSchema = z
  .object({
    schema_version: z.literal(UPGRADE_SCHEMA_FAMILY),
    proposal_id: arenaIdSchema,
    tenant_id: arenaIdSchema,
    idempotency_key: nonEmptyShort,
    correlation_id: arenaIdSchema,
    causation_id: arenaIdSchema.nullable(),
    source: proposalSourceReferenceSchema,
    target_gap: z
      .object({ gap_report_id: arenaIdSchema, gap_report_digest: digestSchema })
      .strict(),
    target_capability: proposalTargetCapabilitySchema,
    delivery_strategy: strategySelectionSchema,
    policy_snapshot: upgradePolicySnapshotSchema,
    policy_snapshot_digest: digestSchema,
    evaluation_suite_ref: evaluationSuiteReferenceSchema,
    proposed_publication_scope: z
      .object({ tenant_id: arenaIdSchema, scope: rightsScopeSchema })
      .strict(),
    cost_retention: z
      .object({
        estimated_cost_usd: nonNegativeAmountSchema,
        currency: currencyCodeSchema,
        retention_profile: retentionProfileSchema,
        privacy_profile: privacyProfileSchema,
      })
      .strict(),
    proposed_by: actorRefSchema,
    created_at: isoTimestampSchema,
    state: proposalStateSchema,
    events: z.array(proposalEventSchema).max(256),
  })
  .strict();

export type CapabilityUpgradeProposal = z.infer<typeof capabilityUpgradeProposalSchema>;

/** Legal state-machine edges with their reason codes (append-only events). */
export const PROPOSAL_TRANSITIONS: Record<ProposalState, Partial<Record<ProposalState, string>>> = {
  SUBMITTED: { EVALUATED: "evaluation_completed", REJECTED: "rejected_before_evaluation" },
  EVALUATED: {
    PUBLISHED: "publication_approved",
    INCONCLUSIVE: "thresholds_not_met",
    FAILED: "evaluation_failed",
    REJECTED: "rights_or_policy_blocked",
  },
  PUBLISHED: {},
  INCONCLUSIVE: {},
  FAILED: {},
  REJECTED: {},
};

export function proposalStateIsTerminal(state: ProposalState): boolean {
  return Object.keys(PROPOSAL_TRANSITIONS[state]).length === 0;
}

export type TransitionCheck =
  | { ok: true; reason_code: string }
  | { ok: false; code: UpgErrorCode; allowed: ProposalState[] };

export function evaluateProposalTransition(from: ProposalState, to: ProposalState): TransitionCheck {
  const reason = PROPOSAL_TRANSITIONS[from][to];
  if (reason === undefined) {
    return {
      ok: false,
      code: "UPG_STATE_TRANSITION_ILLEGAL",
      allowed: Object.keys(PROPOSAL_TRANSITIONS[from]) as ProposalState[],
    };
  }
  return { ok: true, reason_code: reason };
}

/** Canonical digest (idempotency + cross-plane anchoring). */
export function computeProposalDigest(proposal: CapabilityUpgradeProposal): string {
  return computeCanonicalDigest(proposal);
}

/** Policy snapshot digest (mirrors the gap-report digest convention). */
export function computePolicySnapshotDigest(policy: UpgradePolicySnapshot): string {
  return computeCanonicalDigest(policy);
}

/** Cross-field semantics checked at trust boundaries. */
export function validateProposalSemantics(proposal: CapabilityUpgradeProposal): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  if (proposal.target_capability.body_version < 1) {
    issues.push({ field: "target_capability.body_version", rule: "body versions are positive integers" });
  }
  if (
    proposal.policy_snapshot.fine_tuning_authorized &&
    (proposal.policy_snapshot.fine_tuning_approval_ref === null ||
      !proposal.policy_snapshot.permitted_use_kinds.includes("FINE_TUNING"))
  ) {
    issues.push({
      field: "policy_snapshot.fine_tuning_authorized",
      rule: "fine-tuning authorization requires an approval reference and the FINE_TUNING use kind",
    });
  }
  if (
    proposal.delivery_strategy.strategy === "AUTHORIZED_FINE_TUNING" &&
    !proposal.policy_snapshot.fine_tuning_authorized
  ) {
    issues.push({
      field: "delivery_strategy.strategy",
      rule: "AUTHORIZED_FINE_TUNING may only be selected under explicit policy authorization",
    });
  }
  const seen = new Set<string>();
  for (const event of proposal.events) {
    if (event.from !== event.to && proposalStateIsTerminal(event.from)) {
      issues.push({ field: "events", rule: `terminal state ${event.from} cannot transition` });
    }
    if (seen.has(event.event_id)) {
      issues.push({ field: "events.event_id", rule: "proposal event ids must be unique" });
    }
    seen.add(event.event_id);
  }
  return issues;
}

export const PROPOSAL_IMMUTABILITY_RULE =
  "a CapabilityUpgradeProposal is immutable once submitted: state changes only through append-only " +
  "events on the frozen SUBMITTED → EVALUATED → (PUBLISHED | INCONCLUSIVE | FAILED | REJECTED) " +
  "state machine; every illegal edge is rejected with UPG_STATE_TRANSITION_ILLEGAL and the allowed set";
