import assert from "node:assert/strict";
import test from "node:test";
import { evaluateTransition } from "@arena/contracts";
import { roundStateMachine, candidateStateMachine, reviewStateMachine } from "../src/contract.js";

/**
 * AR2-009 — 冻结状态机纪律（issue #11）：
 * 三台 EA 机器全部走冻结引擎；非法命令 → INVALID_TRANSITION；
 * 守卫不满足 → INVARIANT_VIOLATION + failed_guards；
 * 评审超时唯一的落点是 REPLACED（带补位守卫）—— 机器上不存在
 * 任何「缺席/超时 → 批准」的边。
 */

test("round machine: DRAFT → FROZEN requires all four pin guards", () => {
  const partial = evaluateTransition(roundStateMachine, "DRAFT", "CreateEscalation", {
    round_material_from_frozen_contract: true,
    rubric_version_pinned: true,
    budget_declared: true,
    deadline_declared: false,
  });
  assert.equal(partial.ok, false);
  if (!partial.ok) {
    assert.equal(partial.code, "ARENA_INVARIANT_VIOLATION");
    assert.deepEqual(partial.failed_guards, ["deadline_declared"]);
  }
  const complete = evaluateTransition(roundStateMachine, "DRAFT", "CreateEscalation", {
    round_material_from_frozen_contract: true,
    rubric_version_pinned: true,
    budget_declared: true,
    deadline_declared: true,
  });
  assert.equal(complete.ok, true);
  if (complete.ok) assert.equal(complete.to, "FROZEN");
});

test("round machine: full happy path DRAFT → … → CLOSED via frozen commands only", () => {
  const steps: Array<[string, string, Record<string, boolean>]> = [
    [
      "CreateEscalation",
      "FROZEN",
      {
        round_material_from_frozen_contract: true,
        rubric_version_pinned: true,
        budget_declared: true,
        deadline_declared: true,
      },
    ],
    [
      "StartAttempt",
      "OPEN_FOR_ATTEMPTS",
      { eligible_experts_notified: true, equalized_context_prepared: true },
    ],
    ["SystemExpireEscalation", "SUBMISSIONS_CLOSED", { submission_deadline_exceeded: true }],
    ["SystemBeginVerification", "VALIDATING", { at_least_one_candidate_submitted: true }],
    ["SystemBeginVerification", "REVIEWING", { independent_review_required: true }],
    ["SystemResolveDispute", "ADJUDICATING", { adjudication_trigger_met: true }],
    [
      "SystemResolveDispute",
      "DECIDED",
      { adjudication_recorded: true, adjudicator_independent: true },
    ],
    [
      "SystemReleasePayment",
      "PAYMENT_PENDING",
      {
        payment_operation_reference_present: true,
        payment_authority_external: true,
      },
    ],
    ["SystemReconcileProvider", "CLOSED", { payment_reference_resolved: true }],
  ];
  let state = roundStateMachine.initial;
  for (const [command, expected, facts] of steps) {
    const evaluation = evaluateTransition(roundStateMachine, state, command, facts);
    assert.equal(evaluation.ok, true, `${state} --${command}--> failed`);
    if (evaluation.ok) {
      assert.equal(evaluation.to, expected);
      state = expected;
    }
  }
  assert.equal(state, "CLOSED");
});

test("round machine: P0/P1 rounds decide from VALIDATING on validator evidence", () => {
  const evaluation = evaluateTransition(
    roundStateMachine,
    "VALIDATING",
    "SystemRecordProofDecision",
    {
      validator_evidence_decisive: true,
      hard_stop_criteria_not_failed: true,
    },
  );
  assert.equal(evaluation.ok, true);
  if (evaluation.ok) assert.equal(evaluation.to, "DECIDED");
});

test("round machine: unknown command in state → typed INVALID_TRANSITION", () => {
  const evaluation = evaluateTransition(roundStateMachine, "FROZEN", "SubmitAppeal", {});
  assert.equal(evaluation.ok, false);
  if (!evaluation.ok) assert.equal(evaluation.code, "ARENA_INVALID_TRANSITION");
});

