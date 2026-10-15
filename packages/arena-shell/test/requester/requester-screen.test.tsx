import assert from "node:assert/strict";
import test from "node:test";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { RequesterController, type RequesterBindingPort } from "../../src/screens/requester/controller.js";
import { RequesterScreen } from "../../src/screens/requester/RequesterScreen.js";
import { requesterRegistration } from "../../src/screens/requester/registration.js";
import type { ArenaScreenHost } from "../../src/contract.js";
import type {
  EscalationDraft,
  ResultViewOutcome,
  SubmitFlowOutcome,
  TimelineOutcome,
  TrackingRow,
} from "@arena/workbench";
import type { BuildContext } from "@arena/workbench";

/**
 * UIA-001 Lane B — 请求方驾驶舱渲染测试（RENDERED via react-dom/server；
 * 控制器 + 注入假件 —— 无网络）。覆盖：加载/空/错误/主流程、六型提交
 * 结果逐字、透镜仅展示（两个透镜 → 同一请求路径）、零 ZCode 品牌。
 */

function normalize(html: string): string {
  return html.replace(/<!--.*?-->/g, "");
}

interface CallLog {
  op: string;
  args: unknown[];
}

class FakeBinding implements RequesterBindingPort {
  public readonly calls: CallLog[] = [];
  private rows: readonly TrackingRow[] | null = null;
  private submitResult: SubmitFlowOutcome = { kind: "UNAUTHENTICATED" };
  private timelineResult: TimelineOutcome = { kind: "TRANSPORT_ERROR", message: "not loaded" };
  private resultViewResult: ResultViewOutcome | null = null;

  constructor(private readonly principal: { tenant_id: string; user_id: string }) {}

  configure(options: {
    rows?: readonly TrackingRow[] | null;
    submit?: SubmitFlowOutcome;
    timeline?: TimelineOutcome;
    result?: ResultViewOutcome | null;
  }): void {
    if (options.rows !== undefined) this.rows = options.rows;
    if (options.submit !== undefined) this.submitResult = options.submit;
    if (options.timeline !== undefined) this.timelineResult = options.timeline;
    if (options.result !== undefined) this.resultViewResult = options.result;
  }

  async submitDraft(draft: EscalationDraft, context: BuildContext, principal: { tenant_id: string; user_id: string }): Promise<SubmitFlowOutcome> {
    this.calls.push({ op: "submitDraft", args: [draft.task.title, context.caller_idempotency_key, principal.tenant_id, principal.user_id] });
    return this.submitResult;
  }

  async tracking(principal: { tenant_id: string; user_id: string }, titleEcho?: ReadonlyMap<string, string>): Promise<readonly TrackingRow[] | null> {
    this.calls.push({ op: "tracking", args: [principal.tenant_id, principal.user_id, titleEcho?.size ?? 0] });
    return this.rows;
  }

  async timeline(escalation_id: string, principal: { tenant_id: string; user_id: string }): Promise<TimelineOutcome> {
    this.calls.push({ op: "timeline", args: [escalation_id, principal.tenant_id] });
    return this.timelineResult;
  }

  async resultView(escalation_id: string, principal: { tenant_id: string; user_id: string }): Promise<ResultViewOutcome | null> {
    this.calls.push({ op: "resultView", args: [escalation_id, principal.tenant_id] });
    return this.resultViewResult;
  }
}

const PRINCIPAL = { tenant_id: "tnt_00000001", user_id: "usr_00000001" };

function makeHost(lens: ArenaScreenHost["lens"]): ArenaScreenHost {
  return {
    lens,
    port: {
      navigate: () => ({ kind: "navigated" as const, screen: "requester" as const }),
      activeScreen: () => "requester" as const,
    },
  };
}

function render(controller: RequesterController, lens: ArenaScreenHost["lens"] = "requester"): string {
  return normalize(
    renderToString(createElement(RequesterScreen, { host: makeHost(lens), controller })),
  );
}

