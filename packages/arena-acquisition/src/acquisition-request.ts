import { z } from "zod";
import {
  acceptanceCriterionSchema,
  arenaIdSchema,
  currencyCodeSchema,
  digestSchema,
  isoTimestampSchema,
  positiveAmountSchema,
  positiveIntSchema,
  privacyProfileSchema,
  redactionClassSchema,
  retentionProfileSchema,
  riskTierSchema,
  semverSchema,
  tenantContextSchema,
} from "@arena/contracts";
import {
  ACQUISITION_SCHEMA_FAMILY,
  nonEmptyMedium,
  nonEmptyShort,
  regionCodeSchema,
  schemaReferenceSchema,
  useKindSchema,
  type SemanticIssue,
} from "./primitives.js";
import { classifyShapeIssues, type AcqErrorCode } from "./errors.js";
import { computeCanonicalDigest } from "./canonical.js";

/**
 * AR2-016 — CapabilityAcquisitionRequest（issue #32；spec §2/§3）。
 *
 * - tenant/principal 由服务端从认证凭据推导（复用冻结 CF1.0 tenantContextSchema
 *   形状）；调用方载荷不含 tenant 字段 —— 任何 tenant/tenant_id 输入都会被
 *   strict envelope 当作未知字段拒绝。
 * - schema_version 钉定 ACQ1.0（ACQ 家族与冻结 CF1.0 分离，仅经不可变
 *   correlation/causation ID 关联）。
 * - 回退（fallback）仅当请求策略显式允许，且永不超出原聚合预算/deadline/
 *   attempt 限制（router 层强制）。
 */

/** 路由模式（spec §2/§3）。 */
export const acquisitionRouteModeSchema = z.enum([
  "PINNED_PROVIDER",
  "ANY_COMPATIBLE_PROVIDER",
  "AUTO",
]);

export type AcquisitionRouteMode = z.infer<typeof acquisitionRouteModeSchema>;

/** pinned 引用：精确 provider/version，或 provider family（version=null → 注册表内确定性取最新）。 */
export const pinnedProviderReferenceSchema = z
  .object({
    provider_id: arenaIdSchema,
    provider_version: semverSchema.nullable(),
  })
  .strict();

export type PinnedProviderReference = z.infer<typeof pinnedProviderReferenceSchema>;

/** 缺口引用（不可变 ID + canonical digest 锚定）。 */
export const gapReferenceSchema = z
  .object({
    gap_report_id: arenaIdSchema,
    gap_report_digest: digestSchema,
  })
  .strict();

export type GapReference = z.infer<typeof gapReferenceSchema>;

/** 数据范围：允许的来源模式 + 数据驻留区域要求。 */
export const acquisitionScopeSchema = z
  .object({
    permitted_source_patterns: z.array(nonEmptyMedium).max(64),
    required_regions: z.array(regionCodeSchema).max(16),
  })
  .strict();

export type AcquisitionScope = z.infer<typeof acquisitionScopeSchema>;

/** 数据使用/保留策略（FINE_TUNING 绝非默认，需显式审批引用）。 */
export const dataUsePolicySchema = z
  .object({
    use_kinds: z.array(useKindSchema).min(1).max(6),
    retention_profile: retentionProfileSchema,
    privacy_profile: privacyProfileSchema,
    redaction_class: redactionClassSchema,
    fine_tuning_approval: nonEmptyMedium.nullable(),
  })
  .strict();

export type DataUsePolicy = z.infer<typeof dataUsePolicySchema>;

/** 首选路由：模式 + pinned 目标 + 显式回退许可。 */
export const preferredRouteSchema = z
  .object({
    mode: acquisitionRouteModeSchema,
    pinned_provider: pinnedProviderReferenceSchema.nullable(),
    fallback_permitted: z.boolean(),
  })
  .strict();

export type PreferredRoute = z.infer<typeof preferredRouteSchema>;

export const capabilityAcquisitionRequestSchema = z
  .object({
    schema_version: z.literal(ACQUISITION_SCHEMA_FAMILY),
    request_id: arenaIdSchema,
    /** 服务端从认证凭据推导 —— 不是调用方输入。 */
    tenant_context: tenantContextSchema,
    idempotency_key: nonEmptyShort,
    correlation_id: arenaIdSchema,
    causation_id: arenaIdSchema.nullable(),
    request_digest: digestSchema,
    gap_reference: gapReferenceSchema,
    desired_output_schema: schemaReferenceSchema,
    scope: acquisitionScopeSchema,
    budget: z
      .object({
        limit_amount: positiveAmountSchema,
        currency: currencyCodeSchema,
      })
      .strict(),
    deadline: isoTimestampSchema,
    attempt_limit: positiveIntSchema.max(64),
    risk_tier: riskTierSchema,
    acceptance_criteria: z.array(acceptanceCriterionSchema).min(1).max(64),
    data_use_policy: dataUsePolicySchema,
    preferred_route: preferredRouteSchema,
  })
  .strict();

