import assert from "node:assert/strict";
import test from "node:test";
import type { EscalationRequest } from "@arena/contracts";
import {
  checkExpertProfile,
  compileCapabilityDemand,
  levelSatisfies,
  matchExperts,
  routeNextExpert,
  type ExpertProfile,
} from "../src/contract.js";

/**
 * AR2-008 验收（issue #10）：
 * - qualification ≠ authorization（匹配行不含授权语义）；
 * - 分配前策略检查（能力等级/证据、资质证据/辖区、辖区覆盖、容量、
 *   利益冲突）逐维度可解释；
 * - 失败尝试保留归因（同专家被排除出下一位路由）；
 * - 重试永不超出聚合预算 / 尝试次数 / deadline（类型化 stop）。
 */

const ISO = "2026-10-11T00:00:00Z";

function profile(overrides: Partial<ExpertProfile> & { expert_id: string }): ExpertProfile {
  return {
    expert_id: "exp_00000001",
    tenant_id: "tnt_00000001",
    capabilities: [
      { capability_id: "cap_00000001", level: "senior", evidence_refs: ["evd_00000001"] },
    ],
    qualifications: [
      {
        qualification: "licensed engineer (jurisdiction GH)",
        evidence_refs: ["evd_00000002"],
        jurisdiction: "GH",
        expires_at: null,
      },
    ],
    availability: { max_concurrent_attempts: 2, active_attempts: 0 },
    jurisdictions: ["GH"],
    policy_flags: [],
    ...overrides,
  };
}

function request(): EscalationRequest {
  return {
    contract_version: "ES2.0",
    client_application_id: "app_00000001",
    caller_idempotency_key: "match-key-1",
    request_digest: "ab".repeat(32),
    task: { title: "Fix failing build", outcome_description: "Compiles and tests pass." },
    task_type: { domain: "software-engineering", type_id: "typ_00000001", type_version: "1.0.0" },
    required_capabilities: [{ capability_id: "cap_00000001", minimum_level: "senior" }],
    required_qualifications: ["licensed engineer (jurisdiction GH)"],
    acceptance_criteria: [],
    proof_policy: {
      policy_version: "PVP1.0",
      content_digest: "1e".repeat(32),
      selected_class: "P0",
      selection_rationale: "deterministic",
      per_criterion_classes: [],
      validators: [
        {
          validator_id: "val_00000001",
          validator_version: "1.2.0",
          kind: "deterministic",
          allowed_commands: ["pnpm"],
          timeout_seconds: 1800,
          resource_limits: "2 vCPU / 3 GB",
          evidence_policy: "logs",
        },
      ],
      rerun_policy: { minimum_reruns: 2, risk_exception: null },
      sample_policy: null,
      review_policy: null,
      observation_policy: null,
      payout_gate: {
        release_requires: "all_predicates_pass",
        caller_authenticity_verified: true,
        task_binding_verified: true,
        dispute_blocks_release: true,
      },
      retry_next_expert: {
        max_attempts: 3,
        max_aggregate_spend: 500,
        cooldown_policy: "48h",
        failed_attempt_posture: "retain_attributed",
        next_expert_baseline: "baseline_plus_approved_prior_attempts",
      },
      timeout: "72h",
      dispute_conditions: "logs contradict outcome",
      budget_ceiling: 500,
    },
    constraints: {
      risk_tier: "MEDIUM",
      privacy_profile: "TENANT",
      retention_profile: "STANDARD",
      jurisdiction: "GH",
      professional_requirements: [],
      deadline: "2026-12-01T00:00:00Z",
      escalation_modes: ["next_expert", "budget_stop"],
    },
    budget: { limit_amount: 500, currency: "USD", allowed_attempts: 3, per_attempt_limit: 200 },
    input_artifacts: [],
    result_schema: { schema_id: "sch_00000001", schema_version: "1.0.0" },
    delivery_preferences: { channel: "poll", webhook_reference: null },
  };
}

test("profile check: strict schema rejections with field issues", () => {
  const ok = checkExpertProfile(profile({ expert_id: "exp_00000001" }));
  assert.equal(ok.ok, true);

  const bad = { ...profile({ expert_id: "exp_00000001" }), secret: "x" };
  const badCheck = checkExpertProfile(bad);
  assert.equal(badCheck.ok, false);
  if (!badCheck.ok) assert.ok(badCheck.issues.length > 0);

  const noQualEvidence = profile({ expert_id: "exp_00000002" });
  noQualEvidence.qualifications[0]!.evidence_refs = [];
  const evidenceCheck = checkExpertProfile(noQualEvidence);
  assert.equal(evidenceCheck.ok, false);
});

