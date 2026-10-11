import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ROUTING_POLICY,
  routeAcquisitionRequest,
  routeDecisionSchema,
  validateRouteDecisionSemantics,
  type RouteDecision,
  type RoutingPolicy,
} from "../src/contract.js";
import { acquisitionRequest, gapReport, registry, routingState } from "./fixtures.js";

/**
 * AR2-016 验收（issue #32）：AUTO 模式 ——
 * 默认策略绝不组合（显式许可才可能）、组合计划 = scraper ACQUIRE +
 * human expert VALIDATE（精确版本、成本/延迟求和）、组合仍受原预算与
 * deadline 约束（超限则退回单一最优，绝不超支）、无 KNOWLEDGE_PACK
 * 交付用途永不组合、缺任一种类退回单一最优。
 */

const PRV_SCRAPER = "prv_00000040";
const PRV_HUMAN = "prv_00000041";
const PRV_API = "prv_00000042";

const COMPOSITE_POLICY: RoutingPolicy = {
  policy_version: DEFAULT_ROUTING_POLICY.policy_version,
  allowCompositePlans: true,
};

function autoRequest(overrides: Parameters<typeof acquisitionRequest>[0] = {}) {
  return acquisitionRequest({
    preferred_route: { mode: "AUTO", pinned_provider: null, fallback_permitted: false },
    ...overrides,
  });
}

/** KNOWLEDGE_PACK 交付用途（组合计划的前提之一）。 */
function knowledgePackRequest(overrides: Parameters<typeof acquisitionRequest>[0] = {}) {
  return autoRequest({
    data_use_policy: {
      use_kinds: ["KNOWLEDGE_PACK"],
      retention_profile: "STANDARD",
      privacy_profile: "TENANT",
      redaction_class: "tenant",
      fine_tuning_approval: null,
    },
    ...overrides,
  });
}

function route(
  providers: Parameters<typeof registry>[0],
  policy: RoutingPolicy,
  request: ReturnType<typeof acquisitionRequest> = knowledgePackRequest(),
  stateOverrides: Parameters<typeof routingState>[0] = {},
): RouteDecision {
  return routeAcquisitionRequest({
    request,
    gap: gapReport(),
    registry: registry(...providers),
    state: routingState(stateOverrides),
    decisionId: "dcs_00000040",
    policy,
  });
}

function assertWellFormed(decision: RouteDecision, expectedOutcome: RouteDecision["outcome"]) {
  assert.equal(decision.outcome, expectedOutcome);
  assert.deepEqual(validateRouteDecisionSemantics(decision), []);
  assert.ok(routeDecisionSchema.safeParse(decision).success, "router emits a schema-valid record");
}

test("auto: the default policy never composes, even with scraper and expert both eligible", () => {
  const decision = route(
    [{ provider_id: PRV_SCRAPER }, { provider_id: PRV_HUMAN, kind: "HUMAN_EXPERT" }],
    DEFAULT_ROUTING_POLICY,
  );
  assertWellFormed(decision, "ROUTED");
  assert.equal(decision.selected?.plan_kind, "SINGLE_PROVIDER");
  assert.equal(decision.selected?.steps.length, 1);
  assert.equal(decision.selected?.steps[0]?.provider_id, PRV_SCRAPER);
});

test("auto: an explicit policy plus KNOWLEDGE_PACK composes acquire + validate", () => {
  const decision = route(
    [{ provider_id: PRV_SCRAPER }, { provider_id: PRV_HUMAN, kind: "HUMAN_EXPERT" }],
    COMPOSITE_POLICY,
  );
  assertWellFormed(decision, "ROUTED");
  assert.equal(decision.selected?.plan_kind, "COMPOSITE");
  assert.equal(decision.selected?.steps.length, 2);
  const [acquire, validate] = decision.selected?.steps ?? [];
  assert.equal(acquire?.role, "ACQUIRE");
  assert.equal(acquire?.kind, "SCRAPER");
  assert.equal(acquire?.provider_id, PRV_SCRAPER);
  assert.equal(acquire?.provider_version, "1.0.0");
  assert.equal(validate?.role, "VALIDATE");
  assert.equal(validate?.kind, "HUMAN_EXPERT");
  assert.equal(validate?.provider_id, PRV_HUMAN);
  // Estimated cost/latency are the sums of the pinned step estimates.
  assert.equal(decision.selected?.estimated_cost, 240);
  assert.equal(decision.selected?.estimated_latency_seconds, 1200);
  assert.ok(decision.explanation.includes("composite"));
  assert.equal(decision.fallback_applied, false);
});

