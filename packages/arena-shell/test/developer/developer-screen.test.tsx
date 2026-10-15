import assert from "node:assert/strict";
import test from "node:test";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import * as contractReference from "../../src/screens/developer/contractReference.js";
import { DeveloperScreen } from "../../src/screens/developer/DeveloperScreen.js";
import { developerRegistration } from "../../src/screens/developer/registration.js";
import { DeveloperController } from "../../src/screens/developer/sdkMount.js";
import { providerRegistryViewModel } from "../../src/screens/developer/providerRegistry.js";
import {
  acquisitionRouteModeSchema,
  capabilityProviderDescriptorSchema,
  FALLBACK_CONSTRAINTS_RULE,
  pinnedProviderReferenceSchema,
  preferredRouteSchema,
  providerKindSchema,
  providerStatusSchema,
  sourceRightsPostureSchema,
  ACQUISITION_REQUEST_TENANT_RULE,
} from "@arena/acquisition";
import type { ArenaScreenHost } from "../../src/contract.js";

/**
 * UIA-003 — 开发者门户渲染测试（RENDERED；未接线组合根的真实默认态 +
 * 真实 ACQ1.0 词表枚举 + 退役常量 GONE 断言）。
 * 接线态（真实 SDK 绑定 + 真实 arena-api）覆盖见 developer-real.test.tsx。
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

const UNWIRED_CONTROLLER = new DeveloperController({ binding: null, principal: null });

function render(controller: DeveloperController = UNWIRED_CONTROLLER): string {
  return normalize(renderToString(createElement(DeveloperScreen, { host: HOST, controller })));
}

test("the portal renders the typed contract reference enumerated from the real schemas", () => {
  const html = render();
  assert.match(html, /Typed contract reference/);
  assert.match(html, /caller_idempotency_key/);
  assert.match(html, /delivery_preferences/);
  assert.match(html, /PARTIALLY_ACCEPTED/);
});

test("the webhook setup panel renders the canonical headers and idempotency semantics verbatim", () => {
  const html = render();
  assert.match(html, /x-idempotency-key/);
  assert.match(html, /replay the stored outcome; no second side effect/);
  assert.match(html, /sameKeyDifferentDigest/);
});

test("credential provisioning renders truthfully pending (never fake success)", () => {
  const html = render();
  assert.match(html, /disabled — no live provider at this base/);
  assert.match(contractReference.CREDENTIAL_PROVISIONING_DISCLOSURE, /truthfully\s+pending, never fake success/);
  assert.match(html, /truthfully pending, never fake success/);
});

test("delivery status rows render as labelled fixtures with verbatim semantics", () => {
  const html = render();
  assert.match(html, /FIXTURE rows/);
  assert.match(html, /DUPLICATE_IGNORED/);
});

test("the retired constraint constants are GONE (exports absent, copy absent)", () => {
  assert.equal("SDK_OPS_RESOLUTION_CONSTRAINT" in contractReference, false);
  assert.equal("PROVIDER_CONFIGURATION_CONSTRAINT" in contractReference, false);
  const html = render();
  assert.doesNotMatch(html, /not resolvable from @arena\/shell at this base/);
  assert.doesNotMatch(html, /not resolvable from this module at base/);
  assert.doesNotMatch(html, /mount at TL integration/);
});

test("the SDK mounts render the honest unwired state (never a fabricated client/tool/digest)", () => {
  const html = render();
  assert.match(html, /this\s+composition root wired no SDK binding/);
  assert.match(html, /never a fabricated client, tool invocation, or digest/);
  assert.match(html, /the portal never fabricates a tool surface/);
  assert.match(html, /no digest is fabricated/);
});

test("the SDK quickstart unwired inputs render disabled (truthful, never absent)", () => {
  const html = render();
  assert.match(html, /aria-label="run the SDK quickstart"/);
  assert.match(html, /aria-label="run the SDK quickstart".*disabled/s);
  assert.match(html, /not run yet — the outcomes below appear after a real run/);
});

test("the digest panel renders its exact semantics and canonical field list", () => {
  const html = render();
  assert.match(html, /sha256 \(hex\) of the canonical request subset/);
  assert.match(html, /independent of the server-side idempotency digest/);
  for (const field of ["task", "task_type", "acceptance_criteria", "constraints", "budget"]) {
    assert.match(html, new RegExp(`<code>${field}</code>`));
  }
});

test("the provider registry renders the real ACQ1.0 routing vocabulary 1:1 from the schemas", () => {
  const vm = providerRegistryViewModel();
  assert.deepEqual([...vm.routeModes], [...acquisitionRouteModeSchema.options]);
  assert.deepEqual([...vm.preferredRouteFields], Object.keys(preferredRouteSchema.shape));
  assert.deepEqual([...vm.pinnedReferenceFields], Object.keys(pinnedProviderReferenceSchema.shape));
  assert.deepEqual([...vm.descriptorFields], Object.keys(capabilityProviderDescriptorSchema.shape));
  assert.deepEqual([...vm.kinds], [...providerKindSchema.options]);
  assert.deepEqual([...vm.statuses], [...providerStatusSchema.options]);
  assert.deepEqual([...vm.rightsPostures], [...sourceRightsPostureSchema.options]);
  const html = render();
  assert.match(html, /PINNED_PROVIDER/);
  assert.match(html, /ANY_COMPATIBLE_PROVIDER/);
  assert.match(html, /AUTO/);
  assert.match(html, /SCRAPER/);
  assert.match(html, /EXTERNAL_API/);
  assert.match(html, /HUMAN_EXPERT/);
  assert.match(html, /DEPRECATED/);
  assert.match(html, /PERMITTED/);
  assert.match(html, /UNKNOWN/);
});

test("the provider registry renders the ACQ rules verbatim (fallback + tenant derivation)", () => {
  const html = render();
  assert.match(html, new RegExp(FALLBACK_CONSTRAINTS_RULE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, new RegExp(ACQUISITION_REQUEST_TENANT_RULE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("canonical transport headers carry the authorization/idempotency semantics", () => {
  const auth = contractReference.CANONICAL_TRANSPORT_HEADERS.find((h) => h.header === "authorization");
  assert.match(auth?.semantics ?? "", /never a UI role/);
  const idem = contractReference.CANONICAL_TRANSPORT_HEADERS.find((h) => h.header === "x-idempotency-key");
  assert.match(idem?.semantics ?? "", /apply-once, replay, or typed conflict/);
});

test("the portal renders the release posture verbatim (NOT_GO / test mode)", () => {
  const html = render();
  assert.match(html, /NOT_GO/);
  assert.match(html, /test mode only/);
});

test("lens is presentation only — the portal renders identically under another lens", () => {
  const otherHost: ArenaScreenHost = { lens: "operator", port: HOST.port };
  const htmlA = render();
  const htmlB = normalize(renderToString(createElement(DeveloperScreen, { host: otherHost, controller: UNWIRED_CONTROLLER })));
  assert.match(htmlA, /Viewing as developer/);
  assert.match(htmlB, /Viewing as operator/);
  assert.equal(
    htmlA.replace(/Viewing as developer/, "").replace(/data-arena-lens="developer"/, ""),
    htmlB.replace(/Viewing as operator/, "").replace(/data-arena-lens="operator"/, ""),
  );
});

test("registration keeps the no-arg call site working and wires zero ZCode branding", () => {
  const registration = developerRegistration();
  assert.equal(registration.screen, "developer");
  assert.equal(registration.title, "Developer");
  const html = normalize(renderToString(registration.render(HOST) as never));
  assert.match(html, /data-arena-screen="developer"/);
  assert.doesNotMatch(html, /ZCode/i);
});

test("structural a11y: the portal carries landmarks, labels, and disabled semantics", () => {
  const html = render();
  assert.match(html, /aria-label="developer portal"/);
  assert.match(html, /aria-label="typed request and result contract reference"/);
  assert.match(html, /aria-label="SDK quickstart \(real typed outcomes\)"/);
  assert.match(html, /aria-label="MCP facade tool surface \(read-only\)"/);
  assert.match(html, /aria-label="canonical request digest"/);
  assert.match(html, /aria-label="capability-provider registry \(read-only ACQ1\.0 vocabulary\)"/);
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /role="note"/);
});
