import assert from "node:assert/strict";
import test from "node:test";
import {
  routeAcquisitionRequest,
  routeDecisionSchema,
  validateRouteDecisionSemantics,
  type CapabilityProviderDescriptor,
  type RouteDecision,
} from "../src/contract.js";
import { acquisitionRequest, descriptor, gapReport, registry, routingState } from "./fixtures.js";

/**
 * AR2-016 验收（issue #32）：ANY_COMPATIBLE_PROVIDER 模式 ——
 * 每条硬性过滤的 typed 拒绝码（租户授权/状态/能力/schema/来源权利/区域/
 * 用途/风险/配额/预算/deadline）、确定性排序键（能力余量→证据→可靠性→
 * 成本→延迟→id）、流行度绝不覆盖证据或策略、审计完整性与三态语义。
 */

const PRV = "prv_00000020";

function route(
  providers: readonly (Partial<CapabilityProviderDescriptor> & { provider_id: string })[],
  overrides: Parameters<typeof acquisitionRequest>[0] = {},
  stateOverrides: Parameters<typeof routingState>[0] = {},
): RouteDecision {
  return routeAcquisitionRequest({
    request: acquisitionRequest({
      preferred_route: {
        mode: "ANY_COMPATIBLE_PROVIDER",
        pinned_provider: null,
        fallback_permitted: false,
      },
      ...overrides,
    }),
    gap: gapReport(),
    registry: registry(...providers),
    state: routingState(stateOverrides),
    decisionId: "dcs_00000020",
  });
}

function assertWellFormed(decision: RouteDecision, expectedOutcome: RouteDecision["outcome"]) {
  assert.equal(decision.outcome, expectedOutcome);
  assert.deepEqual(validateRouteDecisionSemantics(decision), []);
  assert.ok(routeDecisionSchema.safeParse(decision).success, "router emits a schema-valid record");
}

function rejectedCodes(decision: RouteDecision, providerId: string): string[] {
  const candidate = decision.rejected_candidates.find((entry) => entry.provider_id === providerId);
  assert.notEqual(candidate, undefined, `${providerId} must appear in rejected_candidates`);
  return candidate!.filters.map((filter) => filter.code);
}

test("any-compatible: a hard-filter matrix rejects each violation with its typed code", () => {
  const cases: Array<{
    label: string;
    overrides: Partial<CapabilityProviderDescriptor>;
    code: string;
  }> = [
    {
      label: "tenant lacks a required entitlement",
      overrides: { required_entitlements: ["enterprise-scraping"] },
      code: "ACQ_TENANT_NOT_AUTHORIZED",
    },
    {
      label: "provider status is not ACTIVE",
      overrides: { status: "DEPRECATED" },
      code: "ACQ_PROVIDER_STATUS_DISALLOWS",
    },
    {
      label: "capability not offered",
      overrides: {
        supported_capabilities: [
          { capability_id: "cap_00000099", level: "senior", evidence_refs: ["evd_00000001"] },
        ],
      },
      code: "ACQ_CAPABILITY_MISMATCH",
    },
    {
      label: "capability level below the minimum",
      overrides: {
        supported_capabilities: [
          { capability_id: "cap_00000001", level: "junior", evidence_refs: ["evd_00000001"] },
        ],
      },
      code: "ACQ_CAPABILITY_MISMATCH",
    },
    {
      label: "unknown capability level word fails closed",
      overrides: {
        supported_capabilities: [
          { capability_id: "cap_00000001", level: "guru", evidence_refs: ["evd_00000001"] },
        ],
      },
      code: "ACQ_CAPABILITY_MISMATCH",
    },
    {
      label: "different output schema id",
      overrides: { output_schema: { schema_id: "sch_00000099", schema_version: "1.0.0" } },
      code: "ACQ_SCHEMA_MISMATCH",
    },
    {
      label: "older output schema than desired",
      overrides: { output_schema: { schema_id: "sch_00000001", schema_version: "0.9.0" } },
      code: "ACQ_SCHEMA_MISMATCH",
    },
    {
      label: "source rights posture UNKNOWN is not permission",
      overrides: {
        source_rights: { posture: "UNKNOWN", approved_source_patterns: ["docs.blender.org/*"] },
      },
      code: "ACQ_SOURCE_RIGHTS_DENIED",
    },
    {
      label: "source pattern not approved by the provider",
      overrides: {
        source_rights: { posture: "PERMITTED", approved_source_patterns: ["example.com/*"] },
      },
      code: "ACQ_SOURCE_RIGHTS_DENIED",
    },
    {
      label: "required region not covered",
      overrides: { available_regions: ["NG"] },
      code: "ACQ_REGION_NOT_COVERED",
    },
    {
      label: "intended use not allowed",
      overrides: { allowed_use: ["INDEX"] },
      code: "ACQ_USE_NOT_PERMITTED",
    },
    {
      label: "request risk tier exceeds provider appetite",
      overrides: { max_risk_tier: "LOW" },
      code: "ACQ_RISK_TIER_DISALLOWS",
    },
    {
      label: "quota exhausted",
      overrides: { cost: { currency: "USD", per_run_estimate: 10, quota_remaining: 0 } },
      code: "ACQ_QUOTA_EXHAUSTED",
    },
    {
      label: "per-run estimate exceeds the whole budget",
      overrides: { cost: { currency: "USD", per_run_estimate: 501, quota_remaining: 5 } },
      code: "ACQ_BUDGET_EXCEEDED",
    },
    {
      label: "SLA would pass the deadline",
      overrides: { latency: { sla_seconds: 50000000 } },
      code: "ACQ_DEADLINE_EXCEEDED",
    },
  ];

  for (const entry of cases) {
    const decision = route([{ provider_id: PRV, ...entry.overrides }]);
    assert.equal(decision.outcome, "INCONCLUSIVE", entry.label);
    assert.deepEqual(rejectedCodes(decision, PRV), [entry.code], entry.label);
  }
});

