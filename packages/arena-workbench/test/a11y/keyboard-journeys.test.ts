import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { writeTranscript, type A11yHarness, type HostPage } from "./harness.js";

/**
 * AR2-021 — keyboard-only journeys (Playwright keyboard API; no mouse input).
 *
 *  journey 1 requester : skip link, full tab order, error-summary focus move,
 *                        focus retention through submitting -> submitted,
 *                        live-region announcement content at each step
 *  journey 2 expert    : keyboard lens switch, workspace tab order, frozen-
 *                        machine submission announcements, focus retention
 *  journey 3 reviewer  : evidence dialog opened by keyboard, focus trap
 *                        (Tab/Shift+Tab cycle inside), Escape close with
 *                        focus RETURN to the trigger; adjudication live
 *                        region pending -> resolved on the SAME DOM node
 *  journey 4 payout    : keyboard advance through the frozen payment states,
 *                        announcement per transition, terminal aria-disabled
 *
 * Observable focus (document.activeElement) and announcement content are
 * asserted at every step and recorded to keyboard-*.json transcripts.
 */

interface FocusDescriptor {
  tag: string;
  id: string | null;
  text: string | null;
  role: string | null;
  className: string | null;
}

interface KeyboardStep {
  action: string;
  focus: FocusDescriptor | null;
  announcement?: string;
}

class JourneyRecorder {
  readonly steps: KeyboardStep[] = [];

  record(action: string, focus: FocusDescriptor | null, announcement?: string): void {
    this.steps.push({ action, focus, announcement });
  }

  write(journey: string): void {
    writeTranscript(`keyboard-${journey}.json`, {
      kind: "keyboard-journey",
      journey,
      steps: this.steps,
      inputMode: "keyboard-only (Playwright keyboard API; no mouse events)",
    });
  }
}

/** Tab until the focused element matches (bounded), returning the focus. */
async function tabUntil(
  hostPage: HostPage,
  match: (focus: FocusDescriptor) => boolean,
  label: string,
  maxTabs = 16,
): Promise<FocusDescriptor> {
  for (let index = 0; index < maxTabs; index += 1) {
    await hostPage.page.keyboard.press("Tab");
    const focus = await hostPage.activeElement();
    assert.ok(focus !== null, `focus lost while tabbing toward ${label}`);
    if (match(focus)) {
      return focus;
    }
  }
  assert.fail(`tab target not reached: ${label}`);
}

async function waitForAnnouncement(
  hostPage: HostPage,
  selector: string,
  pattern: RegExp,
): Promise<string> {
  await hostPage.page.waitForFunction(
    ({ selector: scope, pattern: source }) =>
      new RegExp(source).test(document.querySelector(scope)?.textContent ?? ""),
    { selector, pattern: pattern.source },
    { timeout: 10_000 },
  );
  return hostPage.liveRegionText(selector);
}

