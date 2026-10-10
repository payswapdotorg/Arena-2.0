import assert from "node:assert/strict";
import test from "node:test";
import {
  DEMO_ACCEPTANCE_CRITERIA,
  DEMO_KNOWN_EVIDENCE_IDS,
  DEMO_EXPERT_PRINCIPAL,
  DEMO_EXPERT_TENANT_ID,
  MockArenaClient,
  SELF_EVALUATION_IS_NOT_A_VOTE_RULE,
  adjudicationView,
  buildReviewDeck,
  evaluateCandidateSubmission,
  evaluateSelfEvaluationSubmission,
  partitionByRedactionClass,
  validateCandidateDraft,
  validateSelfEvaluationDraft,
  type CandidateDraft,
  type SelfEvaluationDraft,
} from "../src/contract.js";
import {
  DEMO_ATTEMPT_DIVERGENT,
  DEMO_ATTEMPT_OPEN,
  DEMO_ATTEMPT_SUBMITTED,
  DEMO_EVIDENCE_RECORDS,
  DEMO_PROOF_POLICY_PRESET,
  DEMO_RESULT,
  DEMO_RESULT_DIVERGENT,
  DEMO_SELF_EVALUATION,
} from "../src/contract.js";
import { DEMO_TAG } from "../src/contract.js";

/**
 * AR2-003 slice 2 UI-logic 测试（node:test；无 DOM）：
 * 验收场景 2（专家队列 + 候选提交 + 结构化自评——非独立投票）与
 * 场景 3（reviewer/adjudicator 视图 + criterionOutcomeSchema 驱动 +
 * 脱敏分区 + 自评不计入独立评审数）。
 */

const FOREIGN_PRINCIPAL = { tenant_id: "tnt_other0001", user_id: "usr_other0001" };

function candidateDraft(overrides: Record<string, unknown> = {}): CandidateDraft {
  return {
    artifact_manifest: "demo artifact manifest content v1",
    submission_notes: "demo: corrected rule + fixture-table diff attached",
    ...overrides,
  };
}

function selfEvalDraft(overrides: Partial<SelfEvaluationDraft> = {}): SelfEvaluationDraft {
  return {
    entries: [
      {
        criterion_id: "cri_00000001",
        decision: "PASS",
        evidence_ids: ["evd_public001", "evd_tenant001"],
        rationale: "demo: mismatch count 0 across the 12 edge cases",
      },
      {
        criterion_id: "cri_00000002",
        decision: "NOT_EVALUATED",
        evidence_ids: [],
        rationale: "demo: documentation left to reviewer rubric",
      },
    ],
    ...overrides,
  };
}

const SELF_EVAL_CONTEXT = {
  attempt_id: "att_00000001",
  criteria: DEMO_ACCEPTANCE_CRITERIA,
  known_evidence_ids: DEMO_KNOWN_EVIDENCE_IDS,
};

const FIXED_CLOCK = () => "2026-10-10T12:00:00Z";
const DEPS = { clock: FIXED_CLOCK, digest: () => "cd".repeat(32) };

// ---------------------------------------------------------------------------
// 场景 2 — 专家流
// ---------------------------------------------------------------------------

test("scenario 2: candidate draft builds an immutable candidate version", () => {
  const validation = validateCandidateDraft(candidateDraft(), { previous_candidates: 0 }, DEPS);
  assert.equal(validation.ok, true);
  if (validation.ok) {
    assert.equal(validation.candidate.candidate_version, 1);
    assert.equal(validation.candidate.immutable, true);
    assert.equal(validation.candidate.submitted_at, "2026-10-10T12:00:00Z");
    assert.equal(validation.candidate.artifact_manifest_digest, "cd".repeat(32));
  }
});

