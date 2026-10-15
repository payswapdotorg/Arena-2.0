import assert from "node:assert/strict";
import test from "node:test";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import {
  ARENA_DEFAULT_SCREEN,
  ARENA_PRODUCT_NAME,
  ARENA_RELEASE_POSTURE,
  type ArenaScreenRegistration,
} from "../../src/contract.js";
import { ArenaShell } from "../../src/shell/ArenaShell.js";
import { ArenaScreenRegistry } from "../../src/shell/registry.js";

function makeRegistry(...registrations: ArenaScreenRegistration[]): ArenaScreenRegistry {
  const registry = new ArenaScreenRegistry();
  for (const r of registrations) registry.register(r);
  return registry;
}

function renderShell(registry: ArenaScreenRegistry): string {
  return normalize(renderToString(createElement(ArenaShell, { registry })));
}

/** renderToString 会往相邻文本节点之间插 <!-- --> 注释；断言前归一化。 */
function normalize(html: string): string {
  return html.replace(/<!--.*?-->/g, "");
}

test("empty-registry shell renders honest unregistered refusals for every screen (never silence)", () => {
  const html = renderShell(new ArenaScreenRegistry());
  for (const marker of ["Screen not registered", "not registered", ARENA_PRODUCT_NAME]) {
    assert.ok(html.includes(marker), `expected "${marker}" in the rendered shell`);
  }
  assert.ok(
    html.includes(`screen &quot;${ARENA_DEFAULT_SCREEN}&quot;`),
    "the default screen refusal names the screen",
  );
});

test("registered screen renders through the registry host (port + lens reach the screen)", () => {
  const seen: unknown[] = [];
  const registry = makeRegistry({
    screen: "requester",
    title: "Requester",
    render: (host) => {
      seen.push({ screen: host.port.activeScreen(), lens: host.lens });
      return createElement("p", null, "REQUESTER-BODY");
    },
  });
  const html = renderShell(registry);
  assert.ok(html.includes("REQUESTER-BODY"));
  assert.deepEqual(seen, [{ screen: "requester", lens: "requester" }]);
});

test("shell renders the honest release posture verbatim (NOT_GO / test_mode / disabled)", () => {
  const html = renderShell(new ArenaScreenRegistry());
  assert.ok(html.includes(`Release decision: ${ARENA_RELEASE_POSTURE.releaseDecision}`));
  assert.ok(html.includes(`Finance: ${ARENA_RELEASE_POSTURE.financeMode}`));
  assert.ok(html.includes(`Untrusted execution: ${ARENA_RELEASE_POSTURE.untrustedExecution}`));
});

test("shell renders the full frozen screen vocabulary in the rail with ARIA semantics", () => {
  const html = renderShell(new ArenaScreenRegistry());
  for (const screen of ["requester", "expert", "reviewer", "developer", "operations"]) {
    assert.ok(html.includes(`data-arena-nav-item="${screen}"`), `rail item ${screen}`);
  }
  assert.ok(html.includes('role="tablist"'));
  assert.ok(html.includes('role="tab"'));
  assert.ok(html.includes('aria-current="page"'));
});

test("role lens switcher is presentation-only vocabulary (no authority language)", () => {
  const html = renderShell(new ArenaScreenRegistry());
  for (const lens of ["requester", "expert", "reviewer", "developer", "operator"]) {
    assert.ok(html.includes(`data-arena-lens="${lens}"`), `lens ${lens}`);
  }
  assert.ok(
    html.includes("presentation only"),
    "the lens group must disclose presentation-only semantics",
  );
  assert.ok(!html.includes("admin"), "no authority vocabulary in the lens group");
});

test("user-visible surfaces carry zero ZCode identity (the naming law)", () => {
  const html = renderShell(new ArenaScreenRegistry());
  for (const forbidden of ["ZCode", "zcode", "ZCODE"]) {
    assert.ok(!html.includes(forbidden), `ZCode identity leaked: ${forbidden}`);
  }
});

test("skip link and main landmark exist (keyboard path into content)", () => {
  const html = renderShell(new ArenaScreenRegistry());
  assert.ok(html.includes("Skip to main content"));
  assert.ok(html.includes('id="arena-main"'));
});

test("wordmark component is present in the brand position", () => {
  const html = renderShell(new ArenaScreenRegistry());
  assert.ok(html.includes("data-arena-wordmark"));
});
