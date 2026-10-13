/**
 * OidcIdentityAdapter —— IDN1.0 生产代表性参考实现（AR2-022）。
 *
 * 这是 AR2-015 门报告 grg_00000005 记录的 demo-auth seam 的生产替换路径：
 * - OIDC 访问令牌（RS256 + JWKS，JWKS 拉取/轮换/缓存）；
 * - issuer/audience 严格校验（精确匹配）；
 * - 时钟偏移有界（exp/nbf 容差可配置，默认 60s）；
 * - alg 允许列表（默认仅 RS256；HS256 需显式对称密钥配置）；
 * - arena_tenant_context 声明映射到 CF1.0 TenantContext（冻结 schema 出口校验）；
 * - 可选 jti_once 重放防线（单实例加固，默认 none 并披露）；
 * - 一切失败类型化且 fail-closed；验证顺序：结构 → alg → 签名 → iss →
 *   aud → 时效 → 声明 → 重放（未签名声明零信任）。
 *
 * 不代表任何具体 IdP 厂商选择 —— 那是 owner 决策（AR2-023 记录）。
 */

import {
  idnClaimsSchema,
  tenantContextFromClaim,
  type AdapterReadiness,
  type AuthnResult,
  type IdentityAdapter,
} from "./idn.js";
import { authnFailure } from "./errors.js";
import {
  extractBearerToken,
  parseCompactJws,
  verifyHs256,
  verifyRs256,
  type RsaJwk,
} from "./jwt.js";
import { createJwksClient, type JwksClient } from "./jwks.js";
import { createReplayGuard, type ReplayGuard, type ReplayPolicy } from "./replay.js";

export interface OidcAdapterOptions {
  /** 预期 issuer（精确匹配）。 */
  issuer: string;
  /** 预期 audience（aud 数组或字符串须包含之）。 */
  audience: string;
  /** JWKS 端点（显式配置；不做 issuer 猜测式发现）。 */
  jwksUri: string;
  /** 允许的签名算法（默认 ["RS256"]）。 */
  algorithms?: string[];
  /** 时钟偏移容差（秒，默认 60）。 */
  clockSkewSeconds?: number;
  /** JWKS 缓存 TTL（毫秒，默认 600_000）。 */
  jwksCacheTtlMs?: number;
  /** JWKS 请求超时（毫秒，默认 5_000）。 */
  jwksTimeoutMs?: number;
  /** 重放策略（默认 "none"，披露）。 */
  replayPolicy?: ReplayPolicy;
  /** HS256 对称密钥（仅当 algorithms 含 HS256 时必填；分发纪律见 README）。 */
  hmacSecret?: Buffer;
  /** 注入测试用 fetch。 */
  fetchImpl?: typeof fetch;
}

const SUPPORTED_ALGORITHMS = ["RS256", "HS256"] as const;

export interface OidcAdapter extends IdentityAdapter {
  probe(): Promise<AdapterReadiness>;
  readiness(): AdapterReadiness;
}

