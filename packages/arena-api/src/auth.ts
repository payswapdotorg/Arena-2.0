import type { TenantContext } from "@arena/contracts";
import {
  DEMO_IDENTITY_DISCLOSURE,
  createDemoIdentityAdapter,
  type AuthnResult,
  type IdentityAdapter,
} from "@arena/identity";

/**
 * 认证上下文适配器 seam（AR2-022 升级；AR2-002 原面保留兼容）。
 * 租户上下文永远由服务端从已认证凭据推导 —— 请求体中的 tenant 字段
 * 会被契约 schema 作为未知字段拒绝（这是冻结行为）。
 *
 * IDN1.0 端口（@arena/identity）：demo 注册表（DEMO-ONLY）或
 * OIDC/JWKS 生产参考实现；组合根（main.ts / 测试）注入具体适配器，
 * server.ts 只依赖端口形状 —— 接口形状不变，适配器可替换。
 *
 * 边缘映射纪律：任何认证失败（含类型化 IDN_* 失败码）一律同一 401
 * 信封 —— 失败码只进类型化测试与运维面，绝不进响应体（无预言机）。
 */

export const DEMO_AUTH_DISCLOSURE = DEMO_IDENTITY_DISCLOSURE;

/** 网关：把 IDN1.0 适配器结果投影为边缘形状（null ⇒ 401）。 */
export interface AuthGateway {
  /** 活动适配器（披露/测试用）。 */
  readonly adapter: IdentityAdapter;
  /** 失败结果（类型化，供测试断言；响应体永不携带）。 */
  readonly lastFailure: () => AuthnResult | null;
  /** 从 Authorization 头推导租户上下文；任何失败 ⇒ null。 */
  deriveTenantContext(
    authorizationHeader: string | null | undefined,
  ): Promise<TenantContext | null>;
  /** /readyz 投影（无凭据值）。 */
  describeAuth(): { mode: string; ready: boolean; disclosure?: string };
}

/** demo 网关（默认组合 —— 与 AR2-002 行为逐字节兼容）。 */
export function createDemoAuthGateway(): AuthGateway {
  return createAuthGateway(createDemoIdentityAdapter());
}

/**
 * 组合网关：适配器注入（OIDC 参考实现或任何 IDN1.0 实现）。
 * demo 适配器永远披露 DEMO-ONLY；OIDC 披露生产参考路径。
 */
export function createAuthGateway(adapter: IdentityAdapter): AuthGateway {
  let lastFailure: AuthnResult | null = null;
  return {
    adapter,
    lastFailure: () => lastFailure,
    async deriveTenantContext(authorizationHeader) {
      const result = await adapter.verify(authorizationHeader);
      if (result.ok) {
        lastFailure = null;
        return result.context;
      }
      lastFailure = result;
      return null;
    },
    describeAuth() {
      if (adapter.mode === "demo") {
        return { mode: "demo_registry", ready: true, disclosure: DEMO_IDENTITY_DISCLOSURE };
      }
      const probe = adapter as {
        readiness?: () => { mode: string; ready: boolean; detail?: string };
      };
      const readiness = probe.readiness?.() ?? { mode: "oidc_jwks_v1", ready: true };
      return {
        mode: readiness.mode,
        ready: readiness.ready,
        disclosure: readiness.detail,
      };
    },
  };
}

/** role/lens 永远不是授权（冻结规则）——供路由层断言。 */
export function roleIsPresentationOnly(context: TenantContext): boolean {
  return context.derived_from === "authenticated_credentials";
}
