import type { CapabilityAcquisitionRequest } from "./acquisition-request.js";
import type { CapabilityGapReport } from "./gap-report.js";
import {
  CAPABILITY_LEVEL_ORDER,
  capabilityLevelSatisfies,
  compareSemver,
  riskTierWithin,
} from "./primitives.js";
import type { AcqErrorCode } from "./errors.js";
import type { CapabilityProviderDescriptor, ProviderKind } from "./provider-registry.js";
import type { RouteFilterId } from "./route-decision.js";

/**
 * AR2-016 — 路由的确定性筛选与排序内核（router.ts 的内部模块）。
 *
 * - 硬性过滤按固定顺序（FILTER_PIPELINE）逐项独立执行：一个候选可同时记录
 *   多条失败（每条带 typed reason code）—— 绝不静默丢弃。
 * - 排序完全确定性：能力余量 → 证据质量 → 可靠性（成功率、完成数）→
 *   预期成本 → 延迟 → (provider_id, provider_version) 字典序终局决胜。
 *   无时钟读取、无随机、无网络 —— clock 由调用方注入。
 */

/** 硬性过滤管线（固定顺序；决策记录的 applied_filters 即此序）。 */
export const FILTER_PIPELINE: readonly RouteFilterId[] = [
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
];

export interface RoutingDemand {
  capability_id: string;
  minimum_level: string;
  desired_output_schema_id: string;
  desired_output_schema_version: string;
  permitted_source_patterns: readonly string[];
  required_regions: readonly string[];
  use_kinds: readonly string[];
  risk_tier: string;
  budget_limit: number;
  currency: string;
  deadline_ms: number;
  now_ms: number;
  spend_so_far: number;
  tenant_entitlements: readonly string[];
}

/** 从（已校验的）请求 + 缺口报告 + 路由状态编译路由需求 —— 纯函数。 */
export function compileRoutingDemand(
  request: CapabilityAcquisitionRequest,
  gap: CapabilityGapReport,
  state: { now_ms: number; spend_so_far: number; tenant_entitlements: readonly string[] },
): RoutingDemand {
  return {
    capability_id: gap.capability_statement.capability_id,
    minimum_level: gap.capability_statement.minimum_level,
    desired_output_schema_id: request.desired_output_schema.schema_id,
    desired_output_schema_version: request.desired_output_schema.schema_version,
    permitted_source_patterns: request.scope.permitted_source_patterns,
    required_regions: request.scope.required_regions,
    use_kinds: request.data_use_policy.use_kinds,
    risk_tier: request.risk_tier,
    budget_limit: request.budget.limit_amount,
    currency: request.budget.currency,
    deadline_ms: Date.parse(request.deadline),
    now_ms: state.now_ms,
    spend_so_far: state.spend_so_far,
    tenant_entitlements: state.tenant_entitlements,
  };
}

export interface FilterRejection {
  filter: RouteFilterId;
  code: AcqErrorCode;
  explanation: string;
}

export interface ScreenedProvider {
  descriptor: CapabilityProviderDescriptor;
  rejections: readonly FilterRejection[];
}

/** 输出 schema 兼容：同 schema_id、同 major、provider 版本 >= 期望版本。 */
export function outputSchemaCompatible(
  provider: CapabilityProviderDescriptor,
  demand: RoutingDemand,
): boolean {
  const offered = provider.output_schema;
  if (offered.schema_id !== demand.desired_output_schema_id) return false;
  const offeredMajor = Number.parseInt(offered.schema_version.split(".")[0] ?? "0", 10);
  const desiredMajor = Number.parseInt(
    demand.desired_output_schema_version.split(".")[0] ?? "0",
    10,
  );
  if (offeredMajor !== desiredMajor) return false;
  return compareSemver(offered.schema_version, demand.desired_output_schema_version) >= 0;
}

