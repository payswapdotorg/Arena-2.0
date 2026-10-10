import { z } from "zod";
import { arenaIdSchema, nonEmptyShortSchema } from "./common.js";

/**
 * A10 — TenantContext 契约。
 * 规则（ES2.0 §1/§3，architecture-lock 第 7 条）：
 * - tenant 由服务端从已认证凭据推导；调用方提供的 tenant 字段永远不能覆盖它。
 * - 已认证主体、tenant、行动身份、role/lens、授权决定是五个不同的概念；
 *   role/lens 永远不是授权依据。
 */

export const tenantDerivationSchema = z.enum(["authenticated_credentials"]);

export const tenantContextSchema = z
  .object({
    tenant_id: arenaIdSchema,
    derived_from: tenantDerivationSchema,
    client_application_id: arenaIdSchema,
    principal_id: arenaIdSchema,
    acting_identity_id: arenaIdSchema.nullable(),
    role: nonEmptyShortSchema,
    authorization_scope_ids: z.array(arenaIdSchema).max(64),
  })
  .strict();

export type TenantContext = z.infer<typeof tenantContextSchema>;

/** 租户推导规则（冻结语义，供文档与测试引用）。 */
export const TENANT_DERIVATION_RULE =
  "tenant_id is derived server-side from authenticated credentials only; " +
  "a caller-provided tenant/tenant_id field is rejected as an unknown field and must never override derivation";

/** role/lens 非授权规则（architecture-lock 第 7 条）。 */
export const ROLE_IS_NOT_AUTHORIZATION_RULE =
  "role and lens are presentation context only; authorization decisions must be made server-side " +
  "from principal + scope + object policy, never from the role/lens field";

/**
 * 语义校验：TenantContext 层面的跨字段规则。
 * 结构校验之后在信任边界调用；返回空数组表示语义通过。
 */
export interface SemanticIssue {
  field: string;
  rule: string;
}

export function validateTenantContextSemantics(input: TenantContext): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  if (input.derived_from !== "authenticated_credentials") {
    issues.push({
      field: "derived_from",
      rule: "tenant must be derived from authenticated credentials",
    });
  }
  if (input.authorization_scope_ids.length > 0 && input.principal_id === input.tenant_id) {
    issues.push({ field: "principal_id", rule: "principal and tenant are distinct identities" });
  }
  return issues;
}
