/**
 * IDN1.0 类型化认证失败目录（AR2-022）。
 *
 * 纪律：
 * - 封闭枚举 —— 新失败码必须走 IDN 契约版本演进，禁止静默扩表；
 * - detail 是给类型化测试与运维的内部信息：绝不进入 HTTP 响应体
 *   （边缘统一 401，无预言机），也绝不含任何密钥/令牌值；
 * - 所有失败 fail-closed：没有「降级放行」的失败类别。
 */

export const AUTHN_FAILURE_CODES = [
  "IDN_AUTH_MISSING",
  "IDN_AUTH_MALFORMED",
  "IDN_TOKEN_MALFORMED",
  "IDN_ALG_REJECTED",
  "IDN_ISSUER_MISMATCH",
  "IDN_AUDIENCE_MISMATCH",
  "IDN_TOKEN_EXPIRED",
  "IDN_TOKEN_NOT_YET_VALID",
  "IDN_SIGNATURE_INVALID",
  "IDN_KEY_UNAVAILABLE",
  "IDN_CLAIMS_INVALID",
  "IDN_REPLAY_DETECTED",
] as const;

export type AuthnFailureCode = (typeof AUTHN_FAILURE_CODES)[number];

export interface AuthnFailureSpec {
  code: AuthnFailureCode;
  /** 类别：凭据缺失 / 凭据不可解析 / 密码学拒绝 / 有效性窗口 / 声明映射 / 重放。 */
  class:
    | "credential_absent"
    | "credential_malformed"
    | "cryptographic"
    | "validity_window"
    | "claims_mapping"
    | "replay";
  /** 内部语义（文档与测试引用；不外发）。 */
  semantics: string;
}

export const AUTHN_FAILURE_CATALOG: Record<AuthnFailureCode, AuthnFailureSpec> = {
  IDN_AUTH_MISSING: {
    code: "IDN_AUTH_MISSING",
    class: "credential_absent",
    semantics: "no Authorization header on a protected route",
  },
  IDN_AUTH_MALFORMED: {
    code: "IDN_AUTH_MALFORMED",
    class: "credential_malformed",
    semantics: "Authorization header is not a Bearer scheme with a non-empty token",
  },
  IDN_TOKEN_MALFORMED: {
    code: "IDN_TOKEN_MALFORMED",
    class: "credential_malformed",
    semantics: "compact JWS structure/base64url/JSON parsing failed",
  },
  IDN_ALG_REJECTED: {
    code: "IDN_ALG_REJECTED",
    class: "cryptographic",
    semantics:
      "alg absent, 'none', or outside the configured allowlist (incl. alg-confusion attempts)",
  },
  IDN_ISSUER_MISMATCH: {
    code: "IDN_ISSUER_MISMATCH",
    class: "cryptographic",
    semantics: "iss claim does not exactly match the configured issuer",
  },
  IDN_AUDIENCE_MISMATCH: {
    code: "IDN_AUDIENCE_MISMATCH",
    class: "cryptographic",
    semantics: "aud claim does not contain the configured audience",
  },
  IDN_TOKEN_EXPIRED: {
    code: "IDN_TOKEN_EXPIRED",
    class: "validity_window",
    semantics: "exp is in the past beyond the configured clock-skew bound",
  },
  IDN_TOKEN_NOT_YET_VALID: {
    code: "IDN_TOKEN_NOT_YET_VALID",
    class: "validity_window",
    semantics: "nbf is in the future beyond the configured clock-skew bound",
  },
  IDN_SIGNATURE_INVALID: {
    code: "IDN_SIGNATURE_INVALID",
    class: "cryptographic",
    semantics: "signature verification failed for the resolved key",
  },
  IDN_KEY_UNAVAILABLE: {
    code: "IDN_KEY_UNAVAILABLE",
    class: "cryptographic",
    semantics: "JWKS unreachable, malformed, or kid unknown after refresh — fail-closed",
  },
  IDN_CLAIMS_INVALID: {
    code: "IDN_CLAIMS_INVALID",
    class: "claims_mapping",
    semantics:
      "arena_tenant_context claim missing/unknown-field/shape-invalid or frozen-schema drift",
  },
  IDN_REPLAY_DETECTED: {
    code: "IDN_REPLAY_DETECTED",
    class: "replay",
    semantics: "jti already consumed within the token validity window (jti_once policy)",
  },
};

/** 内部失败构造：detail 只进类型化结果与运维面，永不进 HTTP 响应。 */
export function authnFailure(
  code: AuthnFailureCode,
  detail: string,
): {
  ok: false;
  code: AuthnFailureCode;
  detail: string;
} {
  return { ok: false, code, detail };
}
