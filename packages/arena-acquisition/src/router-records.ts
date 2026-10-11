import type { AcquisitionRouteMode } from "./acquisition-request.js";
import type { AcqErrorCode } from "./errors.js";
import type { CapabilityProviderDescriptor } from "./provider-registry.js";
import type {
  EligibleCandidate,
  RejectedCandidate,
  RouteDecision,
  SelectedPlan,
} from "./route-decision.js";
import { ACQUISITION_SCHEMA_FAMILY } from "./primitives.js";
import {
  FILTER_PIPELINE,
  candidateBasis,
  type FilterRejection,
  type RankedCandidate,
  type ScreenedProvider,
} from "./router-filters.js";

/**
 * AR2-016 — RouteDecision 记录构造器（router.ts 的内部模块）。
 *
 * 三态（ROUTED / BLOCKED / INCONCLUSIVE）的全部记录形态集中在此：字段一致性
 * 由 route-decision.ts 的语义校验与测试共同锚定；构造是纯函数，无时钟、无随机。
 * context 由路由器从 RoutingInput 推导（此处不 import router.ts —— 无环）。
 */

/** 决策记录的固定上下文（路由器从请求/状态推导）。 */
export interface DecisionRecordContext {
  decision_id: string;
  request_id: string;
  correlation_id: string;
  route_mode: AcquisitionRouteMode;
  decided_at: string;
}

function baseRecord(
  context: DecisionRecordContext,
  policyVersion: string,
): Pick<
  RouteDecision,
  | "schema_version"
  | "decision_id"
  | "request_id"
  | "correlation_id"
  | "route_mode"
  | "policy_version"
  | "applied_filters"
  | "model_assist"
  | "decided_at"
> {
  return {
    schema_version: ACQUISITION_SCHEMA_FAMILY,
    decision_id: context.decision_id,
    request_id: context.request_id,
    correlation_id: context.correlation_id,
    route_mode: context.route_mode,
    policy_version: policyVersion,
    applied_filters: [...FILTER_PIPELINE],
    model_assist: { used: false, model_id: null },
    decided_at: context.decided_at,
  };
}

export function blockedDecision(
  context: DecisionRecordContext,
  policyVersion: string,
  code: AcqErrorCode,
  explanation: string,
  rejected: RejectedCandidate[] = [],
): RouteDecision {
  return {
    ...baseRecord(context, policyVersion),
    outcome: "BLOCKED",
    error_code: code,
    explanation,
    eligible_candidates: [],
    rejected_candidates: rejected,
    selected: null,
    fallback_applied: false,
  };
}

export function inconclusiveDecision(
  context: DecisionRecordContext,
  policyVersion: string,
  rejected: RejectedCandidate[],
  code: AcqErrorCode,
): RouteDecision {
  const codes = [...new Set(rejected.flatMap((entry) => entry.filters.map((f) => f.code)))].sort();
  return {
    ...baseRecord(context, policyVersion),
    outcome: "INCONCLUSIVE",
    error_code: code,
    explanation:
      `no eligible provider within the current budget/deadline/quota constraints; ` +
      `screened ${rejected.length} candidate(s)` +
      (codes.length > 0 ? `; reason codes observed: ${codes.join(", ")}` : ""),
    eligible_candidates: [],
    rejected_candidates: rejected,
    selected: null,
    fallback_applied: false,
  };
}

export function routedDecision(
  context: DecisionRecordContext,
  policyVersion: string,
  selected: SelectedPlan,
  eligible: EligibleCandidate[],
  rejected: RejectedCandidate[],
  fallbackApplied: boolean,
): RouteDecision {
  const head = selected.steps[0]!;
  return {
    ...baseRecord(context, policyVersion),
    outcome: "ROUTED",
    error_code: null,
    explanation:
      `routed to ${head.provider_id}@${head.provider_version}` +
      (selected.plan_kind === "COMPOSITE"
        ? ` as a composite plan (${selected.steps.length} steps) permitted by routing policy`
        : ` (rank 1 of ${eligible.length} eligible)`) +
      (fallbackApplied
        ? "; explicit fallback from the pinned provider, within the original budget, deadline and attempt limit"
        : ""),
    eligible_candidates: eligible,
    rejected_candidates: rejected,
    selected,
    fallback_applied: fallbackApplied,
  };
}

export function singleProviderPlan(provider: CapabilityProviderDescriptor): SelectedPlan {
  return {
    plan_kind: "SINGLE_PROVIDER",
    steps: [
      {
        role: "ACQUIRE",
        provider_id: provider.provider_id,
        provider_version: provider.provider_version,
        kind: provider.kind,
        estimated_cost: provider.cost.per_run_estimate,
        estimated_latency_seconds: provider.latency.sla_seconds,
      },
    ],
    currency: provider.cost.currency,
    estimated_cost: provider.cost.per_run_estimate,
    estimated_latency_seconds: provider.latency.sla_seconds,
  };
}

export function compositeAcquireValidatePlan(
  acquire: RankedCandidate,
  validate: RankedCandidate,
): SelectedPlan {
  return {
    plan_kind: "COMPOSITE",
    steps: [
      {
        role: "ACQUIRE",
        provider_id: acquire.descriptor.provider_id,
        provider_version: acquire.descriptor.provider_version,
        kind: acquire.descriptor.kind,
        estimated_cost: acquire.cost,
        estimated_latency_seconds: acquire.latencySeconds,
      },
      {
        role: "VALIDATE",
        provider_id: validate.descriptor.provider_id,
        provider_version: validate.descriptor.provider_version,
        kind: validate.descriptor.kind,
        estimated_cost: validate.cost,
        estimated_latency_seconds: validate.latencySeconds,
      },
    ],
    currency: acquire.descriptor.cost.currency,
    estimated_cost: acquire.cost + validate.cost,
    estimated_latency_seconds: acquire.latencySeconds + validate.latencySeconds,
  };
}

export function eligibleRows(ranked: readonly RankedCandidate[]): EligibleCandidate[] {
  return ranked.map((candidate, index) => ({
    provider_id: candidate.descriptor.provider_id,
    provider_version: candidate.descriptor.provider_version,
    kind: candidate.descriptor.kind,
    rank: index + 1,
    estimated_cost: candidate.cost,
    estimated_latency_seconds: candidate.latencySeconds,
    basis: candidateBasis(candidate),
  }));
}

export function rejectedRow(candidate: ScreenedProvider): RejectedCandidate {
  return {
    provider_id: candidate.descriptor.provider_id,
    provider_version: candidate.descriptor.provider_version,
    filters: [...candidate.rejections],
  };
}

export function rejectionSummary(rejections: readonly FilterRejection[]): string {
  return rejections.map((entry) => `${entry.filter}: ${entry.explanation}`).join("; ");
}

/** 无候选时的类型化结论码：全体唯一失败码，否则 NO_ELIGIBLE_PROVIDER。 */
export function noRouteCode(rejected: readonly RejectedCandidate[]): AcqErrorCode {
  const codes = new Set(rejected.flatMap((entry) => entry.filters.map((f) => f.code)));
  if (rejected.length > 0 && codes.size === 1) {
    return [...codes][0]!;
  }
  return "ACQ_NO_ELIGIBLE_PROVIDER";
}
