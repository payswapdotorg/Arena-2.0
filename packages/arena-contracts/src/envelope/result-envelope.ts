import { z } from "zod";
import {
  CONTRACT_VERSION,
  arenaIdSchema,
  digestSchema,
  isoTimestampSchema,
  nonEmptyMediumSchema,
  proofClassSchema,
} from "../common.js";

/**
 * A7 — ResultEnvelope 契约（ES2.0 §4 的每一个字段）。
 * payment 字段是「资格引用」，不是结算声明；
 * 永不把隐藏 chain-of-thought 当作必备证据返回；
 * 敏感字段与 reviewer 私有 rationale 使用独立授权 scope。
 */

export const resultStatusSchema = z.enum([
  "ACCEPTED",
  "PARTIALLY_ACCEPTED",
  "REJECTED",
  "INCONCLUSIVE",
  "EXPIRED",
  "FAILED",
]);

export const criterionDecisionSchema = z.enum(["PASS", "FAIL", "INCONCLUSIVE", "NOT_EVALUATED"]);

export const criterionOutcomeSchema = z
  .object({
    criterion_id: arenaIdSchema,
    decision: criterionDecisionSchema,
    proof_class: proofClassSchema,
    evidence_ids: z.array(arenaIdSchema).max(64),
    hard_stop_triggered: z.boolean(),
  })
  .strict();

export const verificationTrailSchema = z
  .object({
    validator_ids: z.array(arenaIdSchema).max(32),
    validator_versions: z.array(nonEmptyMediumSchema).max(32),
    reviewer_ids: z.array(arenaIdSchema).max(32),
    adjudicator_id: arenaIdSchema.nullable(),
    outcomes: z.array(nonEmptyMediumSchema).max(32),
    policy_version: nonEmptyMediumSchema,
  })
  .strict();

export const structuredOutputSchema = z
  .object({
    schema_id: arenaIdSchema,
    schema_version: nonEmptyMediumSchema,
    data: z.unknown(),
  })
  .strict();

export const paymentEligibilityReferenceSchema = z
  .object({
    eligibility_id: arenaIdSchema,
    is_reference_only: z.literal(true),
  })
  .strict();

export const resultEnvelopeSchema = z
  .object({
    result_id: arenaIdSchema,
    escalation_id: arenaIdSchema,
    attempt_id: arenaIdSchema,
    tenant_id: arenaIdSchema,
    status: resultStatusSchema,
    structured_outputs: structuredOutputSchema,
    criterion_decisions: z.array(criterionOutcomeSchema).min(1).max(64),
    proof_class: proofClassSchema,
    evidence_references: z
      .array(z.object({ evidence_id: arenaIdSchema, integrity_digest: digestSchema }).strict())
      .max(64),
    verification: verificationTrailSchema,
    limitations: z.array(nonEmptyMediumSchema).max(32),
    assumptions: z.array(nonEmptyMediumSchema).max(32),
    residual_risk: nonEmptyMediumSchema.nullable(),
    follow_up_recommendations: z.array(nonEmptyMediumSchema).max(32),
    artifact: z
      .object({
        artifact_version: nonEmptyMediumSchema,
        lineage: z.array(digestSchema).max(64),
      })
      .strict(),
    payment_eligibility_reference: paymentEligibilityReferenceSchema.nullable(),
    correlation_id: arenaIdSchema,
    created_at: isoTimestampSchema,
    contract_version: z.literal(CONTRACT_VERSION),
  })
  .strict();

export type ResultEnvelope = z.infer<typeof resultEnvelopeSchema>;

/** 支付资格 ≠ 结算（PVP1.0 §4）。 */
export const ELIGIBILITY_IS_NOT_SETTLEMENT_RULE =
  "payment_eligibility_reference is a reference to a durable payment-domain decision, never a claim of " +
  "actual settlement; provider acknowledgement and ledger reconciliation establish settlement";

/** CoT 禁令（architecture-lock 第 13 条）。 */
export const NO_CHAIN_OF_THOUGHT_RULE =
  "hidden chain-of-thought is never returned as required evidence; sensitive fields and reviewer-private " +
  "rationale use separate authorization scopes";

/**
 * 语义校验。
 */
export interface SemanticIssue {
  field: string;
  rule: string;
}

export function validateResultEnvelopeSemantics(input: ResultEnvelope): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  if (
    input.status === "ACCEPTED" &&
    input.criterion_decisions.some((c) => c.decision === "FAIL" && c.hard_stop_triggered)
  ) {
    issues.push({
      field: "criterion_decisions",
      rule: "ACCEPTED cannot carry a triggered hard-stop failure",
    });
  }
  if (input.status === "REJECTED" && input.payment_eligibility_reference !== null) {
    issues.push({
      field: "payment_eligibility_reference",
      rule: "REJECTED results carry no payment eligibility",
    });
  }
  if (
    input.criterion_decisions.some((c) => c.decision === "INCONCLUSIVE") &&
    input.status === "ACCEPTED"
  ) {
    issues.push({ field: "status", rule: "inconclusive criteria cannot yield ACCEPTED" });
  }
  if (input.status === "FAILED" && input.residual_risk === null) {
    issues.push({ field: "residual_risk", rule: "FAILED results must state residual risk" });
  }
  return issues;
}
