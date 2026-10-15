import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReviewDeck,
  DEMO_ACCEPTANCE_CRITERIA,
  DEMO_EVIDENCE_RECORDS,
  DEMO_RESULT,
  DEMO_RESULT_DIVERGENT,
  DEMO_SELF_EVALUATION,
  type ReviewDeckView,
} from "@arena/workbench";
import {
  adjudicationPanelViewModel,
  evidenceGradeOf,
  PAYOUT_ELIGIBILITY_RULE,
  payoutEligibility,
  quorumViewModel,
  SELF_EVALUATION_DISTINCTION_TEXT,
  TEST_MODE_LEDGER_DISCLOSURE,
} from "../../src/screens/reviewer/viewModel.js";
import {
  operationalStateVocabulary,
  providerHealthVocabulary,
  releasePosturePanelViewModel,
  RESTRICTED_ACTIONS,
} from "../../src/screens/operations/postureModel.js";
import {
  EVENT_ENVELOPE_FIELDS,
  IDEMPOTENCY_RULES,
  REQUEST_ENVELOPE_FIELDS,
  RESULT_STATUS_VOCABULARY,
  deliveryStatusFixtureRows,
} from "../../src/screens/developer/contractReference.js";
import { ARENA_EVIDENCE_GRADES, ARENA_RELEASE_POSTURE } from "../../src/contract.js";

/**
 * UIA-001 Lane C — 纯视图模型测试（PURE；无 DOM、无网络）。
 * 覆盖：deck 组装冻结形状、法定人数（自评不计入）、裁决视图、支付资格
 * 与结果挂钩、脱敏分区、发布姿态真相法、契约参考的真实 schema 枚举。
 */

function deckOf(result = DEMO_RESULT): ReviewDeckView {
  return buildReviewDeck(
    result,
    DEMO_ACCEPTANCE_CRITERIA,
    DEMO_EVIDENCE_RECORDS,
    DEMO_SELF_EVALUATION,
    { demo: true, disclosure: "DEMO — deterministic fixtures, never customer state" },
  );
}

test("the review deck carries the frozen shapes (criterion rows, trail, redaction, self-eval separation)", () => {
  const deck = deckOf();
  assert.ok(deck.result_id.startsWith("res_"));
  assert.ok(deck.criterion_rows.length > 0);
  for (const row of deck.criterion_rows) {
    assert.equal(typeof row.criterion_id, "string");
    assert.equal(typeof row.statement, "string");
    assert.ok(["PASS", "FAIL", "INCONCLUSIVE", "NOT_EVALUATED"].includes(row.decision));
    assert.ok(["P0", "P1", "P2", "P3"].includes(row.proof_class));
  }
  assert.equal(typeof deck.trail.policy_version, "string");
  assert.equal(typeof deck.redaction.withheld_operator_count, "number");
});

test("quorum counts ONLY independent reviewers from the trail (self-evaluations never count)", () => {
  const deck = deckOf();
  const quorum = quorumViewModel(deck, {
    adjudication_trigger: "divergent_outcomes",
    minimum_independent_reviews: 2,
  });
  assert.equal(quorum.independentReviewCount, deck.trail.reviewer_ids.length);
  assert.equal(quorum.satisfied, deck.trail.reviewer_ids.length >= 2);
  assert.match(quorum.basis, /never counts toward quorum/);
});

test("self-evaluation distinction text is the frozen never-a-vote rule (verbatim)", () => {
  assert.match(SELF_EVALUATION_DISTINCTION_TEXT, /never an independent vote/);
  assert.match(SELF_EVALUATION_DISTINCTION_TEXT, /verifier decision or sole payment trigger/);
});

test("adjudication view triggers on divergent outcomes or hard-stop disputes (frozen semantics)", () => {
  const policy = { adjudication_trigger: "divergent_outcomes_or_hard_stop_dispute", minimum_independent_reviews: 2 };
  const plain = adjudicationPanelViewModel(deckOf(DEMO_RESULT), policy);
  const divergent = adjudicationPanelViewModel(deckOf(DEMO_RESULT_DIVERGENT), policy);
  assert.equal(divergent.view.divergent, true);
  assert.equal(divergent.triggerRecorded, true);
  assert.equal(typeof plain.view.divergent, "boolean");
});

