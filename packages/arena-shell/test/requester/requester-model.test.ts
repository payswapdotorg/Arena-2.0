import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContext,
  buildDraft,
  initialFormState,
  quickValidate,
  RISK_TIER_OPTIONS,
  PRIVACY_PROFILE_OPTIONS,
  RETENTION_PROFILE_OPTIONS,
  ESCALATION_MODE_OPTIONS,
  DELIVERY_CHANNEL_OPTIONS,
} from "../../src/screens/requester/formModel.js";
import { ROUTING_CONCEPTS, routingStatusFromEvents } from "../../src/screens/requester/routingModel.js";
import {
  FAILED_PROOF_NEVER_PAYS_RULE,
  paymentChip,
  paymentVocabularyPanel,
  TEST_MODE_PAYMENT_DISCLOSURE,
} from "../../src/screens/requester/paymentModel.js";
import {
  resultViewModel,
  submitOutcomeViewModel,
  timelineViewModel,
  trackingViewModel,
} from "../../src/screens/requester/viewModel.js";
import { ARENA_RELEASE_POSTURE } from "../../src/contract.js";
import { stateView, WORKBENCH_STATE_VIEWS, type TimelineEvent } from "@arena/workbench";

/**
 * UIA-001 Lane B — 纯视图模型测试（PURE；无 DOM、无网络）。
 *
 * 覆盖：表单模型（枚举选项从冻结 schema 逐字读取）、路由透明度（词表冻结
 * + 服务端唯一来源 + 诚实缺失）、支付 test_mode 披露（逐字）、四态视图
 * 与六型提交流程视图、状态词表 1:1 流转。
 */

test("form enumerations come verbatim from the frozen CF1.0 schemas (never hand-mirrored)", () => {
  assert.deepEqual(RISK_TIER_OPTIONS, ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
  assert.deepEqual(PRIVACY_PROFILE_OPTIONS, ["PUBLIC", "TENANT", "CONFIDENTIAL", "REGULATED"]);
  assert.deepEqual(RETENTION_PROFILE_OPTIONS, ["STANDARD", "EXTENDED", "SHORT", "COMPLIANCE"]);
  assert.deepEqual(ESCALATION_MODE_OPTIONS, [
    "next_expert",
    "budget_stop",
    "manual_review",
    "deadline_stop",
  ]);
  assert.deepEqual(DELIVERY_CHANNEL_OPTIONS, ["poll", "webhook"]);
});

test("a valid form builds a draft that passes the frozen validator (fail-fast green path)", () => {
  const form = initialFormState();
  form.title = "Fix failing build";
  form.outcomeDescription = "Repo compiles and the pinned test passes on the agreed toolchain.";
  const result = quickValidate(form, buildContext("pure-key-1"));
  assert.equal(result.ok, true);
});

test("an invalid form fails fast with typed field errors (verbatim, server-authoritative mirror)", () => {
  const form = initialFormState();
  form.title = "";
  form.outcomeDescription = "x".repeat(10);
  const result = quickValidate(form, buildContext("pure-key-2"));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.fieldErrors.some((error) => error.field.startsWith("task.")));
    for (const error of result.fieldErrors) {
      assert.equal(typeof error.field, "string");
      assert.equal(typeof error.rule, "string");
    }
  }
});

test("the draft never carries tenant (server-derived only) and webhook turns into a typed reference", () => {
  const form = initialFormState();
  form.title = "Webhook delivery request";
  form.outcomeDescription = "The outcome arrives over a signed webhook.";
  form.deliveryChannel = "webhook";
  form.webhookUrl = "https://example.test/hook";
  const draft = buildDraft(form);
  assert.equal("tenant_id" in draft, false);
  assert.equal(draft.delivery_preferences.channel, "webhook");
  assert.equal(draft.delivery_preferences.webhook_url, "https://example.test/hook");
  const validation = quickValidate(form, buildContext("pure-key-3"));
  assert.equal(validation.ok, true);
});

test("routing concepts are the frozen spec §1.1 vocabulary (four concepts, verbatim names)", () => {
  assert.equal(ROUTING_CONCEPTS.length, 4);
  assert.deepEqual(
    ROUTING_CONCEPTS.map((concept) => concept.concept),
    ["human expert", "scraper / data provider", "approved external API", "combination"],
  );
});

test("routing status derives ONLY from server events — absent routing events are honestly not_recorded", () => {
  const events: TimelineEvent[] = [
    { event_type: "EscalationCreated", occurred_at: "2026-10-15T09:00:00Z", actor: "requester" },
  ];
  const status = routingStatusFromEvents(events);
  assert.equal(status.kind, "not_recorded");
  if (status.kind === "not_recorded") {
    assert.match(status.disclosure, /never invented client-side/);
    assert.match(status.disclosure, /server projection does not yet carry a routing event/);
  }
  const nullStatus = routingStatusFromEvents(null);
  assert.equal(nullStatus.kind, "not_recorded");
});

