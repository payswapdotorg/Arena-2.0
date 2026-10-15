import assert from "node:assert/strict";
import test from "node:test";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import {
  ARENA_DEFAULT_SCREEN,
  ARENA_PRODUCT_NAME,
  ARENA_RELEASE_POSTURE,
  ARENA_SCREEN_IDS,
} from "../../src/contract.js";
import { ArenaWordmark } from "../../src/identity/wordmark.js";
import {
  ArenaEmpty,
  ArenaError,
  ArenaLoading,
  ArenaPostureBar,
  ArenaWelcome,
} from "../../src/identity/statePatterns.js";
import {
  SCREEN_TITLE_VOCABULARY,
  appTitle,
  applyDocumentTitle,
  screenTitle,
} from "../../src/identity/productTitle.js";

/** renderToString 会往相邻文本节点之间插 <!-- --> 注释；断言前归一化。 */
function normalize(html: string): string {
  return html.replace(/<!--.*?-->/g, "");
}

test("wordmark renders the Arena product identity (not ZCode)", () => {
  const html = normalize(renderToString(createElement(ArenaWordmark, { size: 24 })));
  assert.ok(html.includes(ARENA_PRODUCT_NAME.toUpperCase()));
  assert.ok(html.includes("data-arena-wordmark"));
  assert.ok(!html.includes("ZCode"));
});

test("wordmark exposes an accessible label and honors custom labels", () => {
  const html = renderToString(createElement(ArenaWordmark, { size: 20, label: "Arena home" }));
  assert.ok(html.includes('aria-label="Arena home"'));
});

test("welcome state states the product mission and the honest posture", () => {
  const html = normalize(renderToString(createElement(ArenaWelcome)));
  assert.ok(html.includes(ARENA_PRODUCT_NAME));
  assert.ok(html.includes("capability-acquisition platform"));
  assert.ok(html.includes(`Release decision: ${ARENA_RELEASE_POSTURE.releaseDecision}`));
  assert.ok(!html.includes("ZCode"));
});

test("empty/loading/error states keep Arena identity and typed honesty", () => {
  const empty = normalize(
    renderToString(createElement(ArenaEmpty, { body: "No escalations yet" })),
  );
  assert.ok(empty.includes("No escalations yet"));

  const loading = normalize(renderToString(createElement(ArenaLoading, {})));
  assert.ok(loading.includes("Loading"));
  assert.ok(loading.includes('role="status"'));

  const error = renderToString(
    createElement(ArenaError, { detail: "409 conflict — attempt already submitted" }),
  );
  assert.ok(error.includes("409 conflict — attempt already submitted"));
  assert.ok(error.includes('role="alert"'));
  // 错误从不软化类型化细节
  assert.ok(!error.includes("retrying automatically"));
});

test("error state surfaces a retry affordance only when wired", () => {
  const without = normalize(renderToString(createElement(ArenaError, { detail: "x" })));
  assert.ok(!without.includes("Retry"));
  const withRetry = renderToString(createElement(ArenaError, { detail: "x", onRetry: () => {} }));
  assert.ok(withRetry.includes("Retry"));
});

test("posture bar renders the recorded basis verbatim", () => {
  const html = normalize(renderToString(createElement(ArenaPostureBar)));
  assert.ok(html.includes(ARENA_RELEASE_POSTURE.releaseDecision));
  assert.ok(html.includes(ARENA_RELEASE_POSTURE.financeMode));
  assert.ok(html.includes(ARENA_RELEASE_POSTURE.untrustedExecution));
});

test("screen titles cover the frozen vocabulary and lead with the product name", () => {
  for (const screen of ARENA_SCREEN_IDS) {
    assert.ok(SCREEN_TITLE_VOCABULARY[screen].length > 0, `title for ${screen}`);
    assert.ok(screenTitle(screen).startsWith(ARENA_PRODUCT_NAME));
  }
  assert.equal(appTitle(), ARENA_PRODUCT_NAME);
});

test("applyDocumentTitle sets and restores titles (no ZCode drift)", () => {
  // 无 DOM 环境下安全（typeof document 守卫）；有 jsdom 时验证真实往返
  if (typeof document === "undefined") {
    const restore = applyDocumentTitle(ARENA_DEFAULT_SCREEN);
    assert.equal(typeof restore, "function");
    restore();
    return;
  }
  const before = document.title;
  const restore = applyDocumentTitle("expert");
  assert.equal(document.title, screenTitle("expert"));
  restore();
  assert.equal(document.title, before);
});