test("level ordering: senior satisfies junior..senior, not principal", () => {
  assert.equal(levelSatisfies("senior", "senior"), true);
  assert.equal(levelSatisfies("senior", "junior"), true);
  assert.equal(levelSatisfies("junior", "senior"), false);
  assert.equal(levelSatisfies("principal", "senior"), true);
  // 未知等级词：fail-closed（仅严格相等视为满足）。
  assert.equal(levelSatisfies("guru", "senior"), false);
  assert.equal(levelSatisfies("guru", "guru"), true);
});

test("explainable matching: every row carries per-dimension verdicts and digests", () => {
  const demand = compileCapabilityDemand(request());
  const candidates = [
    profile({ expert_id: "exp_00000001" }),
    profile({ expert_id: "exp_00000002" }),
  ];
  const rows = matchExperts(demand, candidates, {
    failedAttemptExpertIds: [],
    priorInvolvementExpertIds: [],
    conflictedTenantIds: [],
    knownEvidenceIds: ["evd_00000001", "evd_00000002"],
  });
  assert.equal(rows.length, 2);
  for (const row of rows) {
    // 逐维度：capability ×1、qualification ×1、jurisdiction、availability。
    assert.equal(row.dimensions.length, 4);
    assert.ok(row.digests.capability_profile_digest.length === 64);
    assert.ok(row.digests.qualification_digest.length === 64);
    assert.ok(row.digests.conflict_check_digest.length === 64);
  }
  assert.equal(rows[0]?.eligible, true);
  assert.equal(rows[1]?.eligible, true);
});

test("policy checks gate eligibility: missing evidence, low level, jurisdiction, capacity, conflict", () => {
  const demand = compileCapabilityDemand(request());
  const context = {
    failedAttemptExpertIds: [],
    priorInvolvementExpertIds: [],
    conflictedTenantIds: [],
    knownEvidenceIds: ["evd_00000001", "evd_00000002"],
  };

  // 1) 无证据支撑的能力声明 → 维度 fail。
  const noEvidence = profile({ expert_id: "exp_00000003" });
  noEvidence.capabilities[0]!.evidence_refs = [];
  const r1 = matchExperts(demand, [noEvidence], context);
  assert.equal(r1[0]?.eligible, false);
  assert.ok(r1[0]?.dimensions.some((d) => !d.pass && d.dimension.startsWith("capability:")));

  // 2) 等级不足。
  const junior = profile({ expert_id: "exp_00000004" });
  junior.capabilities[0]!.level = "junior";
  const r2 = matchExperts(demand, [junior], context);
  assert.equal(r2[0]?.eligible, false);

  // 3) 辖区不覆盖。
  const wrongJurisdiction = profile({ expert_id: "exp_00000005" });
  wrongJurisdiction.jurisdictions = ["NG"];
  const r3 = matchExperts(demand, [wrongJurisdiction], context);
  assert.equal(r3[0]?.eligible, false);
  assert.ok(r3[0]?.dimensions.some((d) => d.dimension === "jurisdiction" && !d.pass));

  // 4) 容量已满。
  const atCapacity = profile({
    expert_id: "exp_00000006",
    availability: { max_concurrent_attempts: 2, active_attempts: 2 },
  });
  const r4 = matchExperts(demand, [atCapacity], context);
  assert.equal(r4[0]?.eligible, false);

  // 5) 利益冲突（同专家曾失败）。
  const conflicted = profile({ expert_id: "exp_00000001" });
  const r5 = matchExperts(demand, [conflicted], {
    ...context,
    failedAttemptExpertIds: ["exp_00000001"],
  });
  assert.equal(r5[0]?.eligible, false);
  assert.equal(r5[0]?.conflict.ok, false);
  if (!r5[0]?.conflict.ok) {
    assert.deepEqual(r5[0]?.conflict.reasons, ["same_expert_as_failed_attempt"]);
  }
});

