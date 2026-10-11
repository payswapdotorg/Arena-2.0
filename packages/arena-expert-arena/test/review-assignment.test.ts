import assert from "node:assert/strict";
import test from "node:test";
import { ReviewAssignmentRegistry, checkReviewerEligibility } from "../src/contract.js";
import type { ExpertProfile } from "@arena/matching";

/**
 * AR2-009 — 冲突筛查的评审分配（issue #11 验收）：
 * 同人自评拒绝；同轮其它候选作者拒绝；容量耗尽拒绝；
 * AR2-008 委托冲突（失败尝试/先前参与/租户关系）拒绝；
 * 超时 → REPLACED + 补位请求（批准恒为 false —— 结构字面量）。
 */

function reviewer(expertId: string, tenantId = "tnt_00000002"): ExpertProfile {
  return {
    expert_id: expertId,
    tenant_id: tenantId,
    capabilities: [
      { capability_id: "cap_00000001", level: "senior", evidence_refs: ["evd_00000009"] },
    ],
    qualifications: [
      {
        qualification: "licensed engineer",
        evidence_refs: ["evd_00000010"],
        jurisdiction: "GH",
        expires_at: null,
      },
    ],
    availability: { max_concurrent_attempts: 3, active_attempts: 0 },
    jurisdictions: ["GH"],
    policy_flags: [],
  };
}

const CAPACITY = (expertId: string, active: number) => ({
  expert_id: expertId,
  active_review_slots: active,
  max_concurrent_reviews: 2,
});

const CLEAN_CONTEXT = {
  round_candidate_author_ids: ["exp_00000001", "exp_00000002"],
  failed_attempt_expert_ids: [],
  prior_involvement_expert_ids: [],
  conflicted_tenant_ids: [],
};

test("an ineligible or conflicted evaluator cannot review the candidate", () => {
  // 1) 同人自评（self-review）。
  const selfReview = checkReviewerEligibility({
    reviewer: reviewer("exp_00000001"),
    candidate_author_expert_id: "exp_00000001",
    context: CLEAN_CONTEXT,
    capacity: CAPACITY("exp_00000001", 0),
  });
  assert.equal(selfReview.ok, false);
  if (!selfReview.ok) assert.ok(selfReview.reasons.includes("same_expert_as_candidate_author"));

  // 2) 同轮其它候选的作者（attempt participation）。
  const roundAuthor = checkReviewerEligibility({
    reviewer: reviewer("exp_00000002"),
    candidate_author_expert_id: "exp_00000001",
    context: CLEAN_CONTEXT,
    capacity: CAPACITY("exp_00000002", 0),
  });
  assert.equal(roundAuthor.ok, false);
  if (!roundAuthor.ok)
    assert.ok(roundAuthor.reasons.includes("author_of_another_candidate_in_round"));

  // 3) 容量耗尽。
  const exhausted = checkReviewerEligibility({
    reviewer: reviewer("exp_00000003"),
    candidate_author_expert_id: "exp_00000001",
    context: CLEAN_CONTEXT,
    capacity: CAPACITY("exp_00000003", 2),
  });
  assert.equal(exhausted.ok, false);
  if (!exhausted.ok) assert.ok(exhausted.reasons.includes("reviewer_capacity_exhausted"));

  // 4) 委托 AR2-008 冲突：失败尝试归因。
  const failedAttempt = checkReviewerEligibility({
    reviewer: reviewer("exp_00000003"),
    candidate_author_expert_id: "exp_00000001",
    context: { ...CLEAN_CONTEXT, failed_attempt_expert_ids: ["exp_00000003"] },
    capacity: CAPACITY("exp_00000003", 0),
  });
  assert.equal(failedAttempt.ok, false);
  if (!failedAttempt.ok) assert.ok(failedAttempt.explanation.includes("conflict-of-interest"));

  // 5) 委托 AR2-008 冲突：租户关系。
  const tenantConflict = checkReviewerEligibility({
    reviewer: reviewer("exp_00000003", "tnt_00000009"),
    candidate_author_expert_id: "exp_00000001",
    context: { ...CLEAN_CONTEXT, conflicted_tenant_ids: ["tnt_00000009"] },
    capacity: CAPACITY("exp_00000003", 0),
  });
  assert.equal(tenantConflict.ok, false);

  // 6) 干净的第三方评审人可以通过。
  const clean = checkReviewerEligibility({
    reviewer: reviewer("exp_00000003", "tnt_00000002"),
    candidate_author_expert_id: "exp_00000001",
    context: CLEAN_CONTEXT,
    capacity: CAPACITY("exp_00000003", 0),
  });
  assert.equal(clean.ok, true);
});

test("reviewer timeout triggers replacement, never implicit approval", () => {
  const registry = new ReviewAssignmentRegistry(() => "2026-10-11T08:00:00Z");
  const assigned = registry.assignReviewer({
    round_id: "round_00000001",
    candidate_id: "cand_00000001",
    reviewer_expert_id: "exp_00000003",
  });
  const outcome = registry.replaceOnTimeout({
    assignment_id: assigned.assignment_id,
    reason: "deadline_exceeded",
    deadline: "2026-10-12T08:00:00Z",
  });
  assert.equal(outcome.kind, "REPLACED");
  if (outcome.kind === "REPLACED") {
    assert.equal(outcome.approval_implied, false);
    assert.match(outcome.record.replacement_note ?? "", /replacement requested/);
    assert.match(outcome.record.replacement_note ?? "", /never inferred from absence/);
    assert.equal(outcome.record.state, "REPLACED");
  }
  // 已替换的分配不能再被替换（幂等失败）。
  const again = registry.replaceOnTimeout({
    assignment_id: assigned.assignment_id,
    reason: "deadline_exceeded",
    deadline: "2026-10-12T08:00:00Z",
  });
  assert.equal(again.kind, "NOT_ASSIGNED");
  // 补位：新评审人接到新分配。
  const replacement = registry.assignReviewer({
    round_id: "round_00000001",
    candidate_id: "cand_00000001",
    reviewer_expert_id: "exp_00000004",
  });
  assert.equal(replacement.state, "ASSIGNED");
  assert.equal(registry.activeAssignments("cand_00000001").length, 1);
});

test("reviewer forfeit (not just deadline) also lands in REPLACED", () => {
  const registry = new ReviewAssignmentRegistry(() => "2026-10-11T08:00:00Z");
  const assigned = registry.assignReviewer({
    round_id: "round_00000001",
    candidate_id: "cand_00000002",
    reviewer_expert_id: "exp_00000005",
  });
  const outcome = registry.replaceOnTimeout({
    assignment_id: assigned.assignment_id,
    reason: "forfeited",
    deadline: "2026-10-11T09:00:00Z",
  });
  assert.equal(outcome.kind, "REPLACED");
  if (outcome.kind === "REPLACED") assert.equal(outcome.approval_implied, false);
});