test("scenario 2: unknown candidate draft field is rejected (strict mirror)", () => {
  const draft = candidateDraft() as unknown as Record<string, unknown>;
  draft.candidate_version = 99; // caller must not set the version
  const validation = validateCandidateDraft(
    draft as unknown as CandidateDraft,
    { previous_candidates: 0 },
    DEPS,
  );
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.ok(validation.fieldErrors.some((e) => e.field === "candidate_version"));
  }
});

test("scenario 2: empty artifact manifest and notes are typed field errors", () => {
  const validation = validateCandidateDraft(
    candidateDraft({ artifact_manifest: "", submission_notes: "" }),
    { previous_candidates: 0 },
    DEPS,
  );
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.ok(validation.fieldErrors.some((e) => e.field === "artifact_manifest"));
    assert.ok(validation.fieldErrors.some((e) => e.field === "submission_notes"));
  }
});

test("scenario 2: candidate submission traverses the frozen attempt machine (ENVIRONMENT_READY → SUBMITTED)", () => {
  const transition = evaluateCandidateSubmission(DEMO_ATTEMPT_OPEN);
  assert.equal(transition.ok, true);
  if (transition.ok) {
    assert.equal(transition.to, "SUBMITTED");
    assert.equal(transition.matched?.command, "SubmitIntervention");
  }
});

test("scenario 2: candidate submission refused from non-ENVIRONMENT_READY states (INVALID_TRANSITION)", () => {
  for (const attempt of [DEMO_ATTEMPT_SUBMITTED, DEMO_ATTEMPT_DIVERGENT]) {
    const transition = evaluateCandidateSubmission(attempt);
    assert.equal(transition.ok, false);
    if (!transition.ok) {
      assert.equal(transition.code, "ARENA_INVALID_TRANSITION");
    }
  }
});

test("scenario 2: self-evaluation is structured and carries the never-a-vote literal", () => {
  const validation = validateSelfEvaluationDraft(selfEvalDraft(), SELF_EVAL_CONTEXT, DEPS);
  assert.equal(validation.ok, true);
  if (validation.ok) {
    assert.equal(validation.evaluation.never_an_independent_vote, true);
    assert.equal(validation.evaluation.rule, SELF_EVALUATION_IS_NOT_A_VOTE_RULE);
    assert.equal(validation.evaluation.demo.demo, true);
  }
});

test("scenario 2: unknown criterion in self-evaluation is rejected (no invented criteria)", () => {
  const validation = validateSelfEvaluationDraft(
    selfEvalDraft({
      entries: [
        ...selfEvalDraft().entries,
        {
          criterion_id: "cri_invented1",
          decision: "PASS",
          evidence_ids: [],
          rationale: "demo: invented criterion",
        },
      ],
    }),
    SELF_EVAL_CONTEXT,
    DEPS,
  );
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.ok(
      validation.fieldErrors.some(
        (e) => e.field === "entries.2.criterion_id" && e.rule.includes("no invented criteria"),
      ),
    );
  }
});

test("scenario 2: unknown evidence reference in self-evaluation is fail-closed", () => {
  const validation = validateSelfEvaluationDraft(
    selfEvalDraft({
      entries: [
        {
          criterion_id: "cri_00000001",
          decision: "PASS",
          evidence_ids: ["evd_doesnotexist"],
          rationale: "demo: dangling evidence reference",
        },
        selfEvalDraft().entries[1]!,
      ],
    }),
    SELF_EVAL_CONTEXT,
    DEPS,
  );
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.ok(
      validation.fieldErrors.some((e) =>
        e.rule.includes("unknown evidence reference (fail-closed)"),
      ),
    );
  }
});

test("scenario 2: incomplete criterion coverage is rejected (structured = every criterion)", () => {
  const validation = validateSelfEvaluationDraft(
    { entries: [selfEvalDraft().entries[0]!] },
    SELF_EVAL_CONTEXT,
    DEPS,
  );
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.ok(
      validation.fieldErrors.some(
        (e) => e.field === "entries" && e.rule.includes("missing criterion entry"),
      ),
    );
  }
});