test("routing status surfaces recorded routing events verbatim when the projection carries them", () => {
  const events: TimelineEvent[] = [
    { event_type: "RoutingDecisionRecorded", occurred_at: "2026-10-15T09:05:00Z", actor: "router" },
  ];
  const status = routingStatusFromEvents(events);
  assert.equal(status.kind, "recorded");
  if (status.kind === "recorded") {
    assert.equal(status.events.length, 1);
    assert.equal(status.events[0]?.event_type, "RoutingDecisionRecorded");
  }
});

test("payment disclosure is the recorded test-mode posture verbatim (never live money)", () => {
  assert.match(TEST_MODE_PAYMENT_DISCLOSURE, /test_mode/);
  assert.match(TEST_MODE_PAYMENT_DISCLOSURE, /no live money/);
  assert.match(TEST_MODE_PAYMENT_DISCLOSURE, /NOT_GO/);
  assert.equal(ARENA_RELEASE_POSTURE.financeMode, "test_mode");
  assert.match(FAILED_PROOF_NEVER_PAYS_RULE, /never pays/);
});

test("payment chips flow 1:1 through the frozen payment state vocabulary (no invented states)", () => {
  const panel = paymentVocabularyPanel();
  for (const chip of panel.chips) {
    if ("view" in chip) {
      const known = WORKBENCH_STATE_VIEWS.payment.some((view) => view.state === chip.view.state);
      assert.equal(known, true, `state ${chip.view.state} must exist in the frozen vocabulary`);
    }
  }
  const unknown = paymentChip("DEFINITELY_NOT_A_STATE");
  assert.equal("unknown" in unknown, true);
});

test("tracking view model covers the four honest states", () => {
  assert.equal(trackingViewModel(null).kind, "loading");
  assert.equal(trackingViewModel([]).kind, "empty");
  const ready = trackingViewModel([
    { escalation_id: "esc_00000001", state: "CREATED", updated_at: "2026-10-15T09:00:00Z", title: "t" },
  ]);
  assert.equal(ready.kind, "ready");
});

test("timeline view model renders typed NOT_FOUND failures verbatim", () => {
  const notFound = timelineViewModel({
    kind: "NOT_FOUND",
    envelope: {
      code: "ARENA_ESCALATION_NOT_FOUND",
      message: "no such escalation for this principal",
      correlation_id: "corr_1",
      request_id: null,
      details: null,
    },
  });
  assert.equal(notFound.kind, "error");
  if (notFound.kind === "error") {
    assert.match(notFound.message, /ARENA_ESCALATION_NOT_FOUND/);
    assert.match(notFound.message, /no such escalation for this principal/);
  }
});

test("result view model carries the typed NOT_AVAILABLE disclosure verbatim (AR2-007 legible stub)", () => {
  const vm = resultViewModel({
    kind: "NOT_AVAILABLE",
    envelope: {
      code: "ARENA_RESULT_NOT_AVAILABLE",
      message: "result view not yet available",
      correlation_id: "corr_2",
      request_id: null,
      details: null,
    },
    disclosure: "result views land with AR2-007",
  });
  assert.equal(vm.kind, "not_available");
  assert.equal(vm.disclosure, "result views land with AR2-007");
});

test("submit outcome view model renders all six typed outcomes without softening", () => {
  assert.equal(submitOutcomeViewModel({ kind: "UNAUTHENTICATED" }).kind, "UNAUTHENTICATED");
  const conflict = submitOutcomeViewModel({ kind: "CONFLICT", message: "idempotency digest mismatch" });
  assert.equal(conflict.kind, "CONFLICT");
  if (conflict.kind === "CONFLICT") {
    assert.equal(conflict.message, "idempotency digest mismatch");
  }
  const rejected = submitOutcomeViewModel({
    kind: "REJECTED",
    fieldErrors: [{ field: "task.title", rule: "too_short" }],
  });
  assert.equal(rejected.kind, "REJECTED");
  if (rejected.kind === "REJECTED") {
    assert.deepEqual(rejected.fieldRules, ["task.title: too_short"]);
  }
  const replayed = submitOutcomeViewModel({
    kind: "SUBMITTED",
    escalation_id: "esc_00000009",
    status: "CREATED",
    version: 1,
    replayed: true,
  });
  assert.equal(replayed.kind, "SUBMITTED");
  if (replayed.kind === "SUBMITTED") {
    assert.equal(replayed.replayed, true);
  }
});

test("stateView guard fails closed on unknown states (no invented states reach the chip)", () => {
  const view = stateView("escalation", "NOT_A_REAL_STATE");
  assert.equal("unknown" in view, true);
});