/** 来源模式覆盖：精确匹配或 provider 声明的 "*" 通配。 */
function sourcePatternCovered(pattern: string, approved: readonly string[]): boolean {
  return approved.includes("*") || approved.includes(pattern);
}

/** 逐项硬性筛选：所有失败都记录（顺序 = FILTER_PIPELINE）。 */
export function screenProvider(
  provider: CapabilityProviderDescriptor,
  demand: RoutingDemand,
): ScreenedProvider {
  const rejections: FilterRejection[] = [];
  const offer = provider.supported_capabilities.find(
    (candidate) => candidate.capability_id === demand.capability_id,
  );

  if (
    provider.required_entitlements.some(
      (entitlement) => !demand.tenant_entitlements.includes(entitlement),
    )
  ) {
    rejections.push({
      filter: "TENANT_AUTHORIZATION",
      code: "ACQ_TENANT_NOT_AUTHORIZED",
      explanation: "tenant lacks an entitlement this provider requires",
    });
  }
  if (provider.status !== "ACTIVE") {
    rejections.push({
      filter: "PROVIDER_STATUS",
      code: "ACQ_PROVIDER_STATUS_DISALLOWS",
      explanation: `provider status is ${provider.status}, only ACTIVE is routable`,
    });
  }
  if (offer === undefined || !capabilityLevelSatisfies(offer.level, demand.minimum_level)) {
    rejections.push({
      filter: "CAPABILITY_FIT",
      code: "ACQ_CAPABILITY_MISMATCH",
      explanation:
        offer === undefined
          ? `provider does not declare capability ${demand.capability_id}`
          : `level ${offer.level} does not satisfy minimum ${demand.minimum_level}`,
    });
  }
  if (!outputSchemaCompatible(provider, demand)) {
    rejections.push({
      filter: "OUTPUT_SCHEMA",
      code: "ACQ_SCHEMA_MISMATCH",
      explanation: `output schema ${provider.output_schema.schema_id}@${provider.output_schema.schema_version} is incompatible with desired ${demand.desired_output_schema_id}@${demand.desired_output_schema_version}`,
    });
  }
  const fetchingKind = provider.kind === "SCRAPER" || provider.kind === "EXTERNAL_API";
  if (provider.source_rights.posture !== "PERMITTED") {
    rejections.push({
      filter: "SOURCE_RIGHTS",
      code: "ACQ_SOURCE_RIGHTS_DENIED",
      explanation: `source-rights posture is ${provider.source_rights.posture} (fail closed; UNKNOWN is not permission)`,
    });
  } else if (
    fetchingKind &&
    (demand.permitted_source_patterns.length === 0 ||
      demand.permitted_source_patterns.some(
        (pattern) =>
          !sourcePatternCovered(pattern, provider.source_rights.approved_source_patterns),
      ))
  ) {
    rejections.push({
      filter: "SOURCE_RIGHTS",
      code: "ACQ_SOURCE_RIGHTS_DENIED",
      explanation: fetchingKind
        ? "provider is not approved for every permitted source pattern (or no source is permitted)"
        : "provider does not permit the requested sources",
    });
  }
  if (demand.required_regions.some((region) => !provider.available_regions.includes(region))) {
    rejections.push({
      filter: "REGION_COVERAGE",
      code: "ACQ_REGION_NOT_COVERED",
      explanation: `provider regions [${provider.available_regions.join(",")}] do not cover required [${demand.required_regions.join(",")}]`,
    });
  }
  if (demand.use_kinds.some((kind) => !provider.allowed_use.includes(kind as never))) {
    rejections.push({
      filter: "USE_PERMISSION",
      code: "ACQ_USE_NOT_PERMITTED",
      explanation: `allowed use [${provider.allowed_use.join(",")}] does not cover requested [${demand.use_kinds.join(",")}]`,
    });
  }
  if (!riskTierWithin(demand.risk_tier, provider.max_risk_tier)) {
    rejections.push({
      filter: "RISK_TIER",
      code: "ACQ_RISK_TIER_DISALLOWS",
      explanation: `request risk tier ${demand.risk_tier} exceeds provider appetite ${provider.max_risk_tier}`,
    });
  }
  if (provider.cost.quota_remaining < 1) {
    rejections.push({
      filter: "QUOTA",
      code: "ACQ_QUOTA_EXHAUSTED",
      explanation: "provider quota is exhausted",
    });
  }
  if (demand.spend_so_far + provider.cost.per_run_estimate > demand.budget_limit) {
    rejections.push({
      filter: "BUDGET_CEILING",
      code: "ACQ_BUDGET_EXCEEDED",
      explanation: `estimated cost ${provider.cost.per_run_estimate} ${provider.cost.currency} plus committed spend ${demand.spend_so_far} exceeds the budget ceiling ${demand.budget_limit}`,
    });
  }
  if (demand.now_ms + provider.latency.sla_seconds * 1000 > demand.deadline_ms) {
    rejections.push({
      filter: "DEADLINE",
      code: "ACQ_DEADLINE_EXCEEDED",
      explanation: `SLA ${provider.latency.sla_seconds}s from now would pass the request deadline`,
    });
  }
  return { descriptor: provider, rejections };
}

