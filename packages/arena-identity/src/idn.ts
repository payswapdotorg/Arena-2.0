/**
 * IDN1.0 — Arena 生产身份适配器契约（AR2-022）。
 *
 * 这是一个全新的版本化契约族（IDN1.0），不属于冻结的 CF1.0 语料：
 * packages/arena-contracts 一行不改（无 ACR 的冻结面零变更）。
 * IDN1.0 的输出侧复用 CF1.0 TenantContext 形状（只读引用），
 * 保证与既有授权检查零漂移。
 *
 * 契约规则（与架构锁及 AR2-015 门报告记录的 seam 对齐）：
 * - 适配器只做「已验证凭据 → TenantContext」的推导；
 * - tenant/principal/role/scope 永远来自经过签名验证的令牌声明，
 *   绝不来自请求体（请求体 tenant 字段被 CF1.0 schema 冻结拒绝）；
 * - 任何失败都是类型化的 IDN_* 失败码，失败即失败关闭（fail-closed）；
 * - 失败原因对调用方不可区分（HTTP 边缘统一 401，无签名/存在性预言机）；
 * - 密钥与端点只经环境配置进入，任何日志/披露都不包含凭据值。
 */

import { z } from "zod";
import { arenaIdSchema, tenantContextSchema, type TenantContext } from "@arena/contracts";
import { AUTHN_FAILURE_CATALOG, type AuthnFailureCode } from "./errors.js";

/**
 * role 字段形状镜像 CF1.0 nonEmptyShortSchema（z.string().min(1).max(200)）。
 * 该原语不在 @arena/contracts 公开导出面上，且冻结面不可扩展
 * （AR2-022 验收：No frozen-contract changes without explicit version/ACR）。
 * 零漂移由出口防线保证：映射结果必须通过冻结 tenantContextSchema。
 */
const roleFieldSchema = z.string().min(1).max(200);

/** IDN1.0 契约族版本（独立于 CF1.0 语料版本演进）。 */
export const IDENTITY_CONTRACT_VERSION = "IDN1.0" as const;

/**
 * IDN1.0 令牌声明契约：访问令牌必须携带 `arena_tenant_context` 声明。
 *
 * 双层纪律（对抗租户混淆的结构防线）：
 * - arena_tenant_context 是 strict schema —— 未知字段拒绝
 *   （与 CF1.0 家族同一纪律；攻击者在 arena 命名空间里塞任何
 *   额外字段都会得到 IDN_CLAIMS_INVALID）；
 * - 顶层声明集允许携带任意标准 OIDC 声明（sub/azp/scope/email/…，
 *   生产代表性 IdP 令牌的常态）—— 未知顶层字段被剥离、永不映射；
 *   租户/主体映射只读 arena_tenant_context，顶层任何字段
 *   （包括伪造的 tenant 字段）在结构上不可能参与推导。
 * 注意：derived_from 不在声明中 —— 它永远由服务端填
 * "authenticated_credentials"，令牌无权声明自己的推导方式。
 */
export const arenaTenantClaimSchema = z
  .object({
    tenant_id: arenaIdSchema,
    client_application_id: arenaIdSchema,
    principal_id: arenaIdSchema,
    acting_identity_id: arenaIdSchema.nullable(),
    role: roleFieldSchema,
    authorization_scope_ids: z.array(arenaIdSchema).max(64),
  })
  .strict();

export type ArenaTenantClaim = z.infer<typeof arenaTenantClaimSchema>;

/** 承载 IDN1.0 声明的 JWT 声明集（标准 OIDC 声明 + arena 命名空间）。 */
export const idnClaimsSchema = z.object({
  iss: z.string().min(1),
  sub: z.string().min(1),
  aud: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  exp: z.number().int().finite(),
  iat: z.number().int().finite(),
  nbf: z.number().int().finite().optional(),
  jti: z.string().min(1).optional(),
  arena_tenant_context: arenaTenantClaimSchema,
});

export type IdnClaims = z.infer<typeof idnClaimsSchema>;

