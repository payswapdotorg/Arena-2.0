import assert from "node:assert/strict";
import test from "node:test";
import {
  DEMO_ACCEPTANCE_CRITERIA,
  LENS_VIEWS,
  MockArenaClient,
  ROLE_IS_NOT_AUTHORIZATION_RULE,
  WORKBENCH_LENSES,
  WORKBENCH_STATE_VIEWS,
  isWorkbenchLens,
  roleSwitcherModel,
  stateView,
  validateEscalationDraft,
  type EscalationDraft,
} from "../src/contract.js";
import {
  ATTEMPT_STATES,
  ESCALATION_STATES,
  LEARNING_STATES,
  PAYMENT_STATES,
} from "@arena/contracts";

/**
 * AR2-003 slice 1 UI-logic 测试（node:test；无 DOM）：
 * 1. requester 表单：CF1.0 zod 客户端校验 + 未知字段拒绝 → 类型化错误
 * 2. ROLE_IS_NOT_AUTHORIZATION：mock client 调用路径不含 role
 * 3. 状态登记表 1:1 派生（13/11/12/9），未知状态失败关闭
 * 4. mock client：fail-closed 提交、租户隔离、DEMO 标注
 */

function validDraft(overrides: Record<string, unknown> = {}): EscalationDraft {
  const draft: EscalationDraft = {
    task: {
      title: "Fix pricing rule edge cases",
      outcome_description: "Corrected rule reproduces the fixture table for all 12 edge cases",
    },
    task_type: { domain: "engineering", type_id: "tty_00000001", type_version: "1.0.0" },
    required_capabilities: [{ capability_id: "cap_00000001", minimum_level: "senior" }],
    required_qualifications: ["5+ years applied economics"],
    acceptance_criteria: DEMO_ACCEPTANCE_CRITERIA,
    proof_policy_preset: "demo_p1_rubric",
    constraints: {
      risk_tier: "MEDIUM",
      privacy_profile: "TENANT",
      retention_profile: "STANDARD",
      jurisdiction: null,
      professional_requirements: [],
      deadline: "2026-11-01T00:00:00Z",
      escalation_modes: ["next_expert", "budget_stop"],
    },
    budget: { limit_amount: 500, currency: "USD", allowed_attempts: 3, per_attempt_limit: 200 },
    input_artifacts: [],
    result_schema: { schema_id: "sch_00000001", schema_version: "1.0.0" },
    delivery_preferences: { channel: "poll", webhook_url: null },
    ...overrides,
  };
  return draft;
}

const CONTEXT = {
  client_application_id: "app_00000001",
  caller_idempotency_key: "idem-2026-10-10-001",
};

test("scenario 1: valid draft builds a CF1.0-valid escalation request", () => {
  const validation = validateEscalationDraft(validDraft(), CONTEXT, {
    digest: () => "ab".repeat(32),
  });
  assert.equal(validation.ok, true);
  if (validation.ok) {
    assert.equal(validation.request.contract_version, "ES2.0");
    assert.equal(validation.request.budget.currency, "USD");
    assert.equal(validation.request.request_digest, "ab".repeat(32));
  }
});

test("scenario 1: unknown draft field (tenant injection) is rejected as typed form error", () => {
  const draft = validDraft() as unknown as Record<string, unknown>;
  draft.tenant_id = "tnt_attacker";
  const validation = validateEscalationDraft(draft as unknown as EscalationDraft, CONTEXT, {
    digest: () => "ab".repeat(32),
  });
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    const unknown = validation.fieldErrors.find((e) => e.field === "tenant_id");
    assert.ok(unknown !== undefined, "tenant_id must be surfaced as unknown-field error");
    assert.match(unknown.rule, /server-derived/);
  }
});

test("scenario 1: invalid budget surfaces a per-field zod error", () => {
  const validation = validateEscalationDraft(
    validDraft({
      budget: { limit_amount: -5, currency: "USD", allowed_attempts: 3, per_attempt_limit: null },
    }),
    CONTEXT,
    { digest: () => "ab".repeat(32) },
  );
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.ok(validation.fieldErrors.some((e) => e.field.startsWith("budget")));
  }
});

test("scenario 1: unknown proof policy preset is a typed form error", () => {
  const validation = validateEscalationDraft(
    validDraft({ proof_policy_preset: "nonexistent_preset" }),
    CONTEXT,
    { digest: () => "ab".repeat(32) },
  );
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.ok(validation.fieldErrors.some((e) => e.field === "proof_policy_preset"));
  }
});

