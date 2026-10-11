import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ROUTING_POLICY,
  ROUTE_POLICY_VERSION,
  routeAcquisitionRequest,
  routeDecisionSchema,
  validateRouteDecisionSemantics,
  type RouteDecision,
} from "../src/contract.js";
import { acquisitionRequest, descriptor, gapReport, registry, routingState } from "./fixtures.js";

/**
 * AR2-016 验收（issue #32）：PINNED_PROVIDER 模式 ——
 * 精确版本路由、family 最新解析（semver）、不可用 => typed BLOCKED、
 * 失败无回退许可 => 绝不静默替换（ACQ_FALLBACK_NOT_PERMITTED 语义锚定）、
 * 显式许可的回退走同一套硬性过滤且不超原预算、聚合硬边界（attempt/deadline）。
 */

const PRV_PIN = "prv_00000010";
const PRV_ALT = "prv_00000011";

const FILTER_PIPELINE_ORDER = [
  "TENANT_AUTHORIZATION",
  "PROVIDER_STATUS",
  "CAPABILITY_FIT",
  "OUTPUT_SCHEMA",
  "SOURCE_RIGHTS",
  "REGION_COVERAGE",
  "USE_PERMISSION",
  "RISK_TIER",
  "QUOTA",
  "BUDGET_CEILING",
  "DEADLINE",
];

function pinnedRequest(overrides: Parameters<typeof acquisitionRequest>[0] = {}) {
  return acquisitionRequest({
    preferred_route: {
      mode: "PINNED_PROVIDER",
      pinned_provider: { provider_id: PRV_PIN, provider_version: "1.0.0" },
      fallback_permitted: false,
    },
    ...overrides,
  });
}

function assertWellFormed(decision: RouteDecision, expectedOutcome: RouteDecision["outcome"]) {
  assert.equal(decision.outcome, expectedOutcome);
  assert.equal(decision.policy_version, ROUTE_POLICY_VERSION);
  assert.deepEqual(decision.applied_filters, FILTER_PIPELINE_ORDER);
  assert.equal(decision.model_assist.used, false);
  assert.equal(decision.model_assist.model_id, null);
  assert.deepEqual(validateRouteDecisionSemantics(decision), []);
  assert.ok(routeDecisionSchema.safeParse(decision).success, "router emits a schema-valid record");
}

test("router pinned: exact version routes to the pinned provider", () => {
  const decision = routeAcquisitionRequest({
    request: pinnedRequest(),
    gap: gapReport(),
    registry: registry({ provider_id: PRV_PIN, provider_version: "1.0.0" }),
    state: routingState(),
    decisionId: "dcs_00000001",
    policy: DEFAULT_ROUTING_POLICY,
  });
  assertWellFormed(decision, "ROUTED");
  assert.equal(decision.selected?.plan_kind, "SINGLE_PROVIDER");
  assert.equal(decision.selected?.steps[0]?.provider_id, PRV_PIN);
  assert.equal(decision.selected?.steps[0]?.provider_version, "1.0.0");
  assert.equal(decision.selected?.steps[0]?.role, "ACQUIRE");
  assert.equal(decision.fallback_applied, false);
  assert.deepEqual(decision.rejected_candidates, []);
});

test("router pinned: a family reference resolves the latest version by semver, not lexically", () => {
  const decision = routeAcquisitionRequest({
    request: pinnedRequest({
      preferred_route: {
        mode: "PINNED_PROVIDER",
        pinned_provider: { provider_id: PRV_PIN, provider_version: null },
        fallback_permitted: false,
      },
    }),
    gap: gapReport(),
    registry: registry(
      { provider_id: PRV_PIN, provider_version: "1.9.0" },
      { provider_id: PRV_PIN, provider_version: "1.10.0" },
      { provider_id: PRV_PIN, provider_version: "2.0.0" },
    ),
    state: routingState(),
    decisionId: "dcs_00000002",
  });
  assertWellFormed(decision, "ROUTED");
  assert.equal(decision.selected?.steps[0]?.provider_version, "2.0.0");
});

test("router pinned: unavailable provider is a typed BLOCKED, not a silent alternative", () => {
  for (const pinned of [
    { provider_id: "prv_99999999", provider_version: "1.0.0" }, // nonexistent
    { provider_id: PRV_PIN, provider_version: "9.9.9" }, // version not registered
    { provider_id: PRV_PIN, provider_version: null }, // family not registered
  ]) {
    const decision = routeAcquisitionRequest({
      request: pinnedRequest({
        preferred_route: {
          mode: "PINNED_PROVIDER",
          pinned_provider: pinned,
          fallback_permitted: false,
        },
      }),
      gap: gapReport(),
      registry: registry({ provider_id: PRV_ALT }), // a compatible alternative exists
      state: routingState(),
      decisionId: "dcs_00000003",
    });
    assertWellFormed(decision, "BLOCKED");
    assert.equal(decision.error_code, "ACQ_PINNED_PROVIDER_UNAVAILABLE");
    assert.equal(decision.selected, null);
    assert.equal(decision.fallback_applied, false);
    assert.deepEqual(decision.rejected_candidates, []);
  }
});

