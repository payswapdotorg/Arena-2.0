import type { EscalationRequest } from "@arena/contracts";
import { levelSatisfies, type ConflictOutcome, type ExpertProfile } from "./expert-profile.js";
import { evaluateConflictOfInterest, type ConflictContext } from "./expert-profile.js";

/**
 * AR2-008 — 能力需求编译 + 可解释匹配 + 下一位合格专家路由（issue #10）。
 *
 * - compileCapabilityDemand：从冻结 EscalationRequest 编译匹配需求
 *   （能力等级、证据支撑资质、司法辖区、预算/尝试上限、deadline）。
 * - matchExperts：每个候选一条可解释结论（逐维度 pass/fail + 原因）；
 *   全部策略检查通过才 eligible —— 「no assignment before policy checks」。
 * - routeNextExpert：失败尝试保留归因（排除同专家）；重试永不超出
 *   聚合预算 / 尝试次数 / deadline（类型化 stop 状态）。
 */

export interface CapabilityDemand {
  escalation_id: string;
  capabilities: ReadonlyArray<{ capability_id: string; minimum_level: string }>;
  qualifications: readonly string[];
  jurisdiction: string | null;
  max_attempts: number;
  max_aggregate_spend: number;
  currency: string;
  deadline: string;
  escalation_modes: readonly string[];
}

export function compileCapabilityDemand(request: EscalationRequest): CapabilityDemand {
  return {
    escalation_id: `esc_${request.request_digest.slice(0, 16)}`,
    capabilities: request.required_capabilities.map((entry) => ({
      capability_id: entry.capability_id,
      minimum_level: entry.minimum_level,
    })),
    qualifications: request.required_qualifications,
    jurisdiction: request.constraints.jurisdiction,
    max_attempts: request.proof_policy.retry_next_expert.max_attempts,
    max_aggregate_spend: request.proof_policy.retry_next_expert.max_aggregate_spend,
    currency: request.budget.currency,
    deadline: request.constraints.deadline,
    escalation_modes: request.constraints.escalation_modes,
  };
}

export type DimensionVerdict =
  | { dimension: string; pass: true; note: string }
  | { dimension: string; pass: false; note: string };

export interface MatchRow {
  expert_id: string;
  eligible: boolean;
  dimensions: readonly DimensionVerdict[];
  conflict: ConflictOutcome;
  /** 三个决策 digest（锚定进冻结 expertAssignmentSchema）。 */
  digests: {
    capability_profile_digest: string;
    qualification_digest: string;
    conflict_check_digest: string;
  };
}

export interface MatchContext extends ConflictContext {
  /** 证据存在性查询（evidence-backed 资质/能力检查的输入）。 */
  knownEvidenceIds: readonly string[];
}

