import assert from "node:assert/strict";
import test from "node:test";
import {
  extractBearerToken,
  isRsaSigningJwk,
  parseCompactJws,
  verifyHs256,
  verifyRs256,
} from "../src/contract.js";
import {
  mintAlgConfusionToken,
  generateRsaKeyMaterial,
  hmacSecretForTest,
  mintCompactJws,
  mintValidRs256Token,
  standardClaims,
} from "./helpers.js";
import { createHmac } from "node:crypto";

/**
 * JWS 原语对抗向量（AR2-022）：
 * 结构攻击 / alg=none / alg 混淆 / 伪造签名 / 时序安全比较 / 头解析。
 */

const NOW = 1_800_000_000;
const key = generateRsaKeyMaterial("kid-auth-1");

test("parseCompactJws accepts a well-formed RS256 token", () => {
  const token = mintValidRs256Token(key, NOW);
  const parsed = parseCompactJws(token);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.jws.header.alg, "RS256");
    assert.equal(parsed.jws.header.kid, "kid-auth-1");
    assert.equal(parsed.jws.header.typ, "JWT");
  }
});

test("parseCompactJws rejects structural attacks", () => {
  const token = mintValidRs256Token(key, NOW);
  const segments = token.split(".");
  const cases: Array<[string, string]> = [
    ["two segments", `${segments[0]}.${segments[1]}`],
    ["four segments", `${token}.extra`],
    ["empty header", `.${segments[1]}.${segments[2]}`],
    ["empty claims", `${segments[0]}..${segments[2]}`],
    ["empty signature", `${segments[0]}.${segments[1]}.`],
    ["empty token", ""],
    ["not a jws", "garbage"],
  ];
  for (const [name, candidate] of cases) {
    const parsed = parseCompactJws(candidate);
    assert.equal(parsed.ok, false, name);
  }
});

test("parseCompactJws rejects invalid base64url and JSON", () => {
  const cases = [
    "!!!.eyJhIjoxfQ.SignatureSegment",
    `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.!!!.sig`,
    `${Buffer.from("not json").toString("base64url")}.eyJhIjoxfQ.sig`,
    `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from("not json").toString("base64url")}.sig`,
  ];
  for (const candidate of cases) {
    const parsed = parseCompactJws(candidate);
    assert.equal(parsed.ok, false);
  }
});

test("parseCompactJws rejects alg=none and missing alg", () => {
  const noneHeader = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify(standardClaims(NOW))).toString("base64url");
  const noneToken = `${noneHeader}.${claims}.`;
  assert.equal(parseCompactJws(noneToken).ok, false);

  const noAlgHeader = Buffer.from(JSON.stringify({ typ: "JWT" })).toString("base64url");
  const noAlgToken = `${noAlgHeader}.${claims}.sig`;
  assert.equal(parseCompactJws(noAlgToken).ok, false);

  const arrayHeader = Buffer.from(JSON.stringify(["RS256"])).toString("base64url");
  assert.equal(parseCompactJws(`${arrayHeader}.${claims}.sig`).ok, false);
});

test("verifyRs256 accepts a genuine signature and rejects tampered/foreign signatures", () => {
  const token = mintValidRs256Token(key, NOW);
  const parsed = parseCompactJws(token);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(verifyRs256(key.jwk as never, parsed.jws.signingInput, parsed.jws.signature), true);

  const tampered = mintCompactJws({ key, claims: standardClaims(NOW), tamperSignature: true });
  const parsedTampered = parseCompactJws(tampered);
  assert.equal(parsedTampered.ok, true);
  if (parsedTampered.ok) {
    assert.equal(
      verifyRs256(key.jwk as never, parsedTampered.jws.signingInput, parsedTampered.jws.signature),
      false,
    );
  }

  const attacker = generateRsaKeyMaterial("kid-attacker");
  const foreign = mintCompactJws({
    key: attacker,
    claims: standardClaims(NOW),
    headerOverride: { kid: key.kid },
  });
  const parsedForeign = parseCompactJws(foreign);
  assert.equal(parsedForeign.ok, true);
  if (parsedForeign.ok) {
    assert.equal(
      verifyRs256(key.jwk as never, parsedForeign.jws.signingInput, parsedForeign.jws.signature),
      false,
    );
  }
});

