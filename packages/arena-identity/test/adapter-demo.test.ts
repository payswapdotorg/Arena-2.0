import assert from "node:assert/strict";
import test from "node:test";
import {
  DEMO_IDENTITY_DISCLOSURE,
  createDemoIdentityAdapter,
  isDemoAdapter,
  createOidcIdentityAdapter,
} from "../src/contract.js";
import { ISSUER, AUDIENCE } from "./helpers.js";

/**
 * DEMO 适配器向量（AR2-022 验收：demo adapter marked demo-only
 * in code and docs）+ 与 AR2-002 原注册表的行为一致性。
 */

test("demo disclosure marks DEMO-ONLY explicitly (code marker)", () => {
  assert.match(DEMO_IDENTITY_DISCLOSURE, /DEMO auth adapter/);
  assert.match(DEMO_IDENTITY_DISCLOSURE, /never production identity/);
});

test("demo adapter identity and mode are demo", () => {
  const adapter = createDemoIdentityAdapter();
  assert.equal(adapter.id, "demo_registry_v0");
  assert.equal(adapter.mode, "demo");
  assert.equal(isDemoAdapter(adapter), true);
});

test("demo registry parity with the AR2-002 surface (all three tokens)", async () => {
  const adapter = createDemoIdentityAdapter();
  const cases: Array<[string, string, string]> = [
    ["demo-token-requester-alpha", "tnt_00000001", "requester"],
    ["demo-token-requester-beta", "tnt_00000002", "requester"],
    ["demo-token-expert-omega", "tnt_00000001", "expert"],
  ];
  for (const [token, tenantId, role] of cases) {
    const result = await adapter.verify(`Bearer ${token}`);
    assert.equal(result.ok, true, token);
    if (result.ok) {
      assert.equal(result.context.tenant_id, tenantId);
      assert.equal(result.context.role, role);
      assert.equal(result.context.derived_from, "authenticated_credentials");
    }
  }
});

test("demo adapter rejects unknown/absent/malformed credentials (401 parity)", async () => {
  const adapter = createDemoIdentityAdapter();
  const unknown = await adapter.verify("Bearer demo-token-attacker-forged");
  assert.equal(unknown.ok, false);
  const absent = await adapter.verify(null);
  assert.equal(absent.ok, false);
  if (!absent.ok) assert.equal(absent.code, "IDN_AUTH_MISSING");
  const malformed = await adapter.verify("Basic something");
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.code, "IDN_AUTH_MALFORMED");
});

test("production reference adapter is not demo (mode separation)", () => {
  const oidc = createOidcIdentityAdapter({
    issuer: ISSUER,
    audience: AUDIENCE,
    jwksUri: "https://idp.example/jwks.json",
  });
  assert.equal(oidc.mode, "oidc");
  assert.equal(isDemoAdapter(oidc), false);
  assert.equal(oidc.id, "oidc_jwks_v1");
});
