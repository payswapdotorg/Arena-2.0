import assert from "node:assert/strict";
import test from "node:test";
import {
  createOidcIdentityAdapter,
  loadIdentityConfigFromEnv,
  redactIdentityConfig,
} from "../src/contract.js";
import {
  AUDIENCE,
  ISSUER,
  TENANT_ALPHA,
  TENANT_BETA,
  mintAlgConfusionToken,
  generateRsaKeyMaterial,
  hmacSecretForTest,
  mintCompactJws,
  mintValidRs256Token,
  standardClaims,
  startFakeJwksServer,
} from "./helpers.js";

/**
 * AR2-022 对抗认证电池 —— 全部通过生产参考适配器路径
 * （OidcIdentityAdapter：RS256 + JWKS + issuer/audience + 时钟偏移界）。
 * 向量：伪造/过期/未生效/错受众/错签发者/alg-none/alg 混淆/租户混淆/
 * 重放/JWKS 不可用 fail-closed。
 */

const keyA = generateRsaKeyMaterial("kid-auth-1");
const attackerKey = generateRsaKeyMaterial("kid-attacker");
const NOW = Math.floor(Date.now() / 1000);

async function createBattery() {
  const idp = await startFakeJwksServer([keyA.jwk]);
  const adapter = createOidcIdentityAdapter({
    issuer: ISSUER,
    audience: AUDIENCE,
    jwksUri: idp.jwksUri,
    clockSkewSeconds: 60,
    jwksCacheTtlMs: 60_000,
  });
  return { idp, adapter };
}

function bearer(token: string): string {
  return `Bearer ${token}`;
}

test("positive vector: valid RS256 token maps to the verified TenantContext", async () => {
  const { idp, adapter } = await createBattery();
  try {
    const token = mintValidRs256Token(keyA, NOW);
    const result = await adapter.verify(bearer(token));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.context.tenant_id, TENANT_ALPHA.tenant_id);
      assert.equal(result.context.derived_from, "authenticated_credentials");
      assert.equal(result.meta.adapter_id, "oidc_jwks_v1");
      assert.equal(result.meta.algorithm, "RS256");
      assert.ok(result.meta.expires_at > NOW);
    }
  } finally {
    await idp.close();
  }
});

test("forged signature (attacker key, real kid) is rejected", async () => {
  const { idp, adapter } = await createBattery();
  try {
    const forged = mintCompactJws({
      key: attackerKey,
      claims: standardClaims(NOW),
      headerOverride: { kid: keyA.kid },
    });
    const result = await adapter.verify(bearer(forged));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "IDN_SIGNATURE_INVALID");
  } finally {
    await idp.close();
  }
});

test("tampered signature on a genuine token is rejected", async () => {
  const { idp, adapter } = await createBattery();
  try {
    const tampered = mintCompactJws({
      key: keyA,
      claims: standardClaims(NOW),
      tamperSignature: true,
    });
    const result = await adapter.verify(bearer(tampered));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "IDN_SIGNATURE_INVALID");
  } finally {
    await idp.close();
  }
});

test("alg=none token is rejected", async () => {
  const { idp, adapter } = await createBattery();
  try {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const claims = Buffer.from(JSON.stringify(standardClaims(NOW))).toString("base64url");
    const result = await adapter.verify(bearer(`${header}.${claims}.`));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "IDN_ALG_REJECTED");
  } finally {
    await idp.close();
  }
});

test("alg-confusion token (HS256 signed with RSA public key material) is rejected", async () => {
  const { idp, adapter } = await createBattery();
  try {
    const confusion = mintAlgConfusionToken(keyA, standardClaims(NOW));
    const result = await adapter.verify(bearer(confusion));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "IDN_ALG_REJECTED");
  } finally {
    await idp.close();
  }
});

test("expired beyond the skew bound is rejected; within the bound is accepted", async () => {
  const { idp, adapter } = await createBattery();
  try {
    const farExpired = mintValidRs256Token(keyA, NOW, { exp: NOW - 600 });
    const far = await adapter.verify(bearer(farExpired));
    assert.equal(far.ok, false);
    if (!far.ok) assert.equal(far.code, "IDN_TOKEN_EXPIRED");

    const justExpired = mintValidRs256Token(keyA, NOW, { exp: NOW - 30 });
    const just = await adapter.verify(bearer(justExpired));
    assert.equal(just.ok, true);
  } finally {
    await idp.close();
  }
});