test("qualification is not authorization: match rows carry no authorization semantics", () => {
  const demand = compileCapabilityDemand(request());
  const rows = matchExperts(demand, [profile({ expert_id: "exp_00000001" })], {
    failedAttemptExpertIds: [],
    priorInvolvementExpertIds: [],
    conflictedTenantIds: [],
    knownEvidenceIds: ["evd_00000001", "evd_00000002"],
  });
  const row = rows[0];
  assert.notEqual(row, undefined);
  if (row !== undefined) {
    // 结构性断言：匹配行只有决策维度与 digest —— 没有任何授权字段。
    const keys = Object.keys(row).sort();
    assert.deepEqual(keys, ["conflict", "digests", "dimensions", "eligible", "expert_id"]);
    assert.equal("authorization" in row, false);
    assert.equal("scopes" in row, false);
  }
});

test("routing: hard boundaries before eligibility (attempt limit, budget, deadline)", () => {
  const demand = compileCapabilityDemand(request());
  const matches = matchExperts(demand, [profile({ expert_id: "exp_00000001" })], {
    failedAttemptExpertIds: [],
    priorInvolvementExpertIds: [],
    conflictedTenantIds: [],
    knownEvidenceIds: ["evd_00000001", "evd_00000002"],
  });

  const attemptStop = routeNextExpert(demand, matches, {
    attemptsUsed: 3,
    aggregateSpend: 0,
    nextAttemptAmount: 100,
    now: ISO,
  });
  assert.equal(attemptStop.kind, "ATTEMPT_LIMIT_STOP");

  const budgetStop = routeNextExpert(demand, matches, {
    attemptsUsed: 1,
    aggregateSpend: 400,
    nextAttemptAmount: 200,
    now: ISO,
  });
  assert.equal(budgetStop.kind, "BUDGET_STOP");
  if (budgetStop.kind === "BUDGET_STOP") {
    assert.match(budgetStop.basis, /would exceed ceiling 500/);
  }

  const deadlineStop = routeNextExpert(demand, matches, {
    attemptsUsed: 1,
    aggregateSpend: 100,
    nextAttemptAmount: 100,
    now: "2027-01-01T00:00:00Z",
  });
  assert.equal(deadlineStop.kind, "DEADLINE_STOP");
});

test("routing: failed attempts retain attribution — the same expert is excluded from the next route", () => {
  const demand = compileCapabilityDemand(request());
  const candidates = [
    profile({ expert_id: "exp_00000001" }),
    profile({ expert_id: "exp_00000002" }),
  ];
  // 第一次尝试失败于 exp_00000001 —— 归因保留，下一位路由排除它。
  const afterFailure = matchExperts(demand, candidates, {
    failedAttemptExpertIds: ["exp_00000001"],
    priorInvolvementExpertIds: [],
    conflictedTenantIds: [],
    knownEvidenceIds: ["evd_00000001", "evd_00000002"],
  });
  const route = routeNextExpert(demand, afterFailure, {
    attemptsUsed: 1,
    aggregateSpend: 200,
    nextAttemptAmount: 150,
    now: ISO,
  });
  assert.equal(route.kind, "NEXT_EXPERT");
  if (route.kind === "NEXT_EXPERT") {
    assert.equal(route.expert_id, "exp_00000002");
    assert.equal(route.eligible_count, 1);
  }
});

test("routing: no eligible candidate after screening → typed outcome (never a forced assignment)", () => {
  const demand = compileCapabilityDemand(request());
  const onlyConflicted = matchExperts(demand, [profile({ expert_id: "exp_00000001" })], {
    failedAttemptExpertIds: ["exp_00000001"],
    priorInvolvementExpertIds: [],
    conflictedTenantIds: [],
    knownEvidenceIds: ["evd_00000001", "evd_00000002"],
  });
  const route = routeNextExpert(demand, onlyConflicted, {
    attemptsUsed: 1,
    aggregateSpend: 200,
    nextAttemptAmount: 150,
    now: ISO,
  });
  assert.equal(route.kind, "NO_ELIGIBLE_EXPERT");
});

test("demand compilation: budget/attempt/deadline guards mirror the frozen request fields", () => {
  const demand = compileCapabilityDemand(request());
  assert.equal(demand.max_attempts, 3);
  assert.equal(demand.max_aggregate_spend, 500);
  assert.equal(demand.currency, "USD");
  assert.equal(demand.deadline, "2026-12-01T00:00:00Z");
  assert.equal(demand.jurisdiction, "GH");
  assert.deepEqual(demand.capabilities, [
    { capability_id: "cap_00000001", minimum_level: "senior" },
  ]);
  assert.deepEqual(demand.qualifications, ["licensed engineer (jurisdiction GH)"]);
  assert.ok(demand.escalation_modes.includes("next_expert"));
});
