import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { ArenaShell, shellFromRegistrations } from "../../../src/shell/ArenaShell.js";
import { requesterRegistration } from "../../../src/screens/requester/registration.js";
import {
  expertRegistration,
  mockAttemptsAdapter,
  bindingCommandAdapter,
} from "../../../src/screens/expert/registration.js";
import {
  reviewerRegistration,
  mockDecksAdapter,
  bindingReviewerAdapters,
} from "../../../src/screens/reviewer/registration.js";
import { developerRegistration } from "../../../src/screens/developer/registration.js";
import {
  operationsRegistration,
  bindingAuditAdapter,
} from "../../../src/screens/operations/registration.js";
import { DEMO_EXPERT_PRINCIPAL, MockArenaClient, type CommandApiOutcome, type TimelineOutcome } from "@arena/workbench";
import type { RequesterBindingPort } from "../../../src/screens/requester/controller.js";

/**
 * UIA-001 — browser-journey render host (mirrors the AR2-021 pattern).
 *
 * Mounts the REAL ArenaShell with the five REAL screen registrations — the
 * same composition law as the web integration. The async ports are
 * deterministic render-host fixtures (labelled here, exactly like the
 * workbench host's drive fixtures): the REAL-composition coverage lives in
 * the node-side REAL suites (real arena-api processes); this host exists to
 * exercise the REAL browser surface — branding, navigation, keyboard, lens,
 * honest states, responsive layout, axe.
 */

const REQUESTER_PRINCIPAL = { tenant_id: "tnt_00000001", user_id: "usr_00000001" };
// attempt/deck 种子的租户 = DEMO_EXPERT_TENANT_ID（demo 标注面）；
// 真实绑定的 principal 是另一套（生产适配器替换时统一）。
const EXPERT_PRINCIPAL = DEMO_EXPERT_PRINCIPAL;

const FIXTURE_TRACKING = [
  {
    escalation_id: "esc_host_0001",
    state: "CREATED",
    updated_at: "2026-10-15T08:00:00Z",
    title: "Fix failing build (render-host fixture)",
  },
  {
    escalation_id: "esc_host_0002",
    state: "VERIFYING",
    updated_at: "2026-10-15T08:30:00Z",
    title: "Pricing-rule edge table verification",
  },
];

const FIXTURE_TIMELINE: TimelineOutcome = {
  kind: "FOUND",
  events: [
    { event_type: "EscalationCreated", occurred_at: "2026-10-15T08:00:00Z", actor: "requester" },
    { event_type: "EscalationAmendEscalation", occurred_at: "2026-10-15T08:10:00Z", actor: "requester" },
  ],
};

const FIXTURE_RESULT = {
  kind: "NOT_AVAILABLE" as const,
  envelope: {
    code: "ARENA_RESULT_NOT_AVAILABLE" as const,
    message: "result view not yet available",
    correlation_id: "corr_host_1",
    request_id: null,
    details: null,
  },
  disclosure: "result views land with AR2-007 (recorded frontier — legible, not blank)",
};

/** Deterministic render-host binding (the REAL binding's structural port). */
const hostBinding: RequesterBindingPort = {
  async submitDraft() {
    return {
      kind: "SUBMITTED",
      escalation_id: "esc_host_0003",
      status: "CREATED",
      version: 1,
      replayed: false,
    };
  },
  async tracking() {
    return FIXTURE_TRACKING;
  },
  async timeline() {
    return FIXTURE_TIMELINE;
  },
  async resultView() {
    return FIXTURE_RESULT;
  },
};

const hostCommandSurface = {
  async command(): Promise<CommandApiOutcome> {
    return {
      kind: "INVALID_TRANSITION",
      envelope: {
        code: "ARENA_INVALID_TRANSITION" as const,
        message: "no edge from CREATED via SubmitIntervention (render-host fixture)",
        correlation_id: "corr_host_2",
        request_id: null,
        details: null,
      },
    };
  },
  async timeline(): Promise<TimelineOutcome> {
    return FIXTURE_TIMELINE;
  },
};

// 组合根只构造一次（控制器有状态 —— 每次渲染重建会重置屏内状态）。
const demoClient = new MockArenaClient();
const registry = shellFromRegistrations([
  requesterRegistration({ binding: hostBinding, principal: REQUESTER_PRINCIPAL }),
  expertRegistration({
    attempts: mockAttemptsAdapter(demoClient),
    commands: bindingCommandAdapter(hostCommandSurface, EXPERT_PRINCIPAL),
    principal: EXPERT_PRINCIPAL,
  }),
  reviewerRegistration({
    decks: mockDecksAdapter(demoClient),
    ...bindingReviewerAdapters(hostCommandSurface, EXPERT_PRINCIPAL),
    principal: EXPERT_PRINCIPAL,
  }),
  developerRegistration(),
  operationsRegistration({
    audit: bindingAuditAdapter(hostCommandSurface),
    principal: REQUESTER_PRINCIPAL,
  }),
]);

function HostApp() {
  useEffect(() => {
    document.documentElement.setAttribute("data-arena-host-ready", "true");
  }, []);
  return createElement(ArenaShell, { registry, announceKeyboardHints: true });
}

const container = document.getElementById("root");
if (container === null) {
  throw new Error("render host: #root container missing");
}
createRoot(container).render(createElement(HostApp, {}));