test("not-yet-valid beyond the skew bound is rejected", async () => {
  const { idp, adapter } = await createBattery();
  try {
    const future = mintValidRs256Token(keyA, NOW, { nbf: NOW + 600 });
    const result = await adapter.verify(bearer(future));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "IDN_TOKEN_NOT_YET_VALID");

    const justFuture = mintValidRs256Token(keyA, NOW, { nbf: NOW + 30 });
    const just = await adapter.verify(bearer(justFuture));
    assert.equal(just.ok, true);
  } finally {
    await idp.close();
  }
});

test("wrong audience is rejected (scalar and array forms)", async () => {
  const { idp, adapter } = await createBattery();
  try {
    const wrongScalar = mintValidRs256Token(keyA, NOW, { aud: "some-other-api" });
    const scalar = await adapter.verify(bearer(wrongScalar));
    assert.equal(scalar.ok, false);
    if (!scalar.ok) assert.equal(scalar.code, "IDN_AUDIENCE_MISMATCH");

    const wrongArray = mintValidRs256Token(keyA, NOW, { aud: ["api-one", "api-two"] });
    const array = await adapter.verify(bearer(wrongArray));
    assert.equal(array.ok, false);
    if (!array.ok) assert.equal(array.code, "IDN_AUDIENCE_MISMATCH");

    const rightArray = mintValidRs256Token(keyA, NOW, { aud: [AUDIENCE, "other"] });
    const okArray = await adapter.verify(bearer(rightArray));
    assert.equal(okArray.ok, true);
  } finally {
    await idp.close();
  }
});

test("wrong issuer is rejected (exact match discipline)", async () => {
  const { idp, adapter } = await createBattery();
  try {
    const evilIssuer = mintValidRs256Token(keyA, NOW, { iss: `${ISSUER}-evil` });
    const result = await adapter.verify(bearer(evilIssuer));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "IDN_ISSUER_MISMATCH");
  } finally {
    await idp.close();
  }
});

test("missing arena claim / unknown arena field / malformed ids are rejected as claims-invalid", async () => {
  const { idp, adapter } = await createBattery();
  try {
    const noArenaClaims = standardClaims(NOW, { arena: null });
    delete (noArenaClaims as Record<string, unknown>)["arena_tenant_context"];
    const noArena = await adapter.verify(
      bearer(mintCompactJws({ key: keyA, claims: noArenaClaims })),
    );
    assert.equal(noArena.ok, false);
    if (!noArena.ok) assert.equal(noArena.code, "IDN_CLAIMS_INVALID");

    const smuggled = mintValidRs256Token(keyA, NOW, {
      arena: { ...TENANT_ALPHA, tenant: "tnt_99999999" },
    });
    const smuggledResult = await adapter.verify(bearer(smuggled));
    assert.equal(smuggledResult.ok, false);
    if (!smuggledResult.ok) assert.equal(smuggledResult.code, "IDN_CLAIMS_INVALID");

    const badId = mintValidRs256Token(keyA, NOW, {
      arena: { ...TENANT_ALPHA, tenant_id: "evil-id" },
    });
    const badIdResult = await adapter.verify(bearer(badId));
    assert.equal(badIdResult.ok, false);
    if (!badIdResult.ok) assert.equal(badIdResult.code, "IDN_CLAIMS_INVALID");
  } finally {
    await idp.close();
  }
});

test("tenant confusion: tenant comes only from signature-verified arena claims", async () => {
  const { idp, adapter } = await createBattery();
  try {
    // 攻击者在顶层塞 tenant 字段 ⇒ 被剥离、永不参与映射。
    const top = mintValidRs256Token(keyA, NOW, { extra: { tenant: "tnt_99999999" } });
    const topResult = await adapter.verify(bearer(top));
    assert.equal(topResult.ok, true);
    if (topResult.ok) assert.equal(topResult.context.tenant_id, TENANT_ALPHA.tenant_id);

    // 攻击者在 arena 命名空间塞额外字段 ⇒ 严格拒绝。
    const nested = mintValidRs256Token(keyA, NOW, {
      arena: { ...TENANT_ALPHA, tenant_id: "tnt_00000002" },
    });
    // 注意：这是「签名方真实声明了另一个租户」的合法令牌（IdP 授权的租户切换），
    // 映射必须如实反映已验证声明，而非请求意图。
    const nestedResult = await adapter.verify(bearer(nested));
    assert.equal(nestedResult.ok, true);
    if (nestedResult.ok) assert.equal(nestedResult.context.tenant_id, "tnt_00000002");

    // beta 租户令牌 ⇒ beta 上下文（隔离测试的对照向量）。
    const beta = mintValidRs256Token(keyA, NOW, { arena: TENANT_BETA });
    const betaResult = await adapter.verify(bearer(beta));
    assert.equal(betaResult.ok, true);
    if (betaResult.ok) assert.equal(betaResult.context.tenant_id, TENANT_BETA.tenant_id);
  } finally {
    await idp.close();
  }
});