test("scenario 2: self-evaluation submission traverses SUBMITTED → VERIFYING only when structured", () => {
  const ok = evaluateSelfEvaluationSubmission(DEMO_ATTEMPT_SUBMITTED, true);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.to, "VERIFYING");
    assert.equal(ok.matched?.command, "SubmitSelfEvaluation");
  }
  const unstructured = evaluateSelfEvaluationSubmission(DEMO_ATTEMPT_SUBMITTED, false);
  assert.equal(unstructured.ok, false);
  if (!unstructured.ok) {
    assert.equal(unstructured.code, "ARENA_INVARIANT_VIOLATION");
    assert.ok(unstructured.failed_guards.includes("self_evaluation_structured"));
  }
});

test("scenario 2: mock client expert surface — queue, workspace, tenant isolation", async () => {
  const client = new MockArenaClient();
  const queue = await client.listAssignments(DEMO_EXPERT_PRINCIPAL);
  assert.equal(queue.length, 4);
  assert.ok(queue.every((item) => item.demo.demo === true));
  const foreign = await client.listAssignments(FOREIGN_PRINCIPAL);
  assert.equal(foreign.length, 0);
  const found = await client.getAttempt("att_00000001", DEMO_EXPERT_PRINCIPAL);
  assert.equal(found.kind, "FOUND");
  const crossTenant = await client.getAttempt("att_00000001", FOREIGN_PRINCIPAL);
  assert.equal(crossTenant.kind, "NOT_FOUND"); // 跨租户与不存在不可区分
  const missing = await client.getAttempt("att_nope00001", DEMO_EXPERT_PRINCIPAL);
  assert.equal(missing.kind, "NOT_FOUND");
});

test("scenario 2: mock client submits a candidate through the frozen machine", async () => {
  const client = new MockArenaClient();
  const outcome = await client.submitCandidate(
    "att_00000001",
    candidateDraft(),
    DEMO_EXPERT_PRINCIPAL,
  );
  assert.equal(outcome.kind, "SUBMITTED");
  if (outcome.kind === "SUBMITTED") {
    assert.equal(outcome.candidate_version, 1);
    assert.equal(outcome.state, "SUBMITTED");
  }
  const after = await client.getAttempt("att_00000001", DEMO_EXPERT_PRINCIPAL);
  assert.equal(after.kind, "FOUND");
  if (after.kind === "FOUND") {
    assert.equal(after.attempt.status, "SUBMITTED");
    assert.equal(after.attempt.candidates.length, 1);
    assert.equal(after.attempt.candidates[0]?.immutable, true);
  }
});

test("scenario 2: mock client refuses a second candidate submission from SUBMITTED (no invented edges)", async () => {
  const client = new MockArenaClient();
  const first = await client.submitCandidate(
    "att_00000001",
    candidateDraft(),
    DEMO_EXPERT_PRINCIPAL,
  );
  assert.equal(first.kind, "SUBMITTED");
  const second = await client.submitCandidate(
    "att_00000001",
    candidateDraft(),
    DEMO_EXPERT_PRINCIPAL,
  );
  assert.equal(second.kind, "INVALID_TRANSITION");
  if (second.kind === "INVALID_TRANSITION") {
    assert.equal(second.code, "ARENA_INVALID_TRANSITION");
  }
});

test("scenario 2: mock client self-evaluation flow (SUBMITTED → VERIFYING) and non-vote posture", async () => {
  const client = new MockArenaClient();
  const outcome = await client.submitSelfEvaluation(
    "att_00000002",
    selfEvalDraft(),
    DEMO_EXPERT_PRINCIPAL,
  );
  assert.equal(outcome.kind, "SUBMITTED");
  if (outcome.kind === "SUBMITTED") {
    assert.equal(outcome.state, "VERIFYING");
    assert.equal(outcome.evaluation.never_an_independent_vote, true);
  }
});

