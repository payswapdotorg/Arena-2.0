import type { CapabilityAcquisitionRequest } from "./acquisition-request.js";
import type { CapabilityGapReport } from "./gap-report.js";
import {
  findVisibleProviderVersion,
  findVisibleProviderVersions,
  listVisibleProviders,
  type CapabilityProviderDescriptor,
  type CapabilityProviderRegistry,
} from "./provider-registry.js";
import type { RouteDecision, RejectedCandidate } from "./route-decision.js";
import { ROUTE_POLICY_VERSION } from "./route-decision.js";
import { compareSemver } from "./primitives.js";
import {
  compileRoutingDemand,
  rankCandidates,
  screenProvider,
  type RoutingDemand,
} from "./router-filters.js";
import {
  blockedDecision,
  compositeAcquireValidatePlan,
  eligibleRows,
  inconclusiveDecision,
  noRouteCode,
  rejectedRow,
  rejectionSummary,
  routedDecision,
  singleProviderPlan,
  type DecisionRecordContext,
} from "./router-records.js";

/**
 * AR2-016 — 确定性 provider 路由器（issue #32；spec §3）。
 *
 * 顺序（固定，全部 typed、可审计、无模型参与）：
 * 1. 聚合硬边界（attempt 上限 → deadline 已过）；
 * 2. 租户可见性（跨租户 fail-closed，与不存在不可区分）；
 * 3. PINNED：解析 pinned（精确版本或 family 最新）；不可用 => BLOCKED
 *    （ACQ_PINNED_PROVIDER_UNAVAILABLE）—— 仅当请求策略显式许可回退才继续
 *    筛选其余候选，且回退必须通过同一套硬性过滤（原预算/deadline/attempt 内）；
 * 4. ANY_COMPATIBLE / AUTO：全量硬性筛选 → 确定性排序 → 首位；
 *    AUTO 仅在策略显式允许且 use_kinds 含 KNOWLEDGE_PACK 时构造
 *    组合计划（scraper 采集 + human expert 校验），且组合预算/延迟必须可行。
 *
 * 说明：ACQ_COMPOSITE_PLAN_NOT_PERMITTED 属于 ACQ1.0 错误目录（供 API/后续
 * 策略版本使用）；在 AR2-016 的确定性策略下，组合被策略拒绝时总是存在
 * 可路由的单一候选或标准的 INCONCLUSIVE 路径，因此路由器本身不发射该码。
 */

export interface RoutingPolicy {
  policy_version: string;
  /** AUTO 组合计划（scraper + human expert）的显式许可开关。 */
  allowCompositePlans: boolean;
}

export const DEFAULT_ROUTING_POLICY: RoutingPolicy = {
  policy_version: ROUTE_POLICY_VERSION,
  allowCompositePlans: false,
};

export interface RoutingState {
  /** 注入时钟（ISO-8601 UTC）—— 绝不读取真实时钟。 */
  now: string;
  /** 已承诺的聚合花费（失败尝试的归因金额计入）。 */
  spend_so_far: number;
  /** 已消耗的尝试数。 */
  attempts_used: number;
  /** 调用方租户持有的 entitlement（TENANT_AUTHORIZATION 过滤输入）。 */
  tenant_entitlements: readonly string[];
}

export interface RoutingInput {
  request: CapabilityAcquisitionRequest;
  gap: CapabilityGapReport;
  registry: CapabilityProviderRegistry;
  state: RoutingState;
  decisionId: string;
  policy?: RoutingPolicy;
}

function recordContext(input: RoutingInput): DecisionRecordContext {
  return {
    decision_id: input.decisionId,
    request_id: input.request.request_id,
    correlation_id: input.request.correlation_id,
    route_mode: input.request.preferred_route.mode,
    decided_at: input.state.now,
  };
}

export function routeAcquisitionRequest(input: RoutingInput): RouteDecision {
  const policy = input.policy ?? DEFAULT_ROUTING_POLICY;
  const context = recordContext(input);
  const request = input.request;
  const nowMs = Date.parse(input.state.now);

  if (input.state.attempts_used >= request.attempt_limit) {
    return blockedDecision(
      context,
      policy.policy_version,
      "ACQ_ATTEMPT_LIMIT_EXCEEDED",
      `attempts used ${input.state.attempts_used} of limit ${request.attempt_limit}; authorized attempt limit exhausted`,
    );
  }
  if (nowMs > Date.parse(request.deadline)) {
    return blockedDecision(
      context,
      policy.policy_version,
      "ACQ_DEADLINE_EXCEEDED",
      `now ${input.state.now} is past the request deadline ${request.deadline}`,
    );
  }

  const demand = compileRoutingDemand(request, input.gap, {
    now_ms: nowMs,
    spend_so_far: input.state.spend_so_far,
    tenant_entitlements: input.state.tenant_entitlements,
  });

  if (request.preferred_route.mode === "PINNED_PROVIDER") {
    return routePinned(input, policy.policy_version, demand, context);
  }
  return routeOpen(input, policy, demand, context);
}

