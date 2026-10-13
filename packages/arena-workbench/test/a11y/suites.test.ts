import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import {
  A11yHarness,
  AXE_RULE_TAGS,
  formatViolations,
  probeEnvironment,
  resolveAxeCore,
  writeTranscript,
} from "./harness.js";
import { registerAxeJourneys } from "./axe-journeys.test.js";
import { registerKeyboardJourneys } from "./keyboard-journeys.test.js";

/**
 * AR2-021 — accessibility E2E suite registration.
 *
 * Probes the toolchain (honest NOT_SUPPORTED skip — never a fake pass), then
 * registers under the parent test:
 *   - environment transcript (versions recorded from the live run)
 *   - 4 axe journeys on rendered, interacted states (16 desktop states)
 *   - 4 keyboard-only journeys (focus + announcements asserted per step)
 *   - responsive pass at 375×667 (4 representative states + overflow check)
 *   - aggregate summary transcript
 */

export async function registerA11ySuites(parent: TestContext): Promise<void> {
  const probe = await probeEnvironment();
  const missing: string[] = [];
  if (probe.playwrightVersion === null) {
    missing.push("playwright is not installed in this checkout");
  }
  if (!probe.chromiumPresent) {
    missing.push(
      `chromium executable not found at ${probe.chromiumExecutable} (install with: pnpm --filter @arena/workbench a11y:install-browser)`,
    );
  }
  if (probe.axeCorePath === null) {
    missing.push("axe-core browser bundle is not resolvable");
  }
  if (probe.chromiumPresent && probe.axeCorePath !== null && !probe.bundleBuildable) {
    missing.push(`render-host bundle build failed: ${probe.bundleBuildError ?? "unknown error"}`);
  }
  if (missing.length > 0) {
    parent.skip(
      `a11y toolchain NOT_SUPPORTED in this checkout (honest skip — probe: ${JSON.stringify({
        playwright: probe.playwrightVersion,
        chromiumExecutable: probe.chromiumExecutable,
        chromiumPresent: probe.chromiumPresent,
        axeCore: probe.axeCoreVersion,
        esbuild: probe.esbuildVersion,
      })}) — ${missing.join("; ")}`,
    );
    return;
  }

  const harness = new A11yHarness(resolveAxeCore());
  try {
    await harness.start();

    await parent.test("environment: toolchain recorded (transcripts/environment.json)", async () => {
      writeTranscript("environment.json", {
        kind: "environment",
        generatedAt: new Date().toISOString(),
        node: process.version,
        platform: `${process.platform} ${process.arch}`,
        playwright: probe.playwrightVersion,
        chromium: harness.chromiumVersion(),
        chromiumExecutable: probe.chromiumExecutable,
        axeCore: probe.axeCoreVersion,
        axeRuleTags: AXE_RULE_TAGS,
        esbuild: probe.esbuildVersion,
        renderHost:
          "esbuild IIFE bundle of the workbench public entry (src/contract.ts) served over local HTTP",
      });
    });

    await registerAxeJourneys(parent, harness);
    await registerKeyboardJourneys(parent, harness);

    // ---------------------------------------------------------------
    // responsive pass — representative state per journey at 375×667
    // ---------------------------------------------------------------
    await parent.test("responsive: mobile viewport (375×667) — axe clean + no horizontal overflow", async () => {
      const mobileCases: Array<{
        journey: string;
        state: string;
        lens?: string;
      }> = [
        { journey: "requester", state: "empty" },
        { journey: "expert", state: "queue-pristine", lens: "expert" },
        { journey: "reviewer", state: "deck-pending", lens: "reviewer" },
        { journey: "payout", state: "pending" },
      ];
      for (const mobileCase of mobileCases) {
        const hostPage = await harness.newPage({ width: 375, height: 667 });
        await hostPage.load(harness.url);
        if (mobileCase.lens !== undefined) {
          await hostPage.page.click(`[data-lens='${mobileCase.lens}']`);
          await hostPage.page.waitForSelector(".site-main section");
        }
        const result = await harness.runAxe(hostPage, {
          journey: mobileCase.journey,
          state: mobileCase.state,
          viewport: "mobile-375",
        });
        assert.equal(
          result.violations.length,
          0,
          `${mobileCase.journey}/${mobileCase.state} @375px — ${formatViolations(result)}`,
        );
        const overflow = await hostPage.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.ok(
          overflow <= 0,
          `${mobileCase.journey}/${mobileCase.state} @375px overflows horizontally by ${overflow}px`,
        );
        await hostPage.page.close();
      }
    });

    // ---------------------------------------------------------------
    // summary transcript
    // ---------------------------------------------------------------
    await parent.test("summary: aggregate counts (transcripts/summary.json)", async () => {
      const totalScans = harness.scans.length;
      const totalViolations = harness.scans.reduce((count, scan) => count + scan.violations, 0);
      writeTranscript("summary.json", {
        kind: "run-summary",
        generatedAt: new Date().toISOString(),
        journeys: 4,
        axeScans: totalScans,
        axeScansDesktop: harness.scans.filter((scan) => scan.viewport === "desktop").length,
        axeScansMobile: harness.scans.filter((scan) => scan.viewport !== "desktop").length,
        totalViolations,
        keyboardJourneys: 4,
        perScan: harness.scans,
      });
      assert.equal(totalViolations, 0);
      assert.equal(totalScans, 20);
    });
  } finally {
    await harness.stop();
  }
}
