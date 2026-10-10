import assert from "node:assert/strict";
import test from "node:test";
// tsx 对 include 之外的测试文件使用 classic JSX runtime（src/ 内为 automatic）；
// 显式值导入 React 使两种 runtime 产物兼容。
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AdjudicatorDeckScreen,
  DEMO_ACCEPTANCE_CRITERIA,
  DEMO_EVIDENCE_RECORDS,
  DEMO_RESULT,
  DEMO_SELF_EVALUATION,
  ExpertQueue,
  ExpertWorkspace,
  MockArenaClient,
  ReviewerDeckScreen,
  SelfEvaluationPanel,
  adjudicationView,
  buildReviewDeck,
  DEMO_EXPERT_PRINCIPAL,
  DEMO_PROOF_POLICY_PRESET,
  DEMO_TAG,
} from "../src/contract.js";

/**
 * AR2-003 slice 2 SSR 冒烟（node:test + renderToStaticMarkup；无浏览器依赖）。
 * 验收场景 2/3 的渲染面：专家队列/工作区/自评面板（非投票标注）、
 * reviewer deck（criterion 表 + trail + 脱敏边界 + 自评分区）、
 * adjudicator deck（分歧 + 触发器 + adjudicator 在场）。
 */

async function deckFixtures() {
  const client = new MockArenaClient();
  const own = await client.getReviewDeck("res_00000001", DEMO_EXPERT_PRINCIPAL);
  const divergent = await client.getReviewDeck("res_00000002", DEMO_EXPERT_PRINCIPAL);
  if (own.kind !== "FOUND" || divergent.kind !== "FOUND") {
    throw new Error("demo review decks not found");
  }
  return { convergent: own.deck, divergent: divergent.deck };
}

test("render: expert queue lists assignments with frozen attempt state badges", async () => {
  const client = new MockArenaClient();
  const assignments = await client.listAssignments(DEMO_EXPERT_PRINCIPAL);
  const html = renderToStaticMarkup(<ExpertQueue assignments={assignments} />);
  assert.match(html, /aria-label="expert queue"/);
  assert.match(html, /att_00000001/);
  assert.match(html, /data-state="ENVIRONMENT_READY"[^>]*>Environment Ready/);
  assert.match(html, /aria-label="attempt assignments"/);
  const empty = renderToStaticMarkup(<ExpertQueue assignments={[]} />);
  assert.match(empty, /No assignments \(empty state\)/);
});

test("render: expert workspace shows candidate + self-evaluation forms with the non-vote rule", async () => {
  const client = new MockArenaClient();
  const found = await client.getAttempt("att_00000001", DEMO_EXPERT_PRINCIPAL);
  if (found.kind !== "FOUND") throw new Error("attempt not found");
  const html = renderToStaticMarkup(
    <ExpertWorkspace
      attempt={found.attempt}
      manifestValue="demo manifest"
      notesValue="demo notes"
      candidateErrors={[]}
      selfEvaluationErrors={[]}
      onManifestChange={() => undefined}
      onNotesChange={() => undefined}
      onCandidateSubmit={() => undefined}
      onSelfEvaluationSubmit={() => undefined}
    />,
  );
  assert.match(html, /Candidate submission/);
  assert.match(html, /Submit candidate version/);
  assert.match(html, /Structured self-evaluation/);
  assert.match(html, /data-never-vote="true"/);
  assert.match(html, /never an independent vote/);
  assert.match(html, /data-demo="true"/); // DemoBanner
});

test("render: self-evaluation panel is visually separated and labelled as evidence-not-vote", () => {
  const html = renderToStaticMarkup(<SelfEvaluationPanel evaluation={DEMO_SELF_EVALUATION} />);
  assert.match(html, /visible evidence, not a vote/);
  assert.match(html, /data-never-vote="true"/);
  assert.match(html, /cri_00000001/);
  assert.match(html, /NOT_EVALUATED/);
  assert.match(html, /data-decision="NOT_EVALUATED"/);
});

