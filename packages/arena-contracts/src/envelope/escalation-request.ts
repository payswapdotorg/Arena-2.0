import { z } from "zod";
import {
  CONTRACT_VERSION,
  arenaIdSchema,
  currencyCodeSchema,
  digestSchema,
  isoTimestampSchema,
  nonEmptyMediumSchema,
  nonEmptyShortSchema,
  positiveAmountSchema,
  positiveIntSchema,
  privacyProfileSchema,
  retentionProfileSchema,
  riskTierSchema,
} from "../common.js";
import { acceptanceCriteriaSchema } from "./acceptance-criteria.js";
import { proofPolicySnapshotSchema } from "./proof-policy-snapshot.js";

/**
 * A1 — EscalationRequest 信封（ES2.0 §1 的每一个字段）。
 *
 * 关键规则：
 * - 调用方永远不提供 tenant 字段：tenant 由服务端从认证凭据推导；
 *   本 schema 是 strict object，任何 tenant/tenant_id 输入都会被当作未知字段拒绝
 *   （这正是「租户覆盖尝试」的失败路径）。
 * - 未知字段被拒绝（strict），不被静默解释；新增字段必须走契约版本升级。
 * - contract_version 门控：不支持的版本返回 CONTRACT_VERSION_UNSUPPORTED。
 */

export const taskTypeSchema = z
  .object({
    domain: nonEmptyShortSchema,
    type_id: arenaIdSchema,
    type_version: nonEmptyShortSchema,
  })
  .strict();

export const capabilityRequirementSchema = z
  .object({
    capability_id: arenaIdSchema,
    minimum_level: nonEmptyShortSchema,
  })
  .strict();

export const escalationModeSchema = z.enum([
  "next_expert",
  "budget_stop",
  "manual_review",
  "deadline_stop",
]);

export const inputArtifactSchema = z
  .object({
    artifact_id: arenaIdSchema,
    name: nonEmptyShortSchema,
    media_type: nonEmptyShortSchema,
    content_digest: digestSchema,
    size_bytes: positiveIntSchema,
    rights_basis: nonEmptyMediumSchema,
    provenance: nonEmptyMediumSchema,
  })
  .strict();

export const resultSchemaReferenceSchema = z
  .object({
    schema_id: arenaIdSchema,
    schema_version: nonEmptyShortSchema,
  })
  .strict();

export const deliveryPreferencesSchema = z
  .object({
    channel: z.enum(["webhook", "poll"]),
    webhook_reference: z
      .object({
        url: nonEmptyMediumSchema,
        signature_key_id: arenaIdSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();

export const escalationConstraintsSchema = z
  .object({
    risk_tier: riskTierSchema,
    privacy_profile: privacyProfileSchema,
    retention_profile: retentionProfileSchema,
    jurisdiction: nonEmptyShortSchema.nullable(),
    professional_requirements: z.array(nonEmptyMediumSchema).max(32),
    deadline: isoTimestampSchema,
    escalation_modes: z.array(escalationModeSchema).min(1).max(8),
  })
  .strict();

export const budgetSchema = z
  .object({
    limit_amount: positiveAmountSchema,
    currency: currencyCodeSchema,
    allowed_attempts: positiveIntSchema.max(64),
    per_attempt_limit: positiveAmountSchema.nullable(),
  })
  .strict();

export const escalationRequestSchema = z
  .object({
    contract_version: z.literal(CONTRACT_VERSION),
    client_application_id: arenaIdSchema,
    caller_idempotency_key: nonEmptyShortSchema,
    request_digest: digestSchema,
    task: z
      .object({
        title: nonEmptyShortSchema,
        outcome_description: nonEmptyMediumSchema,
      })
      .strict(),
    task_type: taskTypeSchema,
    required_capabilities: z.array(capabilityRequirementSchema).min(1).max(32),
    required_qualifications: z.array(nonEmptyMediumSchema).max(32),
    acceptance_criteria: acceptanceCriteriaSchema,
    proof_policy: proofPolicySnapshotSchema,
    constraints: escalationConstraintsSchema,
    budget: budgetSchema,
    input_artifacts: z.array(inputArtifactSchema).max(64),
    result_schema: resultSchemaReferenceSchema,
    delivery_preferences: deliveryPreferencesSchema,
  })
  .strict();

export type EscalationRequest = z.infer<typeof escalationRequestSchema>;

/** 未知字段策略（ES2.0 §1）。 */
export const UNKNOWN_FIELD_POLICY =
  "request/result/event envelopes are strict objects: unknown fields are rejected with ERR UNKNOWN_FIELD, " +
  "never silently interpreted; additive fields enter through a new contract_version and a deprecation window";

/** 租户推导策略。 */
export const REQUEST_TENANT_RULE =
  "the server derives tenant ownership from authenticated credentials; this request schema declares no tenant " +
  "input field, so a caller-provided tenant field is structurally rejected";

/**
 * 语义校验（结构校验之后在信任边界调用）。
 */
export interface SemanticIssue {
  field: string;
  rule: string;
}

export function validateEscalationRequestSemantics(input: EscalationRequest): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  if (input.constraints.deadline <= "1970-01-01T00:00:00Z") {
    issues.push({
      field: "constraints.deadline",
      rule: "deadline must be a plausible future timestamp",
    });
  }
  if (
    input.delivery_preferences.channel === "webhook" &&
    input.delivery_preferences.webhook_reference === null
  ) {
    issues.push({
      field: "delivery_preferences.webhook_reference",
      rule: "webhook channel requires an authorized reference",
    });
  }
  if (
    input.budget.per_attempt_limit !== null &&
    input.budget.per_attempt_limit > input.budget.limit_amount
  ) {
    issues.push({
      field: "budget.per_attempt_limit",
      rule: "per-attempt limit must not exceed the aggregate budget limit",
    });
  }
  if (input.proof_policy.budget_ceiling > input.budget.limit_amount) {
    issues.push({
      field: "proof_policy.budget_ceiling",
      rule: "proof policy budget ceiling must not exceed the request budget",
    });
  }
  if (input.proof_policy.retry_next_expert.max_attempts > input.budget.allowed_attempts) {
    issues.push({
      field: "proof_policy.retry_next_expert.max_attempts",
      rule: "retry policy attempts must stay within allowed attempts",
    });
  }
  return issues;
}
