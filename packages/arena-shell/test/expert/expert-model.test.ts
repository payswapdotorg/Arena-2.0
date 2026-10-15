import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPSULE_ENTRY_DISABLED_DISCLOSURE,
  isolationPostureViewModel,
  payoutStatusViewModel,
  PAYOUT_FOLLOWS_PROOF_RULE,
  queueRowViewModel,
  SELF_EVALUATION_VISUAL_DISTINCTION,
} from "../../src/screens/expert/viewModel.js";
import { ARENA_RELEASE_POSTURE } from "../../src/contract.js";
import { commandOutcomeText } from "../../src/screens/requester/viewModel.js";

/**
 * UIA-001 Lane B — 专家工位纯视图模型测试（PURE；无 DOM、无网络）。
 *
 * 覆盖：隔离姿态 §2.3 逐字（untrusted execution DISABLED + 记录依据）、
 * 支付资格展示推导（失败/不确定不支付）、队列类型化事实、demo 标注、
 * 自评区分文本、命令结果逐字渲染。
 */

test("isolation posture renders the recorded release posture verbatim (§2.3 FROZEN)", () => {
  const vm = isolationPostureViewModel();
  assert.equal(vm.untrustedExecution, "disabled");
  assert.equal(vm.posture.releaseDecision, "NOT_GO");
  assert.equal(vm.posture.financeMode, "test_mode");
  assert.equal(vm.isolationEvidence, ARENA_RELEASE_POSTURE.isolationEvidence);
  assert.match(CAPSULE_ENTRY_DISABLED_DISCLOSURE, /Untrusted expert execution is DISABLED/);
  assert.match(CAPSULE_ENTRY_DISABLED_DISCLOSURE, /truthfully disabled \(never absent\)/);
  assert.match(CAPSULE_ENTRY_DISABLED_DISCLOSURE, new RegExp(ARENA_RELEASE_POSTURE.isolationEvidence));
});

test("payout follows proof: failed/inconclusive never pays, in-progress never infers eligibility", () => {
  assert.match(PAYOUT_FOLLOWS_PROOF_RULE, /failed or inconclusive proof never pays/);
  assert.match(PAYOUT_FOLLOWS_PROOF_RULE, /test-mode ledger/);
  assert.equal(payoutStatusViewModel("ACCEPTED").verdictEligible, true);
  assert.equal(payoutStatusViewModel("REJECTED").verdictEligible, false);
  assert.equal(payoutStatusViewModel("FAILED").verdictEligible, false);
  assert.equal(payoutStatusViewModel("INCONCLUSIVE").verdictEligible, false);
  assert.equal(payoutStatusViewModel("EXPIRED").verdictEligible, false);
  assert.equal(payoutStatusViewModel("VERIFYING").verdictEligible, null);
  assert.equal(payoutStatusViewModel(null).verdictEligible, null);
});

test("queue rows carry typed facts and the demo tag honestly", () => {
  const row = queueRowViewModel({
    attempt_id: "att_00000001",
    escalation_id: "esc_00000001",
    state: "ENVIRONMENT_READY",
    expert_id: "exp_00000001",
    budget_remaining: 120,
    currency: "USD",
    candidates: 0,
    demo: { demo: true, disclosure: "DEMO — deterministic fixtures" },
  });
  assert.equal(row.attempt_id, "att_00000001");
  assert.equal(row.state, "ENVIRONMENT_READY");
  assert.equal(row.demo, true);
});

test("self-evaluation carries the frozen never-a-vote distinction text", () => {
  assert.match(SELF_EVALUATION_VISUAL_DISTINCTION, /never an independent vote/);
  assert.match(SELF_EVALUATION_VISUAL_DISTINCTION, /never a verifier decision/);
  assert.match(SELF_EVALUATION_VISUAL_DISTINCTION, /never the sole payment trigger/);
});

test("command outcomes render verbatim across the typed outcome space", () => {
  const envelope = {
    code: "ARENA_ESCALATION_NOT_FOUND" as const,
    message: "no such escalation for this principal",
    correlation_id: "corr_5",
    request_id: null,
    details: null,
  };
  assert.equal(
    commandOutcomeText({ kind: "NOT_FOUND", envelope }),
    "NOT_FOUND ARENA_ESCALATION_NOT_FOUND: no such escalation for this principal",
  );
  const invalid = commandOutcomeText({
    kind: "INVALID_TRANSITION",
    envelope: {
      code: "ARENA_INVALID_TRANSITION" as const,
      message: "no edge from CREATED via SubmitIntervention",
      correlation_id: "corr_6",
      request_id: null,
      details: null,
    },
  });
  assert.match(invalid, /INVALID_TRANSITION ARENA_INVALID_TRANSITION/);
  assert.match(invalid, /no edge from CREATED via SubmitIntervention/);
  const guardFailed = commandOutcomeText({
    kind: "INVARIANT_VIOLATION",
    envelope: {
      code: "ARENA_INVARIANT_VIOLATION" as const,
      message: "guard failed",
      correlation_id: "corr_7",
      request_id: null,
      details: null,
    },
    failed_guards: ["candidate_version_immutable"],
  });
  assert.match(guardFailed, /failed guards: candidate_version_immutable/);
});