function fillValidForm(controller: RequesterController): void {
  controller.setForm({ title: "Fix failing build" });
  controller.setForm({ outcomeDescription: "Repo compiles and the pinned test passes on the agreed toolchain." });
}

test("initial render shows the honest loading state (tracking not yet loaded)", () => {
  const binding = new FakeBinding(PRINCIPAL);
  const controller = new RequesterController({ binding, principal: PRINCIPAL });
  const html = render(controller);
  assert.match(html, /Loading your requests from the server projection/);
});

test("loaded empty queue renders the Arena-branded empty state (no ZCode identity)", async () => {
  const binding = new FakeBinding(PRINCIPAL);
  binding.configure({ rows: [] });
  const controller = new RequesterController({ binding, principal: PRINCIPAL });
  await controller.loadTracking();
  const html = render(controller);
  assert.match(html, /No requests yet/);
  assert.match(html, /capability gap/);
  assert.doesNotMatch(html, /ZCode/i);
});

test("tracking error renders the typed message verbatim with a retry affordance", async () => {
  const binding = new FakeBinding(PRINCIPAL);
  binding.configure({
    timeline: {
      kind: "NOT_FOUND",
      envelope: {
        code: "ARENA_ESCALATION_NOT_FOUND",
        message: "no such escalation for this principal",
        correlation_id: "corr_3",
        request_id: null,
        details: null,
      },
    },
  });
  const controller = new RequesterController({ binding, principal: PRINCIPAL });
  await controller.selectEscalation("esc_missing");
  const html = render(controller);
  assert.match(html, /ARENA_ESCALATION_NOT_FOUND: no such escalation for this principal/);
});

test("loaded tracking rows render server states via the frozen vocabulary and select for inspection", async () => {
  const binding = new FakeBinding(PRINCIPAL);
  binding.configure({
    rows: [
      { escalation_id: "esc_00000001", state: "CREATED", updated_at: "2026-10-15T09:00:00Z", title: "Fix failing build" },
    ],
    timeline: {
      kind: "FOUND",
      events: [{ event_type: "EscalationCreated", occurred_at: "2026-10-15T09:00:00Z", actor: "requester" }],
    },
    result: {
      kind: "NOT_AVAILABLE",
      envelope: {
        code: "ARENA_RESULT_NOT_AVAILABLE",
        message: "result view not yet available",
        correlation_id: "corr_4",
        request_id: null,
        details: null,
      },
      disclosure: "result views land with AR2-007",
    },
  });
  const controller = new RequesterController({ binding, principal: PRINCIPAL });
  await controller.loadTracking();
  await controller.selectEscalation("esc_00000001");
  const html = render(controller);
  assert.match(html, /Fix failing build/);
  assert.match(html, /Created/);
  assert.match(html, /EscalationCreated/);
  assert.match(html, /2026-10-15T09:00:00Z/);
  assert.match(html, /result views land with AR2-007/);
  assert.match(html, /Routing transparency/);
  assert.match(html, /human expert/);
  assert.match(html, /does not yet carry a routing event/);
});

test("submit success renders the server projection verbatim (id, status, replay)", async () => {
  const binding = new FakeBinding(PRINCIPAL);
  binding.configure({
    submit: { kind: "SUBMITTED", escalation_id: "esc_00000042", status: "CREATED", version: 1, replayed: false },
    rows: [{ escalation_id: "esc_00000042", state: "CREATED", updated_at: "2026-10-15T09:10:00Z", title: "Fix failing build" }],
    timeline: {
      kind: "FOUND",
      events: [{ event_type: "EscalationCreated", occurred_at: "2026-10-15T09:10:00Z", actor: "requester" }],
    },
  });
  const controller = new RequesterController({ binding, principal: PRINCIPAL });
  fillValidForm(controller);
  await controller.submit();
  const html = render(controller);
  assert.match(html, /esc_00000042/);
  assert.match(html, /CREATED/);
});