test("any-compatible: a committed spend counts against the budget ceiling", () => {
  const decision = route([{ provider_id: PRV }], {}, { spend_so_far: 400 });
  assert.equal(decision.outcome, "INCONCLUSIVE");
  assert.deepEqual(rejectedCodes(decision, PRV), ["ACQ_BUDGET_EXCEEDED"]);
});

test("any-compatible: the deadline is evaluated from the injected now, not a real clock", () => {
  // NOW is 2026-10-11T00:00:00Z; a deadline one hour later with a 2h SLA fails.
  const decision = route([{ provider_id: PRV, latency: { sla_seconds: 7200 } }], {
    deadline: "2026-10-11T01:00:00Z",
  });
  assert.equal(decision.outcome, "INCONCLUSIVE");
  assert.deepEqual(rejectedCodes(decision, PRV), ["ACQ_DEADLINE_EXCEEDED"]);
});

test("any-compatible: one rejection record carries every failed filter (never silently dropped)", () => {
  const decision = route([
    {
      provider_id: PRV,
      status: "SUSPENDED",
      available_regions: ["NG"],
      cost: { currency: "USD", per_run_estimate: 501, quota_remaining: 5 },
    },
  ]);
  assert.equal(decision.outcome, "INCONCLUSIVE");
  assert.deepEqual(rejectedCodes(decision, PRV), [
    "ACQ_PROVIDER_STATUS_DISALLOWS",
    "ACQ_REGION_NOT_COVERED",
    "ACQ_BUDGET_EXCEEDED",
  ]);
});

test("any-compatible: ranking is margin -> evidence -> reliability -> cost -> latency -> id", () => {
  const betterMargin = {
    provider_id: "prv_00000021",
    supported_capabilities: [
      { capability_id: "cap_00000001", level: "principal", evidence_refs: ["evd_00000001"] },
    ],
    reliability: { recent_success_ratio: 0.5, completed_runs: 1 },
    cost: { currency: "USD", per_run_estimate: 500, quota_remaining: 9 },
    latency: { sla_seconds: 5000 },
  };
  const decision = route([
    { provider_id: PRV }, // senior margin 0, better on every later key
    betterMargin,
  ]);
  assertWellFormed(decision, "ROUTED");
  assert.equal(decision.selected?.steps[0]?.provider_id, "prv_00000021");
  assert.equal(decision.eligible_candidates[0]?.rank, 1);
  assert.equal(decision.eligible_candidates[1]?.rank, 2);
});