export interface RankedCandidate {
  descriptor: CapabilityProviderDescriptor;
  margin: number;
  evidence: number;
  successRatio: number;
  completedRuns: number;
  cost: number;
  latencySeconds: number;
}

/** 确定性排序键（spec §3 any-compatible）：能力余量 → 证据 → 可靠性 → 成本 → 延迟 → id。 */
export function rankCandidates(
  screened: readonly ScreenedProvider[],
  demand: RoutingDemand,
): readonly RankedCandidate[] {
  const levels = CAPABILITY_LEVEL_ORDER as readonly string[];
  const ranked = screened
    .filter((candidate) => candidate.rejections.length === 0)
    .map((candidate) => {
      const offer = candidate.descriptor.supported_capabilities.find(
        (entry) => entry.capability_id === demand.capability_id,
      );
      const levelIndex = offer === undefined ? -1 : levels.indexOf(offer.level);
      const minimumIndex = levels.indexOf(demand.minimum_level);
      return {
        descriptor: candidate.descriptor,
        margin: levelIndex >= 0 && minimumIndex >= 0 ? levelIndex - minimumIndex : 0,
        evidence: offer?.evidence_refs.length ?? 0,
        successRatio: candidate.descriptor.reliability.recent_success_ratio,
        completedRuns: candidate.descriptor.reliability.completed_runs,
        cost: candidate.descriptor.cost.per_run_estimate,
        latencySeconds: candidate.descriptor.latency.sla_seconds,
      };
    });
  ranked.sort((a, b) => {
    if (a.margin !== b.margin) return b.margin - a.margin;
    if (a.evidence !== b.evidence) return b.evidence - a.evidence;
    if (a.successRatio !== b.successRatio) return b.successRatio - a.successRatio;
    if (a.completedRuns !== b.completedRuns) return b.completedRuns - a.completedRuns;
    if (a.cost !== b.cost) return a.cost - b.cost;
    if (a.latencySeconds !== b.latencySeconds) return a.latencySeconds - b.latencySeconds;
    if (a.descriptor.provider_id !== b.descriptor.provider_id) {
      return a.descriptor.provider_id < b.descriptor.provider_id ? -1 : 1;
    }
    return a.descriptor.provider_version < b.descriptor.provider_version ? -1 : 1;
  });
  return ranked;
}

export function candidateBasis(candidate: RankedCandidate): string {
  return `margin=+${candidate.margin}; evidence=${candidate.evidence} ref(s); success=${candidate.successRatio}; runs=${candidate.completedRuns}; cost=${candidate.cost}; sla=${candidate.latencySeconds}s`;
}

export function isKind(candidate: RankedCandidate, kind: ProviderKind): boolean {
  return candidate.descriptor.kind === kind;
}