export async function registerKeyboardJourneys(
  parent: TestContext,
  harness: A11yHarness,
): Promise<void> {
  // ---------------------------------------------------------------
  // keyboard journey 1 — requester form
  // ---------------------------------------------------------------
  await parent.test("keyboard: journey 1 — requester form (skip link, tab order, error focus, live announcements)", async () => {
    const hostPage = await harness.newPage();
    await hostPage.load(harness.url);
    const page = hostPage.page;
    const recorder = new JourneyRecorder();

    const initial = await hostPage.activeElement();
    recorder.record("initial (page load)", initial);
    assert.equal(initial?.tag, "body");

    // skip link is the first tabbable control
    await page.keyboard.press("Tab");
    let focus = await hostPage.activeElement();
    recorder.record("Tab #1 — skip link", focus);
    assert.equal(focus?.text, "Skip to main content");

    await page.keyboard.press("Enter");
    focus = await hostPage.activeElement();
    recorder.record("Enter on skip link — focus jumps to main landmark", focus);
    assert.equal(focus?.id, "arena-main");

    // lens buttons in frozen LENS_VIEWS order
    const lensLabels = ["Requester cockpit", "Expert workbench", "Reviewer screens", "Adjudicator screens"];
    for (const label of lensLabels) {
      await page.keyboard.press("Tab");
      focus = await hostPage.activeElement();
      recorder.record(`Tab — lens button ${label}`, focus);
      assert.equal(focus?.text, label);
    }

    // form fields in DOM order
    await page.keyboard.press("Tab");
    focus = await hostPage.activeElement();
    recorder.record("Tab — task title input", focus);
    assert.equal(focus?.id, "arena-task-title");
    await page.keyboard.type("Fix pricing rule edge cases");

    await page.keyboard.press("Tab");
    focus = await hostPage.activeElement();
    recorder.record("Tab — outcome textarea", focus);
    assert.equal(focus?.id, "arena-task-outcome");
    await page.keyboard.type("Corrected rule reproduces the fixture table");

    await page.keyboard.press("Tab");
    focus = await hostPage.activeElement();
    recorder.record("Tab — budget input (left empty on purpose)", focus);
    assert.equal(focus?.id, "arena-budget-limit");

    await page.keyboard.press("Tab");
    focus = await hostPage.activeElement();
    recorder.record("Tab — submit control", focus);
    assert.equal(focus?.text, "Submit escalation");

    // submit with empty budget -> typed errors + focus moves to the summary
    await page.keyboard.press("Enter");
    await page.waitForSelector(".arena-requester-cockpit .arena-field-errors");
    focus = await hostPage.activeElement();
    const rejectionAnnouncement = await hostPage.liveRegionText(
      ".arena-requester-cockpit .arena-live-announcer",
    );
    recorder.record("Enter (empty budget) — focus moved to error summary", focus, rejectionAnnouncement);
    assert.equal(focus?.tag, "ul");
    assert.ok(focus?.className?.includes("arena-field-errors"), "focus is on the error summary list");
    assert.match(rejectionAnnouncement, /Escalation rejected — \d+ field error/);

    const errorText = await page.locator(".arena-requester-cockpit .arena-field-errors").textContent();
    assert.match(errorText ?? "", /budget/);

    // back to the budget input (error summary is tabIndex -1 — skipped by Tab)
    await page.keyboard.press("Shift+Tab");
    focus = await hostPage.activeElement();
    recorder.record("Shift+Tab — back to budget input", focus);
    assert.equal(focus?.id, "arena-budget-limit");
    await page.keyboard.type("500");

    await page.keyboard.press("Tab");
    focus = await hostPage.activeElement();
    recorder.record("Tab — submit control again", focus);
    assert.equal(focus?.text, "Submit escalation");

    // submitting: held gate so the async state is deterministic
    await page.evaluate(() => window.__arenaHostControl?.holdSubmission());
    await page.keyboard.press("Enter");
    const submittingAnnouncement = await waitForAnnouncement(
      hostPage,
      ".arena-requester-cockpit .arena-live-announcer",
      /Submitting escalation request/,
    );
    focus = await hostPage.activeElement();
    recorder.record("Enter — submitting (focus retained)", focus, submittingAnnouncement);
    assert.equal(focus?.text, "Submit escalation");

    await page.evaluate(() => window.__arenaHostControl?.releaseSubmission());
    const submittedAnnouncement = await waitForAnnouncement(
      hostPage,
      ".arena-requester-cockpit .arena-live-announcer",
      /Escalation submitted — esc_\d{8}/,
    );
    focus = await hostPage.activeElement();
    recorder.record("after submission (focus retained)", focus, submittedAnnouncement);
    assert.equal(focus?.text, "Submit escalation");
    assert.match(submittedAnnouncement, /esc_00000001/);

    const trackingRows = await page.locator(".arena-tracking li[data-escalation]").count();
    assert.equal(trackingRows, 1);

    recorder.write("requester");
    await hostPage.page.close();
  });

  // ---------------------------------------------------------------
  // keyboard journey 2 — expert flow
  // ---------------------------------------------------------------
  await parent.test("keyboard: journey 2 — expert flow (lens switch, tab order, submission announcements, focus retention)", async () => {
    const hostPage = await harness.newPage();
    await hostPage.load(harness.url);
    const page = hostPage.page;
    const recorder = new JourneyRecorder();

    // keyboard lens switch: skip link, requester, then expert
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    let focus = await hostPage.activeElement();
    recorder.record("Tab ×3 — expert lens button", focus);
    assert.equal(focus?.text, "Expert workbench");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".arena-expert-workspace");
    focus = await hostPage.activeElement();
    recorder.record("Enter — expert lens active (focus retained on lens button)", focus);
    assert.equal(focus?.text, "Expert workbench");

    // workspace controls in DOM order: the remaining lens buttons come
    // first (reviewer, adjudicator), then the workspace form controls
    // (queue list items are not focusable — list semantics)
    await page.keyboard.press("Tab");
    focus = await hostPage.activeElement();
    recorder.record("Tab — reviewer lens button (still in switcher)", focus);
    assert.equal(focus?.text, "Reviewer screens");
    await page.keyboard.press("Tab");
    focus = await hostPage.activeElement();
    recorder.record("Tab — adjudicator lens button (still in switcher)", focus);
    assert.equal(focus?.text, "Adjudicator screens");

    await page.keyboard.press("Tab");
    focus = await hostPage.activeElement();
    recorder.record("Tab — artifact manifest textarea", focus);
    assert.equal(focus?.id, "arena-artifact-manifest");
    await page.keyboard.type("demo manifest: corrected pricing rule with fixture-table fix");

    await page.keyboard.press("Tab");
    focus = await hostPage.activeElement();
    recorder.record("Tab — submission notes input", focus);
    assert.equal(focus?.id, "arena-submission-notes");
    await page.keyboard.type("demo notes: root cause documented with reproducer artifact");

    await page.keyboard.press("Tab");
    focus = await hostPage.activeElement();
    recorder.record("Tab — candidate submit control", focus);
    assert.equal(focus?.text, "Submit candidate version");

    await page.keyboard.press("Enter");
    const candidateAnnouncement = await waitForAnnouncement(
      hostPage,
      ".arena-expert-workspace .arena-live-announcer",
      /Candidate version 1 submitted — attempt SUBMITTED/,
    );
    focus = await hostPage.activeElement();
    recorder.record("Enter — candidate submitted (focus retained)", focus, candidateAnnouncement);
    assert.equal(focus?.text, "Submit candidate version");
    const attemptBadge = await page.locator(".arena-attempt-status .arena-state-badge").textContent();
    assert.match(attemptBadge ?? "", /Submitted/);

    await page.keyboard.press("Tab");
    focus = await hostPage.activeElement();
    recorder.record("Tab — self-evaluation submit control", focus);
    assert.equal(focus?.text, "Submit structured self-evaluation");

    await page.keyboard.press("Enter");
    const selfEvalAnnouncement = await waitForAnnouncement(
      hostPage,
      ".arena-expert-workspace .arena-live-announcer",
      /Structured self-evaluation submitted — attempt VERIFYING/,
    );
    await page.waitForSelector(".arena-self-evaluation-panel");
    focus = await hostPage.activeElement();
    recorder.record("Enter — self-evaluation submitted (focus retained)", focus, selfEvalAnnouncement);
    assert.equal(focus?.text, "Submit structured self-evaluation");
    assert.match(selfEvalAnnouncement, /never an independent vote/);

    const verifyingBadge = await page.locator(".arena-attempt-status .arena-state-badge").textContent();
    assert.match(verifyingBadge ?? "", /Verifying/);
    const queueBadge = await page
      .locator(".arena-assignments li[data-attempt='att_00000001'] .arena-state-badge")
      .textContent();
    assert.match(queueBadge ?? "", /Verifying/);

    recorder.write("expert");
    await hostPage.page.close();
  });

  // ---------------------------------------------------------------
  // keyboard journey 3 — evidence dialog + adjudication live region
  // ---------------------------------------------------------------
  await parent.test("keyboard: journey 3 — evidence dialog focus trap + focus return; adjudication live region", async () => {
    const hostPage = await harness.newPage();
    await hostPage.load(harness.url);
    const page = hostPage.page;
    const recorder = new JourneyRecorder();

    // keyboard lens switch to reviewer
    const reviewerFocus = await tabUntil(hostPage, (f) => f.text === "Reviewer screens", "Reviewer screens lens");
    recorder.record("Tab — reviewer lens button", reviewerFocus);
    await page.keyboard.press("Enter");
    await page.waitForSelector(".arena-reviewer-deck");

    // tab to the shared evidence trigger (deck selector buttons come first)
    const evidenceFocus = await tabUntil(
      hostPage,
      (f) => (f.text ?? "").includes("evd_public001"),
      "evidence inspect trigger",
    );
    recorder.record("Tab — evidence inspect trigger", evidenceFocus);
    assert.ok(evidenceFocus.text?.includes("evd_public001"));

    await page.keyboard.press("Enter");
    await page.waitForSelector("[role='dialog']");
    let focus = await hostPage.activeElement();
    recorder.record("Enter — dialog opened, focus moved inside (close control)", focus);
    assert.equal(focus?.text, "Close evidence details");

    // focus trap: Tab cycles within the dialog
    for (let index = 0; index < 6; index += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(
        () => document.activeElement?.closest("[role='dialog']") !== null,
      );
      assert.ok(inside, `focus escaped the dialog at Tab ${index + 1}`);
    }
    recorder.record("Tab ×6 — focus stayed trapped inside the dialog", await hostPage.activeElement());

    // Shift+Tab wraps within the dialog as well
    await page.keyboard.press("Shift+Tab");
    const insideShift = await page.evaluate(
      () => document.activeElement?.closest("[role='dialog']") !== null,
    );
    assert.ok(insideShift, "focus escaped the dialog on Shift+Tab");
    recorder.record("Shift+Tab — wrap within dialog", await hostPage.activeElement());

    // Escape closes and focus RETURNS to the trigger
    await page.keyboard.press("Escape");
    await page.waitForSelector("[role='dialog']", { state: "detached" });
    focus = await hostPage.activeElement();
    recorder.record("Escape — dialog closed, focus returned to trigger", focus);
    assert.ok(focus?.text?.includes("evd_public001"), "focus returned to the evidence trigger");

    // adjudication live region: pending -> resolved on the SAME node
    const adjudicatorFocus = await tabUntil(
      hostPage,
      (f) => f.text === "Adjudicator screens",
      "Adjudicator screens lens",
    );
    recorder.record("Tab — adjudicator lens button", adjudicatorFocus);
    await page.keyboard.press("Enter");
    await page.waitForSelector(".arena-adjudicator-deck");
    await page.waitForSelector(".arena-adjudicator-deck [data-divergent='false']");

    // mark the live-region node so the pending -> resolved transition is
    // proven to be a CONTENT MUTATION of the same persistent node
    await page.evaluate(() => {
      document.querySelector(".arena-divergence")?.setAttribute("data-kbd-marker", "pending");
    });
    const pendingText = await page.locator(".arena-divergence").textContent();
    recorder.record("adjudication pending (live region)", await hostPage.activeElement(), pendingText ?? "");
    assert.match(pendingText ?? "", /No divergence detected/);

    const divergentFocus = await tabUntil(
      hostPage,
      (f) => (f.text ?? "").includes("Load divergent case"),
      "divergent case selector",
    );
    recorder.record("Tab — divergent case selector", divergentFocus);
    await page.keyboard.press("Enter");
    await page.waitForSelector(".arena-adjudicator-deck [data-divergent='true']");
    const resolvedText = await page.locator(".arena-divergence").textContent();
    const marker = await page.evaluate(
      () => document.querySelector(".arena-divergence")?.getAttribute("data-kbd-marker"),
    );
    recorder.record("Enter — adjudication resolved (same live-region node mutated)", await hostPage.activeElement(), resolvedText ?? "");
    assert.match(resolvedText ?? "", /Divergence detected/);
    assert.equal(marker, "pending", "the live region is the SAME persistent DOM node (content mutation, not remount)");

    recorder.write("reviewer");
    await hostPage.page.close();
  });

  // ---------------------------------------------------------------
  // keyboard journey 4 — payout status
  // ---------------------------------------------------------------
  await parent.test("keyboard: journey 4 — payout status (keyboard advance, live announcements, terminal aria-disabled)", async () => {
    const hostPage = await harness.newPage();
    await hostPage.load(harness.url);
    const page = hostPage.page;
    const recorder = new JourneyRecorder();

    // requester lens is default; tab to the payout advance control
    const advanceFocus = await tabUntil(
      hostPage,
      (f) => f.text === "Advance payment lifecycle",
      "payout advance control",
    );
    recorder.record("Tab — payout advance control", advanceFocus);

    const pendingState = await page.locator(".arena-payout-current").getAttribute("data-payout-state");
    assert.equal(pendingState, "PENDING_EVIDENCE");
    const pendingAnnouncement = await hostPage.liveRegionText(".arena-payout-panel .arena-live-announcer");
    recorder.record("payout pending", advanceFocus, pendingAnnouncement);
    assert.match(pendingAnnouncement, /Pending Evidence/);

    const expectedStates = [
      { state: "EVIDENCE_ACCEPTED", label: "Evidence Accepted" },
      { state: "READY_TO_RELEASE", label: "Ready To Release" },
      { state: "RELEASE_SUBMITTED", label: "Release Submitted" },
      { state: "SETTLED", label: "Settled" },
    ];
    for (const expected of expectedStates) {
      await page.keyboard.press("Enter");
      await page.waitForSelector(`.arena-payout-current[data-payout-state='${expected.state}']`);
      const announcement = await hostPage.liveRegionText(".arena-payout-panel .arena-live-announcer");
      const focus = await hostPage.activeElement();
      recorder.record(`Enter — payment state ${expected.state}`, focus, announcement);
      assert.match(announcement, new RegExp(expected.label));
    }

    // terminal: control is aria-disabled, focus retained, Enter is a guarded no-op
    await page.waitForSelector(".arena-payout-panel button[aria-disabled='true']");
    const terminalFocus = await hostPage.activeElement();
    recorder.record("terminal — aria-disabled control keeps focus", terminalFocus);
    assert.equal(terminalFocus?.text, "Advance payment lifecycle");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    const settledState = await page.locator(".arena-payout-current").getAttribute("data-payout-state");
    assert.equal(settledState, "SETTLED");

    const currentStep = await page
      .locator(".arena-payout-steps li[aria-current='step']")
      .getAttribute("data-payment-state");
    assert.equal(currentStep, "SETTLED");

    recorder.write("payout");
    await hostPage.page.close();
  });
}
