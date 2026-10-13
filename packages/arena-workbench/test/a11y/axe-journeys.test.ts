import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { formatViolations, type A11yHarness } from "./harness.js";

/**
 * AR2-021 — axe journeys (rendered, INTERACTED states — never static markup).
 *
 *  journey 1 requester  : empty / validation-error / submitting / submitted
 *  journey 2 expert     : queue pristine / candidate error / candidate
 *                         submitted / self-evaluation submitted
 *  journey 3 reviewer   : deck pending (convergent) / evidence dialog open /
 *                         deck divergent / adjudicator pending / resolved
 *  journey 4 payout     : pending / releasing / paid
 *
 * Every scan asserts ZERO violations with the recorded rule tags; states are
 * driven through real interactions (clicks, form fills, the held submission
 * gate) before axe-core is injected into the live page.
 */

export async function registerAxeJourneys(parent: TestContext, harness: A11yHarness): Promise<void> {
  // ---------------------------------------------------------------
  // axe journey 1 — requester submits a capability request
  // ---------------------------------------------------------------
  await parent.test("axe: journey 1 — requester submits a capability request (4 states)", async () => {
    const hostPage = await harness.newPage();
    await hostPage.load(harness.url);

    // state: empty (pristine form, empty tracking, payout panel initial)
    let result = await harness.runAxe(hostPage, {
      journey: "requester",
      state: "empty",
      viewport: "desktop",
    });
    assert.equal(result.violations.length, 0, formatViolations(result));

    // state: validation error (empty submit -> typed field errors + focus move)
    await hostPage.page.click("form.arena-escalation-form button[type='submit']");
    await hostPage.page.waitForSelector(".arena-requester-cockpit .arena-field-errors");
    result = await harness.runAxe(hostPage, {
      journey: "requester",
      state: "validation-error",
      viewport: "desktop",
    });
    assert.equal(result.violations.length, 0, formatViolations(result));

    // state: submitting (held async gate: aria-disabled control, aria-busy form)
    await hostPage.page.evaluate(() => window.__arenaHostControl?.holdSubmission());
    await hostPage.page.fill("#arena-task-title", "Fix pricing rule edge cases");
    await hostPage.page.fill("#arena-task-outcome", "Corrected rule reproduces the fixture table");
    await hostPage.page.fill("#arena-budget-limit", "500");
    await hostPage.page.click("form.arena-escalation-form button[type='submit']");
    await hostPage.page.waitForSelector("form.arena-escalation-form button[aria-disabled='true']");
    result = await harness.runAxe(hostPage, {
      journey: "requester",
      state: "submitting",
      viewport: "desktop",
    });
    assert.equal(result.violations.length, 0, formatViolations(result));

    // state: submitted (announcement + tracking row)
    await hostPage.page.evaluate(() => window.__arenaHostControl?.releaseSubmission());
    await hostPage.page.waitForSelector(".arena-tracking li[data-escalation]");
    result = await harness.runAxe(hostPage, {
      journey: "requester",
      state: "submitted",
      viewport: "desktop",
    });
    assert.equal(result.violations.length, 0, formatViolations(result));
    await hostPage.page.close();
  });

  // ---------------------------------------------------------------
  // axe journey 2 — expert reviews an attempt
  // ---------------------------------------------------------------
  await parent.test("axe: journey 2 — expert reviews an attempt (4 states)", async () => {
    const hostPage = await harness.newPage();
    await hostPage.load(harness.url);
    await hostPage.page.click("[data-lens='expert']");
    await hostPage.page.waitForSelector(".arena-expert-queue .arena-assignments li");

    // state: queue pristine (4 seeded assignments + workspace on the open attempt)
    let result = await harness.runAxe(hostPage, {
      journey: "expert",
      state: "queue-pristine",
      viewport: "desktop",
    });
    assert.equal(result.violations.length, 0, formatViolations(result));

    // state: candidate error (empty candidate submission -> typed errors)
    await hostPage.page.click(".arena-candidate-form button[type='submit']");
    await hostPage.page.waitForSelector(".arena-candidate-form .arena-field-errors");
    result = await harness.runAxe(hostPage, {
      journey: "expert",
      state: "candidate-error",
      viewport: "desktop",
    });
    assert.equal(result.violations.length, 0, formatViolations(result));

    // state: candidate submitted (frozen machine ENVIRONMENT_READY -> SUBMITTED)
    await hostPage.page.fill("#arena-artifact-manifest", "demo manifest: corrected pricing rule");
    await hostPage.page.fill("#arena-submission-notes", "demo notes: root cause with reproducer");
    await hostPage.page.click(".arena-candidate-form button[type='submit']");
    await hostPage.page.waitForFunction(
      () => (document.querySelector(".arena-attempt-status")?.textContent ?? "").includes("Submitted"),
    );
    result = await harness.runAxe(hostPage, {
      journey: "expert",
      state: "candidate-submitted",
      viewport: "desktop",
    });
    assert.equal(result.violations.length, 0, formatViolations(result));

    // state: self-evaluation submitted (SUBMITTED -> VERIFYING + panel, non-vote)
    await hostPage.page.click(".arena-self-evaluation-form button[type='submit']");
    await hostPage.page.waitForSelector(".arena-self-evaluation-panel");
    await hostPage.page.waitForFunction(
      () => (document.querySelector(".arena-attempt-status")?.textContent ?? "").includes("Verifying"),
    );
    result = await harness.runAxe(hostPage, {
      journey: "expert",
      state: "selfevaluation-submitted",
      viewport: "desktop",
    });
    assert.equal(result.violations.length, 0, formatViolations(result));
    await hostPage.page.close();
  });

  // ---------------------------------------------------------------
  // axe journey 3 — reviewer adjudication view
  // ---------------------------------------------------------------
  await parent.test("axe: journey 3 — reviewer adjudication view (5 states)", async () => {
    const hostPage = await harness.newPage();
    await hostPage.load(harness.url);
    await hostPage.page.click("[data-lens='reviewer']");
    await hostPage.page.waitForSelector(".arena-reviewer-deck");

    // state: deck pending (convergent: PARTIALLY_ACCEPTED, no adjudicator)
    let result = await harness.runAxe(hostPage, {
      journey: "reviewer",
      state: "deck-pending",
      viewport: "desktop",
    });
    assert.equal(result.violations.length, 0, formatViolations(result));

    // state: evidence dialog open (role=dialog, aria-modal, focus inside)
    await hostPage.page.click("li[data-evidence='evd_public001'] button");
    await hostPage.page.waitForSelector("[role='dialog']");
    result = await harness.runAxe(hostPage, {
      journey: "reviewer",
      state: "evidence-dialog-open",
      viewport: "desktop",
    });
    assert.equal(result.violations.length, 0, formatViolations(result));
    await hostPage.page.keyboard.press("Escape");
    await hostPage.page.waitForSelector("[role='dialog']", { state: "detached" });

    // state: deck divergent (hard-stop dispute, withheld operator evidence)
    await hostPage.page.click("[data-deck-choice='res_00000002']");
    await hostPage.page.waitForSelector(".arena-reviewer-deck[data-result='res_00000002']");
    result = await harness.runAxe(hostPage, {
      journey: "reviewer",
      state: "deck-divergent",
      viewport: "desktop",
    });
    assert.equal(result.violations.length, 0, formatViolations(result));

    // state: adjudicator pending (convergent deck: no divergence detected)
    await hostPage.page.click("[data-lens='adjudicator']");
    await hostPage.page.click("[data-deck-choice='res_00000001']");
    await hostPage.page.waitForSelector(".arena-adjudicator-deck [data-divergent='false']");
    result = await harness.runAxe(hostPage, {
      journey: "adjudicator",
      state: "pending",
      viewport: "desktop",
    });
    assert.equal(result.violations.length, 0, formatViolations(result));

    // state: adjudicator resolved (divergence detected, adjudicator present)
    await hostPage.page.click("[data-deck-choice='res_00000002']");
    await hostPage.page.waitForSelector(".arena-adjudicator-deck [data-divergent='true']");
    result = await harness.runAxe(hostPage, {
      journey: "adjudicator",
      state: "resolved",
      viewport: "desktop",
    });
    assert.equal(result.violations.length, 0, formatViolations(result));
    await hostPage.page.close();
  });

  // ---------------------------------------------------------------
  // axe journey 4 — payout status view
  // ---------------------------------------------------------------
  await parent.test("axe: journey 4 — payout status view (3 states)", async () => {
    const hostPage = await harness.newPage();
    await hostPage.load(harness.url);
    await hostPage.page.waitForSelector(".arena-payout-panel");

    // state: pending (PENDING_EVIDENCE, test-mode disclosure)
    let result = await harness.runAxe(hostPage, {
      journey: "payout",
      state: "pending",
      viewport: "desktop",
    });
    assert.equal(result.violations.length, 0, formatViolations(result));

    // state: releasing (mid progression READY_TO_RELEASE)
    await hostPage.page.click(".arena-payout-panel button[type='button']");
    await hostPage.page.click(".arena-payout-panel button[type='button']");
    await hostPage.page.waitForSelector(".arena-payout-current[data-payout-state='READY_TO_RELEASE']");
    result = await harness.runAxe(hostPage, {
      journey: "payout",
      state: "releasing",
      viewport: "desktop",
    });
    assert.equal(result.violations.length, 0, formatViolations(result));

    // state: paid (SETTLED terminal, aria-disabled advance control)
    await hostPage.page.click(".arena-payout-panel button[type='button']");
    await hostPage.page.click(".arena-payout-panel button[type='button']");
    await hostPage.page.waitForSelector(".arena-payout-panel button[aria-disabled='true']");
    await hostPage.page.waitForSelector(".arena-payout-current[data-payout-state='SETTLED']");
    result = await harness.runAxe(hostPage, {
      journey: "payout",
      state: "paid",
      viewport: "desktop",
    });
    assert.equal(result.violations.length, 0, formatViolations(result));
    await hostPage.page.close();
  });
}