/** 解析 pinned 引用：精确版本，或 family 内确定性最新（semver 后字典序）。 */
function resolvePinned(
  registry: CapabilityProviderRegistry,
  tenantId: string,
  providerId: string,
  providerVersion: string | null,
): CapabilityProviderDescriptor | null {
  if (providerVersion !== null) {
    return findVisibleProviderVersion(registry, tenantId, providerId, providerVersion);
  }
  const versions = findVisibleProviderVersions(registry, tenantId, providerId);
  let best: CapabilityProviderDescriptor | null = null;
  for (const candidate of versions) {
    if (best === null) {
      best = candidate;
      continue;
    }
    const order = compareSemver(candidate.provider_version, best.provider_version);
    if (order > 0 || (order === 0 && candidate.provider_version > best.provider_version)) {
      best = candidate;
    }
  }
  return best;
}

function routePinned(
  input: RoutingInput,
  policyVersion: string,
  demand: RoutingDemand,
  context: DecisionRecordContext,
): RouteDecision {
  const request = input.request;
  const pinnedRef = request.preferred_route.pinned_provider;
  if (pinnedRef === null) {
    return blockedDecision(
      context,
      policyVersion,
      "ACQ_ROUTE_BLOCKED",
      "pinned route without a pinned provider reference (semantic validation should have caught this)",
    );
  }
  const pinned = resolvePinned(
    input.registry,
    request.tenant_context.tenant_id,
    pinnedRef.provider_id,
    pinnedRef.provider_version,
  );
  if (pinned === null) {
    // 不可见与不存在同码同文案 —— 无存在性预言机（isolation 测试锚定）。
    return blockedDecision(
      context,
      policyVersion,
      "ACQ_PINNED_PROVIDER_UNAVAILABLE",
      `pinned provider ${pinnedRef.provider_id}@${
        pinnedRef.provider_version ?? "latest"
      } is not visible in tenant scope`,
    );
  }

  const pinnedScreened = screenProvider(pinned, demand);
  if (pinnedScreened.rejections.length === 0) {
    const eligible = eligibleRows(rankCandidates([pinnedScreened], demand));
    return routedDecision(context, policyVersion, singleProviderPlan(pinned), eligible, [], false);
  }

  const rejected = [rejectedRow(pinnedScreened)];
  if (!request.preferred_route.fallback_permitted) {
    const first = pinnedScreened.rejections[0]!;
    return blockedDecision(
      context,
      policyVersion,
      first.code,
      `${rejectionSummary(pinnedScreened.rejections)}; fallback not permitted by request policy — ` +
        "no source is silently substituted",
      rejected,
    );
  }

  // 显式许可的回退：其余租户可见候选过同一套硬性过滤（原预算/deadline/attempt 内）。
  const others = listVisibleProviders(input.registry, request.tenant_context.tenant_id).filter(
    (provider) => provider.provider_id !== pinned.provider_id,
  );
  const screened = others.map((provider) => screenProvider(provider, demand));
  const ranked = rankCandidates(screened, demand);
  for (const candidate of screened) {
    if (candidate.rejections.length > 0) rejected.push(rejectedRow(candidate));
  }
  if (ranked.length === 0) {
    return inconclusiveDecision(context, policyVersion, rejected, noRouteCode(rejected));
  }
  const best = ranked[0]!;
  return routedDecision(
    context,
    policyVersion,
    singleProviderPlan(best.descriptor),
    eligibleRows(ranked),
    rejected,
    true,
  );
}

function routeOpen(
  input: RoutingInput,
  policy: RoutingPolicy,
  demand: RoutingDemand,
  context: DecisionRecordContext,
): RouteDecision {
  const request = input.request;
  const visible = listVisibleProviders(input.registry, request.tenant_context.tenant_id);
  const screened = visible.map((provider) => screenProvider(provider, demand));
  const rejected: RejectedCandidate[] = [];
  for (const candidate of screened) {
    if (candidate.rejections.length > 0) rejected.push(rejectedRow(candidate));
  }
  const ranked = rankCandidates(screened, demand);

  // AUTO 组合计划：仅当策略显式允许且交付用途含 KNOWLEDGE_PACK（采集+校验形态）。
  if (
    request.preferred_route.mode === "AUTO" &&
    policy.allowCompositePlans &&
    request.data_use_policy.use_kinds.includes("KNOWLEDGE_PACK")
  ) {
    const scraper = ranked.find((candidate) => candidate.descriptor.kind === "SCRAPER");
    const human = ranked.find((candidate) => candidate.descriptor.kind === "HUMAN_EXPERT");
    if (scraper !== undefined && human !== undefined) {
      const combinedCost = scraper.cost + human.cost;
      const combinedLatency = scraper.latencySeconds + human.latencySeconds;
      if (
        demand.spend_so_far + combinedCost <= demand.budget_limit &&
        demand.now_ms + combinedLatency * 1000 <= demand.deadline_ms
      ) {
        return routedDecision(
          context,
          policy.policy_version,
          compositeAcquireValidatePlan(scraper, human),
          eligibleRows(ranked),
          rejected,
          false,
        );
      }
    }
  }

  if (ranked.length === 0) {
    return inconclusiveDecision(context, policy.policy_version, rejected, noRouteCode(rejected));
  }
  const best = ranked[0]!;
  return routedDecision(
    context,
    policy.policy_version,
    singleProviderPlan(best.descriptor),
    eligibleRows(ranked),
    rejected,
    false,
  );
}