export function createOidcIdentityAdapter(options: OidcAdapterOptions): OidcAdapter {
  const issuer = options.issuer;
  const audience = options.audience;
  const algorithms = options.algorithms ?? ["RS256"];
  const clockSkewSeconds = options.clockSkewSeconds ?? 60;
  const replayPolicy = options.replayPolicy ?? "none";

  for (const alg of algorithms) {
    if (!SUPPORTED_ALGORITHMS.includes(alg as (typeof SUPPORTED_ALGORITHMS)[number])) {
      throw new Error(`unsupported algorithm in allowlist: ${alg}`);
    }
  }
  if (algorithms.includes("HS256") && options.hmacSecret === undefined) {
    throw new Error(
      "HS256 in allowlist requires an explicit hmacSecret (distribution discipline: README)",
    );
  }

  let jwks: JwksClient | null = null;
  if (algorithms.includes("RS256")) {
    jwks = createJwksClient({
      uri: options.jwksUri,
      timeoutMs: options.jwksTimeoutMs,
      cacheTtlMs: options.jwksCacheTtlMs,
      fetchImpl: options.fetchImpl,
    });
  }
  const replay: ReplayGuard = createReplayGuard({ policy: replayPolicy });

  function failClosedJwks(): AuthnResult {
    return {
      ok: false,
      code: "IDN_KEY_UNAVAILABLE",
      detail: "JWKS unavailable — verification fails closed",
    };
  }

  async function verify(authorizationHeader: string | null | undefined): Promise<AuthnResult> {
    const extracted = extractBearerToken(authorizationHeader);
    if (!extracted.ok) {
      return { ok: false, code: extracted.code, detail: extracted.detail };
    }
    const parsed = parseCompactJws(extracted.token);
    if (!parsed.ok) {
      return { ok: false, code: parsed.code, detail: parsed.detail };
    }
    const jws = parsed.jws;
    if (!algorithms.includes(jws.header.alg)) {
      return authnFailure(
        "IDN_ALG_REJECTED",
        `alg ${jws.header.alg} is outside the configured allowlist`,
      );
    }
    // 签名先行：未通过签名验证的载荷零信任（含 iss/aud/exp）。
    let signatureOk = false;
    if (jws.header.alg === "RS256") {
      let jwk: RsaJwk;
      try {
        jwk = await (jwks as JwksClient).getSigningKey(jws.header.kid);
      } catch {
        return failClosedJwks();
      }
      signatureOk = verifyRs256(jwk, jws.signingInput, jws.signature);
    } else {
      signatureOk = verifyHs256(options.hmacSecret as Buffer, jws.signingInput, jws.signature);
    }
    if (!signatureOk) {
      return authnFailure("IDN_SIGNATURE_INVALID", "signature verification failed");
    }
    // 声明集（已签名）：结构校验。
    const claims = idnClaimsSchema.safeParse(jws.rawClaims);
    if (!claims.success) {
      return authnFailure(
        "IDN_CLAIMS_INVALID",
        "signed claims do not satisfy the IDN1.0 claims contract",
      );
    }
    const payload = claims.data;
    // iss 精确匹配。
    if (payload.iss !== issuer) {
      return authnFailure("IDN_ISSUER_MISMATCH", "iss does not match the configured issuer");
    }
    // aud 包含性校验。
    const audienceList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audienceList.includes(audience)) {
      return authnFailure("IDN_AUDIENCE_MISMATCH", "aud does not contain the configured audience");
    }
    // 时效（有界时钟偏移）。
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (payload.exp + clockSkewSeconds <= nowSeconds) {
      return authnFailure("IDN_TOKEN_EXPIRED", "exp is in the past beyond the clock-skew bound");
    }
    if (payload.nbf !== undefined && payload.nbf - clockSkewSeconds > nowSeconds) {
      return authnFailure(
        "IDN_TOKEN_NOT_YET_VALID",
        "nbf is in the future beyond the clock-skew bound",
      );
    }
    // arena 租户声明 → CF1.0 TenantContext（出口冻结校验）。
    const mapped = tenantContextFromClaim(payload.arena_tenant_context);
    if (!mapped.ok) {
      return { ok: false, code: mapped.code, detail: mapped.detail };
    }
    // 重放防线（jti_once）。
    if (replayPolicy === "jti_once") {
      const jti = payload.jti ?? `sub:${payload.sub}:${payload.iat}:${payload.exp}`;
      const accepted = replay.checkAndRecord(`${payload.iss}::${jti}`, payload.exp, nowSeconds);
      if (!accepted) {
        return authnFailure("IDN_REPLAY_DETECTED", "jti already consumed within validity");
      }
    }
    return {
      ok: true,
      context: mapped.context,
      meta: {
        adapter_id: "oidc_jwks_v1",
        algorithm: jws.header.alg,
        jti: payload.jti ?? null,
        expires_at: payload.exp,
      },
    };
  }

  async function probe(): Promise<AdapterReadiness> {
    if (jwks === null) {
      return { mode: "oidc_hmac_v1", ready: true, detail: "symmetric mode (no JWKS dependency)" };
    }
    try {
      await jwks.refresh();
      const state = jwks.state();
      return {
        mode: "oidc_jwks_v1",
        ready: true,
        detail: `jwks ok (${state.keyCount} signing key(s))`,
      };
    } catch {
      const state = jwks.state();
      return {
        mode: "oidc_jwks_v1",
        ready: false,
        detail: `jwks unreachable (${state.lastErrorKind ?? "unknown"}) — verification stays fail-closed`,
      };
    }
  }

  function readiness(): AdapterReadiness {
    if (jwks === null) {
      return { mode: "oidc_hmac_v1", ready: true };
    }
    const state = jwks.state();
    if (state.lastFetchOk) {
      return {
        mode: "oidc_jwks_v1",
        ready: true,
        detail: `jwks ok (${state.keyCount} signing key(s))`,
      };
    }
    return {
      mode: "oidc_jwks_v1",
      ready: false,
      detail: `jwks not yet confirmed (${state.lastErrorKind ?? "not probed"}) — verification fail-closed`,
    };
  }

  return {
    id: "oidc_jwks_v1",
    mode: "oidc",
    verify,
    probe,
    readiness,
  };
}