test("missing and malformed Authorization headers are typed failures", async () => {
  const { idp, adapter } = await createBattery();
  try {
    const missing = await adapter.verify(null);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, "IDN_AUTH_MISSING");

    const empty = await adapter.verify("");
    assert.equal(empty.ok, false);

    const notBearer = await adapter.verify("Basic dXNlcjpwYXNz");
    assert.equal(notBearer.ok, false);
    if (!notBearer.ok) assert.equal(notBearer.code, "IDN_AUTH_MALFORMED");

    const garbage = await adapter.verify("Bearer not-a-jws");
    assert.equal(garbage.ok, false);
    if (!garbage.ok) assert.equal(garbage.code, "IDN_TOKEN_MALFORMED");
  } finally {
    await idp.close();
  }
});

test("JWKS outage is fail-closed (no verification without keys)", async () => {
  const { idp, adapter } = await createBattery();
  try {
    const token = mintValidRs256Token(keyA, NOW);
    const okBefore = await adapter.verify(bearer(token));
    assert.equal(okBefore.ok, true);
    idp.breakEndpoint();
    // 已缓存密钥仍在 TTL 内 ⇒ 依然可验证（轮换期可用性）。
    const cached = await adapter.verify(bearer(token));
    assert.equal(cached.ok, true);
    // 未知 kid + 端点故障 ⇒ fail-closed。
    const unknownKid = mintCompactJws({
      key: attackerKey,
      claims: standardClaims(NOW),
      headerOverride: { kid: "kid-unknown" },
    });
    const result = await adapter.verify(bearer(unknownKid));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "IDN_KEY_UNAVAILABLE");
  } finally {
    await idp.close();
  }
});

test("key rotation: tokens signed with the retired key are rejected after refresh", async () => {
  const { idp, adapter } = await createBattery();
  try {
    const keyB = generateRsaKeyMaterial("kid-auth-2");
    const tokenA = mintValidRs256Token(keyA, NOW);
    assert.equal((await adapter.verify(bearer(tokenA))).ok, true);
    idp.setKeys([keyB.jwk]);
    const tokenB = mintValidRs256Token(keyB, NOW);
    const resultB = await adapter.verify(bearer(tokenB));
    assert.equal(resultB.ok, true);
    // kid-auth-1 已从 JWKS 移除 ⇒ fail-closed。
    const resultA = await adapter.verify(bearer(tokenA));
    assert.equal(resultA.ok, false);
    if (!resultA.ok) assert.equal(resultA.code, "IDN_KEY_UNAVAILABLE");
  } finally {
    await idp.close();
  }
});

test("replay: jti_once policy rejects verbatim replay; default policy is disclosed none", async () => {
  const idp = await startFakeJwksServer([keyA.jwk]);
  try {
    const strict = createOidcIdentityAdapter({
      issuer: ISSUER,
      audience: AUDIENCE,
      jwksUri: idp.jwksUri,
      replayPolicy: "jti_once",
    });
    const token = mintValidRs256Token(keyA, NOW, { jti: "jti-replay-1" });
    assert.equal((await strict.verify(bearer(token))).ok, true);
    const replayed = await strict.verify(bearer(token));
    assert.equal(replayed.ok, false);
    if (!replayed.ok) assert.equal(replayed.code, "IDN_REPLAY_DETECTED");

    const token2 = mintValidRs256Token(keyA, NOW, { jti: "jti-replay-2" });
    assert.equal((await strict.verify(bearer(token2))).ok, true);

    // 默认策略：无重放防线（诚实披露，单实例加固为显式选择）。
    const defaultAdapter = createOidcIdentityAdapter({
      issuer: ISSUER,
      audience: AUDIENCE,
      jwksUri: idp.jwksUri,
    });
    assert.equal((await defaultAdapter.verify(bearer(token))).ok, true);
    assert.equal((await defaultAdapter.verify(bearer(token))).ok, true);
  } finally {
    await idp.close();
  }
});

test("probe and readiness reflect JWKS state without credential values", async () => {
  const { idp, adapter } = await createBattery();
  try {
    const probed = await adapter.probe();
    assert.equal(probed.mode, "oidc_jwks_v1");
    assert.equal(probed.ready, true);
    assert.match(probed.detail ?? "", /jwks ok/);

    idp.breakEndpoint();
    const strict = createOidcIdentityAdapter({
      issuer: ISSUER,
      audience: AUDIENCE,
      jwksUri: idp.jwksUri,
    });
    const failing = await strict.probe();
    assert.equal(failing.ready, false);
    assert.match(failing.detail ?? "", /unreachable/);
    assert.equal(strict.readiness().ready, false);
  } finally {
    await idp.close();
  }
});