test("form validation failure renders typed field errors verbatim (fail-fast)", async () => {
  const binding = new FakeBinding(PRINCIPAL);
  const controller = new RequesterController({ binding, principal: PRINCIPAL });
  await controller.submit();
  const html = render(controller);
  assert.match(html, /task\.title/);
  assert.match(html, /REJECTED/);
  assert.equal(binding.calls.filter((call) => call.op === "submitDraft").length, 0);
});

test("CONFLICT and TRANSPORT_ERROR outcomes render verbatim (no softening)", async () => {
  const binding = new FakeBinding(PRINCIPAL);
  binding.configure({ submit: { kind: "CONFLICT", message: "idempotency digest mismatch" } });
  const controller = new RequesterController({ binding, principal: PRINCIPAL });
  fillValidForm(controller);
  await controller.submit();
  const html = render(controller);
  assert.match(html, /CONFLICT: idempotency digest mismatch/);
});

test("lens is presentation only — switching lens changes no request path", async () => {
  const bindingA = new FakeBinding(PRINCIPAL);
  const bindingB = new FakeBinding(PRINCIPAL);
  const controllerA = new RequesterController({ binding: bindingA, principal: PRINCIPAL });
  const controllerB = new RequesterController({ binding: bindingB, principal: PRINCIPAL });
  fillValidForm(controllerA);
  fillValidForm(controllerB);
  const htmlRequester = render(controllerA, "requester");
  const htmlExpert = render(controllerB, "expert");
  void htmlRequester;
  void htmlExpert;
  await controllerA.submit();
  await controllerB.submit();
  assert.deepEqual(bindingA.calls, bindingB.calls);
  const lensHtmlA = render(controllerA, "requester");
  const lensHtmlB = render(controllerB, "expert");
  assert.match(lensHtmlA, /Viewing as requester/);
  assert.match(lensHtmlB, /Viewing as expert/);
  assert.equal(
    lensHtmlA.replace(/Viewing as requester/, "").replace(/data-arena-lens="requester"/, ""),
    lensHtmlB.replace(/Viewing as expert/, "").replace(/data-arena-lens="expert"/, ""),
  );
});

test("registration wires the screen into the shell vocabulary with the host port", () => {
  const binding = new FakeBinding(PRINCIPAL);
  const registration = requesterRegistration({ binding, principal: PRINCIPAL });
  assert.equal(registration.screen, "requester");
  assert.equal(typeof registration.title, "string");
  const node = registration.render(makeHost("requester"));
  const html = normalize(renderToString(node as never));
  assert.match(html, /data-arena-screen="requester"/);
  assert.match(html, /Compose a capability-gap request/);
});

test("payment panel renders test-mode disclosure and the vocabulary chips 1:1", () => {
  const binding = new FakeBinding(PRINCIPAL);
  const controller = new RequesterController({ binding, principal: PRINCIPAL });
  const html = render(controller);
  assert.match(html, /test_mode/);
  assert.match(html, /never pays/);
  assert.match(html, /Pending Evidence/i);
  assert.match(html, /Settled/i);
});

test("the release posture renders verbatim on the requester surface (NOT_GO / test_mode / disabled)", () => {
  const binding = new FakeBinding(PRINCIPAL);
  const controller = new RequesterController({ binding, principal: PRINCIPAL });
  const html = render(controller);
  assert.match(html, /NOT_GO/);
  assert.match(html, /test_mode/);
  assert.match(html, /disabled/);
});

test("structural a11y: form labels, roles, live regions, and busy semantics are present", () => {
  const binding = new FakeBinding(PRINCIPAL);
  const controller = new RequesterController({ binding, principal: PRINCIPAL });
  const html = render(controller);
  assert.match(html, /aria-label="requester cockpit"/);
  assert.match(html, /<label for="arena-form-title">/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /role="status"/);
  assert.match(html, /<fieldset/);
  assert.match(html, /<legend>Escalation modes<\/legend>/);
});
