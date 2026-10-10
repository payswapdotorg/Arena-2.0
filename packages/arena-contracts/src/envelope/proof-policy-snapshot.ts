import { z } from "zod";
import {
  PROOF_POLICY_VERSION,
  arenaIdSchema,
  digestSchema,
  nonEmptyMediumSchema,
  nonEmptyShortSchema,
  positiveAmountSchema,
  positiveIntSchema,
  proofClassSchema,
  semverSchema,
} from "../common.js";
import { acceptanceCriteriaSchema } from "./acceptance-criteria.js";

/**
 * A3 — ProofPolicySnapshot（ES2.0 §1；PVP1.0 全文为规范来源）。
 * 在请求创建时持久化：proof class、验收标准、validators、基线证据要求、
 * rerun 策略、timeout、争议条件、预算上限、支付策略版本。
 * 这些内容在工作开始后不可追溯削弱（PVP1.0 §1）。
 * snapshot 通过 version + content_digest 双重钉死。
 */

export const validatorKindSchema = z.enum([
  "deterministic",
  "statistical",
  "rubric",
  "field_observer",
]);

export const validatorDescriptorSchema = z
  .object({
    validator_id: arenaIdSchema,
    validator_version: semverSchema,
    kind: validatorKindSchema,
    allowed_commands: z.array(nonEmptyShortSchema).max(128),
    timeout_seconds: positiveIntSchema,
    resource_limits: nonEmptyMediumSchema,
    evidence_policy: nonEmptyMediumSchema,
  })
  .strict();

export const rerunPolicySchema = z
  .object({
    minimum_reruns: positiveIntSchema,
    risk_exception: nonEmptyMediumSchema.nullable(),
  })
  .strict();

export const samplePolicySchema = z
  .object({
    sample_size: positiveIntSchema,
    repetitions: positiveIntSchema,
    aggregate_threshold: nonEmptyMediumSchema,
    inconclusive_rule: z.enum([
      "retry_within_budget",
      "independent_review",
      "next_expert",
      "fail_closed",
    ]),
  })
  .strict();

export const reviewPolicySchema = z
  .object({
    minimum_independent_reviews: positiveIntSchema.min(2),
    raise_to: positiveIntSchema.min(3).nullable(),
    blind: z.boolean(),
    rubric_version: semverSchema,
    adjudication_trigger: nonEmptyMediumSchema,
    abstention_policy: nonEmptyMediumSchema,
  })
  .strict();

export const observationPolicySchema = z
  .object({
    observation_period: nonEmptyMediumSchema,
    trusted_sources: z.array(nonEmptyMediumSchema).min(1).max(16),
    attestation_rule: nonEmptyMediumSchema,
    interim_milestones: nonEmptyMediumSchema.nullable(),
    dispute_process: nonEmptyMediumSchema,
  })
  .strict();

export const payoutGateSchema = z
  .object({
    release_requires: z.enum([
      "all_predicates_pass",
      "aggregate_threshold_pass",
      "rubric_plus_independent_approval",
      "observation_gate_pass",
    ]),
    caller_authenticity_verified: z.boolean(),
    task_binding_verified: z.boolean(),
    dispute_blocks_release: z.boolean().refine((v) => v === true, {
      message:
        "dispute_blocks_release must be true (PVP1.0: disputed or inconclusive blocks release)",
    }),
  })
  .strict();

export const retryNextExpertPolicySchema = z
  .object({
    max_attempts: positiveIntSchema,
    max_aggregate_spend: positiveAmountSchema,
    cooldown_policy: nonEmptyMediumSchema,
    failed_attempt_posture: z.enum(["rollback", "isolate_branch", "retain_attributed"]),
    next_expert_baseline: z.enum([
      "immutable_baseline_only",
      "baseline_plus_approved_prior_attempts",
    ]),
  })
  .strict();

export const proofPolicySnapshotSchema = z
  .object({
    policy_version: z.literal(PROOF_POLICY_VERSION),
    content_digest: digestSchema,
    selected_class: proofClassSchema,
    selection_rationale: nonEmptyMediumSchema,
    per_criterion_classes: z
      .array(z.object({ criterion_id: arenaIdSchema, proof_class: proofClassSchema }).strict())
      .max(64),
    validators: z.array(validatorDescriptorSchema).min(1).max(16),
    rerun_policy: rerunPolicySchema,
    sample_policy: samplePolicySchema.nullable(),
    review_policy: reviewPolicySchema.nullable(),
    observation_policy: observationPolicySchema.nullable(),
    payout_gate: payoutGateSchema,
    retry_next_expert: retryNextExpertPolicySchema,
    timeout: nonEmptyMediumSchema,
    dispute_conditions: nonEmptyMediumSchema,
    budget_ceiling: positiveAmountSchema,
  })
  .strict();

export type ProofPolicySnapshot = z.infer<typeof proofPolicySnapshotSchema>;

/** snapshot 钉死规则。 */
export const PROOF_POLICY_SNAPSHOT_RULE =
  "the selected class, rationale, validators and policy fields are pinned by policy_version + content_digest " +
  "and are immutable for that task version; a validation pass records an immutable evidence decision and " +
  "a retry creates a new attempt rather than overwriting the failed one (PVP1.0 §3/§4)";

/**
 * 语义校验：按等级强制条件（PVP1.0 §2/§3）。
 */
export interface SemanticIssue {
  field: string;
  rule: string;
}

export function validateProofPolicySemantics(
  snapshot: ProofPolicySnapshot,
  criteria?: z.infer<typeof acceptanceCriteriaSchema>,
): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  const cls = snapshot.selected_class;
  if (cls === "P1" && snapshot.sample_policy === null) {
    issues.push({
      field: "sample_policy",
      rule: "P1 requires a sample policy (size/repetitions/threshold/inconclusive rule)",
    });
  }
  if (cls === "P2" && snapshot.review_policy === null) {
    issues.push({
      field: "review_policy",
      rule: "P2 requires an independent review policy with minimum quorum >= 2",
    });
  }
  if (cls === "P3" && snapshot.observation_policy === null) {
    issues.push({
      field: "observation_policy",
      rule: "P3 requires an observation policy with trusted sources and attestation",
    });
  }
  if (cls === "P0" && snapshot.rerun_policy.minimum_reruns < 1) {
    issues.push({
      field: "rerun_policy.minimum_reruns",
      rule: "P0 payout-critical deterministic checks rerun at least once",
    });
  }
  if (snapshot.review_policy !== null && snapshot.review_policy.minimum_independent_reviews < 2) {
    issues.push({
      field: "review_policy.minimum_independent_reviews",
      rule: "P2 default minimum is two independent blind reviews",
    });
  }
  if (cls === "P2" && !snapshot.validators.some((v) => v.kind === "rubric")) {
    issues.push({
      field: "validators",
      rule: "P2 requires a versioned rubric validator established before candidate review",
    });
  }
  if (criteria !== undefined) {
    for (const per of snapshot.per_criterion_classes) {
      if (!criteria.some((c) => c.criterion_id === per.criterion_id)) {
        issues.push({
          field: "per_criterion_classes",
          rule: "per-criterion proof class must reference a declared criterion",
        });
      }
    }
  }
  return issues;
}