test("verifyRs256 is tamper-sensitive to claim payload changes", () => {
  const tokenA = mintCompactJws({
    key,
    claims: standardClaims(NOW, {
      arena: {
        ...(standardClaims(NOW)["arena_tenant_context"] as object),
        tenant_id: "tnt_00000001",
      },
    }),
  });
  const tokenB = mintCompactJws({
    key,
    claims: standardClaims(NOW, {
      arena: {
        ...(standardClaims(NOW)["arena_tenant_context"] as object),
        tenant_id: "tnt_00000002",
      },
    }),
  });
  const parsedB = parseCompactJws(tokenB);
  assert.equal(parsedB.ok, true);
  // B 的签名对 B 的载荷有效，对 A 的载荷无效（逐字节防篡改）。
  if (parsedB.ok) {
    const parsedA = parseCompactJws(tokenA);
    assert.equal(parsedA.ok, true);
    if (parsedA.ok) {
      assert.equal(
        verifyRs256(key.jwk as never, parsedB.jws.signingInput, parsedB.jws.signature),
        true,
      );
      // 用 B 的签名配 A 的输入 ⇒ 拒绝。
      assert.equal(
        verifyRs256(key.jwk as never, parsedA.jws.signingInput, parsedB.jws.signature),
        false,
      );
    }
  }
});

test("verifyHs256 constant-time comparison rejects length-mismatched and forged macs", () => {
  const secret = hmacSecretForTest();
  const message = Buffer.from("header.claims", "ascii");
  const good = createHmac("sha256", secret).update(message).digest();
  assert.equal(verifyHs256(secret, message, good), true);
  const bad = Buffer.from(good);
  bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 0x01;
  assert.equal(verifyHs256(secret, message, bad), false);
  assert.equal(verifyHs256(secret, message, Buffer.alloc(16)), false);
  const otherSecret = Buffer.from("another-secret");
  assert.equal(verifyHs256(otherSecret, message, good), false);
});

test("isRsaSigningJwk filters non-signing keys (alg-confusion surface hardening)", () => {
  assert.equal(isRsaSigningJwk(key.jwk), true);
  assert.equal(isRsaSigningJwk({ ...key.jwk, use: "enc" }), false);
  assert.equal(isRsaSigningJwk({ ...key.jwk, key_ops: ["encrypt"] }), false);
  assert.equal(isRsaSigningJwk({ ...key.jwk, alg: "RS512" }), false);
  assert.equal(isRsaSigningJwk({ ...key.jwk, kty: "EC" }), false);
  assert.equal(isRsaSigningJwk({ ...key.jwk, n: "" }), false);
  assert.equal(isRsaSigningJwk(null), false);
  assert.equal(isRsaSigningJwk([key.jwk]), false);
});

test("extractBearerToken vectors (missing/malformed/valid)", () => {
  assert.equal(extractBearerToken(null).ok, false);
  assert.equal(extractBearerToken(undefined).ok, false);
  assert.equal(extractBearerToken("").ok, false);
  assert.equal(extractBearerToken("Basic abc").ok, false);
  assert.equal(extractBearerToken("Bearer").ok, false);
  assert.equal(extractBearerToken("bearer lowercase").ok, false);
  const ok = extractBearerToken("Bearer the-token");
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.token, "the-token");
});

test("alg-confusion token (HS256 with public key material) is structurally HS256", () => {
  const confusion = mintAlgConfusionToken(key, standardClaims(NOW));
  const parsed = parseCompactJws(confusion);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    // alg 混淆令牌的 alg 是 HS256 —— 适配器允许列表（默认仅 RS256）将拒绝。
    assert.equal(parsed.jws.header.alg, "HS256");
  }
});