test("env config: demo default; oidc mode requires the triple (fail-fast, values withheld)", () => {
  assert.deepEqual(loadIdentityConfigFromEnv({}), { mode: "demo" });
  assert.throws(
    () => loadIdentityConfigFromEnv({ ARENA_AUTH_MODE: "oidc" }),
    /ARENA_AUTH_OIDC_ISSUER/,
  );
  assert.throws(
    () =>
      loadIdentityConfigFromEnv({ ARENA_AUTH_MODE: "oidc", ARENA_AUTH_OIDC_ISSUER: "https://x" }),
    /ARENA_AUTH_OIDC_AUDIENCE/,
  );
  assert.throws(() => loadIdentityConfigFromEnv({ ARENA_AUTH_MODE: "bogus" }), /ARENA_AUTH_MODE/);
  assert.throws(
    () =>
      loadIdentityConfigFromEnv({
        ARENA_AUTH_OIDC_CLOCK_SKEW_SECONDS: "-5",
        ARENA_AUTH_MODE: "oidc",
        ARENA_AUTH_OIDC_ISSUER: "https://x",
        ARENA_AUTH_OIDC_AUDIENCE: "a",
        ARENA_AUTH_OIDC_JWKS_URI: "https://x/jwks",
      }),
    /positive integer/,
  );
  const configured = loadIdentityConfigFromEnv({
    ARENA_AUTH_MODE: "oidc",
    ARENA_AUTH_OIDC_ISSUER: "https://idp.example",
    ARENA_AUTH_OIDC_AUDIENCE: "arena-api",
    ARENA_AUTH_OIDC_JWKS_URI: "https://idp.example/jwks.json",
    ARENA_AUTH_OIDC_CLOCK_SKEW_SECONDS: "30",
    ARENA_AUTH_OIDC_REPLAY_POLICY: "jti_once",
  });
  assert.equal(configured.mode, "oidc");
  if (configured.mode === "oidc") {
    assert.equal(configured.clockSkewSeconds, 30);
    assert.equal(configured.replayPolicy, "jti_once");
  }
  const redacted = redactIdentityConfig(configured);
  const serialized = JSON.stringify(redacted);
  assert.ok(serialized.includes("oidc"));
  // 投影不包含任何密钥类字段（RS256+JWKS 公钥流无客户端机密）。
  assert.ok(!/secret|password|private/i.test(serialized));
});

test("symmetric HS256 mode is explicit-only (allowlist + secret required)", async () => {
  assert.throws(
    () =>
      createOidcIdentityAdapter({
        issuer: ISSUER,
        audience: AUDIENCE,
        jwksUri: "unused",
        algorithms: ["HS256"],
      }),
    /hmacSecret/,
  );
  assert.throws(
    () =>
      createOidcIdentityAdapter({
        issuer: ISSUER,
        audience: AUDIENCE,
        jwksUri: "unused",
        algorithms: ["ES256"],
      }),
    /unsupported algorithm/,
  );
  const hmac = createOidcIdentityAdapter({
    issuer: ISSUER,
    audience: AUDIENCE,
    jwksUri: "unused",
    algorithms: ["HS256"],
    hmacSecret: hmacSecretForTest(),
  });
  const good = mintCompactJws({
    key: keyA,
    claims: standardClaims(NOW),
    algorithm: "HS256",
    hmacSecret: hmacSecretForTest(),
  });
  const goodResult = await hmac.verify(bearer(good));
  assert.equal(goodResult.ok, true);
  if (goodResult.ok) assert.equal(goodResult.meta.algorithm, "HS256");

  const wrongSecret = mintCompactJws({
    key: keyA,
    claims: standardClaims(NOW),
    algorithm: "HS256",
    hmacSecret: Buffer.from("wrong-secret"),
  });
  const wrongResult = await hmac.verify(bearer(wrongSecret));
  assert.equal(wrongResult.ok, false);
  if (!wrongResult.ok) assert.equal(wrongResult.code, "IDN_SIGNATURE_INVALID");

  // RS256 令牌在 HS256-only 允许列表下被结构性拒绝。
  const rsToken = mintValidRs256Token(keyA, NOW);
  const rsResult = await hmac.verify(bearer(rsToken));
  assert.equal(rsResult.ok, false);
  if (!rsResult.ok) assert.equal(rsResult.code, "IDN_ALG_REJECTED");
});