test("scenario 2: mock client refuses self-evaluation on an open attempt (guard failure)", async () => {
  const client = new MockArenaClient();
  const outcome = await client.submitSelfEvaluation(
    "att_00000001",
    selfEvalDraft(),
    DEMO_EXPERT_PRINCIPAL,
  );
  assert.equal(outcome.kind, "INVALID_TRANSITION");
  if (outcome.kind === "INVALID_TRANSITION") {
    assert.equal(outcome.code, "ARENA_INVALID_TRANSITION");
  }
});

test("scenario 2: seed isolation — one client's transitions never leak into another instance", async () => {
  const mutating = new MockArenaClient();
  await mutating.submitCandidate("att_00000001", candidateDraft(), DEMO_EXPERT_PRINCIPAL);
  const fresh = new MockArenaClient();
  const attempt = await fresh.getAttempt("att_00000001", DEMO_EXPERT_PRINCIPAL);
  assert.equal(attempt.kind, "FOUND");
  if (attempt.kind === "FOUND") {
    assert.equal(attempt.attempt.status, "ENVIRONMENT_READY"); // fixture 未被污染
    assert.equal(attempt.attempt.candidates.length, 0);
  }
  assert.equal(DEMO_ATTEMPT_OPEN.status, "ENVIRONMENT_READY");
  assert.equal(DEMO_ATTEMPT_OPEN.candidates.length, 0);
});

// ---------------------------------------------------------------------------
// 场景 3 — reviewer/adjudicator 视图
// ---------------------------------------------------------------------------

test("scenario 3: review deck merges criterion outcomes with frozen criteria statements", () => {
  const deck = buildReviewDeck(
    DEMO_RESULT,
    DEMO_ACCEPTANCE_CRITERIA,
    DEMO_EVIDENCE_RECORDS,
    DEMO_SELF_EVALUATION,
    DEMO_TAG,
  );
  assert.equal(deck.criterion_rows.length, 2);
  const first = deck.criterion_rows[0]!;
  assert.equal(first.criterion_id, "cri_00000001");
  assert.equal(first.decision, "PASS");
  assert.equal(first.proof_class, "P1");
  assert.deepEqual([...first.evidence_ids], ["evd_public001", "evd_tenant001"]);
  assert.equal(first.statement.includes("fixture table"), true);
  const second = deck.criterion_rows[1]!;
  assert.equal(second.self_decision, "NOT_EVALUATED"); // 自评并排展示
});

test("scenario 3: redaction partition — reviewer_private separated, operator withheld (count only)", () => {
  const partition = partitionByRedactionClass(DEMO_EVIDENCE_RECORDS);
  assert.deepEqual(
    partition.shared.map((e) => e.redaction_class),
    ["public", "tenant"],
  );
  assert.equal(partition.reviewer_private.length, 1);
  assert.equal(partition.reviewer_private[0]?.evidence_id, "evd_review001");
  assert.equal(partition.withheld_operator_count, 1);
});

test("scenario 3: verification trail exposes every frozen field", () => {
  const deck = buildReviewDeck(
    DEMO_RESULT,
    DEMO_ACCEPTANCE_CRITERIA,
    DEMO_EVIDENCE_RECORDS,
    DEMO_SELF_EVALUATION,
    DEMO_TAG,
  );
  assert.deepEqual([...deck.trail.reviewer_ids], ["rev_00000001", "rev_00000002"]);
  assert.equal(deck.trail.adjudicator_id, null);
  assert.equal(deck.trail.policy_version, "PVP1.0");
  assert.deepEqual(
    deck.trail.validators.map((v) => `${v.validator_id}@${v.validator_version}`),
    ["val_00000001@1.0.0", "val_00000002@1.0.0"],
  );
  assert.deepEqual([...deck.trail.outcomes], ["rubric_band_B", "rubric_band_B"]);
});

