import assert from "node:assert/strict";
import test from "node:test";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import {
  DeveloperScreen,
} from "../../src/screens/developer/DeveloperScreen.js";
import { developerRegistration } from "../../src/screens/developer/registration.js";
import {
  CANONICAL_TRANSPORT_HEADERS,
  CREDENTIAL_PROVISIONING_DISCLOSURE,
  PROVIDER_CONFIGURATION_CONSTRAINT,
  SDK_OPS_RESOLUTION_CONSTRAINT,
} from "../../src/screens/developer/contractReference.js";
import type { ArenaScreenHost } from "../../src/contract.js";

/**
 * UIA-001 Lane C — 开发者门户渲染测试（RENDERED；参考面 + 诚实约束）。
 * 纯 schema 枚举断言见 reviewer-model.test.ts（同一 contractReference 面）。
 */

function normalize(html: string): string {
  return html.replace(/<!--.*?-->/g, "");
}

const HOST: ArenaScreenHost = {
  lens: "developer",
  port: {
    navigate: () => ({ kind: "navigated", screen: "developer" }),
    activeScreen: () => "developer",
  },
};

test("the portal renders the typed contract reference enumerated from the real schemas", () => {
  const html = normalize(renderToString(createElement(DeveloperScreen, { host: HOST })));
  assert.match(html, /Typed contract reference/);
  assert.match(html, /caller_idempotency_key/);
  assert.match(html, /delivery_preferences/);
  assert.match(html, /PARTIALLY_ACCEPTED/);
});

test("the webhook setup panel renders the canonical headers and idempotency semantics verbatim", () => {
  const html = normalize(renderToString(createElement(DeveloperScreen, { host: HOST })));
  assert.match(html, /x-idempotency-key/);
  assert.match(html, /replay the stored outcome; no second side effect/);
  assert.match(html, /sameKeyDifferentDigest/);
});

test("credential provisioning renders truthfully pending (never fake success)", () => {
  const html = normalize(renderToString(createElement(DeveloperScreen, { host: HOST })));
  assert.match(html, /disabled — no live provider at this base/);
  assert.match(CREDENTIAL_PROVISIONING_DISCLOSURE, /truthfully\s+pending, never fake success/);
});

test("delivery status rows render as labelled fixtures with verbatim semantics", () => {
  const html = normalize(renderToString(createElement(DeveloperScreen, { host: HOST })));
  assert.match(html, /FIXTURE rows/);
  assert.match(html, /DUPLICATE_IGNORED/);
});

test("the provider configuration panel renders the read-only routing vocabulary with the constraint", () => {
  const html = normalize(renderToString(createElement(DeveloperScreen, { host: HOST })));
  assert.match(html, /human expert/);
  assert.match(html, /approved external API/);
  assert.match(PROVIDER_CONFIGURATION_CONSTRAINT, /@arena\/acquisition \(not resolvable from this module at base\)/);
});

test("the SDK/OPS resolution constraint renders honestly on the portal", () => {
  const html = normalize(renderToString(createElement(DeveloperScreen, { host: HOST })));
  assert.match(html, /not resolvable from @arena\/shell at this base/);
  assert.match(SDK_OPS_RESOLUTION_CONSTRAINT, /mount at TL integration/);
});

test("canonical transport headers carry the authorization/idempotency semantics", () => {
  const auth = CANONICAL_TRANSPORT_HEADERS.find((h) => h.header === "authorization");
  assert.match(auth?.semantics ?? "", /never a UI role/);
  const idem = CANONICAL_TRANSPORT_HEADERS.find((h) => h.header === "x-idempotency-key");
  assert.match(idem?.semantics ?? "", /apply-once, replay, or typed conflict/);
});

test("the portal renders the release posture verbatim (NOT_GO / test mode)", () => {
  const html = normalize(renderToString(createElement(DeveloperScreen, { host: HOST })));
  assert.match(html, /NOT_GO/);
  assert.match(html, /test mode only/);
});

test("lens is presentation only — the portal renders identically under another lens", () => {
  const otherHost: ArenaScreenHost = { lens: "operator", port: HOST.port };
  const htmlA = normalize(renderToString(createElement(DeveloperScreen, { host: HOST })));
  const htmlB = normalize(renderToString(createElement(DeveloperScreen, { host: otherHost })));
  assert.match(htmlA, /Viewing as developer/);
  assert.match(htmlB, /Viewing as operator/);
  assert.equal(
    htmlA.replace(/Viewing as developer/, "").replace(/data-arena-lens="developer"/, ""),
    htmlB.replace(/Viewing as operator/, "").replace(/data-arena-lens="operator"/, ""),
  );
});

test("registration wires the developer portal with zero ZCode branding", () => {
  const registration = developerRegistration();
  assert.equal(registration.screen, "developer");
  assert.equal(registration.title, "Developer");
  const html = normalize(renderToString(registration.render(HOST) as never));
  assert.match(html, /data-arena-screen="developer"/);
  assert.doesNotMatch(html, /ZCode/i);
});

test("structural a11y: the portal carries landmarks, labels, and disabled semantics", () => {
  const html = normalize(renderToString(createElement(DeveloperScreen, { host: HOST })));
  assert.match(html, /aria-label="developer portal"/);
  assert.match(html, /aria-label="typed request and result contract reference"/);
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /role="note"/);
});
