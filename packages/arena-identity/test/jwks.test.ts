import assert from "node:assert/strict";
import test from "node:test";
import { JwksUnavailableError, createJwksClient } from "../src/contract.js";
import { generateRsaKeyMaterial, startFakeJwksServer } from "./helpers.js";

/**
 * JWKS 客户端向量（AR2-022）：拉取/缓存/轮换/未知 kid/fail-closed。
 * 全部对着真实本地 HTTP 端点（假 IdP）。
 */

const keyA = generateRsaKeyMaterial("kid-a");
const keyB = generateRsaKeyMaterial("kid-b");

test("fetches and caches the key set (single request for repeated kid)", async () => {
  const idp = await startFakeJwksServer([keyA.jwk]);
  try {
    const client = createJwksClient({ uri: idp.jwksUri, cacheTtlMs: 60_000 });
    const jwk = await client.getSigningKey("kid-a");
    assert.equal(jwk.kid, "kid-a");
    await client.getSigningKey("kid-a");
    assert.equal(idp.requestCount(), 1);
    const state = client.state();
    assert.equal(state.lastFetchOk, true);
    assert.equal(state.keyCount, 1);
  } finally {
    await idp.close();
  }
});

test("unknown kid triggers exactly one refresh, then fail-closed", async () => {
  const idp = await startFakeJwksServer([keyA.jwk]);
  try {
    const client = createJwksClient({ uri: idp.jwksUri, cacheTtlMs: 60_000 });
    await client.getSigningKey("kid-a");
    const before = idp.requestCount();
    await assert.rejects(() => client.getSigningKey("kid-unknown"), JwksUnavailableError);
    assert.equal(idp.requestCount(), before + 1);
    assert.equal(client.state().lastErrorKind, null);
  } finally {
    await idp.close();
  }
});

test("rotation: new kid is served after refresh; removed old kid fails closed", async () => {
  const idp = await startFakeJwksServer([keyA.jwk]);
  try {
    const client = createJwksClient({ uri: idp.jwksUri, cacheTtlMs: 60_000 });
    await client.getSigningKey("kid-a");
    // 密钥轮换：IdP 换上新密钥。
    idp.setKeys([keyB.jwk]);
    const jwk = await client.getSigningKey("kid-b");
    assert.equal(jwk.kid, "kid-b");
    // 旧密钥已从 JWKS 移除 ⇒ 旧 kid 的令牌 fail-closed。
    await assert.rejects(() => client.getSigningKey("kid-a"), JwksUnavailableError);
  } finally {
    await idp.close();
  }
});

test("network failure is fail-closed (no stale fallback for unseen keys)", async () => {
  const idp = await startFakeJwksServer([keyA.jwk]);
  const client = createJwksClient({ uri: idp.jwksUri, cacheTtlMs: 60_000 });
  await idp.close();
  await assert.rejects(() => client.getSigningKey("kid-a"), JwksUnavailableError);
  assert.equal(client.state().lastFetchOk, false);
});

test("endpoint outage after a successful fetch: unknown kid stays fail-closed", async () => {
  const idp = await startFakeJwksServer([keyA.jwk]);
  try {
    const client = createJwksClient({ uri: idp.jwksUri, cacheTtlMs: 60_000 });
    await client.getSigningKey("kid-a");
    idp.breakEndpoint();
    // 已缓存且 TTL 内的 kid 仍可用（轮换期可用性）。
    const cached = await client.getSigningKey("kid-a");
    assert.equal(cached.kid, "kid-a");
    // 但新 kid 的刷新失败 ⇒ fail-closed。
    await assert.rejects(() => client.getSigningKey("kid-b"), JwksUnavailableError);
    assert.equal(client.state().lastFetchOk, false);
  } finally {
    await idp.close();
  }
});

test("malformed JWKS bodies are fail-closed", async () => {
  const idp = await startFakeJwksServer([keyA.jwk]);
  try {
    const brokenJson = createJwksClient({
      uri: `${idp.base}/jwks.json`,
      fetchImpl: (async () => new Response("{not-json", { status: 200 })) as typeof fetch,
    });
    await assert.rejects(() => brokenJson.getSigningKey("kid-a"), JwksUnavailableError);

    const missingKeys = createJwksClient({
      uri: `${idp.base}/jwks.json`,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ foo: 1 }), { status: 200 })) as typeof fetch,
    });
    await assert.rejects(() => missingKeys.getSigningKey("kid-a"), JwksUnavailableError);

    const nonObject = createJwksClient({
      uri: `${idp.base}/jwks.json`,
      fetchImpl: (async () =>
        new Response(JSON.stringify([keyA.jwk]), { status: 200 })) as typeof fetch,
    });
    await assert.rejects(() => nonObject.getSigningKey("kid-a"), JwksUnavailableError);

    const noSigningKeys = createJwksClient({
      uri: `${idp.base}/jwks.json`,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ keys: [{ kty: "EC", crv: "P-256", x: "a", y: "b" }] }), {
          status: 200,
        })) as typeof fetch,
    });
    await assert.rejects(() => noSigningKeys.getSigningKey("kid-a"), JwksUnavailableError);

    const duplicateKid = createJwksClient({
      uri: `${idp.base}/jwks.json`,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ keys: [keyA.jwk, { ...keyA.jwk }] }), {
          status: 200,
        })) as typeof fetch,
    });
    await assert.rejects(() => duplicateKid.getSigningKey("kid-a"), JwksUnavailableError);
  } finally {
    await idp.close();
  }
});

test("non-200 JWKS responses are fail-closed with typed status", async () => {
  const idp = await startFakeJwksServer([keyA.jwk]);
  try {
    const client = createJwksClient({
      uri: `${idp.base}/not-jwks`,
      fetchImpl: undefined,
    });
    await assert.rejects(() => client.getSigningKey("kid-a"), JwksUnavailableError);
    assert.equal(client.state().lastErrorKind, "http_404");
  } finally {
    await idp.close();
  }
});

test("TTL expiry triggers a refetch", async () => {
  const idp = await startFakeJwksServer([keyA.jwk]);
  try {
    const client = createJwksClient({ uri: idp.jwksUri, cacheTtlMs: 20 });
    await client.getSigningKey("kid-a");
    assert.equal(idp.requestCount(), 1);
    await new Promise((resolve) => setTimeout(resolve, 40));
    await client.getSigningKey("kid-a");
    assert.equal(idp.requestCount(), 2);
  } finally {
    await idp.close();
  }
});

test("token without kid: single-key JWKS resolves implicitly, multi-key fails closed", async () => {
  const idp = await startFakeJwksServer([keyA.jwk]);
  try {
    const client = createJwksClient({ uri: idp.jwksUri, cacheTtlMs: 60_000 });
    const jwk = await client.getSigningKey(undefined);
    assert.equal(jwk.kid, "kid-a");
    idp.setKeys([keyA.jwk, keyB.jwk]);
    await client.refresh();
    await assert.rejects(() => client.getSigningKey(undefined), JwksUnavailableError);
  } finally {
    await idp.close();
  }
});
