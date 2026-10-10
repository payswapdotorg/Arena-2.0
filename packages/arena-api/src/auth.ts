import type { TenantContext } from "@arena/contracts";

/**
 * 认证上下文适配器（DEMO）。
 * 租户上下文永远由服务端从已认证凭据推导 —— 请求体中的 tenant 字段
 * 会被契约 schema 作为未知字段拒绝（这是冻结行为）。
 *
 * 本 WO 使用确定性的演示令牌注册表；生产认证（OAuth/服务凭证）属于
 * 后续 WO 的适配器替换面，接口形状不变。
 */

export const DEMO_AUTH_DISCLOSURE =
  "DEMO auth adapter: deterministic token registry for local development only — never production identity" as const;

const DEMO_PRINCIPALS: Record<string, TenantContext> = {
  "demo-token-requester-alpha": {
    tenant_id: "tnt_00000001",
    derived_from: "authenticated_credentials",
    client_application_id: "app_00000001",
    principal_id: "usr_00000001",
    acting_identity_id: null,
    role: "requester",
    authorization_scope_ids: ["scp_00000001"],
  },
  "demo-token-requester-beta": {
    tenant_id: "tnt_00000002",
    derived_from: "authenticated_credentials",
    client_application_id: "app_00000002",
    principal_id: "usr_00000002",
    acting_identity_id: null,
    role: "requester",
    authorization_scope_ids: ["scp_00000002"],
  },
  "demo-token-expert-omega": {
    tenant_id: "tnt_00000001",
    derived_from: "authenticated_credentials",
    client_application_id: "app_00000001",
    principal_id: "usr_00000003",
    acting_identity_id: null,
    role: "expert",
    authorization_scope_ids: ["scp_00000003"],
  },
};

/** 从 Authorization 头推导租户上下文；缺失/未知令牌 → null（调用方返回 401）。 */
export function deriveTenantContext(
  authorizationHeader: string | null | undefined,
): TenantContext | null {
  if (authorizationHeader === undefined || authorizationHeader === null) return null;
  const match = /^Bearer (.+)$/.exec(authorizationHeader);
  if (match === null) return null;
  return DEMO_PRINCIPALS[match[1] ?? ""] ?? null;
}

/** role/lens 永远不是授权（冻结规则）——供路由层断言。 */
export function roleIsPresentationOnly(context: TenantContext): boolean {
  return context.derived_from === "authenticated_credentials";
}
