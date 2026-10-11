import { z } from "zod";
import {
  arenaIdSchema,
  currencyCodeSchema,
  isoTimestampSchema,
  nonNegativeAmountSchema,
  positiveIntSchema,
} from "@arena/contracts";
import { ACQUISITION_SCHEMA_FAMILY, nonEmptyMedium, nonEmptyShort } from "./primitives.js";
import { acqErrorCodeSchema } from "./errors.js";
import { acquisitionRouteModeSchema } from "./acquisition-request.js";
import { providerKindSchema } from "./provider-registry.js";

/**
 * AR2-016 — RouteDecision：可审计路由决策记录（issue #32；spec §2/§3）。
 *
 * - 记录：合格候选、已应用的硬性策略过滤、被拒候选（typed reason codes）、
 *   选中的 provider/plan（精确 provider 版本）、预估预算/延迟、policy
 *   version 与回退约束。
 * - 模型辅助槽位（model_assist）保留但钉死 used=false —— AR2-016 的路由
 *   是确定性策略/预算/授权过滤 + 确定性排序，模型不参与。
 */

/** 硬性过滤管线（固定顺序 —— 决策记录按此顺序声明 applied_filters）。 */
export const routeFilterSchema = z.enum([
  "TENANT_AUTHORIZATION",
  "PROVIDER_STATUS",
  "CAPABILITY_FIT",
  "OUTPUT_SCHEMA",
  "SOURCE_RIGHTS",
  "REGION_COVERAGE",
  "USE_PERMISSION",
  "RISK_TIER",
  "QUOTA",
  "BUDGET_CEILING",
  "DEADLINE",
]);
export type RouteFilterId = z.infer<typeof routeFilterSchema>;

/** 决策三态：ROUTED / BLOCKED（策略禁止）/ INCONCLUSIVE（当前约束内无路由）。 */
export const routeOutcomeSchema = z.enum(["ROUTED", "BLOCKED", "INCONCLUSIVE"]);
export type RouteOutcome = z.infer<typeof routeOutcomeSchema>;

export const planStepRoleSchema = z.enum(["ACQUIRE", "VALIDATE"]);
export type PlanStepRole = z.infer<typeof planStepRoleSchema>;

export const planKindSchema = z.enum(["SINGLE_PROVIDER", "COMPOSITE"]);
export type PlanKind = z.infer<typeof planKindSchema>;

/** 被拒候选：每个失败过滤一条 typed 记录（完整拒绝解释）。 */
export const rejectedCandidateSchema = z
  .object({
    provider_id: arenaIdSchema,
    provider_version: z.string().min(1).max(64),
    filters: z
      .array(
        z
          .object({
            filter: routeFilterSchema,
            code: acqErrorCodeSchema,
            explanation: nonEmptyMedium,
          })
          .strict(),
      )
      .min(1)
      .max(16),
  })
  .strict();
export type RejectedCandidate = z.infer<typeof rejectedCandidateSchema>;

/** 合格候选：确定性排序后的名次与依据。 */
export const eligibleCandidateSchema = z
  .object({
    provider_id: arenaIdSchema,
    provider_version: z.string().min(1).max(64),
    kind: providerKindSchema,
    rank: positiveIntSchema,
    estimated_cost: nonNegativeAmountSchema,
    estimated_latency_seconds: positiveIntSchema,
    basis: nonEmptyMedium,
  })
  .strict();
export type EligibleCandidate = z.infer<typeof eligibleCandidateSchema>;

/** 选中计划：单一 provider 或（策略显式允许的）组合计划 —— 每步带精确版本。 */
export const selectedPlanSchema = z
  .object({
    plan_kind: planKindSchema,
    steps: z
      .array(
        z
          .object({
            role: planStepRoleSchema,
            provider_id: arenaIdSchema,
            provider_version: z.string().min(1).max(64),
            kind: providerKindSchema,
            estimated_cost: nonNegativeAmountSchema,
            estimated_latency_seconds: positiveIntSchema,
          })
          .strict(),
      )
      .min(1)
      .max(4),
    currency: currencyCodeSchema,
    estimated_cost: nonNegativeAmountSchema,
    estimated_latency_seconds: positiveIntSchema,
  })
  .strict();
export type SelectedPlan = z.infer<typeof selectedPlanSchema>;