test("auto: a composite that would exceed the original budget falls back to the best single", () => {
  // 120 + 120 = 240 > 500-spend(400) => composite infeasible inside the ORIGINAL budget.
  const decision = route(
    [{ provider_id: PRV_SCRAPER }, { provider_id: PRV_HUMAN, kind: "HUMAN_EXPERT" }],
    COMPOSITE_POLICY,
    knowledgePackRequest(),
    { spend_so_far: 400 },
  );
  assertWellFormed(decision, "INCONCLUSIVE");
  assert.equal(decision.error_code, "ACQ_BUDGET_EXCEEDED");
  assert.equal(decision.selected, null);
});

test("auto: a composite that would pass the deadline falls back to the best single", () => {
  // NOW + (600s + 600s) exceeds a deadline 15 minutes out; each single fits.
  const decision = route(
    [
      { provider_id: PRV_SCRAPER, latency: { sla_seconds: 600 } },
      { provider_id: PRV_HUMAN, kind: "HUMAN_EXPERT", latency: { sla_seconds: 600 } },
    ],
    COMPOSITE_POLICY,
    knowledgePackRequest({ deadline: "2026-10-11T00:15:00Z" }),
  );
  assertWellFormed(decision, "ROUTED");
  assert.equal(decision.selected?.plan_kind, "SINGLE_PROVIDER");
  assert.equal(decision.selected?.steps[0]?.provider_id, PRV_SCRAPER);
  assert.equal(decision.selected?.estimated_latency_seconds, 600);
});

test("auto: without a KNOWLEDGE_PACK delivery use there is never a composite", () => {
  const decision = route(
    [{ provider_id: PRV_SCRAPER }, { provider_id: PRV_HUMAN, kind: "HUMAN_EXPERT" }],
    COMPOSITE_POLICY,
    autoRequest(), // use_kinds = [RETRIEVAL]
  );
  assertWellFormed(decision, "ROUTED");
  assert.equal(decision.selected?.plan_kind, "SINGLE_PROVIDER");
});

test("auto: a missing expert kind degrades to the best single provider", () => {
  const decision = route(
    [{ provider_id: PRV_SCRAPER }, { provider_id: PRV_API, kind: "EXTERNAL_API" }],
    COMPOSITE_POLICY,
  );
  assertWellFormed(decision, "ROUTED");
  assert.equal(decision.selected?.plan_kind, "SINGLE_PROVIDER");
  assert.equal(decision.selected?.steps[0]?.provider_id, PRV_SCRAPER);
});

test("auto: a missing scraper kind degrades to the best single provider", () => {
  const decision = route(
    [
      { provider_id: PRV_HUMAN, kind: "HUMAN_EXPERT" },
      { provider_id: PRV_API, kind: "EXTERNAL_API" },
    ],
    COMPOSITE_POLICY,
  );
  assertWellFormed(decision, "ROUTED");
  assert.equal(decision.selected?.plan_kind, "SINGLE_PROVIDER");
  // Full ranking tie -> lexical provider_id tiebreak picks prv_00000041.
  assert.equal(decision.selected?.steps[0]?.kind, "HUMAN_EXPERT");
  assert.equal(decision.selected?.steps[0]?.provider_id, PRV_HUMAN);
});

test("auto: model_assist is pinned off and the policy version is recorded", () => {
  const decision = route([{ provider_id: PRV_SCRAPER }], COMPOSITE_POLICY);
  assert.equal(decision.model_assist.used, false);
  assert.equal(decision.model_assist.model_id, null);
  assert.equal(decision.policy_version, DEFAULT_ROUTING_POLICY.policy_version);
});

test("auto: identical inputs produce identical composite decisions (determinism)", () => {
  const providers = [
    { provider_id: PRV_SCRAPER },
    { provider_id: PRV_HUMAN, kind: "HUMAN_EXPERT" },
    {
      provider_id: PRV_API,
      kind: "EXTERNAL_API",
      cost: { currency: "USD", per_run_estimate: 500, quota_remaining: 9 },
    },
  ];
  const first = route(providers, COMPOSITE_POLICY);
  const second = route(providers, COMPOSITE_POLICY);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  // The composite must still keep the fully-screened candidate audit.
  assert.equal(first.eligible_candidates.length, 3);
  assert.equal(first.rejected_candidates.length, 0);
});
