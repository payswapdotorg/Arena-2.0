/**
 * IDN1.0 紧凑 JWS 解析与签名验证原语（AR2-022）。
 *
 * 纪律（对抗面：伪造/none/alg-confusion/结构攻击）：
 * - 只接受三段 compact JWS（header.payload.signature），多余段/空段拒绝；
 * - base64url 严格解码（无填充、无空白、无非法字符）；
 * - header 必须是 JSON 对象且 alg 为非空字符串；alg "none" 一律拒绝；
 * - 签名验证只支持 RS256（JWKS 公钥）与 HS256（显式对称配置，默认关闭）；
 *   alg 混淆（用 RSA 公钥材料当 HMAC 密钥）因 alg 不在允许列表而结构性拒绝；
 * - 解析出的 payload 只是「候选声明」：在签名验证通过前不做任何信任。
 */

import {
  createHmac,
  createPublicKey,
  timingSafeEqual,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import { authnFailure, type AuthnFailureCode } from "./errors.js";

export interface ParsedJws {
  header: { alg: string; typ?: string; kid?: string };
  /** 原始签名的目标字节（header.payload 的 ASCII）。 */
  signingInput: Buffer;
  signature: Buffer;
  /** 未验证的候选声明（调用方必须在信任前完成签名验证）。 */
  rawClaims: unknown;
}

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

function decodeBase64Url(segment: string): Buffer {
  if (segment.length === 0 || !BASE64URL_RE.test(segment)) {
    throw new Error("invalid base64url segment");
  }
  return Buffer.from(segment, "base64url");
}

function parseJsonSegment(segment: string, what: string): unknown {
  let text: string;
  try {
    text = decodeBase64Url(segment).toString("utf8");
  } catch {
    throw new Error(`${what}: base64url decode failed`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${what}: JSON parse failed`);
  }
}

/**
 * 解析三段 compact JWS。结构/编码/JSON 失败 ⇒ IDN_TOKEN_MALFORMED。
 * alg 必须存在；"none" 在此层即拒绝（IDN_ALG_REJECTED）。
 */
export function parseCompactJws(
  token: string,
): { ok: true; jws: ParsedJws } | { ok: false; code: AuthnFailureCode; detail: string } {
  if (typeof token !== "string" || token.length === 0) {
    return authnFailure("IDN_TOKEN_MALFORMED", "empty token");
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return authnFailure("IDN_TOKEN_MALFORMED", `expected 3 JWS segments, got ${parts.length}`);
  }
  let header: unknown;
  try {
    header = parseJsonSegment(parts[0] ?? "", "header");
  } catch (error) {
    return authnFailure("IDN_TOKEN_MALFORMED", (error as Error).message);
  }
  if (header === null || typeof header !== "object" || Array.isArray(header)) {
    return authnFailure("IDN_TOKEN_MALFORMED", "header is not a JSON object");
  }
  const alg = (header as Record<string, unknown>).alg;
  if (typeof alg !== "string" || alg.length === 0) {
    return authnFailure("IDN_ALG_REJECTED", "header.alg missing or not a string");
  }
  if (alg === "none") {
    return authnFailure("IDN_ALG_REJECTED", "unsigned token (alg=none) is never acceptable");
  }
  let rawClaims: unknown;
  try {
    rawClaims = parseJsonSegment(parts[1] ?? "", "claims");
  } catch (error) {
    return authnFailure("IDN_TOKEN_MALFORMED", (error as Error).message);
  }
  if (rawClaims === null || typeof rawClaims !== "object" || Array.isArray(rawClaims)) {
    return authnFailure("IDN_TOKEN_MALFORMED", "claims is not a JSON object");
  }
  let signature: Buffer;
  try {
    signature = decodeBase64Url(parts[2] ?? "");
  } catch (error) {
    return authnFailure("IDN_TOKEN_MALFORMED", `signature: ${(error as Error).message}`);
  }
  const parsedHeader: { alg: string; typ?: string; kid?: string } = {
    alg,
  };
  const typ = (header as Record<string, unknown>).typ;
  if (typeof typ === "string") parsedHeader.typ = typ;
  const kid = (header as Record<string, unknown>).kid;
  if (typeof kid === "string") parsedHeader.kid = kid;
  return {
    ok: true,
    jws: {
      header: parsedHeader,
      signingInput: Buffer.from(`${parts[0] ?? ""}.${parts[1] ?? ""}`, "ascii"),
      signature,
      rawClaims,
    },
  };
}

/** RSA JWK 形状（仅取验证所需字段；无关字段忽略）。 */
export interface RsaJwk {
  kty: "RSA";
  kid?: string;
  n: string;
  e: string;
  use?: string;
  key_ops?: string[];
  alg?: string;
}

export function isRsaSigningJwk(jwk: unknown): jwk is RsaJwk {
  if (jwk === null || typeof jwk !== "object" || Array.isArray(jwk)) return false;
  const record = jwk as Record<string, unknown>;
  if (record.kty !== "RSA") return false;
  if (typeof record.n !== "string" || record.n.length === 0) return false;
  if (typeof record.e !== "string" || record.e.length === 0) return false;
  if (typeof record.use === "string" && record.use !== "sig") return false;
  if (Array.isArray(record.key_ops) && !record.key_ops.includes("verify")) return false;
  if (typeof record.alg === "string" && record.alg !== "RS256") return false;
  return true;
}

function rsaKeyObjectFromJwk(jwk: RsaJwk): KeyObject {
  return createPublicKey({ key: jwk as unknown as Record<string, string>, format: "jwk" });
}

/** RS256 验证：JWK（JWKS 提供）× 签名输入。任何底层异常归一为验证失败。 */
export function verifyRs256(jwk: RsaJwk, signingInput: Buffer, signature: Buffer): boolean {
  try {
    const key = rsaKeyObjectFromJwk(jwk);
    return cryptoVerify("sha256", signingInput, key, signature);
  } catch {
    return false;
  }
}

/**
 * HS256 验证（显式对称模式；默认不启用）。
 * 该模式要求密钥分发纪律（见 README），生产参考路径是 RS256 + JWKS。
 * 常数时间比较，杜绝时序侧信道。
 */
export function verifyHs256(secret: Buffer, signingInput: Buffer, signature: Buffer): boolean {
  const expected = createHmac("sha256", secret).update(signingInput).digest();
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(expected, signature);
}

/** 从 Authorization 头提取 Bearer 令牌（严格 Bearer 大小写与单空格）。 */
export function extractBearerToken(
  authorizationHeader: string | null | undefined,
): { ok: true; token: string } | { ok: false; code: AuthnFailureCode; detail: string } {
  if (
    authorizationHeader === undefined ||
    authorizationHeader === null ||
    authorizationHeader.length === 0
  ) {
    return authnFailure("IDN_AUTH_MISSING", "no Authorization header");
  }
  const match = /^Bearer (.+)$/.exec(authorizationHeader);
  if (match === null) {
    return authnFailure("IDN_AUTH_MALFORMED", "Authorization header is not a Bearer credential");
  }
  return { ok: true, token: match[1] ?? "" };
}
