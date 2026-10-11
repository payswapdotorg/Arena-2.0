import assert from "node:assert/strict";
import test from "node:test";
import {
  capabilityProviderDescriptorSchema,
  checkCapabilityProviderDescriptor,
  createProviderRegistry,
  findVisibleProviderVersion,
  findVisibleProviderVersions,
  listVisibleProviders,
  providerKindSchema,
  providerStatusSchema,
  sourceRightsPostureSchema,
  type CapabilityProviderDescriptor,
} from "../src/contract.js";
import { TENANT_ALPHA, TENANT_BETA, descriptor, registry } from "./fixtures.js";

/**
 * AR2-016 验收（issue #32）：CapabilityProviderDescriptor 与注册表 ——
 * 正/负向量、未知字段拒绝（含秘密走私）、全部 kind/status/posture 词表、
 * 注册全有或全无、确定性排序与 deep-freeze、租户可见性与不可区分性、
 * 不可变版本记录（新版本 = 新记录）。
 */

const PRV_A = "prv_00000001";
const PRV_B = "prv_00000002";
const PRV_BETA = "prv_00000003";

test("provider registry: valid descriptor parses through the trust-boundary check", () => {
  const check = checkCapabilityProviderDescriptor(descriptor({ provider_id: PRV_A }));
  assert.equal(check.ok, true);
  if (check.ok) assert.equal(check.descriptor.kind, "SCRAPER");
});

test("provider registry: kind, status and posture vocabularies are the contract surface", () => {
  assert.deepEqual(providerKindSchema.options, ["SCRAPER", "EXTERNAL_API", "HUMAN_EXPERT"]);
  assert.deepEqual(providerStatusSchema.options, ["ACTIVE", "SUSPENDED", "DEPRECATED", "RETIRED"]);
  assert.deepEqual(sourceRightsPostureSchema.options, [
    "PERMITTED",
    "RESTRICTED",
    "PROHIBITED",
    "UNKNOWN",
  ]);
});

test("provider registry: unknown fields are rejected (a smuggled secret is a typed error)", () => {
  const smuggled = { ...descriptor({ provider_id: PRV_A }), api_secret: "sk-live-000000000000" };
  const check = checkCapabilityProviderDescriptor(smuggled);
  assert.equal(check.ok, false);
  if (!check.ok) assert.equal(check.code, "ACQ_UNKNOWN_FIELD");

  const nested = {
    ...descriptor({ provider_id: PRV_A }),
    cost: { ...descriptor({ provider_id: PRV_A }).cost, token: "abc" },
  };
  const nestedCheck = checkCapabilityProviderDescriptor(nested);
  assert.equal(nestedCheck.ok, false);
  if (!nestedCheck.ok) assert.equal(nestedCheck.code, "ACQ_UNKNOWN_FIELD");
});

test("provider registry: strict shape negatives use the generic typed code", () => {
  const negatives: Array<[string, Partial<CapabilityProviderDescriptor>]> = [
    ["no capability offers", { supported_capabilities: [] }],
    ["lowercase region", { available_regions: ["gh"] }],
    ["negative quota", { cost: { currency: "USD", per_run_estimate: 10, quota_remaining: -1 } }],
    [
      "zero per-run estimate",
      { cost: { currency: "USD", per_run_estimate: 0, quota_remaining: 5 } },
    ],
    ["success ratio above 1", { reliability: { recent_success_ratio: 1.5, completed_runs: 10 } }],
    ["empty allowed use", { allowed_use: [] }],
    ["bad semver", { provider_version: "1.0" }],
  ];
  for (const [label, overrides] of negatives) {
    const check = checkCapabilityProviderDescriptor(
      descriptor({ provider_id: PRV_A, ...overrides }),
    );
    assert.equal(check.ok, false, label);
    if (!check.ok) assert.equal(check.code, "ACQ_VALIDATION_FAILED", label);
  }
});

test("provider registry: registration is all-or-nothing (no partial registry)", () => {
  const valid = descriptor({ provider_id: PRV_A });
  const invalid = { ...descriptor({ provider_id: PRV_B }), provider_version: "not-semver" };
  const check = createProviderRegistry([valid, invalid]);
  assert.equal(check.ok, false);
  if (!check.ok) assert.equal(check.code, "ACQ_VALIDATION_FAILED");
});

