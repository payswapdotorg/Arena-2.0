import { z } from "zod";
import {
  arenaIdSchema,
  nonEmptyMediumSchema,
  nonEmptyShortSchema,
  positiveAmountSchema,
  proofClassSchema,
} from "../common.js";

/**
 * A2 — 验收标准结构（ES2.0 §1：criterion IDs、measurement 定义、hard-stop 规则；一经接受即不可变）。
 * 不可变性由状态机（AmendEscalation 仅在 CREATED/CLARIFICATION 阶段允许）与
 * 版本化修正（新版本、绝不原地改写）共同强制。
 */

export const criterionComparatorSchema = z.enum([
  "eq",
  "ne",
  "lt",
  "le",
  "gt",
  "ge",
  "contains",
  "matches",
  "passes_predicate",
]);

export const criterionMeasurementSchema = z
  .object({
    definition: nonEmptyMediumSchema,
    metric: nonEmptyShortSchema.nullable(),
    unit: nonEmptyShortSchema.nullable(),
    threshold: z.union([z.string(), z.number()]).nullable(),
    comparator: criterionComparatorSchema,
  })
  .strict();

export const acceptanceCriterionSchema = z
  .object({
    criterion_id: arenaIdSchema,
    statement: nonEmptyMediumSchema,
    measurement: criterionMeasurementSchema,
    hard_stop: z.boolean(),
    proof_class: proofClassSchema,
    weight: positiveAmountSchema.max(1).nullable(),
  })
  .strict();

export const acceptanceCriteriaSchema = z.array(acceptanceCriterionSchema).min(1).max(64);

export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;
export type AcceptanceCriteria = z.infer<typeof acceptanceCriteriaSchema>;

/** 验收标准不可变规则（PVP1.0 §1：开工会话后不得追溯削弱）。 */
export const ACCEPTANCE_CRITERIA_IMMUTABILITY_RULE =
  "acceptance criteria are immutable once the escalation leaves the pre-assignment states; " +
  "changes require an explicit versioned amendment (AmendEscalation) with recorded client approval, " +
  "and never retroactively weaken criteria after work has begun";

/**
 * 语义校验：跨 criterion 规则。
 */
export interface SemanticIssue {
  field: string;
  rule: string;
}

export function validateAcceptanceCriteriaSemantics(criteria: AcceptanceCriteria): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  const seen = new Set<string>();
  for (const criterion of criteria) {
    if (seen.has(criterion.criterion_id)) {
      issues.push({
        field: "criterion_id",
        rule: "criterion IDs must be unique within the escalation",
      });
    }
    seen.add(criterion.criterion_id);
    if (
      criterion.hard_stop &&
      criterion.proof_class === "P0" &&
      criterion.measurement.comparator === "matches"
    ) {
      issues.push({
        field: "measurement.comparator",
        rule: "a hard-stop P0 criterion must use a machine-checkable comparator, not regex matching",
      });
    }
    if (criterion.measurement.metric === null && criterion.measurement.threshold !== null) {
      issues.push({ field: "measurement.metric", rule: "a threshold requires a named metric" });
    }
  }
  if (!criteria.some((criterion) => criterion.hard_stop)) {
    issues.push({ field: "hard_stop", rule: "at least one hard-stop criterion is required" });
  }
  return issues;
}
