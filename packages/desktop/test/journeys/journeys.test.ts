import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { parseDesktopEntryMode } from "../../src/renderer/src/arenaDesktopMount.js";
import { startArenaApiFixtureServer, type ArenaApiFixture } from "./servers.js";
import {
  DesktopJourneyHarness,
  HOST_DIST_DIR,
  formatViolations,
  probeEnvironment,
  resolveAxeCore,
  writeTranscript,
  type DesktopHostPage,
} from "./harness.js";

/**
 * UIA-006 — desktop mounted-app browser journeys (issue #80): the WEB
 * journeys precedent (branding, navigation, keyboard, role lens, honest
 * states, responsive, axe) applied to the REAL DESKTOP shell.
 *
 * Every journey drives the REAL `buildArenaDesktopComposition` (consumed
 * AS-IS from src/renderer/src/arenaDesktopMount.ts) inside the REAL
 * `ArenaShell`, mounted in a REAL Electron renderer window with the
 * production security posture (contextIsolation: true, nodeIntegration:
 * false, sandbox: true, webviewTag: false — see electron-main.cjs), launched
 * through Playwright's _electron API under the station Xvfb.
 *
 * Honest postures, both real:
 *   - unconfigured baseUrl (no arenaBaseUrl query) → the port-0 sentinel law:
 *     typed TRANSPORT_ERROR / DOWN states rendered VERBATIM (no fake success);
 *   - configured baseUrl → a REAL local node:http arena-api fixture (CORS
 *     posture included — the renderer origin differs from the API origin):
 *     real tracking/timeline/result projections, the idempotent submit path
 *     (the shim-backed request digest), and the station probes mapping
 *     (a DOWN row fails the aggregate closed).
 *
 * Honest skip with reasons when the toolchain (playwright / electron / X
 * display / axe-core / the render-host bundle) is unresolvable — never a
 * silent pass. Evidence: transcripts + screenshots under
 * docs/evidence/ui/uia-006-desktop/**.
 */

const SCREENS = ["requester", "expert", "reviewer", "developer", "operations"] as const;

/** The dark :root recorded fallback for --arena-surface-app (#0f1115). */
const DARK_SURFACE_APP = "rgb(15, 17, 21)";
/** The light token group's --arena-surface-app (#f7f8fa — FROZEN calibration). */
const LIGHT_SURFACE_APP = "rgb(247, 248, 250)";

async function navigateTo(hostPage: DesktopHostPage, screen: string): Promise<void> {
  await hostPage.page.click(`[data-arena-nav-item="${screen}"]`);
  await hostPage.page.waitForSelector(`[data-arena-screen="${screen}"]`, { timeout: 5_000 });
}

async function visibleText(hostPage: DesktopHostPage): Promise<string> {
  return (await hostPage.page.locator("body").innerText()) ?? "";
}

async function computedSurface(hostPage: DesktopHostPage): Promise<string | null> {
  return hostPage.page.evaluate(() => {
    const shell = document.querySelector(".arena-shell");
    return shell instanceof HTMLElement ? window.getComputedStyle(shell).backgroundColor : null;
  });
}

async function closeQuietly(fixture: ArenaApiFixture): Promise<void> {
  await new Promise<void>((accept) => {
    fixture.server.close(() => accept());
  });
}