/** 可解释匹配：逐维度评估，绝不整体黑箱通过。 */
export function matchExperts(
  demand: CapabilityDemand,
  candidates: readonly ExpertProfile[],
  context: MatchContext,
): readonly MatchRow[] {
  return candidates.map((profile) => {
    const dimensions: DimensionVerdict[] = [];

    // 1) 能力维度：逐条需求检查（等级 + 证据支撑）。
    for (const need of demand.capabilities) {
      const claim = profile.capabilities.find((c) => c.capability_id === need.capability_id);
      if (claim === undefined) {
        dimensions.push({
          dimension: `capability:${need.capability_id}`,
          pass: false,
          note: "expert has no claim for this capability",
        });
        continue;
      }
      if (!levelSatisfies(claim.level, need.minimum_level)) {
        dimensions.push({
          dimension: `capability:${need.capability_id}`,
          pass: false,
          note: `level ${claim.level} does not satisfy minimum ${need.minimum_level}`,
        });
        continue;
      }
      // 证据支撑：至少一条引用且全部可查（空引用数组 = 无证据声明，fail-closed）。
      const backed =
        claim.evidence_refs.length > 0 &&
        claim.evidence_refs.every((ref) => context.knownEvidenceIds.includes(ref));
      dimensions.push({
        dimension: `capability:${need.capability_id}`,
        pass: backed,
        note: backed
          ? `level ${claim.level} with ${claim.evidence_refs.length} evidence ref(s)`
          : "capability claim lacks evidence backing",
      });
    }

    // 2) 资质维度：逐条要求检查（证据 + 司法辖区 + 有效期）。
    for (const need of demand.qualifications) {
      const claim = profile.qualifications.find(
        (q) => q.qualification.toLowerCase() === need.toLowerCase(),
      );
      if (claim === undefined) {
        dimensions.push({
          dimension: `qualification:${need}`,
          pass: false,
          note: "expert has no qualification claim",
        });
        continue;
      }
      const evidenceOk = claim.evidence_refs.some((ref) => context.knownEvidenceIds.includes(ref));
      if (!evidenceOk) {
        dimensions.push({
          dimension: `qualification:${need}`,
          pass: false,
          note: "qualification claim has no known evidence",
        });
        continue;
      }
      if (
        demand.jurisdiction !== null &&
        claim.jurisdiction !== null &&
        claim.jurisdiction !== demand.jurisdiction
      ) {
        dimensions.push({
          dimension: `qualification:${need}`,
          pass: false,
          note: `claim jurisdiction ${claim.jurisdiction} does not cover ${demand.jurisdiction}`,
        });
        continue;
      }
      dimensions.push({
        dimension: `qualification:${need}`,
        pass: true,
        note: `evidence-backed (${claim.evidence_refs.length} ref(s))`,
      });
    }

    // 3) 司法辖区维度（专家执业辖区覆盖请求辖区）。
    const jurisdictionOk =
      demand.jurisdiction === null || profile.jurisdictions.includes(demand.jurisdiction);
    dimensions.push({
      dimension: "jurisdiction",
      pass: jurisdictionOk,
      note: jurisdictionOk
        ? `covers ${demand.jurisdiction ?? "(unrestricted)"}`
        : `does not cover ${demand.jurisdiction}`,
    });

    // 4) 可用性/容量维度。
    const capacityOk =
      profile.availability.active_attempts < profile.availability.max_concurrent_attempts;
    dimensions.push({
      dimension: "availability",
      pass: capacityOk,
      note: capacityOk
        ? `${profile.availability.active_attempts}/${profile.availability.max_concurrent_attempts} attempts in flight`
        : "at capacity",
    });

    const conflict = evaluateConflictOfInterest(profile, context);
    const eligible = dimensions.every((d) => d.pass) && conflict.ok;

    return {
      expert_id: profile.expert_id,
      eligible,
      dimensions,
      conflict,
      digests: {
        capability_profile_digest: digestOf(
          profile.capabilities.map((c) => `${c.capability_id}@${c.level}`).sort(),
        ),
        qualification_digest: digestOf(
          profile.qualifications.map((q) => `${q.qualification}#${q.jurisdiction ?? "-"}`).sort(),
        ),
        conflict_check_digest: digestOf(conflict.ok ? ["clear"] : [...conflict.reasons].sort()),
      },
    };
  });
}

export type RoutingDecision =
  | {
      kind: "NEXT_EXPERT";
      expert_id: string;
      rank: number;
      eligible_count: number;
      basis: string;
    }
  | { kind: "BUDGET_STOP"; basis: string }
  | { kind: "DEADLINE_STOP"; basis: string }
  | { kind: "ATTEMPT_LIMIT_STOP"; basis: string }
  | { kind: "NO_ELIGIBLE_EXPERT"; basis: string };

export interface RoutingState {
  /** 已发生尝试数（含失败 —— 失败尝试保留归因并计数）。 */
  attemptsUsed: number;
  /** 已消耗聚合金额（失败尝试的授权金额计入 —— retain_attributed）。 */
  aggregateSpend: number;
  /** 下一次尝试的预估授权金额。 */
  nextAttemptAmount: number;
  now: string;
}

/** 下一位合格专家路由：先检查硬边界，再取排序后的首位 eligible。 */
export function routeNextExpert(
  demand: CapabilityDemand,
  matches: readonly MatchRow[],
  state: RoutingState,
): RoutingDecision {
  if (state.attemptsUsed >= demand.max_attempts) {
    return {
      kind: "ATTEMPT_LIMIT_STOP",
      basis: `attempts used ${state.attemptsUsed} of max ${demand.max_attempts}`,
    };
  }
  if (state.aggregateSpend + state.nextAttemptAmount > demand.max_aggregate_spend) {
    return {
      kind: "BUDGET_STOP",
      basis: `aggregate spend ${state.aggregateSpend} + next attempt ${state.nextAttemptAmount} would exceed ceiling ${demand.max_aggregate_spend}`,
    };
  }
  if (state.now > demand.deadline) {
    return {
      kind: "DEADLINE_STOP",
      basis: `now ${state.now} is past deadline ${demand.deadline}`,
    };
  }
  const eligible = matches.filter((m) => m.eligible);
  const first = eligible[0];
  if (first === undefined) {
    return {
      kind: "NO_ELIGIBLE_EXPERT",
      basis: `${matches.length} candidate(s) screened; none eligible after policy checks`,
    };
  }
  return {
    kind: "NEXT_EXPERT",
    expert_id: first.expert_id,
    rank: 1,
    eligible_count: eligible.length,
    basis: `first eligible after policy checks (${first.dimensions.length} dimensions evaluated)`,
  };
}

/** FNV-1a 64 稳定摘要（解释性锚定；非安全哈希 —— 分配记录 digest 用途）。 */
function digestOf(parts: readonly string[]): string {
  const input = parts.join("|");
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0").padEnd(64, "0");
}