test("scenario 4: role/lens is presentation only — registry, switcher model, rule text", () => {
  assert.deepEqual([...WORKBENCH_LENSES], ["requester", "expert", "reviewer", "adjudicator"]);
  assert.equal(isWorkbenchLens("requester"), true);
  assert.equal(isWorkbenchLens("admin"), false);
  const model = roleSwitcherModel("expert");
  assert.equal(model.selected, "expert");
  assert.equal(model.available.length, 4);
  assert.match(ROLE_IS_NOT_AUTHORIZATION_RULE, /presentation ONLY/i);
  assert.ok(Object.values(LENS_VIEWS).every((view) => view.description.length > 0));
});

test("scenario 5: state views derive 1:1 from the four frozen machines (no invented states)", () => {
  assert.equal(WORKBENCH_STATE_VIEWS.escalation.length, ESCALATION_STATES.length);
  assert.equal(WORKBENCH_STATE_VIEWS.attempt.length, ATTEMPT_STATES.length);
  assert.equal(WORKBENCH_STATE_VIEWS.payment.length, PAYMENT_STATES.length);
  assert.equal(WORKBENCH_STATE_VIEWS.learning.length, LEARNING_STATES.length);
  for (const view of WORKBENCH_STATE_VIEWS.escalation) {
    assert.ok((ESCALATION_STATES as readonly string[]).includes(view.state));
  }
  const verifying = stateView("escalation", "VERIFYING");
  assert.equal("unknown" in verifying, false);
  if (!("unknown" in verifying)) {
    assert.equal(verifying.kind, "active");
    assert.equal(verifying.label, "Verifying");
  }
});

test("scenario 5: unknown state value fails closed (no invented rendering)", () => {
  const unknown = stateView("escalation", "HACKED_STATE");
  assert.equal("unknown" in unknown, true);
  const terminal = stateView("escalation", "CLOSED");
  assert.equal("unknown" in terminal, false);
  if (!("unknown" in terminal)) {
    assert.equal(terminal.kind, "terminal");
  }
});

test("scenario 4: mock client never receives the UI role — identical records regardless of lens", async () => {
  const client = new MockArenaClient();
  const validation = validateEscalationDraft(validDraft(), CONTEXT, {
    digest: () => "ab".repeat(32),
  });
  assert.equal(validation.ok, true);
  if (!validation.ok) {
    assert.fail("draft must validate");
  }
  const principal = { tenant_id: "tnt_00000001", user_id: "usr_00000001" };
  // “role”只存在于透镜层：提交调用不携带也不需要 role。
  const submitted = await client.submitEscalation(validation.request, principal);
  assert.equal(submitted.kind, "SUBMITTED");
  const listed = await client.listEscalations(principal);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.demo.demo, true);
  assert.match(listed[0]?.demo.disclosure ?? "", /DEMO — deterministic fixtures/);
});

test("scenario 1: mock client rejects invalid envelopes fail-closed with field errors", async () => {
  const client = new MockArenaClient();
  const outcome = await client.submitEscalation(
    { ...validDraft(), surprise: true },
    { tenant_id: "tnt_00000001", user_id: "usr_00000001" },
  );
  assert.equal(outcome.kind, "REJECTED");
  if (outcome.kind === "REJECTED") {
    assert.ok(outcome.fieldErrors.length > 0);
  }
});

test("tenant isolation: cross-tenant lookup is indistinguishable from not-found", async () => {
  const client = new MockArenaClient();
  const validation = validateEscalationDraft(validDraft(), CONTEXT, {
    digest: () => "ab".repeat(32),
  });
  if (!validation.ok) {
    assert.fail("draft must validate");
  }
  const owner = { tenant_id: "tnt_00000001", user_id: "usr_00000001" };
  const submitted = await client.submitEscalation(validation.request, owner);
  if (submitted.kind !== "SUBMITTED") {
    assert.fail("submit must succeed");
  }
  const crossTenant = await client.getEscalation(submitted.escalation_id, {
    tenant_id: "tnt_000099",
    user_id: "usr_000099",
  });
  assert.deepEqual(crossTenant, { kind: "NOT_FOUND" });
  const own = await client.getEscalation(submitted.escalation_id, owner);
  assert.equal(own.kind, "FOUND");
});