test("scenario 3: self-evaluation never counts as an independent review", () => {
  const deck = buildReviewDeck(
    DEMO_RESULT,
    DEMO_ACCEPTANCE_CRITERIA,
    DEMO_EVIDENCE_RECORDS,
    DEMO_SELF_EVALUATION,
    DEMO_TAG,
  );
  assert.equal(deck.independent_review_count, 2); // 只来自 trail.reviewer_ids
  assert.equal(deck.self_evaluation?.never_an_independent_vote, true);
  const withoutSelf = buildReviewDeck(
    DEMO_RESULT,
    DEMO_ACCEPTANCE_CRITERIA,
    DEMO_EVIDENCE_RECORDS,
    null,
    DEMO_TAG,
  );
  assert.equal(withoutSelf.independent_review_count, 2); // 自评在场与否不影响计数
});

test("scenario 3: adjudication view flags divergence and hard-stop disputes", () => {
  const convergent = adjudicationView(
    buildReviewDeck(
      DEMO_RESULT,
      DEMO_ACCEPTANCE_CRITERIA,
      DEMO_EVIDENCE_RECORDS,
      DEMO_SELF_EVALUATION,
      DEMO_TAG,
    ),
    DEMO_PROOF_POLICY_PRESET.review_policy,
  );
  assert.equal(convergent.divergent, false);
  assert.equal(convergent.adjudicator_id, null);
  assert.ok(convergent.trigger?.includes("divergence"));

  const divergentDeck = buildReviewDeck(
    DEMO_RESULT_DIVERGENT,
    DEMO_ACCEPTANCE_CRITERIA,
    DEMO_EVIDENCE_RECORDS,
    DEMO_SELF_EVALUATION,
    DEMO_TAG,
  );
  const divergent = adjudicationView(divergentDeck, DEMO_PROOF_POLICY_PRESET.review_policy);
  assert.equal(divergent.divergent, true); // outcome 带分歧 + hard-stop 争议
  assert.equal(divergent.adjudicator_id, "adj_00000001");
});

test("scenario 3: mock client serves review decks tenant-scoped (cross-tenant = NOT_FOUND)", async () => {
  const client = new MockArenaClient();
  const own = await client.getReviewDeck("res_00000001", DEMO_EXPERT_PRINCIPAL);
  assert.equal(own.kind, "FOUND");
  if (own.kind === "FOUND") {
    assert.equal(own.deck.result_id, "res_00000001");
    assert.equal(own.deck.demo.demo, true);
    // operator 证据在 reviewer 面只出现计数，不出现 evidence_id
    assert.equal(own.deck.redaction.withheld_operator_count, 1);
    assert.ok(!own.deck.redaction.shared.some((e) => e.evidence_id === "evd_operator01"));
  }
  const foreign = await client.getReviewDeck("res_00000001", FOREIGN_PRINCIPAL);
  assert.equal(foreign.kind, "NOT_FOUND");
  const missing = await client.getReviewDeck("res_nope00001", DEMO_EXPERT_PRINCIPAL);
  assert.equal(missing.kind, "NOT_FOUND");
});

test("scenario 3: demo expert fixtures all validate against frozen schemas at client construction", () => {
  // 构造即校验：非法 seed 直接抛错（fail-closed demo data）。
  assert.doesNotThrow(() => new MockArenaClient());
  assert.equal(DEMO_EXPERT_TENANT_ID.length >= 8, true);
});

test("scenario 2/3: demo attempts carry terminal INCONCLUSIVE history without invented states", () => {
  assert.equal(DEMO_ATTEMPT_DIVERGENT.status, "INCONCLUSIVE");
  assert.equal(DEMO_ATTEMPT_DIVERGENT.candidates.length, 1);
  // INCONCLUSIVE 是冻结 attempt 状态机的合法终态（不发明状态）。
  assert.equal(
    ["ACCEPTED", "REJECTED", "INCONCLUSIVE", "FAILED", "EXPIRED", "SUPERSEDED"].includes(
      DEMO_ATTEMPT_DIVERGENT.status,
    ),
    true,
  );
});
