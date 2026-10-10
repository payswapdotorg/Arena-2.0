import assert from "node:assert/strict";
import test from "node:test";
import {
  createInMemoryRuntime,
  IN_MEMORY_RUNTIME_DISCLOSURE,
  executeCommand,
} from "../src/contract.js";
import { createEscalation } from "../src/contract.js";
import type { TenantContext } from "@arena/contracts";

/**
 * @arena/application 单元测试：用例层行为（幂等、outbox 事件、乐观并发、
 * 租户失败关闭、状态机命令执行）。
 */

const TENANT: TenantContext = {
  tenant_id: "tnt_00000001",
  derived_from: "authenticated_credentials",
  client_application_id: "app_00000001",
  principal_id: "usr_00000001",
  acting_identity_id: null,
  role: "requester",
  authorization_scope_ids: ["scp_00000001"],
};

const VALID_REQUEST = {
  contract_version: "ES2.0",
  client_application_id: "app_00000001",
  caller_idempotency_key: "idem-key-0001",
  request_digest: "ab".repeat(32),
  task: { title: "Fix build", outcome_description: "Tests pass on pinned toolchain." },
  task_type: { domain: "software-engineering", type_id: "typ_00000001", type_version: "1.0.0" },
  required_capabilities: [{ capability_id: "cap_00000001", minimum_level: "senior" }],
  required_qualifications: [],
  acceptance_criteria: [
    {
      criterion_id: "crt_00000001",
      statement: "tests exit 0",
      measurement: {
        definition: "exit code",
        metric: "exit_code",
        unit: null,
        threshold: 0,
        comparator: "eq",
      },
      hard_stop: true,
      proof_class: "P0",
      weight: 1,
    },
  ],
  proof_policy: {
    policy_version: "PVP1.0",
    content_digest: "1e".repeat(32),
    selected_class: "P0",
    selection_rationale: "deterministic",
    per_criterion_classes: [{ criterion_id: "crt_00000001", proof_class: "P0" }],
    validators: [
      {
        validator_id: "val_00000001",
        validator_version: "1.2.0",
        kind: "deterministic",
        allowed_commands: ["pnpm"],
        timeout_seconds: 600,
        resource_limits: "2 vCPU",
        evidence_policy: "trusted runner",
      },
    ],
    rerun_policy: { minimum_reruns: 1, risk_exception: null },
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
      failed_attempt_posture: "isolate_branch",
      next_expert_baseline: "baseline_plus_approved_prior_attempts",
    },
    timeout: "72h",
    dispute_conditions: "logs contradict",
    budget_ceiling: 500,
  },
  constraints: {
    risk_tier: "LOW",
    privacy_profile: "TENANT",
    retention_profile: "STANDARD",
    jurisdiction: null,
    professional_requirements: [],
    deadline: "2026-11-10T00:00:00Z",
    escalation_modes: ["next_expert"],
  },
  budget: { limit_amount: 500, currency: "USD", allowed_attempts: 3, per_attempt_limit: 200 },
  input_artifacts: [],
  result_schema: { schema_id: "sch_00000001", schema_version: "1.0.0" },
  delivery_preferences: { channel: "poll", webhook_reference: null },
};

function commandInput(key: string, digest = "ab".repeat(32)) {
  return {
    request: VALID_REQUEST,
    tenant: TENANT,
    command: {
      request_id: `req_${key}`,
      idempotency_key: key,
      request_digest: digest,
      correlation_id: `cor_${key}`,
    },
  };
}

test("NON-DURABLE disclosure is exported and explicit", () => {
  assert.ok(IN_MEMORY_RUNTIME_DISCLOSURE.includes("NON-DURABLE"));
  assert.ok(IN_MEMORY_RUNTIME_DISCLOSURE.includes("AR2-005"));
});

test("create persists the aggregate and enqueues an outbox event in the same save", async () => {
  const runtime = createInMemoryRuntime();
  const outcome = await createEscalation(runtime, commandInput("key-outbox-1"));
  assert.equal(outcome.kind, "CREATED");
  const stored = runtime.readAggregate("escalation", outcome.escalation_id);
  assert.notEqual(stored, null);
  assert.equal(stored?.version, 1);
  const events = runtime.pendingEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0]?.event_type, "EscalationCreated");
  assert.equal(events[0]?.tenant_id, TENANT.tenant_id);
  assert.equal(events[0]?.immutable, true);
});

