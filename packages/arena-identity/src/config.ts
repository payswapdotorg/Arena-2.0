/**
 * IDN1.0 环境配置（AR2-022）。
 *
 * 密钥纪律（issue #54「Secrets handling」）：
 * - 密钥/端点只经环境变量进入构造，代码内零字面量；
 * - 配置错误在组合根抛出（fail-fast），错误消息点名变量名但绝不带值；
 * - OIDC 公钥流（RS256+JWKS）无需客户端密钥；机密客户端流
 *   （client_secret）明确不在本 WO 范围（IdP 侧决策，AR2-023 记录）；
 * - redactIdentityConfig 提供日志/披露安全投影：无任何凭据值
 *   （issuer/audience 是标识符而非机密，可披露；轮换期望见 README）。
 */

export type AuthMode = "demo" | "oidc";

export interface OidcAdapterEnvConfig {
  mode: "oidc";
  issuer: string;
  audience: string;
  jwksUri: string;
  clockSkewSeconds: number;
  jwksCacheTtlSeconds: number;
  jwksTimeoutMs: number;
  replayPolicy: "none" | "jti_once";
}

export interface DemoEnvConfig {
  mode: "demo";
}

export type IdentityEnvConfig = DemoEnvConfig | OidcAdapterEnvConfig;

export class IdentityConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityConfigError";
  }
}

function requireEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new IdentityConfigError(`missing required environment variable: ${name}`);
  }
  return value.trim();
}

function parsePositiveInt(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new IdentityConfigError(`environment variable ${name} must be a positive integer`);
  }
  return parsed;
}

/**
 * 从环境推导身份配置。默认 demo（向后兼容：现有部署与测试面不变）。
 * ARENA_AUTH_MODE=oidc 时要求 issuer/audience/jwksUri 三项齐备（fail-fast）。
 */
export function loadIdentityConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): IdentityEnvConfig {
  const mode = (env["ARENA_AUTH_MODE"] ?? "demo").trim();
  if (mode !== "demo" && mode !== "oidc") {
    throw new IdentityConfigError(
      `ARENA_AUTH_MODE must be "demo" or "oidc" (got an invalid value; value withheld)`,
    );
  }
  if (mode === "demo") return { mode: "demo" };
  const replayRaw = (env["ARENA_AUTH_OIDC_REPLAY_POLICY"] ?? "none").trim();
  if (replayRaw !== "none" && replayRaw !== "jti_once") {
    throw new IdentityConfigError(
      `ARENA_AUTH_OIDC_REPLAY_POLICY must be "none" or "jti_once" (value withheld)`,
    );
  }
  return {
    mode: "oidc",
    issuer: requireEnv(env, "ARENA_AUTH_OIDC_ISSUER"),
    audience: requireEnv(env, "ARENA_AUTH_OIDC_AUDIENCE"),
    jwksUri: requireEnv(env, "ARENA_AUTH_OIDC_JWKS_URI"),
    clockSkewSeconds: parsePositiveInt(env, "ARENA_AUTH_OIDC_CLOCK_SKEW_SECONDS", 60),
    jwksCacheTtlSeconds: parsePositiveInt(env, "ARENA_AUTH_OIDC_JWKS_CACHE_TTL_SECONDS", 600),
    jwksTimeoutMs: parsePositiveInt(env, "ARENA_AUTH_OIDC_JWKS_TIMEOUT_MS", 5_000),
    replayPolicy: replayRaw,
  };
}

/** 日志/披露安全投影：结构化、无凭据值。 */
export function redactIdentityConfig(config: IdentityEnvConfig): Record<string, unknown> {
  if (config.mode === "demo") {
    return { mode: "demo" };
  }
  return {
    mode: "oidc",
    issuer: config.issuer,
    audience: config.audience,
    jwks_uri: config.jwksUri,
    clock_skew_seconds: config.clockSkewSeconds,
    jwks_cache_ttl_seconds: config.jwksCacheTtlSeconds,
    jwks_timeout_ms: config.jwksTimeoutMs,
    replay_policy: config.replayPolicy,
  };
}