export const routeDecisionSchema = z
  .object({
    schema_version: z.literal(ACQUISITION_SCHEMA_FAMILY),
    decision_id: arenaIdSchema,
    request_id: arenaIdSchema,
    correlation_id: arenaIdSchema,
    route_mode: acquisitionRouteModeSchema,
    policy_version: nonEmptyShort,
    outcome: routeOutcomeSchema,
    error_code: acqErrorCodeSchema.nullable(),
    explanation: nonEmptyMedium,
    applied_filters: z.array(routeFilterSchema).max(16),
    eligible_candidates: z.array(eligibleCandidateSchema).max(256),
    rejected_candidates: z.array(rejectedCandidateSchema).max(256),
    selected: selectedPlanSchema.nullable(),
    /** 仅 PINNED 回退路径可为 true —— 显式许可的回退。 */
    fallback_applied: z.boolean(),
    /** 模型辅助槽位（AR2-016 钉死 used=false —— 确定性路由，无模型参与）。 */
    model_assist: z
      .object({
        used: z.boolean(),
        model_id: arenaIdSchema.nullable(),
      })
      .strict(),
    decided_at: isoTimestampSchema,
  })
  .strict();
export type RouteDecision = z.infer<typeof routeDecisionSchema>;

/** AR2-016 路由策略版本（决策记录锚定）。 */
export const ROUTE_POLICY_VERSION = "ACQ-ROUTE-POLICY1.0";

/** 无模型路由规则（槽位保留，钉死关闭）。 */
export const NO_MODEL_ROUTING_RULE =
  "AR2-016 routing is deterministic: hard authorization/rights/schema/budget/deadline/quota filters and " +
  "candidate ranking run without any model; the model_assist slot is reserved and must record used=false " +
  "until a versioned ACQ policy explicitly admits model-assisted ranking after deterministic filters";

/** 决策审计规则：每个候选要么合格（有名次），要么带 typed reason codes 被拒。 */
export const ROUTE_DECISION_AUDIT_RULE =
  "every screened candidate appears in the decision record either as an eligible candidate with a rank and " +
  "basis or as a rejected candidate carrying one typed reason code per failed hard filter; no candidate " +
  "is silently dropped";

/** 回退审计规则（与请求侧 FALLBACK_CONSTRAINTS_RULE 成对）。 */
export const ROUTE_FALLBACK_AUDIT_RULE =
  "a fallback is visible in the record (fallback_applied=true only under explicit request permission) and " +
  "the fallback plan passes the same hard filters against the original budget, deadline and attempt limit";

export interface DecisionSemanticIssue {
  field: string;
  rule: string;
}

/** 语义校验：三态与字段的一致性（写入侧与读取侧都调用）。 */
export function validateRouteDecisionSemantics(input: RouteDecision): DecisionSemanticIssue[] {
  const issues: DecisionSemanticIssue[] = [];
  if (input.outcome === "ROUTED" && (input.selected === null || input.error_code !== null)) {
    issues.push({
      field: "selected",
      rule: "a ROUTED decision carries a selected plan and no error code",
    });
  }
  if (input.outcome !== "ROUTED" && (input.selected !== null || input.error_code === null)) {
    issues.push({
      field: "outcome",
      rule: "a non-routed decision carries an error code and no selected plan",
    });
  }
  if (input.model_assist.used !== false || input.model_assist.model_id !== null) {
    issues.push({ field: "model_assist", rule: NO_MODEL_ROUTING_RULE });
  }
  if (input.fallback_applied && input.route_mode !== "PINNED_PROVIDER") {
    issues.push({
      field: "fallback_applied",
      rule: "fallback is only reachable from the pinned-provider path",
    });
  }
  if (input.selected !== null) {
    const cost = input.selected.steps.reduce((sum, step) => sum + step.estimated_cost, 0);
    if (cost !== input.selected.estimated_cost) {
      issues.push({
        field: "selected.estimated_cost",
        rule: "estimated cost must equal the sum of step costs",
      });
    }
    const latency = input.selected.steps.reduce(
      (sum, step) => sum + step.estimated_latency_seconds,
      0,
    );
    if (latency !== input.selected.estimated_latency_seconds) {
      issues.push({
        field: "selected.estimated_latency_seconds",
        rule: "estimated latency must equal the sum of step latencies",
      });
    }
  }
  const ranks = input.eligible_candidates.map((candidate) => candidate.rank).sort((a, b) => a - b);
  if (ranks.some((rank, index) => rank !== index + 1)) {
    issues.push({ field: "eligible_candidates.rank", rule: "ranks are 1..n and contiguous" });
  }
  return issues;
}