test("payout eligibility follows the typed result status (failed/inconclusive never pay)", () => {
  assert.match(PAYOUT_ELIGIBILITY_RULE, /REJECTED \/ INCONCLUSIVE \/ EXPIRED \/ FAILED never pay/);
  assert.match(PAYOUT_ELIGIBILITY_RULE, /duplicate operations\s+cannot double pay/);
  assert.equal(payoutEligibility("ACCEPTED").kind, "eligible_pending_proof");
  assert.equal(payoutEligibility("PARTIALLY_ACCEPTED").kind, "eligible_pending_proof");
  for (const status of ["REJECTED", "INCONCLUSIVE", "EXPIRED", "FAILED"]) {
    const eligibility = payoutEligibility(status);
    assert.equal(eligibility.kind, "not_eligible");
  }
  assert.equal(payoutEligibility("NOT_A_STATUS").kind, "unknown_status");
});

test("the ledger disclosure is test-mode verbatim (no live money)", () => {
  assert.match(TEST_MODE_LEDGER_DISCLOSURE, /test_mode/);
  assert.match(TEST_MODE_LEDGER_DISCLOSURE, /no live money/);
  assert.match(TEST_MODE_LEDGER_DISCLOSURE, /NOT_GO/);
});

test("evidence grade renders verbatim from the demo tag (never inflated)", () => {
  assert.equal(evidenceGradeOf(deckOf()), "DEMO");
});

test("release posture panel is the recorded truth verbatim (NOT_GO / test_mode / disabled + bases)", () => {
  const vm = releasePosturePanelViewModel();
  assert.equal(vm.posture.releaseDecision, "NOT_GO");
  assert.equal(vm.posture.financeMode, "test_mode");
  assert.equal(vm.posture.untrustedExecution, "disabled");
  assert.equal(vm.posture.decisionBasis, ARENA_RELEASE_POSTURE.decisionBasis);
  for (const restricted of RESTRICTED_ACTIONS) {
    assert.equal(typeof restricted.action, "string");
    assert.ok(restricted.basis.length > 0, "every restricted action carries its recorded basis");
  }
});

test("provider health vocabulary renders typed statuses with evidence grades verbatim", () => {
  const vocabulary = providerHealthVocabulary();
  for (const row of vocabulary) {
    assert.deepEqual([...row.evidenceGrades], [...ARENA_EVIDENCE_GRADES]);
  }
  assert.ok(vocabulary.some((row) => row.status === "ACTIVE"));
});

test("operational state vocabulary flows 1:1 from the frozen machine views (no invented states)", () => {
  const vocabulary = operationalStateVocabulary();
  assert.equal(vocabulary.length, 4);
  for (const machine of vocabulary) {
    assert.ok(machine.states.length > 0);
  }
});

test("developer contract reference enumerates the REAL frozen schemas (never hand-mirrored)", () => {
  assert.ok(REQUEST_ENVELOPE_FIELDS.includes("caller_idempotency_key"));
  assert.ok(REQUEST_ENVELOPE_FIELDS.includes("delivery_preferences"));
  assert.ok(REQUEST_ENVELOPE_FIELDS.includes("proof_policy"));
  assert.ok(EVENT_ENVELOPE_FIELDS.includes("event_id"));
  assert.ok(EVENT_ENVELOPE_FIELDS.includes("correlation_id"));
  assert.deepEqual([...RESULT_STATUS_VOCABULARY], [
    "ACCEPTED",
    "PARTIALLY_ACCEPTED",
    "REJECTED",
    "INCONCLUSIVE",
    "EXPIRED",
    "FAILED",
  ]);
});

test("idempotency rules render the CF1.0 semantics verbatim", () => {
  const keys = IDEMPOTENCY_RULES.map((rule) => rule.key);
  assert.deepEqual(keys, ["sameKeySameDigest", "sameKeyDifferentDigest", "concurrentSameKey", "retryBound"]);
  const same = IDEMPOTENCY_RULES.find((rule) => rule.key === "sameKeySameDigest");
  assert.equal(same?.text, "replay the stored outcome; no second side effect");
});

test("delivery status fixture rows are labelled fixtures with verbatim semantics", () => {
  const rows = deliveryStatusFixtureRows();
  for (const row of rows) {
    assert.equal(row.fixture, true);
    assert.ok(row.semantics.length > 0);
  }
  assert.ok(rows.some((row) => row.outcome === "DUPLICATE_IGNORED"));
});
