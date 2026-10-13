import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTHN_FAILURE_CATALOG,
  AUTHN_FAILURE_CODES,
  IDENTITY_CONTRACT_VERSION,
  arenaTenantClaimSchema,
  idnClaimsSchema,
  tenantContextFromClaim,
  AUTHN_EDGE_MAPPING_RULE,
} from "../src/contract.js";
import { TENANT_ALPHA, TENANT_BETA, standardClaims } from "./helpers.js";

/**
 * IDN1.0 契约正向/负向向量（AR2-022 验收：
 * Adapter contract with positive/negative vectors）。
 */

const NOW = 1_800_000_000;

test("IDN1.0 version constant is explicit and frozen-shaped", () => {
  assert.equal(IDENTITY_CONTRACT_VERSION, "IDN1.0");
});

test("arena tenant claim accepts the canonical shape (positive vector)", () => {
  const parsed = arenaTenantClaimSchema.safeParse(TENANT_ALPHA);
  assert.equal(parsed.success, true);
});

test("arena tenant claim rejects unknown fields (tenant confusion resistance)", () => {
  const parsed = arenaTenantClaimSchema.safeParse({ ...TENANT_ALPHA, tenant: "tnt_00000009" });
  assert.equal(parsed.success, false);
});

test("arena tenant claim rejects derived_from smuggle (server-owned field)", () => {
  const parsed = arenaTenantClaimSchema.safeParse({
    ...TENANT_ALPHA,
    derived_from: "authenticated_credentials",
  });
  assert.equal(parsed.success, false);
});

test("arena tenant claim rejects malformed ids, empty role, oversized scopes", () => {
  assert.equal(arenaTenantClaimSchema.safeParse({ ...TENANT_ALPHA, tenant_id: "" }).success, false);
  // 冻结模式：^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$ —— 过短/非法字符拒绝。
  assert.equal(
    arenaTenantClaimSchema.safeParse({ ...TENANT_ALPHA, tenant_id: "short" }).success,
    false,
  );
  assert.equal(
    arenaTenantClaimSchema.safeParse({ ...TENANT_ALPHA, tenant_id: "_leading_underscore" }).success,
    false,
  );
  assert.equal(
    arenaTenantClaimSchema.safeParse({ ...TENANT_ALPHA, tenant_id: "has space in it" }).success,
    false,
  );
  assert.equal(arenaTenantClaimSchema.safeParse({ ...TENANT_ALPHA, role: "" }).success, false);
  assert.equal(
    arenaTenantClaimSchema.safeParse({
      ...TENANT_ALPHA,
      authorization_scope_ids: Array.from(
        { length: 65 },
        (_, i) => `scp_${String(i).padStart(8, "0")}`,
      ),
    }).success,
    false,
  );
});

test("claims contract: standard OIDC top-level extras are tolerated and never mapped", () => {
  const claims = standardClaims(NOW, {
    extra: { scope: "arena:escalation", email: "u@example.test", azp: "app_00000001" },
  });
  const parsed = idnClaimsSchema.safeParse(claims);
  assert.equal(parsed.success, true);
});

test("claims contract: missing arena_tenant_context is invalid", () => {
  const claims = standardClaims(NOW, { arena: null });
  delete (claims as Record<string, unknown>)["arena_tenant_context"];
  assert.equal(idnClaimsSchema.safeParse(claims).success, false);
});

test("claims contract: missing exp / iss / aud / sub are invalid", () => {
  for (const field of ["exp", "iss", "aud", "sub", "iat"]) {
    const claims: Record<string, unknown> = { ...standardClaims(NOW) };
    delete claims[field];
    assert.equal(idnClaimsSchema.safeParse(claims).success, false, `field ${field}`);
  }
});

test("tenantContextFromClaim derives server-owned derived_from and passes frozen schema", () => {
  const result = tenantContextFromClaim(TENANT_ALPHA);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.context.derived_from, "authenticated_credentials");
    assert.equal(result.context.tenant_id, "tnt_00000001");
    assert.equal(result.context.principal_id, "usr_00000001");
    assert.equal(result.context.role, "requester");
  }
});

test("tenantContextFromClaim keeps tenants distinct (alpha vs beta mapping)", () => {
  const alpha = tenantContextFromClaim(TENANT_ALPHA);
  const beta = tenantContextFromClaim(TENANT_BETA);
  assert.equal(alpha.ok, true);
  assert.equal(beta.ok, true);
  if (alpha.ok && beta.ok) {
    assert.notEqual(alpha.context.tenant_id, beta.context.tenant_id);
  }
});

test("failure catalog: closed enum, every code has a spec and class", () => {
  assert.equal(AUTHN_FAILURE_CODES.length, 12);
  for (const code of AUTHN_FAILURE_CODES) {
    const spec = AUTHN_FAILURE_CATALOG[code];
    assert.ok(spec !== undefined, `catalog entry for ${code}`);
    assert.equal(spec.code, code);
    assert.ok(spec.semantics.length > 0);
    assert.ok(
      [
        "credential_absent",
        "credential_malformed",
        "cryptographic",
        "validity_window",
        "claims_mapping",
        "replay",
      ].includes(spec.class),
    );
  }
  assert.equal(Object.keys(AUTHN_FAILURE_CATALOG).length, AUTHN_FAILURE_CODES.length);
});

test("edge mapping rule is recorded (uniform 401, no oracle)", () => {
  assert.match(AUTHN_EDGE_MAPPING_RULE, /uniform 401/);
  assert.match(AUTHN_EDGE_MAPPING_RULE, /never for caller-visible/);
});