test("idempotency replay returns the stored response; digest mismatch is a typed conflict", async () => {
  const runtime = createInMemoryRuntime();
  const first = await createEscalation(runtime, commandInput("key-idem"));
  const replay = await createEscalation(runtime, commandInput("key-idem"));
  assert.equal(replay.kind, "REPLAY");
  assert.deepEqual(replay.response, first);
  await assert.rejects(
    () => createEscalation(runtime, commandInput("key-idem", "cd".repeat(32))),
    (error: { code?: string }) => error.code === "ARENA_IDEMPOTENCY_DIGEST_MISMATCH",
  );
});

test("tenant context from caller body never overrides derivation", async () => {
  const runtime = createInMemoryRuntime();
  const payload = JSON.parse(JSON.stringify(VALID_REQUEST)) as Record<string, unknown>;
  payload.tenant = "tnt_99999999";
  await assert.rejects(
    () => createEscalation(runtime, { ...commandInput("key-tenant"), request: payload }),
    (error: { code?: string }) => error.code === "ARENA_UNKNOWN_FIELD",
  );
});

test("optimistic concurrency conflict is typed", async () => {
  const runtime = createInMemoryRuntime();
  const outcome = await createEscalation(runtime, commandInput("key-cc"));
  await assert.rejects(
    () =>
      runtime.aggregates.saveAggregate({
        ref: {
          aggregate_type: "escalation",
          aggregate_id: outcome.escalation_id,
          expected_version: 0,
        },
        record: {},
        events: [],
        recorded_at: "2026-10-10T08:00:00Z",
      }),
    (error: Error) => error.message === "ARENA_CONCURRENT_WRITE_CONFLICT",
  );
});

test("command executor drives the frozen machine and records timeline + events", async () => {
  const runtime = createInMemoryRuntime();
  const outcome = await createEscalation(runtime, commandInput("key-cmd"));
  const amended = await executeCommand(runtime, {
    aggregate_type: "escalation",
    aggregate_id: outcome.escalation_id,
    command: "AmendEscalation",
    facts: { pre_assignment_amendment: true },
    actor: { type: "requester", id: TENANT.principal_id },
    tenant_id: TENANT.tenant_id,
    request_id: null,
    correlation_id: "cor_cmd1",
  });
  assert.equal(amended.from, "CREATED");
  assert.equal(amended.to, "CREATED");
  assert.equal(amended.version, 2);
  const events = runtime.pendingEvents();
  assert.equal(
    events.filter((event) => event.event_type === "EscalationAmendEscalation").length,
    1,
  );
  // 守卫不满足 → 类型化拒绝。
  await assert.rejects(
    () =>
      executeCommand(runtime, {
        aggregate_type: "escalation",
        aggregate_id: outcome.escalation_id,
        command: "AmendEscalation",
        facts: { pre_assignment_amendment: false },
        actor: { type: "requester", id: TENANT.principal_id },
        tenant_id: TENANT.tenant_id,
        request_id: null,
        correlation_id: "cor_cmd2",
      }),
    (error: { code?: string }) => error.code === "ARENA_INVARIANT_VIOLATION",
  );
});

test("cross-tenant command execution fails closed as not-found", async () => {
  const runtime = createInMemoryRuntime();
  const outcome = await createEscalation(runtime, commandInput("key-xtenant"));
  await assert.rejects(
    () =>
      executeCommand(runtime, {
        aggregate_type: "escalation",
        aggregate_id: outcome.escalation_id,
        command: "AmendEscalation",
        facts: { pre_assignment_amendment: true },
        actor: { type: "requester", id: "usr_00000002" },
        tenant_id: "tnt_00000002",
        request_id: null,
        correlation_id: "cor_x",
      }),
    (error: { code?: string }) => error.code === "ARENA_ESCALATION_NOT_FOUND",
  );
});