test("any-compatible: more evidence outranks fewer, popularity cannot override it", () => {
  const decision = route([
    {
      provider_id: PRV,
      supported_capabilities: [
        {
          capability_id: "cap_00000001",
          level: "senior",
          evidence_refs: ["evd_00000001", "evd_00000002", "evd_00000003"],
        },
      ],
      reliability: { recent_success_ratio: 0.9, completed_runs: 10 },
      cost: { currency: "USD", per_run_estimate: 400, quota_remaining: 9 },
    },
    {
      provider_id: "prv_00000022",
      supported_capabilities: [
        { capability_id: "cap_00000001", level: "senior", evidence_refs: ["evd_00000001"] },
      ],
      reliability: { recent_success_ratio: 0.99, completed_runs: 1000000 },
      cost: { currency: "USD", per_run_estimate: 1, quota_remaining: 9 },
      latency: { sla_seconds: 1 },
    },
  ]);
  assertWellFormed(decision, "ROUTED");
  assert.equal(decision.selected?.steps[0]?.provider_id, PRV);
});

test("any-compatible: reliability (ratio then completed runs) breaks evidence ties", () => {
  const decision = route([
    {
      provider_id: PRV,
      reliability: { recent_success_ratio: 0.95, completed_runs: 10 },
    },
    {
      provider_id: "prv_00000023",
      reliability: { recent_success_ratio: 0.99, completed_runs: 2 },
    },
  ]);
  assert.equal(decision.selected?.steps[0]?.provider_id, "prv_00000023");

  const byRuns = route([
    { provider_id: PRV, reliability: { recent_success_ratio: 0.95, completed_runs: 10 } },
    {
      provider_id: "prv_00000023",
      reliability: { recent_success_ratio: 0.95, completed_runs: 900 },
    },
  ]);
  assert.equal(byRuns.selected?.steps[0]?.provider_id, "prv_00000023");
});

test("any-compatible: lower cost then lower latency break earlier ties", () => {
  const byCost = route([
    { provider_id: PRV, cost: { currency: "USD", per_run_estimate: 150, quota_remaining: 9 } },
    {
      provider_id: "prv_00000024",
      cost: { currency: "USD", per_run_estimate: 100, quota_remaining: 9 },
    },
  ]);
  assert.equal(byCost.selected?.steps[0]?.provider_id, "prv_00000024");

  const byLatency = route([
    { provider_id: PRV, latency: { sla_seconds: 900 } },
    { provider_id: "prv_00000024", latency: { sla_seconds: 300 } },
  ]);
  assert.equal(byLatency.selected?.steps[0]?.provider_id, "prv_00000024");
});

test("any-compatible: full ties are broken by (provider_id, provider_version) lexically", () => {
  const decision = route([
    { provider_id: "prv_00000026", provider_version: "1.1.0" },
    { provider_id: "prv_00000025", provider_version: "1.0.0" },
  ]);
  assertWellFormed(decision, "ROUTED");
  assert.equal(decision.selected?.steps[0]?.provider_id, "prv_00000025");
});

test("any-compatible: every screened candidate appears exactly once (audit completeness)", () => {
  const decision = route([
    { provider_id: "prv_00000027" },
    { provider_id: "prv_00000028", status: "SUSPENDED" },
    { provider_id: "prv_00000029", available_regions: ["NG"] },
  ]);
  const ranked = new Set(decision.eligible_candidates.map((candidate) => candidate.provider_id));
  const rejected = new Set(decision.rejected_candidates.map((candidate) => candidate.provider_id));
  for (const id of ["prv_00000027", "prv_00000028", "prv_00000029"]) {
    assert.ok(ranked.has(id) || rejected.has(id), `${id} must be accounted for`);
  }
  assert.equal(ranked.size + rejected.size, 3);
});

test("any-compatible: an empty visible registry is a typed INCONCLUSIVE with no candidates", () => {
  const decision = route([]);
  assertWellFormed(decision, "INCONCLUSIVE");
  assert.equal(decision.error_code, "ACQ_NO_ELIGIBLE_PROVIDER");
  assert.deepEqual(decision.rejected_candidates, []);
  assert.deepEqual(decision.eligible_candidates, []);
});

test("any-compatible: identical inputs produce identical decisions, repeatedly", () => {
  const providers = [
    { provider_id: PRV },
    { provider_id: "prv_00000031", max_risk_tier: "LOW" },
    { provider_id: "prv_00000032", status: "SUSPENDED" },
  ];
  const first = route(providers);
  const second = route(providers);
  const third = route([...providers].reverse());
  assert.deepEqual(first, second);
  // The registry normalizes descriptor order, so the decision never depends on
  // caller-side insertion order either.
  assert.equal(JSON.stringify(first), JSON.stringify(third));
  assert.equal(descriptor({ provider_id: PRV }).kind, "SCRAPER");
});