export async function registerDesktopJourneys(parent: TestContext): Promise<void> {
  const probe = await probeEnvironment();
  const missing: string[] = [];
  if (probe.playwrightVersion === null) {
    missing.push("playwright is not installed in this checkout");
  }
  if (!probe.electronPresent) {
    missing.push(
      `electron binary not resolvable (${probe.electronError ?? probe.electronExecutable ?? "unknown"})`,
    );
  }
  if (probe.xDisplay.display === null) {
    missing.push(
      `no X display answered the X11 handshake (probe: ${JSON.stringify(probe.xDisplay)})`,
    );
  }
  if (probe.axeCorePath === null) {
    missing.push("axe-core browser bundle is not resolvable");
  }
  if (!probe.shimParityOk) {
    missing.push(`renderer node:crypto shim parity FAILED: ${probe.shimParityError}`);
  }
  if (probe.shimParityOk && !probe.bundleBuildable) {
    missing.push(`render-host bundle build failed: ${probe.bundleBuildError ?? "unknown error"}`);
  }
  if (missing.length > 0) {
    parent.skip(
      `desktop journey toolchain NOT_SUPPORTED in this checkout (honest skip — probe: ${JSON.stringify({
        playwright: probe.playwrightVersion,
        electronPackage: probe.electronPackageVersion,
        electronExecutable: probe.electronExecutable,
        electronPresent: probe.electronPresent,
        xDisplay: probe.xDisplay,
        axeCore: probe.axeCoreVersion,
        esbuild: probe.esbuildVersion,
        shimParity: { ok: probe.shimParityOk, probes: probe.shimParityProbes },
        bundleBuildable: probe.bundleBuildable,
      })}) — ${missing.join("; ")}`,
    );
    return;
  }

  const harness = new DesktopJourneyHarness({
    axePath: resolveAxeCore(),
    electronPath: probe.electronExecutable as string,
    display: probe.xDisplay.display as string,
  });
  const fixture = await startArenaApiFixtureServer();
  const configuredPageUrl = () => `${harness.url}?arenaBaseUrl=${encodeURIComponent(fixture.url)}`;
  try {
    await harness.start(HOST_DIST_DIR);

    await parent.test("environment: toolchain + Electron runtime recorded (transcripts/environment.json)", async () => {
      const { app, hostPage } = await harness.launchApp({ pageUrl: harness.url });
      try {
        await hostPage.load();
        const versions = await harness.runtimeVersions(app);
        writeTranscript("environment.json", {
          kind: "desktop-browser-journey-environment",
          playwright: probe.playwrightVersion,
          electronPackage: probe.electronPackageVersion,
          electronExecutable: probe.electronExecutable,
          electronRuntime: {
            electron: versions.electron ?? null,
            chrome: versions.chrome ?? null,
            node: versions.node ?? null,
          },
          xDisplay: {
            chosen: probe.xDisplay.display,
            source: probe.xDisplay.source,
            candidates: probe.xDisplay.candidates,
          },
          axeCore: probe.axeCoreVersion,
          esbuild: probe.esbuildVersion,
          rendererShimParity: { ok: probe.shimParityOk, probes: probe.shimParityProbes },
          nodeCryptoSeam:
            "node:crypto aliased to the REAL renderer shim (packages/desktop/src/renderer/src/arenaNodeCryptoShim.ts) — the same alias treatment packages/desktop/vite.config.ts applies to the production renderer bundle",
          chromiumSandbox:
            "Playwright Linux default: --no-sandbox at the Chromium OS level (container constraints — disclosed); the RENDERER webPreferences keep the production posture (contextIsolation/nodeIntegration:false/sandbox/webviewTag:false)",
          host: "arena desktop journey render host (buildArenaDesktopComposition + REAL ArenaShell in a REAL Electron renderer)",
        });
      } finally {
        await app.close().catch(() => {});
      }
    });

    await parent.test("entry journey: plain entry → arena-first — the Arena shell IS the primary surface (five screens navigable)", async () => {
      // The honest shipped default posture: no arenaBaseUrl query — the shell
      // is still the primary surface (unconfigured ≠ broken).
      const { app, hostPage } = await harness.launchApp({ pageUrl: harness.url });
      try {
        await hostPage.load();
        const actualUrl = hostPage.page.url();
        // The REAL parseDesktopEntryMode on the ACTUAL loaded URL:
        assert.equal(
          parseDesktopEntryMode(new URL(actualUrl).search),
          "arena-first",
          "the REAL desktop entry predicate must resolve the plain entry to arena-first",
        );
        await hostPage.page.waitForSelector("[data-arena-screen='requester']", { timeout: 5_000 });
        for (const screen of SCREENS) {
          await navigateTo(hostPage, screen);
          assert.equal(
            await hostPage.page.getAttribute(`[data-arena-nav-item="${screen}"]`, "aria-selected"),
            "true",
            `${screen} must be the selected tab after navigation`,
          );
        }
        const html = await hostPage.page.content();
        assert.match(html, /role="tablist"/);
        assert.match(html, /aria-label="Arena primary navigation"/);
        assert.match(html, /data-arena-shell=""/);
        await harness.screenshot(hostPage, "desktop-entry-arena-first-operations");
        const axe = await harness.runAxe(hostPage, {
          journey: "entry",
          state: "arena-first-operations",
          viewport: "desktop",
        });
        assert.equal(axe.violations.length, 0, `axe violations:\n${formatViolations(axe)}`);
        writeTranscript("entry-arena-first-journey.json", {
          kind: "entry-predicate-journey",
          posture: "unconfigured (the honest shipped default — no arenaBaseUrl)",
          url: actualUrl,
          mode: parseDesktopEntryMode(new URL(actualUrl).search),
          screensNavigated: [...SCREENS],
          fiveScreenRegistry: true,
        });
      } finally {
        await app.close().catch(() => {});
      }
    });

    await parent.test("entry journey: ?workspace=1 → workspace-fallback — the REAL predicate + the honest fallback disclosure; the arena shell is absent", async () => {
      const observations: Array<{ query: string; url: string; mode: string; shellCount: number }> = [];
      for (const query of ["?workspace=1", "?app=workspace"]) {
        const { app, hostPage } = await harness.launchApp({ pageUrl: `${harness.url}${query}` });
        try {
          await hostPage.load();
          const actualUrl = hostPage.page.url();
          const mode = parseDesktopEntryMode(new URL(actualUrl).search);
          assert.equal(
            mode,
            "workspace-fallback",
            `the REAL parseDesktopEntryMode must resolve ${query} to workspace-fallback on the actual loaded URL`,
          );
          await hostPage.page.waitForSelector("[data-arena-journey-entry='workspace-fallback']", {
            timeout: 5_000,
          });
          const shellCount = await hostPage.page.locator("[data-arena-shell]").count();
          assert.equal(
            shellCount,
            0,
            "the Arena five-screen shell is NOT the primary surface on the fallback entry",
          );
          const text = await visibleText(hostPage);
          assert.match(text, /Inherited workspace — explicit fallback entry/);
          assert.match(text, /requires the full host service wiring/);
          assert.match(text, /data-arena-shell is absent by construction/);
          observations.push({ query, url: actualUrl, mode, shellCount });
          if (query === "?workspace=1") {
            await harness.screenshot(hostPage, "desktop-entry-workspace-fallback");
            const axe = await harness.runAxe(hostPage, {
              journey: "entry",
              state: "fallback-disclosure",
              viewport: "desktop",
            });
            assert.equal(axe.violations.length, 0, `axe violations:\n${formatViolations(axe)}`);
          }
        } finally {
          await app.close().catch(() => {});
        }
      }
      writeTranscript("entry-workspace-fallback-journey.json", {
        kind: "entry-predicate-journey",
        fallbackEntries: observations,
        honestDisclosure:
          "the inherited workspace is NOT mounted in the journey host (it requires the full host service wiring); the disclosure renders instead — no fake workspace",
      });
    });

    await parent.test("honest-states journey: unconfigured baseUrl → the typed TRANSPORT_ERROR / DOWN sentinel law renders VERBATIM (no fake success)", async () => {
      const { app, hostPage } = await harness.launchApp({ pageUrl: harness.url });
      try {
        await hostPage.load();
        await hostPage.page.waitForSelector("[data-arena-screen='requester']", { timeout: 5_000 });

        // 1) The submit path against the port-0 sentinel: the REAL form
        // (valid defaults + title/outcome) → typed TRANSPORT_ERROR verbatim.
        await hostPage.page.fill("#arena-form-title", "Journey probe: fix the failing build");
        await hostPage.page.fill(
          "#arena-form-outcome",
          "A typed transport failure must render verbatim on this screen (sentinel law).",
        );
        await hostPage.page.click("button.arena-submit");
        await hostPage.page.waitForSelector("[data-outcome='TRANSPORT_ERROR']", {
          timeout: 5_000,
        });
        const submitOutcome = await hostPage.page
          .locator("[data-outcome='TRANSPORT_ERROR']")
          .innerText();
        assert.match(
          submitOutcome,
          /^TRANSPORT_ERROR: network failure/u,
          "the submit outcome must render the typed sentinel failure verbatim",
        );

        // 2) Operations: the station probes against the sentinel — typed DOWN
        // rows, fail-closed aggregate (never a fabricated ready).
        await navigateTo(hostPage, "operations");
        await hostPage.page.click("form[aria-label='run the readiness aggregate'] button");
        await hostPage.page.waitForSelector("[data-probe-status]", { timeout: 5_000 });
        for (const probeId of ["station-persistence-node-sqlite", "station-isolation-bwrap"]) {
          assert.equal(
            await hostPage.page.getAttribute(`[data-probe='${probeId}']`, "data-probe-status"),
            "DOWN",
            `${probeId} must be DOWN against the unreachable sentinel`,
          );
        }
        assert.equal(
          await hostPage.page.locator("[data-readiness-ready]").getAttribute("data-readiness-ready"),
          "false",
        );
        assert.equal(
          await hostPage.page
            .locator("[data-readiness-fail-closed]")
            .getAttribute("data-readiness-fail-closed"),
          "true",
        );
        const opsText = await visibleText(hostPage);
        assert.match(opsText, /NOT ready — fail closed/u);
        assert.match(
          opsText,
          /station probe endpoint unreachable: http:\/\/127\.0\.0\.1:0\/v1\/ops\/station-probes/u,
          "the DOWN detail must name the unreachable sentinel endpoint verbatim",
        );

        // 3) The operations audit trail against the sentinel — the timeline
        // typed failure rendered verbatim.
        await hostPage.page.fill("#arena-audit-escalation", "esc_journey_unconfigured_0001");
        await hostPage.page.click("form[aria-label='audit trail lookup'] button");
        await hostPage.page.waitForSelector(".arena-ops-panel .arena-typed-error", {
          timeout: 5_000,
        });
        const auditError = await hostPage.page
          .locator(".arena-ops-panel .arena-typed-error")
          .innerText();
        assert.match(
          auditError,
          /^TRANSPORT_ERROR — network failure/u,
          "the audit trail must render the typed sentinel failure verbatim",
        );

        // Honest cleanliness law: the failures are TYPED and caught — zero
        // uncaught page errors (console transport noise is recorded verbatim
        // in the transcript, not silenced).
        assert.equal(
          hostPage.probe.pageErrors.length,
          0,
          `uncaught page errors: ${hostPage.probe.pageErrors.join("; ")}`,
        );
        await harness.screenshot(hostPage, "desktop-honest-unconfigured-operations");
        const axe = await harness.runAxe(hostPage, {
          journey: "honest-states",
          state: "operations-posture",
          viewport: "desktop",
        });
        assert.equal(axe.violations.length, 0, `axe violations:\n${formatViolations(axe)}`);
        writeTranscript("honest-states-journey.json", {
          kind: "honest-states-journey",
          posture: "unconfigured baseUrl — the port-0 sentinel (http://127.0.0.1:0)",
          submitOutcomeVerbatim: submitOutcome,
          auditTrailVerbatim: auditError,
          probeRows: ["station-persistence-node-sqlite:DOWN", "station-isolation-bwrap:DOWN"],
          aggregate: { ready: false, fail_closed: true },
          consoleErrors: hostPage.probe.consoleErrors,
          pageErrors: hostPage.probe.pageErrors,
        });
      } finally {
        await app.close().catch(() => {});
      }
    });

    await parent.test("configured journey: a REAL local arena-api fixture drives the requester projections, the idempotent submit and the fail-closed station probes", async () => {
      const { app, hostPage } = await harness.launchApp({ pageUrl: configuredPageUrl() });
      try {
        await hostPage.load();
        await hostPage.page.waitForSelector("[data-arena-screen='requester']", { timeout: 5_000 });

        // The tracking projection auto-loads on mount — REAL rows from the
        // fixture (real HTTP + real fetch + the real cross-origin posture).
        await hostPage.page.waitForSelector("[data-escalation='esc_journey_0001']", {
          timeout: 5_000,
        });
        await hostPage.page.waitForSelector("[data-escalation='esc_journey_0002']", {
          timeout: 5_000,
        });
        const listHit = fixture.observed.find(
          (entry) => entry.method === "GET" && entry.path === "/v1/escalations",
        );
        assert.ok(listHit, "the fixture must have observed GET /v1/escalations");
        assert.equal(
          listHit.authorization,
          "Bearer demo-token-requester-alpha",
          "the binding must resolve the demo-registry requester-alpha credentials",
        );

        // Select an escalation → the timeline + result projections render.
        await hostPage.page.locator(".arena-tracking-select").first().click();
        await hostPage.page.waitForSelector(".arena-timeline [data-event='EscalationCreated']", {
          timeout: 5_000,
        });
        const requesterText = await visibleText(hostPage);
        assert.match(requesterText, /EscalationAmendEscalation/);
        assert.match(requesterText, /EscalationVerifyRequested/);
        assert.match(requesterText, /ARENA_RESULT_NOT_AVAILABLE: result view not yet available/);
        assert.match(requesterText, /result views land with AR2-007/);

        // The idempotent submit path over real HTTP — the request digest is
        // computed by the REAL renderer node:crypto shim (the bundled seam).
        await hostPage.page.fill("#arena-form-title", "Journey probe: pricing-rule edge table");
        await hostPage.page.fill(
          "#arena-form-outcome",
          "The configured flow must submit through the real binding end to end.",
        );
        await hostPage.page.click("button.arena-submit");
        await hostPage.page.waitForSelector("[data-outcome='SUBMITTED']", { timeout: 5_000 });
        const submittedText = await hostPage.page
          .locator("[data-outcome='SUBMITTED']")
          .innerText();
        assert.match(submittedText, /Submitted esc_journey_0003 — server status CREATED/);
        const postHit = fixture.observed.find(
          (entry) => entry.method === "POST" && entry.path === "/v1/escalations",
        );
        assert.ok(postHit, "the fixture must have observed POST /v1/escalations");
        assert.equal(postHit.authorization, "Bearer demo-token-requester-alpha");
        assert.match(
          postHit.idempotencyKey ?? "",
          /^arena-shell-requester-\d+$/u,
          "the idempotency key must be the controller's envelope key",
        );
        assert.match(
          postHit.requestDigest ?? "",
          /^[0-9a-f]{64}$/u,
          "the request digest must be a 64-hex sha256 (the REAL renderer shim path)",
        );
        // The server projection is the source of truth: the tracking list now
        // carries the submitted escalation.
        await hostPage.page.waitForSelector("[data-escalation='esc_journey_0003']", {
          timeout: 5_000,
        });
        await harness.screenshot(hostPage, "desktop-configured-requester-tracking");
        const axeRequester = await harness.runAxe(hostPage, {
          journey: "configured",
          state: "requester-real-flow",
          viewport: "desktop",
        });
        assert.equal(
          axeRequester.violations.length,
          0,
          `axe violations:\n${formatViolations(axeRequester)}`,
        );

        // Operations: the station probes map the fixture rows verbatim — an
        // UP row + a DOWN row ⇒ the aggregate fails CLOSED (never ready).
        await navigateTo(hostPage, "operations");
        await hostPage.page.click("form[aria-label='run the readiness aggregate'] button");
        await hostPage.page.waitForSelector("[data-probe-status='UP']", { timeout: 5_000 });
        assert.equal(
          await hostPage.page.getAttribute(
            "[data-probe='station-persistence-node-sqlite']",
            "data-probe-status",
          ),
          "UP",
        );
        assert.equal(
          await hostPage.page.getAttribute("[data-probe='station-isolation-bwrap']", "data-probe-status"),
          "DOWN",
        );
        assert.equal(
          await hostPage.page.locator("[data-readiness-ready]").getAttribute("data-readiness-ready"),
          "false",
        );
        assert.equal(
          await hostPage.page
            .locator("[data-readiness-fail-closed]")
            .getAttribute("data-readiness-fail-closed"),
          "true",
        );
        const opsText = await visibleText(hostPage);
        assert.match(opsText, /NOT ready — fail closed/u);
        assert.match(
          opsText,
          /node:sqlite resolvable — the arena-persistence sqlite_reference_engine class \(journey fixture row\)/u,
        );
        assert.ok(
          fixture.stationProbeHits() >= 2,
          "each probe checks the endpoint live (per-dependency visibility law)",
        );

        // The audit trail loads the REAL timeline events from the fixture.
        await hostPage.page.fill("#arena-audit-escalation", "esc_journey_0001");
        await hostPage.page.click("form[aria-label='audit trail lookup'] button");
        await hostPage.page.waitForSelector(
          ".arena-ops-panel .arena-timeline [data-event='EscalationCreated']",
          { timeout: 5_000 },
        );

        await harness.screenshot(hostPage, "desktop-configured-operations-probes");
        const axeOps = await harness.runAxe(hostPage, {
          journey: "configured",
          state: "operations-probes",
          viewport: "desktop",
        });
        assert.equal(axeOps.violations.length, 0, `axe violations:\n${formatViolations(axeOps)}`);
        // The CORS-enabled real flow is clean end to end. ONE disclosed class
        // of console noise is expected: the browser AUTO-LOGS every non-2xx
        // response as "Failed to load resource: the server responded with a
        // status of 404" — and this journey INTENTIONALLY drives two typed
        // 404s (the result-view ARENA_RESULT_NOT_AVAILABLE stub, asserted as
        // visible text above; the honest legible-failure posture, not a
        // defect). Every OTHER console error is unexpected and fails the
        // journey; uncaught page errors fail unconditionally.
        const unexpectedConsoleErrors = hostPage.probe.consoleErrors.filter(
          (entry) =>
            !/^Failed to load resource: the server responded with a status of 404/u.test(entry),
        );
        assert.equal(
          unexpectedConsoleErrors.length,
          0,
          `unexpected console errors: ${unexpectedConsoleErrors.join("; ")}`,
        );
        assert.equal(
          hostPage.probe.pageErrors.length,
          0,
          `page errors: ${hostPage.probe.pageErrors.join("; ")}`,
        );
        writeTranscript("configured-flow-journey.json", {
          kind: "configured-flow-journey",
          baseUrl: fixture.url,
          observedRequests: fixture.observed,
          stationProbeHits: fixture.stationProbeHits(),
          submittedEscalations: fixture.escalations(),
          consoleNoiseDisclosure:
            "the browser's automatic resource-load log for the two intentionally-driven typed 404s (the result-view ARENA_RESULT_NOT_AVAILABLE stub) is recorded verbatim below and excluded from the cleanliness assertion; every other console error and every uncaught page error fails the journey",
          consoleErrors: hostPage.probe.consoleErrors,
          assertions: {
            trackingRows: ["esc_journey_0001", "esc_journey_0002", "esc_journey_0003"],
            submitOutcome: submittedText,
            probeRows: ["station-persistence-node-sqlite:UP", "station-isolation-bwrap:DOWN"],
            aggregate: { ready: false, fail_closed: true },
          },
        });
      } finally {
        await app.close().catch(() => {});
      }
    });

    await parent.test("navigation + keyboard journey: rail tablist semantics, roving tabindex (ArrowDown/Home/End), hash deep-links", async () => {
      const { app, hostPage } = await harness.launchApp({ pageUrl: configuredPageUrl() });
      try {
        await hostPage.load();
        await hostPage.page.waitForSelector("[data-arena-screen='requester']", { timeout: 5_000 });
        // Tab into the rail (past the skip link).
        await hostPage.page.keyboard.press("Tab");
        await hostPage.page.keyboard.press("Tab");
        let active = await hostPage.activeElement();
        assert.equal(active?.role, "tab");
        assert.equal(active?.text, "Requests");
        // ArrowDown moves AND navigates (the roving single-key semantics).
        await hostPage.page.keyboard.press("ArrowDown");
        active = await hostPage.activeElement();
        assert.equal(active?.text, "Expert work");
        await hostPage.page.waitForSelector("[data-arena-screen='expert']", { timeout: 5_000 });
        // End → the last screen; Home → back to the first.
        await hostPage.page.keyboard.press("End");
        active = await hostPage.activeElement();
        assert.equal(active?.text, "Operations");
        await hostPage.page.waitForSelector("[data-arena-screen='operations']", { timeout: 5_000 });
        await hostPage.page.keyboard.press("Home");
        active = await hostPage.activeElement();
        assert.equal(active?.text, "Requests");
        await hostPage.page.waitForSelector("[data-arena-screen='requester']", { timeout: 5_000 });
        // The focus ring is drawn on the wrapper layer (computed outline).
        const railFocus = await hostPage.page.evaluate(() => {
          const rail = document.querySelector(".arena-shell-rail");
          return rail instanceof HTMLElement ? window.getComputedStyle(rail).outlineStyle : "none";
        });
        assert.notEqual(railFocus, "none");
        // Tablist semantics on the real mounted shell:
        const html = await hostPage.page.content();
        assert.match(html, /role="tablist"/);
        assert.match(html, /aria-label="Arena primary navigation"/);
        assert.equal(
          await hostPage.page.getAttribute("[data-arena-nav-item='requester']", "aria-selected"),
          "true",
        );
        // Hash deep-link round-trip on the real Electron page:
        await hostPage.page.evaluate(() => {
          window.location.hash = "#/reviewer";
        });
        await hostPage.page.reload();
        await hostPage.load();
        await hostPage.page.waitForSelector("[data-arena-screen='reviewer']", { timeout: 5_000 });
        await harness.screenshot(hostPage, "desktop-reviewer-hash-deeplink");
        const axe = await harness.runAxe(hostPage, {
          journey: "navigation",
          state: "rail-roving",
          viewport: "desktop",
        });
        assert.equal(axe.violations.length, 0, `axe violations:\n${formatViolations(axe)}`);
      } finally {
        await app.close().catch(() => {});
      }
    });

    await parent.test("role-lens journey: switching lens is presentation only (content identity preserved)", async () => {
      const { app, hostPage } = await harness.launchApp({ pageUrl: configuredPageUrl() });
      try {
        await hostPage.load();
        await hostPage.page.waitForSelector("[data-arena-screen='requester']", { timeout: 5_000 });
        const before = await visibleText(hostPage);
        await hostPage.page.click('[data-arena-lens="expert"]');
        await hostPage.page.waitForSelector('.arena-lens-context[data-arena-lens="expert"]', {
          timeout: 5_000,
        });
        const after = await visibleText(hostPage);
        assert.match(after, /Viewing as expert/);
        // Presentation-invariance law: apart from the lens context line, the
        // main content is identical.
        const normalize = (t: string) =>
          t.replace(/Viewing as (requester|expert|reviewer|developer|operator)[^\n]*\n/u, "");
        assert.equal(normalize(after), normalize(before));
        await harness.screenshot(hostPage, "desktop-requester-expert-lens");
        const axe = await harness.runAxe(hostPage, {
          journey: "role-lens",
          state: "expert-lens",
          viewport: "desktop",
        });
        assert.equal(axe.violations.length, 0, `axe violations:\n${formatViolations(axe)}`);
      } finally {
        await app.close().catch(() => {});
      }
    });

    await parent.test("theme journey: the REAL arenaTheme observer recalibrates data-arena-theme — light AND dark computed surfaces, axe clean in both", async () => {
      const { app, hostPage } = await harness.launchApp({ pageUrl: configuredPageUrl() });
      try {
        await hostPage.load();
        await hostPage.page.waitForSelector("[data-arena-screen='requester']", { timeout: 5_000 });
        // Bootstrap posture: dark host classes → the observer resolved dark.
        assert.equal(
          await hostPage.page.evaluate(() => document.documentElement.getAttribute("data-arena-theme")),
          "dark",
        );
        assert.equal(await computedSurface(hostPage), DARK_SURFACE_APP);
        // Switch to light through the HOST theme classes — the real
        // MutationObserver recalibration path (UIA-005 wiring).
        await hostPage.page.evaluate(() => {
          document.documentElement.classList.remove("dark", "theme-zai-dark");
          document.documentElement.classList.add("theme-zai-light");
        });
        await hostPage.page.waitForSelector("html[data-arena-theme='light']", { timeout: 5_000 });
        assert.equal(await computedSurface(hostPage), LIGHT_SURFACE_APP);
        await navigateTo(hostPage, "operations");
        assert.equal(await computedSurface(hostPage), LIGHT_SURFACE_APP);
        await harness.screenshot(hostPage, "theme-light-desktop-operations");
        const axeLightOps = await harness.runAxe(hostPage, {
          journey: "theme-light",
          state: "operations",
          viewport: "desktop",
        });
        assert.equal(
          axeLightOps.violations.length,
          0,
          `axe violations (light, operations):\n${formatViolations(axeLightOps)}`,
        );
        await navigateTo(hostPage, "requester");
        await harness.screenshot(hostPage, "theme-light-desktop-requester");
        const axeLightReq = await harness.runAxe(hostPage, {
          journey: "theme-light",
          state: "requester",
          viewport: "desktop",
        });
        assert.equal(
          axeLightReq.violations.length,
          0,
          `axe violations (light, requester):\n${formatViolations(axeLightReq)}`,
        );
        // Switch back to dark — the same real path in reverse.
        await hostPage.page.evaluate(() => {
          document.documentElement.classList.remove("theme-zai-light");
          document.documentElement.classList.add("dark", "theme-zai-dark");
        });
        await hostPage.page.waitForSelector("html[data-arena-theme='dark']", { timeout: 5_000 });
        assert.equal(await computedSurface(hostPage), DARK_SURFACE_APP);
        await harness.screenshot(hostPage, "theme-dark-desktop-requester");
        const axeDark = await harness.runAxe(hostPage, {
          journey: "theme-dark",
          state: "requester",
          viewport: "desktop",
        });
        assert.equal(
          axeDark.violations.length,
          0,
          `axe violations (dark):\n${formatViolations(axeDark)}`,
        );
        writeTranscript("theme-journey.json", {
          kind: "theme-journey",
          activation:
            "host theme classes (dark / theme-zai-light / theme-zai-dark) toggled on documentElement — the REAL resolveArenaTheme + applyArenaTheme + observeArenaTheme recalibration path wired by the host (the UIA-005 recipe from the desktop renderer root)",
          computedSurfaces: {
            dark: DARK_SURFACE_APP,
            light: LIGHT_SURFACE_APP,
            darkAfterSwitchBack: DARK_SURFACE_APP,
          },
          scans: [
            { theme: "light", screen: "operations", violations: axeLightOps.violations.length },
            { theme: "light", screen: "requester", violations: axeLightReq.violations.length },
            { theme: "dark", screen: "requester", violations: axeDark.violations.length },
          ],
        });
      } finally {
        await app.close().catch(() => {});
      }
    });

    await parent.test("responsive journey: 1440×900 desktop + 390×844 narrow window — zero horizontal overflow", async () => {
      const results: Array<{ window: string; screen: string; overflow: number }> = [];
      const { app, hostPage } = await harness.launchApp({
        pageUrl: configuredPageUrl(),
        width: 1440,
        height: 900,
      });
      try {
        await hostPage.load();
        await hostPage.page.waitForSelector("[data-arena-screen='requester']", { timeout: 5_000 });
        const overflowRequester = await hostPage.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.equal(overflowRequester, 0, `horizontal overflow of ${overflowRequester}px at 1440×900`);
        results.push({ window: "1440x900", screen: "requester", overflow: overflowRequester });
        await navigateTo(hostPage, "developer");
        const overflowDeveloper = await hostPage.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.equal(
          overflowDeveloper,
          0,
          `horizontal overflow of ${overflowDeveloper}px on the developer portal at 1440×900`,
        );
        results.push({ window: "1440x900", screen: "developer", overflow: overflowDeveloper });
      } finally {
        await app.close().catch(() => {});
      }
      const { app: narrowApp, hostPage: narrowPage } = await harness.launchApp({
        pageUrl: configuredPageUrl(),
        width: 390,
        height: 844,
      });
      try {
        await narrowPage.load();
        await narrowPage.page.waitForSelector("[data-arena-screen='requester']", {
          timeout: 5_000,
        });
        const overflowNarrow = await narrowPage.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.equal(overflowNarrow, 0, `horizontal overflow of ${overflowNarrow}px at 390×844`);
        results.push({ window: "390x844", screen: "requester", overflow: overflowNarrow });
        await navigateTo(narrowPage, "developer");
        const overflowNarrowDeveloper = await narrowPage.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.equal(
          overflowNarrowDeveloper,
          0,
          `horizontal overflow of ${overflowNarrowDeveloper}px on the developer portal at 390×844`,
        );
        results.push({ window: "390x844", screen: "developer", overflow: overflowNarrowDeveloper });
        await harness.screenshot(narrowPage, "mobile-developer-portal");
        const axe = await harness.runAxe(narrowPage, {
          journey: "responsive",
          state: "developer-narrow",
          viewport: "mobile",
        });
        assert.equal(axe.violations.length, 0, `axe violations:\n${formatViolations(axe)}`);
        writeTranscript("responsive-journey.json", {
          kind: "responsive-journey",
          windows: results,
          narrowWindowSize: { width: 390, height: 844, useContentSize: true },
        });
      } finally {
        await narrowApp.close().catch(() => {});
      }
    });

    await parent.test("branding journey: the document-title law, the Arena wordmark, zero user-visible ZCode", async () => {
      const { app, hostPage } = await harness.launchApp({ pageUrl: configuredPageUrl() });
      try {
        await hostPage.load();
        await hostPage.page.waitForSelector("[data-arena-screen='requester']", { timeout: 5_000 });
        // The REAL identity law: composition.applyTitle() → applyDocumentTitle.
        const title = await hostPage.page.title();
        assert.equal(title, "Arena — Requester cockpit");
        await hostPage.page.waitForSelector("[data-arena-wordmark]", { timeout: 5_000 });
        const text = await visibleText(hostPage);
        assert.match(text, /Requests/);
        assert.match(text, /Compose a capability-gap request/);
        assert.match(text, /Routing transparency/);
        assert.match(text, /NOT_GO/);
        assert.match(text, /test_mode/);
        // Zero ZCode in the user-visible surface (the branding sweep law).
        assert.doesNotMatch(text, /ZCode/iu);
        const html = await hostPage.page.content();
        assert.match(html, /data-arena-shell=""/);
        await harness.screenshot(hostPage, "desktop-branding-fresh-launch");
        const axe = await harness.runAxe(hostPage, {
          journey: "branding",
          state: "fresh-launch",
          viewport: "desktop",
        });
        assert.equal(axe.violations.length, 0, `axe violations:\n${formatViolations(axe)}`);
        assert.equal(
          hostPage.probe.consoleErrors.length,
          0,
          `console errors: ${hostPage.probe.consoleErrors.join("; ")}`,
        );
        assert.equal(
          hostPage.probe.pageErrors.length,
          0,
          `page errors: ${hostPage.probe.pageErrors.join("; ")}`,
        );
        writeTranscript("branding-journey.json", {
          kind: "branding-journey",
          documentTitle: title,
          titleLaw:
            "applyDocumentTitle applied once at mount by the composition root (the real desktop law); the title stays Arena-prefixed across screens",
          zeroZcodeSweep: true,
          wordmarkPresent: true,
        });
      } finally {
        await app.close().catch(() => {});
      }
    });

    await parent.test("summary: aggregate scan transcript (transcripts/summary.json)", async () => {
      writeTranscript("summary.json", {
        kind: "desktop-browser-journey-summary",
        scans: harness.scans,
        totalScans: harness.scans.length,
        totalViolations: harness.scans.reduce((sum, scan) => sum + scan.violations, 0),
      });
      assert.equal(
        harness.scans.reduce((sum, scan) => sum + scan.violations, 0),
        0,
        "aggregate axe violations must be zero across all desktop journeys",
      );
    });
  } finally {
    await harness.stop();
    await closeQuietly(fixture);
  }
}

test("UIA-006 desktop browser journeys (REAL Electron renderer × REAL desktop composition: entry predicate + honest states + configured flow + navigation/keyboard + lens + theme + responsive + branding + axe)", async (t) => {
  await registerDesktopJourneys(t);
});
