import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import {
  JourneyHarness,
  formatViolations,
  probeEnvironment,
  resolveAxeCore,
  writeTranscript,
  type HostPage,
} from "./harness.js";

/**
 * UIA-001 — browser journeys on the REAL mounted shell (Arena branding,
 * navigation, keyboard, role lens, truthful posture, honest states,
 * responsive, axe) — the AR2-021 precedent applied to the shell, closing the
 * lanes' PENDING-station browser item at TL integration.
 */

const SCREENS = ["requester", "expert", "reviewer", "developer", "operations"] as const;

async function navigateTo(hostPage: HostPage, screen: string): Promise<void> {
  await hostPage.page.click(`[data-arena-nav-item="${screen}"]`);
  await hostPage.page.waitForSelector(`[data-arena-screen="${screen}"]`, { timeout: 5_000 });
}

async function visibleText(hostPage: HostPage): Promise<string> {
  return (await hostPage.page.locator("body").innerText()) ?? "";
}

export async function registerBrowserJourneys(parent: TestContext): Promise<void> {
  const probe = await probeEnvironment();
  const missing: string[] = [];
  if (probe.playwrightVersion === null) {
    missing.push("playwright is not installed in this checkout");
  }
  if (!probe.chromiumPresent) {
    missing.push(
      `chromium executable not found at ${probe.chromiumExecutable} (install with: pnpm --filter @arena/shell a11y:install-browser)`,
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
      `browser journey toolchain NOT_SUPPORTED in this checkout (honest skip — probe: ${JSON.stringify({
        playwright: probe.playwrightVersion,
        chromiumExecutable: probe.chromiumExecutable,
        chromiumPresent: probe.chromiumPresent,
        axeCore: probe.axeCoreVersion,
        esbuild: probe.esbuildVersion,
      })}) — ${missing.join("; ")}`,
    );
    return;
  }

  const harness = new JourneyHarness(resolveAxeCore());
  try {
    await harness.start();

    await parent.test("environment: toolchain recorded (transcripts/environment.json)", async () => {
      writeTranscript("environment.json", {
        kind: "browser-journey-environment",
        playwright: probe.playwrightVersion,
        chromium: harness.chromiumVersion(),
        chromiumExecutable: probe.chromiumExecutable,
        axeCore: probe.axeCoreVersion,
        esbuild: probe.esbuildVersion,
        host: "arena-shell render host (ArenaShell + five registrations)",
      });
    });

    await parent.test("branding journey: fresh launch is unmistakably Arena (zero user-visible ZCode)", async () => {
      const page = await harness.newPage({ width: 1440, height: 900 });
      await page.load(harness.url);
      await page.page.waitForSelector("[data-arena-screen='requester']", { timeout: 5_000 });
      const text = await visibleText(page);
      assert.match(text, /Requests/);
      assert.match(text, /Compose a capability-gap request/);
      assert.match(text, /Routing transparency/);
      // 用户可见面零 ZCode 品牌（合法署名除外 —— 本面不渲染任何 ZCode 字样）。
      assert.doesNotMatch(text, /ZCode/i);
      // Arena 身份：wordmark 挂载 + 姿态条逐字。
      await page.page.waitForSelector("[data-arena-wordmark]", { timeout: 5_000 });
      assert.match(text, /NOT_GO/);
      assert.match(text, /test_mode/);
      const html = await page.page.content();
      assert.match(html, /data-arena-shell=""/);
      await harness.screenshot(page, "desktop-requester-fresh-launch");
      // 真浏览器键盘/焦点（AR2-021 类 —— lanes 的 PENDING-station 在此闭合）。
      const axe = await harness.runAxe(page, { journey: "branding", state: "fresh-launch", viewport: "desktop" });
      assert.equal(axe.violations.length, 0, `axe violations:\n${formatViolations(axe)}`);
      assert.equal(page.probe.consoleErrors.length, 0, `console errors: ${page.probe.consoleErrors.join("; ")}`);
      assert.equal(page.probe.pageErrors.length, 0, `page errors: ${page.probe.pageErrors.join("; ")}`);
    });

    await parent.test("navigation journey: rail tablist semantics + all five screens reachable", async () => {
      const page = await harness.newPage({ width: 1440, height: 900 });
      await page.load(harness.url);
      for (const screen of SCREENS) {
        await navigateTo(page, screen);
        const active = await page.page.getAttribute(`[data-arena-nav-item="${screen}"]`, "aria-selected");
        assert.equal(active, "true");
      }
      const html = await page.page.content();
      assert.match(html, /role="tablist"/);
      assert.match(html, /aria-label="Arena primary navigation"/);
      await harness.screenshot(page, "desktop-operations-after-full-navigation");
      const axe = await harness.runAxe(page, { journey: "navigation", state: "operations", viewport: "desktop" });
      assert.equal(axe.violations.length, 0, `axe violations:\n${formatViolations(axe)}`);
    });

    await parent.test("hash deep-link journey: #/<screenId> round-trips on the real mount", async () => {
      const page = await harness.newPage({ width: 1440, height: 900 });
      await page.load(harness.url);
      await page.page.evaluate(() => {
        window.location.hash = "#/reviewer";
      });
      await page.page.reload();
      await page.page.waitForSelector("[data-arena-screen='reviewer']", { timeout: 5_000 });
      await harness.screenshot(page, "desktop-reviewer-hash-deeplink");
    });

    await parent.test("keyboard journey: roving tabindex rail (arrows/Home/End) with visible focus", async () => {
      const page = await harness.newPage({ width: 1440, height: 900 });
      await page.load(harness.url);
      await page.page.waitForSelector("[data-arena-screen='requester']", { timeout: 5_000 });
      // Tab 进入轨道（跳过 skip-link 之后）。
      await page.page.keyboard.press("Tab");
      await page.page.keyboard.press("Tab");
      let active = await page.activeElement();
      assert.equal(active?.role, "tab");
      assert.equal(active?.text, "Requests");
      // ArrowDown 移动即导航（roving tabindex 单键语义）。
      await page.page.keyboard.press("ArrowDown");
      active = await page.activeElement();
      assert.equal(active?.text, "Expert work");
      await page.page.waitForSelector("[data-arena-screen='expert']", { timeout: 5_000 });
      // End → 最后一个屏；Home → 回到第一个。
      await page.page.keyboard.press("End");
      active = await page.activeElement();
      assert.equal(active?.text, "Operations");
      await page.page.waitForSelector("[data-arena-screen='operations']", { timeout: 5_000 });
      await page.page.keyboard.press("Home");
      active = await page.activeElement();
      assert.equal(active?.text, "Requests");
      await page.page.waitForSelector("[data-arena-screen='requester']", { timeout: 5_000 });
      // 焦点环画在包装层（继承技法 —— 轨道容器带 outline 断言走 computed style）。
      const railFocus = await page.page.evaluate(() => {
        const rail = document.querySelector(".arena-shell-rail");
        return rail instanceof HTMLElement ? window.getComputedStyle(rail).outlineStyle : "none";
      });
      assert.notEqual(railFocus, "none");
      const axe = await harness.runAxe(page, { journey: "keyboard", state: "rail-roving", viewport: "desktop" });
      assert.equal(axe.violations.length, 0, `axe violations:\n${formatViolations(axe)}`);
    });

    await parent.test("role-lens journey: switching lens is presentation only (content identity preserved)", async () => {
      const page = await harness.newPage({ width: 1440, height: 900 });
      await page.load(harness.url);
      await page.page.waitForSelector("[data-arena-screen='requester']", { timeout: 5_000 });
      const before = await visibleText(page);
      await page.page.click('[data-arena-lens="expert"]');
      await page.page.waitForSelector('.arena-lens-context[data-arena-lens="expert"]', { timeout: 5_000 });
      const after = await visibleText(page);
      assert.match(after, /Viewing as expert/);
      // 呈现不变法：除透镜上下文行外，主体内容保持恒等。
      const normalize = (t: string) => t.replace(/Viewing as (requester|expert|reviewer|developer|operator)[^\n]*\n/, "");
      assert.equal(normalize(after), normalize(before));
      await harness.screenshot(page, "desktop-requester-expert-lens");
    });

    await parent.test("honest-states journey: expert queue loads typed facts; operations posture verbatim", async () => {
      const page = await harness.newPage({ width: 1440, height: 900 });
      await page.load(harness.url);
      await navigateTo(page, "expert");
      await page.page.waitForSelector(".arena-queue-select", { timeout: 5_000 });
      const expertText = await visibleText(page);
      assert.match(expertText, /DEMO data/);
      // 选择一个 attempt 打开工作区（任务上下文 + 胶囊入口）。
      await page.page.click(".arena-queue-select");
      await page.page.waitForSelector(".arena-task-context", { timeout: 5_000 });
      const workspaceText = await visibleText(page);
      assert.match(workspaceText, /Capsule entry/);
      assert.match(workspaceText, /disabled/);
      await navigateTo(page, "operations");
      await page.page.waitForSelector("[data-posture-decision='true']", { timeout: 5_000 });
      const opsText = await visibleText(page);
      assert.match(opsText, /NOT_GO/);
      assert.match(opsText, /test_mode/);
      assert.match(opsText, /disabled/);
      assert.match(opsText, /AR2-015-gate-report-2026-10-11\.md/);
      await harness.screenshot(page, "desktop-operations-posture");
      const axe = await harness.runAxe(page, { journey: "honest-states", state: "operations-posture", viewport: "desktop" });
      assert.equal(axe.violations.length, 0, `axe violations:\n${formatViolations(axe)}`);
    });

    await parent.test("reviewer journey: evidence-first deck with the never-a-vote self-eval section", async () => {
      const page = await harness.newPage({ width: 1440, height: 900 });
      await page.load(harness.url);
      await navigateTo(page, "reviewer");
      await page.page.waitForSelector(".arena-queue-select", { timeout: 5_000 });
      await page.page.click(".arena-queue-select");
      await page.page.waitForSelector(".arena-criteria-table", { timeout: 5_000 });
      const text = await visibleText(page);
      assert.match(text, /Verification trail/);
      assert.match(text, /never a vote/);
      assert.match(text, /withheld from the reviewer surface \(count only/);
      await harness.screenshot(page, "desktop-reviewer-deck");
      const axe = await harness.runAxe(page, { journey: "reviewer", state: "deck-open", viewport: "desktop" });
      assert.equal(axe.violations.length, 0, `axe violations:\n${formatViolations(axe)}`);
    });

    await parent.test("responsive journey: 390×844 mobile — no horizontal overflow, rail collapses", async () => {
      const page = await harness.newPage({ width: 390, height: 844 });
      await page.load(harness.url);
      await page.page.waitForSelector("[data-arena-screen='requester']", { timeout: 5_000 });
      const overflow = await page.page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.equal(overflow, 0, `horizontal overflow of ${overflow}px at 390×844`);
      await navigateTo(page, "developer");
      const overflowDev = await page.page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.equal(overflowDev, 0, `horizontal overflow of ${overflowDev}px on the developer portal at 390×844`);
      await harness.screenshot(page, "mobile-developer-portal");
      const axe = await harness.runAxe(page, { journey: "responsive", state: "developer-mobile", viewport: "mobile" });
      assert.equal(axe.violations.length, 0, `axe violations:\n${formatViolations(axe)}`);
    });

    await parent.test("summary: aggregate scan transcript (transcripts/summary.json)", async () => {
      writeTranscript("summary.json", {
        kind: "browser-journey-summary",
        scans: harness.scans,
        totalScans: harness.scans.length,
        totalViolations: harness.scans.reduce((sum, scan) => sum + scan.violations, 0),
      });
      assert.equal(
        harness.scans.reduce((sum, scan) => sum + scan.violations, 0),
        0,
        "aggregate axe violations must be zero across all journeys",
      );
    });
  } finally {
    await harness.stop();
  }
}

test("UIA-001 browser journeys (Arena branding + navigation + keyboard + lens + posture + responsive + axe)", async (t) => {
  await registerBrowserJourneys(t);
});
