import assert from "node:assert/strict";
import test from "node:test";
import {
  findVisibleProviderVersions,
  listVisibleProviders,
  routeAcquisitionRequest,
  type RouteDecision,
} from "../src/contract.js";
import {
  TENANT_ALPHA,
  TENANT_BETA,
  acquisitionRequest,
  gapReport,
  registry,
  routingState,
} from "./fixtures.js";

/**
 * AR2-016 验收（issue #32）：租户隔离 ——
 * 注册表按租户过滤（跨租户 fail-closed）、路由决策里绝不出现他租户 provider
 * （无枚举收益）、他租户 pinned 与不存在 pinned 同码同文案（无存在性预言机）、
 * 持有他租户 entitlement 无法解锁可见性。
 */

const PRV_ALPHA = "prv_00000050";
const PRV_ALPHA_SECOND = "prv_00000051";
const PRV_BETA = "prv_00000052";

const twoTenantRegistry = registry(
  { provider_id: PRV_ALPHA },
  { provider_id: PRV_ALPHA_SECOND },
  {
    provider_id: PRV_BETA,
    tenant_id: TENANT_BETA,
    required_entitlements: ["beta-scraping"],
  },
);

function routeForAlpha(
  overrides: Parameters<typeof acquisitionRequest>[0] = {},
  stateOverrides: Parameters<typeof routingState>[0] = {},
): RouteDecision {
  return routeAcquisitionRequest({
    request: acquisitionRequest(overrides),
    gap: gapReport(),
    registry: twoTenantRegistry,
    state: routingState(stateOverrides),
    decisionId: "dcs_00000050",
  });
}

test("isolation: the registry view is tenant-scoped before any routing decision", () => {
  assert.deepEqual(
    listVisibleProviders(twoTenantRegistry, TENANT_ALPHA).map((provider) => provider.provider_id),
    [PRV_ALPHA, PRV_ALPHA_SECOND],
  );
  assert.deepEqual(
    listVisibleProviders(twoTenantRegistry, TENANT_BETA).map((provider) => provider.provider_id),
    [PRV_BETA],
  );
  assert.deepEqual(
    findVisibleProviderVersions(twoTenantRegistry, TENANT_ALPHA, PRV_BETA),
    findVisibleProviderVersions(twoTenantRegistry, TENANT_ALPHA, "prv_99999999"),
  );
});

test("isolation: another tenant's provider never appears anywhere in the decision record", () => {
  const decision = routeForAlpha();
  assert.equal(decision.outcome, "ROUTED");
  const serialized = JSON.stringify(decision);
  assert.equal(serialized.includes(PRV_BETA), false, "cross-tenant provider id must not leak");
  assert.equal(
    serialized.includes("beta-scraping"),
    false,
    "cross-tenant entitlement must not leak",
  );
  assert.deepEqual(
    decision.eligible_candidates.map((candidate) => candidate.provider_id),
    [PRV_ALPHA, PRV_ALPHA_SECOND],
  );
  assert.deepEqual(decision.rejected_candidates, []);
});

test("isolation: pinning another tenant's provider is indistinguishable from pinning a ghost", () => {
  const crossTenant = routeForAlpha({
    preferred_route: {
      mode: "PINNED_PROVIDER",
      pinned_provider: { provider_id: PRV_BETA, provider_version: "1.0.0" },
      fallback_permitted: false,
    },
  });
  const ghost = routeForAlpha({
    preferred_route: {
      mode: "PINNED_PROVIDER",
      pinned_provider: { provider_id: "prv_99999999", provider_version: "1.0.0" },
      fallback_permitted: false,
    },
  });

  // Same code, same outcome, same structure — only the CALLER-SUPPLIED id differs.
  assert.equal(crossTenant.outcome, "BLOCKED");
  assert.equal(ghost.outcome, "BLOCKED");
  assert.equal(crossTenant.error_code, "ACQ_PINNED_PROVIDER_UNAVAILABLE");
  assert.equal(ghost.error_code, "ACQ_PINNED_PROVIDER_UNAVAILABLE");
  const normalize = (text: string) =>
    text.replaceAll(PRV_BETA, "X").replaceAll("prv_99999999", "X");
  assert.equal(
    normalize(crossTenant.explanation),
    normalize(ghost.explanation),
    "explanations must be identical modulo the caller-supplied id",
  );
  assert.equal(JSON.stringify(crossTenant).includes(PRV_BETA), true); // caller echo only
  const betaFacts = JSON.stringify(
    twoTenantRegistry.providers.find((p) => p.provider_id === PRV_BETA),
  );
  for (const key of ["beta-scraping", "tnt_00000002"]) {
    assert.equal(JSON.stringify(crossTenant).includes(key), false, `${key} must not leak`);
  }
  assert.ok(betaFacts !== undefined); // fixture sanity: the BETA provider really exists
});

test("isolation: holding another tenant's entitlements does not unlock visibility", () => {
  const decision = routeForAlpha({}, { tenant_entitlements: ["beta-scraping"] });
  assert.equal(decision.outcome, "ROUTED");
  assert.equal(JSON.stringify(decision).includes(PRV_BETA), false);
  assert.deepEqual(
    decision.eligible_candidates.map((candidate) => candidate.provider_id),
    [PRV_ALPHA, PRV_ALPHA_SECOND],
  );
});

test("isolation: a tenant requiring an entitlement the caller lacks is rejected in-tenant", () => {
  const gated = registry(
    { provider_id: PRV_ALPHA },
    { provider_id: PRV_ALPHA_SECOND, required_entitlements: ["alpha-enterprise"] },
  );
  const decision = routeAcquisitionRequest({
    request: acquisitionRequest(),
    gap: gapReport(),
    registry: gated,
    state: routingState({ tenant_entitlements: [] }),
    decisionId: "dcs_00000051",
  });
  assert.equal(decision.outcome, "ROUTED"); // PRV_ALPHA still eligible
  const rejected = decision.rejected_candidates.find((c) => c.provider_id === PRV_ALPHA_SECOND);
  assert.notEqual(rejected, undefined);
  assert.deepEqual(
    rejected?.filters.map((filter) => filter.code),
    ["ACQ_TENANT_NOT_AUTHORIZED"],
  );
});

test("isolation: no cross-tenant fallback even when the pinned provider fails", () => {
  const failingPinnedRegistry = registry(
    { provider_id: PRV_ALPHA, status: "SUSPENDED" },
    { provider_id: PRV_ALPHA_SECOND },
    { provider_id: PRV_BETA, tenant_id: TENANT_BETA },
  );
  const decision = routeAcquisitionRequest({
    request: acquisitionRequest({
      preferred_route: {
        mode: "PINNED_PROVIDER",
        pinned_provider: { provider_id: PRV_ALPHA, provider_version: "1.0.0" },
        fallback_permitted: true,
      },
    }),
    gap: gapReport(),
    registry: failingPinnedRegistry,
    state: routingState(),
    decisionId: "dcs_00000052",
  });
  assert.equal(decision.outcome, "ROUTED");
  assert.equal(decision.fallback_applied, true);
  // The fallback pool is still tenant-scoped: the BETA provider is not even screened.
  assert.equal(JSON.stringify(decision).includes(PRV_BETA), false);
  assert.deepEqual(
    decision.eligible_candidates.map((candidate) => candidate.provider_id),
    [PRV_ALPHA_SECOND],
  );
});
