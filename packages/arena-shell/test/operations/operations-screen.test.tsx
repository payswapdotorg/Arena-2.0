import assert from "node:assert/strict";
import test from "node:test";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { OperationsScreen } from "../../src/screens/operations/OperationsScreen.js";
import { operationsRegistration } from "../../src/screens/operations/registration.js";
import { OperationsController, type OperationsAuditPort } from "../../src/screens/operations/controller.js";
import { DEMO_PRINCIPAL_TOKENS } from "@arena/workbench";
import type { ArenaScreenHost } from "../../src/contract.js";

/**
 * UIA-001 Lane C — 运维/治理渲染测试（RENDERED + posture 真相法断言）。
 */

function normalize(html: string): string {
  return html.replace(/<!--.*?-->/g, "");
}

const HOST: ArenaScreenHost = {
  lens: "operator",
  port: {
    navigate: () => ({ kind: "navigated", screen: "operations" }),
    activeScreen: () => "operations",
  },
};

function makeController(audit?: OperationsAuditPort) {
  const principal = DEMO_PRINCIPAL_TOKENS[0]?.principal ?? {
    tenant_id: "tnt_00000001",
    user_id: "usr_00000001",
  };
  const port: OperationsAuditPort =
    audit ??
    {
      timeline: async () => ({
        kind: "FOUND",
        events: [
          { event_type: "EscalationCreated", occurred_at: "2026-10-15T09:00:00Z", actor: "requester" },
        ],
      }),
    };
  return new OperationsController({ audit: port, principal });
}

function render(controller: OperationsController): string {
  return normalize(renderToString(createElement(OperationsScreen, { host: HOST, controller })));
}

test("the release posture panel renders the recorded truth verbatim (NOT_GO / test_mode / disabled)", () => {
  const html = render(makeController());
  assert.match(html, /data-posture-decision="true">NOT_GO/);
  assert.match(html, /data-posture-finance="true">test_mode/);
  assert.match(html, /data-posture-execution="true">disabled/);
  assert.match(html, /AR2-015-gate-report-2026-10-11\.md/);
  assert.match(html, /AR2-019-strict-mode-station-evidence-2026-10-14\.md/);
  assert.match(html, /AR2-023-authorization-workflow-2026-10-14\.md/);
});

test("restricted actions render truthfully disabled with their recorded bases (never absent)", () => {
  const html = render(makeController());
  assert.match(html, /record a release decision \(GO \/ LIMITED_SCOPE_GO \/ NOT_GO_HOLD\)/);
  assert.match(html, /enable untrusted expert execution/);
  assert.match(html, /enable live-money payments/);
  assert.match(html, /\(disabled\)/);
  assert.match(html, /basis: /);
});

test("provider health renders the typed statuses with evidence grades verbatim", () => {
  const html = render(makeController());
  assert.match(html, /ACTIVE/);
  assert.match(html, /SUSPENDED/);
  assert.match(html, /DEMO \/ FIXTURE \/ REAL/);
});

test("the operational state vocabulary renders 1:1 from the frozen machines", () => {
  const html = render(makeController());
  assert.match(html, /escalation \(\d+ states\)/);
  assert.match(html, /FAILED_EXHAUSTED/);
  assert.match(html, /payment \(\d+ states\)/);
});

test("the audit trail renders server-recorded events verbatim with the append-only basis", async () => {
  const controller = makeController();
  await controller.loadAuditTrail("esc_00000001");
  const html = render(controller);
  assert.match(html, /EscalationCreated/);
  assert.match(html, /no client-side synthesis/);
});

test("audit trail error state renders the typed NOT_FOUND envelope verbatim", async () => {
  const controller = makeController({
    timeline: async () => ({
      kind: "NOT_FOUND",
      envelope: {
        code: "ARENA_ESCALATION_NOT_FOUND",
        message: "no such escalation for this principal",
        correlation_id: "corr_10",
        request_id: null,
        details: null,
      },
    }),
  });
  await controller.loadAuditTrail("esc_missing");
  const html = render(controller);
  assert.match(html, /ARENA_ESCALATION_NOT_FOUND: no such escalation for this principal/);
});

test("the ops resolution constraint renders honestly", () => {
  const html = render(makeController());
  assert.match(html, /@arena\/ops .*is not resolvable/);
  assert.match(html, /mount at TL integration/);
});

test("lens is presentation only — the operations surface renders identically under another lens", async () => {
  const controller = makeController();
  await controller.loadAuditTrail("esc_00000001");
  const otherHost: ArenaScreenHost = { lens: "requester", port: HOST.port };
  const htmlA = normalize(renderToString(createElement(OperationsScreen, { host: HOST, controller })));
  const htmlB = normalize(renderToString(createElement(OperationsScreen, { host: otherHost, controller })));
  assert.match(htmlA, /Viewing as operator/);
  assert.match(htmlB, /Viewing as requester/);
  assert.equal(
    htmlA.replace(/Viewing as operator/, "").replace(/data-arena-lens="operator"/, ""),
    htmlB.replace(/Viewing as requester/, "").replace(/data-arena-lens="requester"/, ""),
  );
});

test("registration wires the operations screen with zero ZCode branding", () => {
  const principal = DEMO_PRINCIPAL_TOKENS[0]?.principal ?? {
    tenant_id: "tnt_00000001",
    user_id: "usr_00000001",
  };
  const registration = operationsRegistration({
    audit: { timeline: async () => ({ kind: "FOUND", events: [] }) },
    principal,
  });
  assert.equal(registration.screen, "operations");
  assert.equal(registration.title, "Operations");
  const html = normalize(renderToString(registration.render(HOST) as never));
  assert.match(html, /data-arena-screen="operations"/);
  assert.doesNotMatch(html, /ZCode/i);
});

test("structural a11y: the operations surface carries roles, labels, and disabled semantics", () => {
  const html = render(makeController());
  assert.match(html, /aria-label="operations and governance"/);
  assert.match(html, /aria-label="release posture \(recorded truth\)"/);
  assert.match(html, /aria-label="restricted owner-gated actions"/);
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /<label for="arena-audit-escalation">/);
});