test("router pinned: a failing pinned provider without fallback permission never substitutes silently", () => {
  const decision = routeAcquisitionRequest({
    request: pinnedRequest(),
    gap: gapReport(),
    registry: registry(
      {
        provider_id: PRV_PIN,
        cost: { currency: "USD", per_run_estimate: 120, quota_remaining: 0 },
      },
      { provider_id: PRV_ALT }, // eligible alternative is present
    ),
    state: routingState(),
    decisionId: "dcs_00000004",
  });
  assertWellFormed(decision, "BLOCKED");
  assert.equal(decision.error_code, "ACQ_QUOTA_EXHAUSTED");
  assert.ok(decision.explanation.includes("fallback not permitted"));
  assert.deepEqual(
    decision.rejected_candidates.map((candidate) => candidate.provider_id),
    [PRV_PIN],
  );
  assert.ok(
    decision.rejected_candidates[0]!.filters.some(
      (filter) => filter.code === "ACQ_QUOTA_EXHAUSTED",
    ),
  );
  // The eligible alternative was never selected or even screened (fallback forbidden).
  assert.deepEqual(decision.eligible_candidates, []);
  assert.equal(decision.selected, null);
});

test("router pinned: explicit fallback permission routes the best alternative and records it", () => {
  const decision = routeAcquisitionRequest({
    request: pinnedRequest({
      preferred_route: {
        mode: "PINNED_PROVIDER",
        pinned_provider: { provider_id: PRV_PIN, provider_version: "1.0.0" },
        fallback_permitted: true,
      },
    }),
    gap: gapReport(),
    registry: registry(
      { provider_id: PRV_PIN, provider_version: "1.0.0", status: "SUSPENDED" },
      { provider_id: PRV_ALT },
    ),
    state: routingState(),
    decisionId: "dcs_00000005",
  });
  assertWellFormed(decision, "ROUTED");
  assert.equal(decision.selected?.steps[0]?.provider_id, PRV_ALT);
  assert.equal(decision.fallback_applied, true);
  assert.ok(decision.explanation.includes("explicit fallback"));
  assert.deepEqual(
    decision.rejected_candidates.map((candidate) => candidate.provider_id),
    [PRV_PIN],
  );
  assert.ok(
    decision.rejected_candidates[0]!.filters.some(
      (filter) => filter.code === "ACQ_PROVIDER_STATUS_DISALLOWS",
    ),
  );
});

test("router pinned: an explicitly permitted fallback still respects the original budget ceiling", () => {
  // spend_so_far=400, budget=500: both the pinned provider and the alternative
  // (120 each) would exceed 500 — the fallback must fail closed inside the
  // ORIGINAL aggregate budget, and the unanimous reason is the typed budget code.
  const decision = routeAcquisitionRequest({
    request: pinnedRequest({
      preferred_route: {
        mode: "PINNED_PROVIDER",
        pinned_provider: { provider_id: PRV_PIN, provider_version: "1.0.0" },
        fallback_permitted: true,
      },
    }),
    gap: gapReport(),
    registry: registry({ provider_id: PRV_PIN }, { provider_id: PRV_ALT }),
    state: routingState({ spend_so_far: 400 }),
    decisionId: "dcs_00000006",
  });
  assertWellFormed(decision, "INCONCLUSIVE");
  assert.equal(decision.error_code, "ACQ_BUDGET_EXCEEDED");
  assert.equal(decision.selected, null);
  assert.ok(decision.explanation.includes("no eligible provider"));
  assert.deepEqual(decision.rejected_candidates.map((candidate) => candidate.provider_id).sort(), [
    PRV_PIN,
    PRV_ALT,
  ]);
  for (const candidate of decision.rejected_candidates) {
    assert.deepEqual(
      candidate.filters.map((filter) => filter.code),
      ["ACQ_BUDGET_EXCEEDED"],
    );
  }
});

test("router pinned: the aggregate attempt limit blocks before any screening", () => {
  const decision = routeAcquisitionRequest({
    request: pinnedRequest({ attempt_limit: 3 }),
    gap: gapReport(),
    registry: registry({ provider_id: PRV_PIN }),
    state: routingState({ attempts_used: 3 }),
    decisionId: "dcs_00000007",
  });
  assertWellFormed(decision, "BLOCKED");
  assert.equal(decision.error_code, "ACQ_ATTEMPT_LIMIT_EXCEEDED");
});

test("router pinned: a now already past the request deadline blocks the route", () => {
  const decision = routeAcquisitionRequest({
    request: pinnedRequest({ deadline: "2026-10-10T00:00:00Z" }), // before NOW
    gap: gapReport(),
    registry: registry({ provider_id: PRV_PIN }),
    state: routingState(),
    decisionId: "dcs_00000008",
  });
  assertWellFormed(decision, "BLOCKED");
  assert.equal(decision.error_code, "ACQ_DEADLINE_EXCEEDED");
});

test("router pinned: identical inputs produce byte-identical decisions (no clock/randomness)", () => {
  const input = {
    request: pinnedRequest({
      preferred_route: {
        mode: "PINNED_PROVIDER",
        pinned_provider: { provider_id: PRV_PIN, provider_version: "1.0.0" },
        fallback_permitted: true,
      },
    }),
    gap: gapReport(),
    registry: registry({ provider_id: PRV_PIN, status: "SUSPENDED" }, { provider_id: PRV_ALT }),
    state: routingState(),
    decisionId: "dcs_00000009",
  } as const;
  const first = routeAcquisitionRequest(input);
  const second = routeAcquisitionRequest(input);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("router pinned: descriptor defaults satisfy the fixture demand (positive control)", () => {
  // Guards the fixture itself: the default descriptor must be eligible for the
  // default request/gap so negative tests below are meaningful.
  const decision = routeAcquisitionRequest({
    request: acquisitionRequest(),
    gap: gapReport(),
    registry: registry({ provider_id: PRV_ALT }),
    state: routingState(),
    decisionId: "dcs_00000010",
  });
  assert.equal(decision.outcome, "ROUTED");
  assert.notEqual(descriptor({ provider_id: PRV_ALT }).status, undefined);
});