test("render: reviewer deck renders criterion rows from criterionOutcomeSchema shapes", async () => {
  const { convergent } = await deckFixtures();
  const html = renderToStaticMarkup(<ReviewerDeckScreen deck={convergent} />);
  assert.match(html, /aria-label="reviewer deck"/);
  assert.match(html, /aria-label="criterion outcomes"/);
  assert.match(html, /data-criterion="cri_00000001"[^>]*data-decision="PASS"/);
  assert.match(html, /data-criterion="cri_00000002"[^>]*data-decision="INCONCLUSIVE"/);
  assert.match(html, /P1/);
  assert.match(html, /fixture table/);
  assert.match(html, /data-demo="true"/);
});

test("render: reviewer-private evidence renders inside a separated redaction boundary", async () => {
  const { convergent } = await deckFixtures();
  const html = renderToStaticMarkup(<ReviewerDeckScreen deck={convergent} />);
  assert.match(
    html,
    /aria-label="reviewer_private content \(visually separated redaction class\)"/,
  );
  assert.match(html, /data-redaction-class="reviewer_private"/);
  assert.match(html, /arena-redaction-reviewer_private/);
  assert.match(html, /evd_review001/);
});

test("render: operator evidence is withheld — count only, no evidence id on the reviewer surface", async () => {
  const { convergent } = await deckFixtures();
  const html = renderToStaticMarkup(<ReviewerDeckScreen deck={convergent} />);
  assert.match(html, /data-withheld-operator="1"/);
  assert.match(html, /Operator-class evidence withheld/);
  assert.ok(!html.includes("evd_operator01")); // 扣留：id 不渲染
});

test("render: verification trail exposes validators, reviewers, outcomes, policy version", async () => {
  const { convergent } = await deckFixtures();
  const html = renderToStaticMarkup(<ReviewerDeckScreen deck={convergent} />);
  assert.match(html, /val_00000001@1\.0\.0/);
  assert.match(html, /rev_00000001, rev_00000002/);
  assert.match(html, /PVP1\.0/);
  assert.match(html, /data-independent-reviews="2"/);
  assert.match(html, /never counted/);
});

test("render: author self-evaluation is separated and never counted as an independent review", async () => {
  const { convergent } = await deckFixtures();
  const html = renderToStaticMarkup(<ReviewerDeckScreen deck={convergent} />);
  assert.match(html, /arena-reviewer-self-evaluation/);
  assert.match(html, /Author self-evaluation — separated, never an independent vote/);
  assert.match(html, /data-decision="PASS"[^>]*\(self, not a vote\)|\(self, not a vote\)/);
  const without = renderToStaticMarkup(
    <ReviewerDeckScreen
      deck={buildReviewDeck(
        DEMO_RESULT,
        DEMO_ACCEPTANCE_CRITERIA,
        DEMO_EVIDENCE_RECORDS,
        null,
        DEMO_TAG,
      )}
    />,
  );
  assert.match(without, /No author self-evaluation on record/);
});

test("render: adjudicator deck flags divergence with trigger and adjudicator presence", async () => {
  const { convergent, divergent } = await deckFixtures();
  const calm = renderToStaticMarkup(
    <AdjudicatorDeckScreen
      deck={convergent}
      adjudication={adjudicationView(convergent, DEMO_PROOF_POLICY_PRESET.review_policy)}
    />,
  );
  assert.match(calm, /No divergence detected/);
  const tense = renderToStaticMarkup(
    <AdjudicatorDeckScreen
      deck={divergent}
      adjudication={adjudicationView(divergent, DEMO_PROOF_POLICY_PRESET.review_policy)}
    />,
  );
  assert.match(tense, /Divergence detected/);
  assert.match(tense, /adj_00000001/);
  assert.match(tense, /rubric_band_A, rubric_band_C/);
});

test("render: PARTIALLY_ACCEPTED result status renders without inventing an attempt state", async () => {
  const { convergent } = await deckFixtures();
  assert.equal(convergent.status, "PARTIALLY_ACCEPTED");
  const html = renderToStaticMarkup(<ReviewerDeckScreen deck={convergent} />);
  assert.match(html, /data-result-status="PARTIALLY_ACCEPTED"/);
  assert.match(html, /PARTIALLY_ACCEPTED \(result status\)/); // 纯文本，不用状态徽章发明状态
  assert.ok(!html.includes("unknown (no invented states)"));
});
