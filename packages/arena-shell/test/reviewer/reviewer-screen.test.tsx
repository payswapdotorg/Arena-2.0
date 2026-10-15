import assert from "node:assert/strict";
import test from "node:test";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import {
  ReviewerController,
  type ReviewerCommandPort,
  type AuditTrailPort,
} from "../../src/screens/reviewer/controller.js";
import { ReviewerScreen } from "../../src/screens/reviewer/ReviewerScreen.js";
import { mockDecksAdapter, reviewerRegistration } from "../../src/screens/reviewer/registration.js";
import { MockArenaClient, DEMO_EXPERT_PRINCIPAL, type CommandApiOutcome } from "@arena/workbench";
import type { TransitionCommand } from "@arena/contracts";
import type { ArenaScreenHost } from "../../src/contract.js";

/**
 * UIA-001 Lane C — 评审/裁决工位渲染 + FIXTURE 旅程测试（react-dom/server +
 * MockArenaClient.getReviewDeck —— 确定性 fixture，如实标注 DEMO）。
 */

function normalize(html: string): string {
  return html.replace(/<!--.*?-->/g, "");
}

const HOST: ArenaScreenHost = {
  lens: "reviewer",
  port: {
    navigate: () => ({ kind: "navigated", screen: "reviewer" }),
    activeScreen: () => "reviewer",
  },
};

function render(controller: ReviewerController): string {
  return normalize(renderToString(createElement(ReviewerScreen, { host: HOST, controller })));
}

function makeController(options?: {
  commands?: ReviewerCommandPort;
  audit?: AuditTrailPort;
}) {
  const client = new MockArenaClient();
  const principal = DEMO_EXPERT_PRINCIPAL;
  const commands: ReviewerCommandPort =
    options?.commands ?? { command: async () => ({ kind: "UNKNOWN_COMMAND" }) };
  const audit: AuditTrailPort =
    options?.audit ??
    {
      timeline: async () => ({
        kind: "FOUND",
        events: [
          { event_type: "EscalationCreated", occurred_at: "2026-10-15T09:00:00Z", actor: "requester" },
        ],
      }),
    };
  const controller = new ReviewerController({
    decks: mockDecksAdapter(client),
    commands,
    audit,
    principal,
  });
  return { client, controller, principal };
}

test("initial render shows the honest queue loading state", () => {
  const { controller } = makeController();
  const html = render(controller);
  assert.match(html, /Loading the review queue/);
});

test("the demo disclosure renders on the reviewer surface", async () => {
  const { controller } = makeController();
  await controller.loadQueue();
  const html = render(controller);
  assert.match(html, /DEMO — deterministic fixtures, never customer state/);
});

test("queue rows carry result ids with DEMO tags; selection opens the evidence-first deck", async () => {
  const { controller } = makeController();
  await controller.loadQueue();
  const html = render(controller);
  assert.match(html, /res_00000001/);
  assert.match(html, /DEMO data/);
  await controller.selectResult("res_00000001");
  const deckHtml = render(controller);
  assert.match(deckHtml, /Review deck — res_00000001/);
  assert.match(deckHtml, /criterion outcomes \(typed rubric\)/);
  assert.match(deckHtml, /Verification trail/);
});

test("the deck renders criterion decisions and proof classes verbatim (typed rubric)", async () => {
  const { controller } = makeController();
  await controller.loadQueue();
  await controller.selectResult("res_00000001");
  const html = render(controller);
  assert.match(html, /cri_00000001/);
  assert.match(html, /PASS|FAIL|INCONCLUSIVE|NOT_EVALUATED/);
  assert.match(html, /P[0-3]/);
});