test("candidate machine: submission requires immutable version + manifest + structured self-evaluation", () => {
  const missing = evaluateTransition(candidateStateMachine, "DRAFT", "SubmitIntervention", {
    candidate_version_immutable: true,
    artifact_manifest_present: true,
    self_evaluation_structured: false,
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.deepEqual(missing.failed_guards, ["self_evaluation_structured"]);

  const ok = evaluateTransition(candidateStateMachine, "DRAFT", "SubmitIntervention", {
    candidate_version_immutable: true,
    artifact_manifest_present: true,
    self_evaluation_structured: true,
  });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.to, "SUBMITTED");
});

test("candidate machine: revision path creates a new submission round-trip", () => {
  const requested = evaluateTransition(
    candidateStateMachine,
    "INDEPENDENT_REVIEW",
    "RequestRevision",
    {
      revision_allowed_within_policy: true,
    },
  );
  assert.equal(requested.ok, true);
  if (requested.ok) assert.equal(requested.to, "REVISION_REQUESTED");
  const resubmitted = evaluateTransition(
    candidateStateMachine,
    "REVISION_REQUESTED",
    "SubmitIntervention",
    {
      candidate_version_immutable: true,
      artifact_manifest_present: true,
      new_revision_version_created: true,
    },
  );
  assert.equal(resubmitted.ok, true);
  if (resubmitted.ok) assert.equal(resubmitted.to, "SUBMITTED");
});

test("review machine: timeout lands ONLY in REPLACED with replacement guard — never approval", () => {
  const fromAssigned = evaluateTransition(
    reviewStateMachine,
    "ASSIGNED",
    "SystemExpireEscalation",
    {
      review_deadline_exceeded: true,
      replacement_requested: false,
    },
  );
  assert.equal(fromAssigned.ok, false, "replacement_requested guard is mandatory");
  const replaced = evaluateTransition(reviewStateMachine, "ASSIGNED", "SystemExpireEscalation", {
    review_deadline_exceeded: true,
    replacement_requested: true,
  });
  assert.equal(replaced.ok, true);
  if (replaced.ok) assert.equal(replaced.to, "REPLACED");

  // 结构性审计：三台机器的迁移目标里不存在任何「超时后进入已批准终态」的边。
  for (const machine of [roundStateMachine, candidateStateMachine, reviewStateMachine]) {
    for (const rule of machine.transitions) {
      if (rule.command === "SystemExpireEscalation") {
        assert.notEqual(rule.to, "ACCEPTED", `${machine.id} must never approve on expiry`);
        assert.notEqual(rule.to, "DECIDED", `${machine.id} must never decide on expiry`);
        assert.notEqual(
          rule.to,
          "FINALIZED",
          `${machine.id} must never finalize a review on expiry`,
        );
      }
    }
  }
});

test("review machine: evaluation submission requires all dimensions + evidence + uncertainty", () => {
  const evaluation = evaluateTransition(
    reviewStateMachine,
    "IN_PROGRESS",
    "SubmitReviewerEvaluation",
    {
      all_required_dimensions_scored: true,
      evidence_refs_attached: true,
      uncertainty_disclosed: false,
    },
  );
  assert.equal(evaluation.ok, false);
  if (!evaluation.ok) assert.deepEqual(evaluation.failed_guards, ["uncertainty_disclosed"]);
});

test("machines: guard-flavored verdicts are typed INVARIANT_VIOLATION with legible failed_guards", () => {
  const reviewAccepted = evaluateTransition(reviewStateMachine, "ASSIGNED", "AcceptOffer", {
    reviewer_conflict_check_passed: false,
    reviewer_capacity_available: true,
  });
  assert.equal(reviewAccepted.ok, false);
  if (!reviewAccepted.ok) {
    assert.equal(reviewAccepted.code, "ARENA_INVARIANT_VIOLATION");
    assert.deepEqual(reviewAccepted.failed_guards, ["reviewer_conflict_check_passed"]);
  }
});