export type CapabilityAcquisitionRequest = z.infer<typeof capabilityAcquisitionRequestSchema>;

/** 租户推导规则（与 CF1.0 REQUEST_TENANT_RULE 同源的 ACQ 家族表述）。 */
export const ACQUISITION_REQUEST_TENANT_RULE =
  "tenant/principal are derived server-side from authenticated credentials and recorded in " +
  "tenant_context; this schema declares no caller-settable tenant override, so a caller-provided " +
  "tenant/tenant_id field is structurally rejected as an unknown field";

/** ACQ1.0 与 CF1.0 的版本族关系（家族分离决策）。 */
export const ACQUISITION_SCHEMA_FAMILY_RULE =
  "ACQ1.0 is a separate versioned schema family: the frozen CF1.0 corpus is never edited from this " +
  "package and the two families are linked only through immutable correlation/causation identifiers";

/** 回退约束规则（spec §3 automatic routing）。 */
export const FALLBACK_CONSTRAINTS_RULE =
  "a fallback route is taken only when the request policy explicitly permits it, and it always stays " +
  "within the original aggregate budget, deadline and attempt limit; no source is silently substituted";

/**
 * 语义校验（结构校验之后在信任边界调用）。
 */
export function validateAcquisitionRequestSemantics(
  input: CapabilityAcquisitionRequest,
): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  if (input.tenant_context.derived_from !== "authenticated_credentials") {
    issues.push({
      field: "tenant_context.derived_from",
      rule: "tenant must be derived from authenticated credentials",
    });
  }
  if (input.causation_id === input.request_id) {
    issues.push({ field: "causation_id", rule: "a request cannot cause itself" });
  }
  if (input.deadline <= "1970-01-01T00:00:00Z") {
    issues.push({ field: "deadline", rule: "deadline must be a plausible future timestamp" });
  }
  if (
    input.preferred_route.mode === "PINNED_PROVIDER" &&
    input.preferred_route.pinned_provider === null
  ) {
    issues.push({
      field: "preferred_route.pinned_provider",
      rule: "PINNED_PROVIDER mode requires a pinned provider reference",
    });
  }
  if (
    input.preferred_route.mode !== "PINNED_PROVIDER" &&
    input.preferred_route.pinned_provider !== null
  ) {
    issues.push({
      field: "preferred_route.pinned_provider",
      rule: "a pinned provider reference is only meaningful in PINNED_PROVIDER mode",
    });
  }
  if (
    input.data_use_policy.use_kinds.includes("FINE_TUNING") &&
    input.data_use_policy.fine_tuning_approval === null
  ) {
    issues.push({
      field: "data_use_policy.fine_tuning_approval",
      rule: "FINE_TUNING use requires an explicit approval reference (never the default)",
    });
  }
  if (input.request_digest !== computeAcquisitionRequestDigest(input)) {
    issues.push({
      field: "request_digest",
      rule: "request_digest must equal the canonical digest of the payload (excluding the digest field itself)",
    });
  }
  return issues;
}

export type AcquisitionRequestCheck =
  | { ok: true; request: CapabilityAcquisitionRequest }
  | { ok: false; code: AcqErrorCode; issues: SemanticIssue[] };

/** 信任边界入口校验：typed 错误（版本门 -> 未知字段 -> 通用校验）。 */
export function checkCapabilityAcquisitionRequest(input: unknown): AcquisitionRequestCheck {
  const parsed = capabilityAcquisitionRequestSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
      rule: `${issue.code}${issue.message ? ` — ${issue.message}` : ""}`,
    }));
    return {
      ok: false,
      code: classifyShapeIssues(parsed.error.issues, { versionField: "schema_version" }),
      issues,
    };
  }
  return { ok: true, request: parsed.data };
}

/**
 * 幂等摘要载荷：剔除 request_digest 后的规范化形式（键序无关 —— 同一逻辑
 * 请求永远产生同一 digest；same key + same digest => 重放）。
 */
export function acquisitionRequestDigestInput(
  input: CapabilityAcquisitionRequest,
): Record<string, unknown> {
  const { request_digest: _excluded, ...payload } = input;
  return payload as Record<string, unknown>;
}

/** 规范化幂等摘要（canonical JSON sha256）。 */
export function computeAcquisitionRequestDigest(input: CapabilityAcquisitionRequest): string {
  return computeCanonicalDigest(acquisitionRequestDigestInput(input));
}