test("redaction partitions separate shared and reviewer-private; operator content is never rendered", async () => {
  const { controller } = makeController();
  await controller.loadQueue();
  await controller.selectResult("res_00000001");
  const html = render(controller);
  assert.match(html, /data-redaction-class="shared"/);
  assert.match(html, /data-redaction-class="reviewer_private"/);
  assert.match(html, /withheld from the reviewer surface \(count only/);
});

test("the self-evaluation section is visually distinct and never counted toward quorum", async () => {
  const { controller } = makeController();
  await controller.loadQueue();
  await controller.selectResult("res_00000001");
  const html = render(controller);
  assert.match(html, /data-self-eval="true"/);
  assert.match(html, /never an independent review/);
  assert.match(html, /never counts toward quorum/);
  assert.match(html, /arena-self-eval-section/);
});

test("the audit trail renders the server-recorded events verbatim (append-only)", async () => {
  const { controller } = makeController();
  await controller.loadQueue();
  await controller.selectResult("res_00000001");
  const html = render(controller);
  assert.match(html, /EscalationCreated/);
  assert.match(html, /2026-10-15T09:00:00Z/);
});

test("payout eligibility renders the result-linked rule with the test-mode ledger disclosure", async () => {
  const { controller } = makeController();
  await controller.loadQueue();
  await controller.selectResult("res_00000001");
  const html = render(controller);
  assert.match(html, /payout eligibility/i);
  assert.match(html, /never pay/);
  assert.match(html, /test_mode/);
});

test("the independent review vote renders typed 409 INVALID_TRANSITION verbatim", async () => {
  const commands: ReviewerCommandPort = {
    command: async (_id: string, command: TransitionCommand): Promise<CommandApiOutcome> => {
      assert.equal(command, "SubmitReviewerEvaluation");
      return {
        kind: "INVALID_TRANSITION",
        envelope: {
          code: "ARENA_INVALID_TRANSITION",
          message: "no edge from CREATED via SubmitReviewerEvaluation",
          correlation_id: "corr_9",
          request_id: null,
          details: null,
        },
      };
    },
  };
  const { controller } = makeController({ commands });
  controller.setVoteEscalationId("esc_00000001");
  await controller.submitReviewVote();
  const html = render(controller);
  assert.match(html, /INVALID_TRANSITION ARENA_INVALID_TRANSITION: no edge from CREATED via SubmitReviewerEvaluation/);
});

test("empty escalation id renders an honest requirement notice", async () => {
  const { controller } = makeController();
  await controller.submitReviewVote();
  const html = render(controller);
  assert.match(html, /an escalation id is required/);
});

test("lens is presentation only — the reviewer surface renders identically under another lens", async () => {
  const { controller } = makeController();
  await controller.loadQueue();
  const otherHost: ArenaScreenHost = { lens: "requester", port: HOST.port };
  const htmlReviewer = normalize(renderToString(createElement(ReviewerScreen, { host: HOST, controller })));
  const htmlOther = normalize(renderToString(createElement(ReviewerScreen, { host: otherHost, controller })));
  assert.match(htmlReviewer, /Viewing as reviewer/);
  assert.match(htmlOther, /Viewing as requester/);
  assert.equal(
    htmlReviewer.replace(/Viewing as reviewer/, "").replace(/data-arena-lens="reviewer"/, ""),
    htmlOther.replace(/Viewing as requester/, "").replace(/data-arena-lens="requester"/, ""),
  );
});

test("registration wires the reviewer screen with zero ZCode branding", async () => {
  const { client } = makeController();
  const registration = reviewerRegistration({
    decks: mockDecksAdapter(client),
    commands: { command: async () => ({ kind: "UNKNOWN_COMMAND" }) },
    audit: { timeline: async () => ({ kind: "FOUND", events: [] }) },
    principal: DEMO_EXPERT_PRINCIPAL,
  });
  assert.equal(registration.screen, "reviewer");
  assert.equal(registration.title, "Review");
  const html = normalize(renderToString(registration.render(HOST) as never));
  assert.match(html, /data-arena-screen="reviewer"/);
  assert.doesNotMatch(html, /ZCode/i);
});

test("structural a11y: the reviewer surface carries roles, labels, and the deck table semantics", async () => {
  const { controller } = makeController();
  await controller.loadQueue();
  await controller.selectResult("res_00000001");
  const html = render(controller);
  assert.match(html, /aria-label="reviewer adjudicator workbench"/);
  assert.match(html, /aria-label="criterion outcomes \(typed rubric\)"/);
  assert.match(html, /<th scope="col">Criterion<\/th>/);
  assert.match(html, /role="note"/);
});