/** 验证成功的元数据（披露/运维用，不含任何凭据值）。 */
export interface AuthnSuccessMeta {
  /** 适配器标识（demo_registry_v0 / oidc_jwks_v1）。 */
  adapter_id: string;
  /** 签名算法（经允许列表验证）。 */
  algorithm: string;
  /** 令牌唯一标识（存在时透传，供运维对账；非密钥）。 */
  jti: string | null;
  /** 令牌有效期（epoch 秒）。 */
  expires_at: number;
}

/** 认证结果：成功携带 CF1.0 TenantContext；失败携带类型化失败码。 */
export type AuthnResult =
  | { ok: true; context: TenantContext; meta: AuthnSuccessMeta }
  | { ok: false; code: AuthnFailureCode; detail: string };

/**
 * 身份适配器端口（IDN1.0）—— AR2-015 门报告记录的 demo-auth seam 的
 * 生产替换面。实现必须：
 * - 无 Authorization 头 / 坏头 / 坏令牌 / 验证失败 ⇒ ok:false（调用方 401）；
 * - 验证成功 ⇒ ok:true 且 context 通过冻结 tenantContextSchema 校验；
 * - 所有网络/密钥获取失败 fail-closed（IDN_KEY_UNAVAILABLE），绝不放行。
 */
export interface IdentityAdapter {
  /** 适配器标识（披露与就绪面用）。 */
  readonly id: string;
  /** 运行模式标识：demo / oidc。 */
  readonly mode: "demo" | "oidc";
  verify(authorizationHeader: string | null | undefined): Promise<AuthnResult>;
}

/** 就绪描述（/readyz 投影；不含凭据值）。 */
export interface AdapterReadiness {
  mode: string;
  ready: boolean;
  detail?: string;
}

/** 支持 readiness 探测的适配器（OIDC 参考实现实现它；demo 恒就绪）。 */
export interface ProbeableAdapter {
  /** 启动/就绪探测：预取 JWKS 等；失败不抛出，只反映在 readiness。 */
  probe(): Promise<AdapterReadiness>;
  readiness(): AdapterReadiness;
}

/**
 * 由已验证的 arena 声明构造 CF1.0 TenantContext。
 * derived_from 永远服务端填充；构造后再用冻结 schema 校验一次（零漂移防线）。
 * meta 由适配器组合（此处不虚构算法/jti 信息）。
 */
export type ClaimMappingResult =
  | { ok: true; context: TenantContext }
  | { ok: false; code: AuthnFailureCode; detail: string };

export function tenantContextFromClaim(claim: ArenaTenantClaim): ClaimMappingResult {
  const candidate: TenantContext = {
    tenant_id: claim.tenant_id,
    derived_from: "authenticated_credentials",
    client_application_id: claim.client_application_id,
    principal_id: claim.principal_id,
    acting_identity_id: claim.acting_identity_id,
    role: claim.role,
    authorization_scope_ids: claim.authorization_scope_ids,
  };
  const validated = tenantContextSchema.safeParse(candidate);
  if (!validated.success) {
    return {
      ok: false,
      code: "IDN_CLAIMS_INVALID",
      detail: "arena_tenant_context does not satisfy the frozen CF1.0 TenantContext schema",
    };
  }
  return { ok: true, context: validated.data };
}

/** IDN1.0 失败码目录（类型化、封闭枚举；详情永不外发）。 */
export { AUTHN_FAILURE_CATALOG, type AuthnFailureCode };

/**
 * 边缘映射规则（冻结语义）：任何 ok:false 一律同一 401 信封 ——
 * 不同失败码之间的响应字节不可区分（无预言机原则）。
 */
export const AUTHN_EDGE_MAPPING_RULE =
  "every IDN1.0 authn failure maps to the same uniform 401 envelope at the HTTP edge; " +
  "failure codes are for typed tests and operations only, never for caller-visible responses";

/** 租户推导规则沿袭（引用 CF1.0 冻结语义，不重复定义）。 */
export const IDN_TENANT_DERIVATION_RULE =
  "tenant_id is derived from signature-verified token claims (IDN1.0 arena_tenant_context) " +
  "or the demo registry; a caller-provided tenant field is rejected upstream by the frozen " +
  "CF1.0 schemas and can never override derivation";