test("provider registry: entries are deterministically sorted by (provider_id, provider_version)", () => {
  // The registry view is a lexicographic (provider_id, provider_version) index —
  // byte-stable for the same inputs. Pinned-latest resolution is separately
  // semver-aware (router tests); both orders are deterministic.
  const built = registry(
    { provider_id: PRV_B, provider_version: "2.0.0" },
    { provider_id: PRV_A, provider_version: "1.2.0" },
    { provider_id: PRV_A, provider_version: "1.10.0" },
    { provider_id: PRV_A, provider_version: "1.9.0" },
  );
  assert.deepEqual(
    built.providers.map((provider) => `${provider.provider_id}@${provider.provider_version}`),
    ["prv_00000001@1.10.0", "prv_00000001@1.2.0", "prv_00000001@1.9.0", "prv_00000002@2.0.0"],
  );
  const again = registry(
    { provider_id: PRV_A, provider_version: "1.9.0" },
    { provider_id: PRV_A, provider_version: "1.10.0" },
    { provider_id: PRV_A, provider_version: "1.2.0" },
    { provider_id: PRV_B, provider_version: "2.0.0" },
  );
  assert.deepEqual(built.providers, again.providers);
});

test("provider registry: the snapshot is deep-frozen (immutability fails closed)", () => {
  const built = registry({ provider_id: PRV_A });
  assert.equal(Object.isFrozen(built.providers), true);
  assert.equal(Object.isFrozen(built.providers[0]), true);
  assert.equal(Object.isFrozen(built.providers[0]!.cost), true);
  assert.throws(() => {
    (built.providers as unknown as { push(item: unknown): unknown }[]).push({});
  }, TypeError);
  assert.throws(() => {
    (built.providers[0] as unknown as { status: string }).status = "RETIRED";
  }, TypeError);
});

test("provider registry: a new provider version is a new record, never an in-place rewrite", () => {
  const v1 = descriptor({ provider_id: PRV_A, provider_version: "1.0.0" });
  const v2 = descriptor({ provider_id: PRV_A, provider_version: "2.0.0", status: "SUSPENDED" });
  const built = registry(v1, v2);
  const versions = built.providers.filter((provider) => provider.provider_id === PRV_A);
  assert.equal(versions.length, 2);
  assert.equal(versions[0]!.status, "ACTIVE");
  assert.equal(versions[1]!.status, "SUSPENDED");
});

test("provider registry: tenant visibility filters fail closed", () => {
  const built = registry({ provider_id: PRV_A }, { provider_id: PRV_BETA, tenant_id: TENANT_BETA });
  assert.deepEqual(
    listVisibleProviders(built, TENANT_ALPHA).map((provider) => provider.provider_id),
    [PRV_A],
  );
  assert.deepEqual(
    listVisibleProviders(built, TENANT_BETA).map((provider) => provider.provider_id),
    [PRV_BETA],
  );
  assert.deepEqual(listVisibleProviders(built, "tnt_99999999"), []);
});

test("provider registry: invisible is indistinguishable from nonexistent (no existence oracle)", () => {
  const built = registry({ provider_id: PRV_BETA, tenant_id: TENANT_BETA });
  const crossTenant = findVisibleProviderVersions(built, TENANT_ALPHA, PRV_BETA);
  const nonexistent = findVisibleProviderVersions(built, TENANT_ALPHA, "prv_99999999");
  assert.deepEqual(crossTenant, nonexistent);
  assert.deepEqual(crossTenant, []);
  assert.equal(
    findVisibleProviderVersion(built, TENANT_ALPHA, PRV_BETA, "1.0.0"),
    findVisibleProviderVersion(built, TENANT_ALPHA, "prv_99999999", "1.0.0"),
  );
});

test("provider registry: exact-version lookup within tenant scope", () => {
  const built = registry(
    { provider_id: PRV_A, provider_version: "1.0.0" },
    { provider_id: PRV_A, provider_version: "2.0.0" },
  );
  const found = findVisibleProviderVersion(built, TENANT_ALPHA, PRV_A, "2.0.0");
  assert.notEqual(found, null);
  if (found !== null) assert.equal(found.provider_version, "2.0.0");
  assert.equal(findVisibleProviderVersion(built, TENANT_ALPHA, PRV_A, "3.0.0"), null);
});

test("provider registry: descriptor schema parses the fixture (schema-level positive control)", () => {
  assert.ok(
    capabilityProviderDescriptorSchema.safeParse(descriptor({ provider_id: PRV_A })).success,
  );
});
