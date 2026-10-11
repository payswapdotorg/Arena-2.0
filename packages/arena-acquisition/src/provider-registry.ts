import { z } from "zod";
import {
  arenaIdSchema,
  currencyCodeSchema,
  nonNegativeIntSchema,
  positiveAmountSchema,
  positiveIntSchema,
  riskTierSchema,
  semverSchema,
} from "@arena/contracts";
import {
  nonEmptyMedium,
  nonEmptyShort,
  regionCodeSchema,
  schemaReferenceSchema,
  useKindSchema,
  type SemanticIssue,
} from "./primitives.js";
import { classifyShapeIssues, type AcqErrorCode } from "./errors.js";

/**
 * AR2-016 — CapabilityProviderDescriptor 与确定性 provider 注册表（issue #32）。
 *
 * - 描述符是不可变记录（provider/version ID、能力、schema、权利姿态、区域、
 *   成本/配额、延迟、可靠性、requirements、状态与允许用途）。
 * - 注册表是本包内的确定性只读视图（AR2-016 无持久化）：注册时全部经
 *   strict schema 校验并 deep-freeze；查询按 tenant 范围执行 —— 跨租户读取
 *   fail-closed，且与不存在不可区分（无存在性预言机）。
 */

/** provider 种类（spec §2）。 */
export const providerKindSchema = z.enum(["SCRAPER", "EXTERNAL_API", "HUMAN_EXPERT"]);
export type ProviderKind = z.infer<typeof providerKindSchema>;

/** provider 状态（只有 ACTIVE 可被路由）。 */
export const providerStatusSchema = z.enum(["ACTIVE", "SUSPENDED", "DEPRECATED", "RETIRED"]);
export type ProviderStatus = z.infer<typeof providerStatusSchema>;

/** 来源权利姿态（UNKNOWN 一律 fail-closed，绝不当作许可）。 */
export const sourceRightsPostureSchema = z.enum([
  "PERMITTED",
  "RESTRICTED",
  "PROHIBITED",
  "UNKNOWN",
]);
export type SourceRightsPosture = z.infer<typeof sourceRightsPostureSchema>;

/** provider 声明的能力（等级词表与 AR2-008 CAPABILITY_LEVEL_ORDER 对齐）。 */
export const capabilityOfferSchema = z
  .object({
    capability_id: arenaIdSchema,
    level: nonEmptyShort,
    evidence_refs: z.array(arenaIdSchema).max(16),
  })
  .strict();
export type CapabilityOffer = z.infer<typeof capabilityOfferSchema>;

export const capabilityProviderDescriptorSchema = z
  .object({
    provider_id: arenaIdSchema,
    /** 不可变 provider/version ID：版本变化 = 新记录，绝不原地改写。 */
    provider_version: semverSchema,
    kind: providerKindSchema,
    /** 注册/可见范围所属租户（注册表查询按租户过滤）。 */
    tenant_id: arenaIdSchema,
    status: providerStatusSchema,
    supported_capabilities: z.array(capabilityOfferSchema).min(1).max(32),
    input_schema: schemaReferenceSchema,
    output_schema: schemaReferenceSchema,
    source_rights: z
      .object({
        posture: sourceRightsPostureSchema,
        approved_source_patterns: z.array(nonEmptyMedium).max(128),
      })
      .strict(),
    available_regions: z.array(regionCodeSchema).min(1).max(32),
    cost: z
      .object({
        currency: currencyCodeSchema,
        per_run_estimate: positiveAmountSchema,
        quota_remaining: nonNegativeIntSchema,
      })
      .strict(),
    latency: z.object({ sla_seconds: positiveIntSchema }).strict(),
    reliability: z
      .object({
        recent_success_ratio: z.number().min(0).max(1),
        completed_runs: nonNegativeIntSchema,
      })
      .strict(),
    /** 调用方租户必须持有的 entitlement（缺失 => 硬性拒绝）。 */
    required_entitlements: z.array(nonEmptyShort).max(32),
    allowed_use: z.array(useKindSchema).min(1).max(6),
    max_risk_tier: riskTierSchema,
  })
  .strict();

export type CapabilityProviderDescriptor = z.infer<typeof capabilityProviderDescriptorSchema>;

export type DescriptorCheck =
  | { ok: true; descriptor: CapabilityProviderDescriptor }
  | { ok: false; code: AcqErrorCode; issues: SemanticIssue[] };

/** 信任边界入口校验（strict schema + typed 错误）。 */
export function checkCapabilityProviderDescriptor(input: unknown): DescriptorCheck {
  const parsed = capabilityProviderDescriptorSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
      rule: `${issue.code}${issue.message ? ` — ${issue.message}` : ""}`,
    }));
    return {
      ok: false,
      code: classifyShapeIssues(parsed.error.issues),
      issues,
    };
  }
  return { ok: true, descriptor: parsed.data };
}

/**
 * 确定性只读注册表快照：描述符按 (provider_id, provider_version) 排序并
 * deep-freeze —— 相同输入永远得到字节稳定的注册表视图。
 */
export interface CapabilityProviderRegistry {
  readonly providers: readonly CapabilityProviderDescriptor[];
}

export type RegistryCheck =
  | { ok: true; registry: CapabilityProviderRegistry }
  | { ok: false; code: AcqErrorCode; issues: SemanticIssue[] };

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** 创建注册表：逐条校验 + 排序 + 冻结（任一非法 => typed 失败，绝无半注册）。 */
export function createProviderRegistry(descriptors: readonly unknown[]): RegistryCheck {
  const validated: CapabilityProviderDescriptor[] = [];
  for (const candidate of descriptors) {
    const check = checkCapabilityProviderDescriptor(candidate);
    if (!check.ok) {
      return check;
    }
    validated.push(check.descriptor);
  }
  validated.sort((a, b) =>
    a.provider_id === b.provider_id
      ? a.provider_version < b.provider_version
        ? -1
        : a.provider_version > b.provider_version
          ? 1
          : 0
      : a.provider_id < b.provider_id
        ? -1
        : 1,
  );
  return { ok: true, registry: { providers: deepFreeze(validated) } };
}

/** 租户可见视图（跨租户条目在此过滤 —— fail-closed）。 */
export function listVisibleProviders(
  registry: CapabilityProviderRegistry,
  tenantId: string,
): readonly CapabilityProviderDescriptor[] {
  return registry.providers.filter((provider) => provider.tenant_id === tenantId);
}

/**
 * 按 ID 查找租户可见 provider（全部版本）：不可见与不存在同样返回空数组 ——
 * 两者不可区分（无存在性预言机）。
 */
export function findVisibleProviderVersions(
  registry: CapabilityProviderRegistry,
  tenantId: string,
  providerId: string,
): readonly CapabilityProviderDescriptor[] {
  return registry.providers.filter(
    (provider) => provider.tenant_id === tenantId && provider.provider_id === providerId,
  );
}

/** 精确版本查找（同租户范围；不可见/不存在/版本不符 => null，不可区分）。 */
export function findVisibleProviderVersion(
  registry: CapabilityProviderRegistry,
  tenantId: string,
  providerId: string,
  providerVersion: string,
): CapabilityProviderDescriptor | null {
  const versions = findVisibleProviderVersions(registry, tenantId, providerId);
  return versions.find((provider) => provider.provider_version === providerVersion) ?? null;
}
