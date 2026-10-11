import { z } from "zod";
import { arenaIdSchema, isoTimestampSchema } from "@arena/contracts";

/** 本地非空短文本（公开面未导出该基础 schema —— 包内声明，与 CF1.0 形状一致）。 */
const nonEmptyShort = z.string().min(1).max(200);

/**
 * AR2-008 — 专家画像、能力需求编译与冲突检查（issue #10）。
 *
 * QUALIFICATION_IS_NOT_AUTHORIZATION_RULE：资质/能力/冲突检查是「匹配
 * 决策」，不是授权 —— 授权永远来自服务端认证上下文（TenantContext），
 * 匹配结果不携带任何授权语义。分配前的策略检查（capability /
 * qualification / conflict / availability / jurisdiction / budget）全部
 * 通过才产生 offer；每个检查的结论以 digest 锚定进 expertAssignment
 * （冻结 expertAssignmentSchema 的三个 digest 字段）。
 */

/** 能力等级序（匹配比较用；等级词表属领域配置，此处为参考序）。 */
export const CAPABILITY_LEVEL_ORDER = [
  "junior",
  "mid",
  "senior",
  "principal",
  "distinguished",
] as const;
export type CapabilityLevel = (typeof CAPABILITY_LEVEL_ORDER)[number];

export const capabilityClaimSchema = z
  .object({
    capability_id: arenaIdSchema,
    level: nonEmptyShort,
    /** 证据引用（evidence-backed capability；空数组 = 无证据声明）。 */
    evidence_refs: z.array(arenaIdSchema),
  })
  .strict();

export const qualificationClaimSchema = z
  .object({
    qualification: nonEmptyShort,
    /** 资质必须证据支撑（无证据 → 不参与匹配）。 */
    evidence_refs: z.array(arenaIdSchema).min(1),
    jurisdiction: nonEmptyShort.nullable(),
    expires_at: isoTimestampSchema.nullable(),
  })
  .strict();

export const expertProfileSchema = z
  .object({
    expert_id: arenaIdSchema,
    tenant_id: arenaIdSchema,
    capabilities: z.array(capabilityClaimSchema),
    qualifications: z.array(qualificationClaimSchema),
    /** 可用性/容量：并发上限与当前在途数。 */
    availability: z
      .object({
        max_concurrent_attempts: z.number().int().positive(),
        active_attempts: z.number().int().nonnegative(),
      })
      .strict(),
    jurisdictions: z.array(nonEmptyShort),
    /** 政策标记（如禁止未披露外部协作）。 */
    policy_flags: z.array(nonEmptyShort),
  })
  .strict();

export type CapabilityClaim = z.infer<typeof capabilityClaimSchema>;
export type QualificationClaim = z.infer<typeof qualificationClaimSchema>;
export type ExpertProfile = z.infer<typeof expertProfileSchema>;

export type ProfileCheck =
  | { ok: true; profile: ExpertProfile }
  | { ok: false; issues: ReadonlyArray<{ field: string; rule: string }> };

/** 画像入口校验（strict schema；未知字段拒绝 —— 冻结纪律的本地形态）。 */
export function checkExpertProfile(input: unknown): ProfileCheck {
  const parsed = expertProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
        rule: `${issue.code}${issue.message ? ` — ${issue.message}` : ""}`,
      })),
    };
  }
  return { ok: true, profile: parsed.data };
}

/** 等级比较：level >= minimum（未知等级按词表位置，缺省视为不满足）。 */
export function levelSatisfies(level: string, minimum: string): boolean {
  const order = CAPABILITY_LEVEL_ORDER as readonly string[];
  const li = order.indexOf(level);
  const mi = order.indexOf(minimum);
  if (li === -1 || mi === -1) {
    // 未知等级词：严格相等才视为满足（fail-closed，不发明序关系）。
    return level === minimum;
  }
  return li >= mi;
}

export type ConflictReason =
  | "same_expert_as_failed_attempt"
  | "prior_involvement_disclosed"
  | "tenant_relationship_conflict";

export interface ConflictContext {
  /** 已失败尝试的专家归属（保留归因 —— 失败尝试保留 attribution/evidence）。 */
  failedAttemptExpertIds: readonly string[];
  /** 该专家已在本 escalation 中出现过的其它角色（requester 侧等）。 */
  priorInvolvementExpertIds: readonly string[];
  /** 声明冲突的租户关系（同租户利益冲突等）。 */
  conflictedTenantIds: readonly string[];
}

export type ConflictOutcome =
  | { ok: true }
  | { ok: false; reasons: ConflictReason[]; explanation: string };

/** 利益冲突筛查（分配前策略检查之一）。 */
export function evaluateConflictOfInterest(
  profile: ExpertProfile,
  context: ConflictContext,
): ConflictOutcome {
  const reasons: ConflictReason[] = [];
  if (context.failedAttemptExpertIds.includes(profile.expert_id)) {
    reasons.push("same_expert_as_failed_attempt");
  }
  if (context.priorInvolvementExpertIds.includes(profile.expert_id)) {
    reasons.push("prior_involvement_disclosed");
  }
  if (context.conflictedTenantIds.includes(profile.tenant_id)) {
    reasons.push("tenant_relationship_conflict");
  }
  if (reasons.length === 0) return { ok: true };
  return {
    ok: false,
    reasons,
    explanation: `conflict-of-interest detected: ${reasons.join(", ")}`,
  };
}
