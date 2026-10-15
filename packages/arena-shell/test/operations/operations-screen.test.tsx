import assert from "node:assert/strict";
import test from "node:test";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import {
  CAPACITY_DISCLOSURE,
  CUSTODIAN_DISCLOSURE,
  DEAD_LETTER_DISCLOSURE,
  HEALTH_DISCLOSURE,
} from "@arena/ops";
import { providerStatusSchema } from "@arena/acquisition";
import { OperationsScreen } from "../../src/screens/operations/OperationsScreen.js";
import { operationsRegistration } from "../../src/screens/operations/registration.js";
import {
  OperationsController,
  type OperationsAuditPort,
} from "../../src/screens/operations/controller.js";
import * as postureModel from "../../src/screens/operations/postureModel.js";
import { DEMO_PRINCIPAL_TOKENS } from "@arena/workbench";
import type { ArenaScreenHost } from "../../src/contract.js";

/**
 * UIA-003 — 运维/治理渲染测试（RENDERED；真实 ops/acquisition 挂接面 +
 * posture 真相法断言 + 退役常量 GONE 断言）。
 * 真实探针聚合（node:sqlite / bwrap 实测）覆盖见 operations-real.test.tsx。
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

test("the HEALTH_DISCLOSURE renders verbatim and the unwired aggregate refuses to evaluate", () => {
  const html = render(makeController());
  assert.match(html, new RegExp(HEALTH_DISCLOSURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /no station probes wired at this composition root/);
  assert.match(html, /the aggregate over zero probes would claim ready, which this surface refuses to render as truth/);
  assert.match(html, /aria-label="run the readiness aggregate"/);
  assert.match(html, /aria-label="run the readiness aggregate".*disabled/s);
});

test("provider health renders the REAL ACQ1.0 provider status vocabulary 1:1", () => {
  const html = render(makeController());
  assert.deepEqual([...postureModel.PROVIDER_STATUSES], [...providerStatusSchema.options]);
  for (const status of providerStatusSchema.options) {
    assert.match(html, new RegExp(`data-status="${status}"`));
  }
  assert.match(html, /DEMO \/ FIXTURE \/ REAL/);
  assert.match(html, /@arena\/acquisition providerStatusSchema/);
  assert.doesNotMatch(html, /data-status="DEGRADED"/);
});

test("the retired ops fallback vocabulary is GONE (exports absent, copy absent)", () => {
  assert.equal("OPS_RESOLUTION_CONSTRAINT" in postureModel, false);
  assert.equal("PROVIDER_HEALTH_STATUSES" in postureModel, false);
  const html = render(makeController());
  assert.doesNotMatch(html, /is not resolvable\s+from @arena\/shell/);
  assert.doesNotMatch(html, /mount at TL integration/);
});

test("the capacity panel renders CAPACITY_DISCLOSURE verbatim over an EMPTY-labeled gauge", () => {
  const html = render(makeController());
  assert.match(html, new RegExp(CAPACITY_DISCLOSURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /EMPTY input \(no live outbox\/capsule feed is wired to this surface/);
  assert.match(html, /data-queue-lag-level="OK"/);
});

test("the dead-letter panel renders DEAD_LETTER_DISCLOSURE verbatim with the retained: true literal", () => {
  const html = render(makeController());
  assert.match(html, new RegExp(DEAD_LETTER_DISCLOSURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /data-dead-letter-retained="true"/);
  assert.match(html, /flagged \(attempts ≥ 5\)/);
});

test("the custodian panel renders CUSTODIAN_DISCLOSURE verbatim over an empty ledger", () => {
  const html = render(makeController());
  assert.match(html, new RegExp(CUSTODIAN_DISCLOSURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /ledger entries/);
  assert.match(html, /teardown drift/);
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

test("registration keeps the { audit, principal } call shape working with zero ZCode branding", () => {
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
  assert.match(html, /aria-label="aggregate readiness \(real probe semantics\)"/);
  assert.match(html, /aria-label="capacity \(quota fail-closed \+ queue lag gauge\)"/);
  assert.match(html, /aria-label="dead letters \(visibility over the durable outbox\)"/);
  assert.match(html, /aria-label="capsule custodian \(teardown drift \+ recovery\)"/);
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /<label for="arena-audit-escalation">/);
});
