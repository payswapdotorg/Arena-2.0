/**
 * DemoIdentityAdapter —— IDN1.0 demo 适配器（AR2-022 移植，DEMO-ONLY）。
 *
 * ⚠️ DEMO-ONLY：确定性演示令牌注册表，仅供本地开发/既有测试面。
 * 它不是身份证据，绝不用于生产。生产路径是 OidcIdentityAdapter
 * （或任何实现 IDN1.0 端口的第三方适配器）。此标记在代码与文档
 * 双重存在（issue #54 验收：demo adapter marked demo-only in code and docs）。
 *
 * 行为与 AR2-002 的 packages/arena-api/src/auth.ts 原注册表完全一致：
 * 同一令牌集、同一 TenantContext 形状（经冻结 schema 出口校验）、
 * 未知令牌 ⇒ ok:false（调用方 401）。
 */

import { tenantContextSchema, type TenantContext } from "@arena/contracts";
import { type IdentityAdapter } from "./idn.js";

export const DEMO_IDENTITY_DISCLOSURE =
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

const BEARER_RE = /^Bearer (.+)$/;

export function createDemoIdentityAdapter(): IdentityAdapter {
  return {
    id: "demo_registry_v0",
    mode: "demo",
    async verify(authorizationHeader) {
      if (authorizationHeader === undefined || authorizationHeader === null) {
        return { ok: false, code: "IDN_AUTH_MISSING" as const, detail: "no Authorization header" };
      }
      const match = BEARER_RE.exec(authorizationHeader);
      if (match === null) {
        return {
          ok: false,
          code: "IDN_AUTH_MALFORMED" as const,
          detail: "Authorization header is not a Bearer credential",
        };
      }
      const raw = DEMO_PRINCIPALS[match[1] ?? ""];
      if (raw === undefined) {
        return {
          ok: false,
          code: "IDN_SIGNATURE_INVALID" as const,
          detail: "demo registry: unknown token",
        };
      }
      const validated = tenantContextSchema.safeParse(raw);
      if (!validated.success) {
        return {
          ok: false,
          code: "IDN_CLAIMS_INVALID" as const,
          detail: "demo registry entry drifted from the frozen schema",
        };
      }
      return {
        ok: true,
        context: validated.data,
        meta: {
          adapter_id: "demo_registry_v0",
          algorithm: "demo-registry-lookup",
          jti: null,
          expires_at: Number.MAX_SAFE_INTEGER,
        },
      };
    },
  };
}

/** DEMO-ONLY 断言（供路由/测试层显式拒绝 demo 凭据用于生产断言）。 */
export function isDemoAdapter(adapter: IdentityAdapter): boolean {
  return adapter.mode === "demo";
}
