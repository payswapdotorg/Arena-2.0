import { z } from "zod";
import {
  arenaIdSchema,
  currencyCodeSchema,
  digestSchema,
  isoTimestampSchema,
  nonNegativeAmountSchema,
  nonEmptyMediumSchema,
  positiveIntSchema,
} from "../common.js";

/**
 * A4 — Attempt 聚合契约（ES2.0 §3：assignment、attempt 预算消耗、capsule 链接、
 * 已提交的 candidate 版本）。
 * 失败尝试是不可变历史：重试创建新 attempt，绝不覆盖失败记录（PVP1.0 §4）。
 */

export const attemptStatusSchema = z.enum([
  "CREATED",
  "ASSIGNED",
  "ENVIRONMENT_READY",
  "SUBMITTED",
  "VERIFYING",
  "ACCEPTED",
  "REJECTED",
  "INCONCLUSIVE",
  "FAILED",
  "EXPIRED",
  "SUPERSEDED",
]);

export const attemptFailureReasonSchema = z.enum([
  "VALIDATOR_FAILED",
  "EXPERT_DECLINED",
  "ENVIRONMENT_FAILURE",
  "DEADLINE_EXCEEDED",
  "BUDGET_EXHAUSTED",
  "EVIDENCE_REJECTED",
  "EXPERT_UNABLE",
]);

export const expertAssignmentSchema = z
  .object({
    expert_id: arenaIdSchema,
    capability_profile_digest: digestSchema,
    qualification_digest: digestSchema,
    conflict_check_digest: digestSchema,
    assigned_at: isoTimestampSchema,
  })
  .strict();

export const attemptBudgetSchema = z
  .object({
    authorized_amount: nonNegativeAmountSchema,
    currency: currencyCodeSchema,
    consumed_amount: nonNegativeAmountSchema,
    remaining_amount: nonNegativeAmountSchema,
  })
  .strict();

export const attemptCapsuleLinkSchema = z
  .object({
    capsule_id: arenaIdSchema,
    manifest_digest: digestSchema,
    environment_ready: z.boolean(),
    teardown_verified: z.boolean(),
  })
  .strict();

export const candidateVersionSchema = z
  .object({
    candidate_version: positiveIntSchema,
    submitted_at: isoTimestampSchema,
    artifact_manifest_digest: digestSchema,
    immutable: z.literal(true),
  })
  .strict();

export const attemptFailureRecordSchema = z
  .object({
    reason_code: attemptFailureReasonSchema,
    evidence_reference: arenaIdSchema,
    reason_detail: nonEmptyMediumSchema,
    failed_at: isoTimestampSchema,
  })
  .strict();

export const attemptSchema = z
  .object({
    attempt_id: arenaIdSchema,
    escalation_id: arenaIdSchema,
    attempt_number: positiveIntSchema,
    status: attemptStatusSchema,
    expert: expertAssignmentSchema,
    budget: attemptBudgetSchema,
    capsule: attemptCapsuleLinkSchema,
    candidates: z.array(candidateVersionSchema).max(64),
    failure: attemptFailureRecordSchema.nullable(),
    created_at: isoTimestampSchema,
    updated_at: isoTimestampSchema,
  })
  .strict();

export type Attempt = z.infer<typeof attemptSchema>;

/** Attempt 不可变历史规则。 */
export const ATTEMPT_HISTORY_RULE =
  "a validation pass records an immutable evidence decision; a retry creates a new attempt and never " +
  "overwrites the failed attempt; a replacement expert receives prior history for avoidance but inherits " +
  "neither attribution nor payment entitlement (PVP1.0 §4/§5)";

/**
 * 语义校验。
 */
export interface SemanticIssue {
  field: string;
  rule: string;
}

export function validateAttemptSemantics(input: Attempt): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  if (input.budget.consumed_amount > input.budget.authorized_amount) {
    issues.push({
      field: "budget.consumed_amount",
      rule: "attempt consumption must not exceed authorization",
    });
  }
  if (
    Math.abs(
      input.budget.authorized_amount - input.budget.consumed_amount - input.budget.remaining_amount,
    ) > 1e-9
  ) {
    issues.push({
      field: "budget.remaining_amount",
      rule: "remaining must equal authorized minus consumed",
    });
  }
  if (input.status === "FAILED" && input.failure === null) {
    issues.push({
      field: "failure",
      rule: "a failed attempt must carry evidence and reason codes",
    });
  }
  if (input.status === "SUBMITTED" && input.candidates.length === 0) {
    issues.push({
      field: "candidates",
      rule: "no SUBMITTED state without an immutable candidate version",
    });
  }
  if (input.status === "ENVIRONMENT_READY" && !input.capsule.environment_ready) {
    issues.push({
      field: "capsule.environment_ready",
      rule: "escalation ENVIRONMENT_READY requires capsule readiness",
    });
  }
  return issues;
}
