import type { ProofPolicySnapshot } from "@arena/contracts";
import type { ProofDecision } from "@arena/evidence";

/**
 * AR2-010 — 支付资格闸门（PVP1.0 §3/§4；issue #12）。
 *
 * 消费 AR2-007 的 ProofDecision（decision-only），推导冻结支付状态机的
 * 守卫事实 —— 但资格判定绝不等于结算（ELIGIBILITY_IS_NOT_SETTLEMENT_RULE：
 * EVIDENCE_ACCEPTED / READY_TO_RELEASE ≠ SETTLED；provider 确认 + 台账
 * 对账才构成结算，见 payment-flow.ts）。
 *
 * 不变量 6（ES2.0 §6）的守卫事实派生：
 * - evidence_conclusive ⇔ ProofDecision.status === "SATISFIED"
 * - not_disputed ⇔ 无未决争议（显式输入，不从证据推断）
 * - not_self_approved ⇔ ProofDecision.self_evaluation_counted === false
 *   （AR2-007 评估器已保证永远为 false —— 双重防线）
 * - evidence_binding_correct ⇔ 决策引用的证据绑定与本次 attempt 一致
 *   （显式输入：绑定校验结果）
 */

export interface EligibilityInput {
  decision: ProofDecision;
  policy: ProofPolicySnapshot;
  /** 未决争议（SubmitAppeal 后、SystemResolveDispute 前 = true）。 */
  disputed: boolean;
  /** 证据绑定校验结果（tenant/escalation/attempt 一致性）。 */
  bindingCorrect: boolean;
}

export type EligibilityGuards = {
  evidence_conclusive: boolean;
  not_disputed: boolean;
  not_self_approved: boolean;
  evidence_binding_correct: boolean;
};

export type EligibilityOutcome =
  | { kind: "EVIDENCE_GATE_PASSED"; guards: EligibilityGuards; decision: ProofDecision }
  | {
      kind: "EVIDENCE_GATE_BLOCKED";
      guards: EligibilityGuards;
      decision: ProofDecision;
      reason: string;
      /** 路由提示（与 ProofDecision.routing_hint 同族；不执行路由）。 */
      routing: "next_expert" | "retry_within_budget" | "independent_review" | "fail_closed";
    };

/** 资格闸门第一步：PENDING_EVIDENCE → EVIDENCE_ACCEPTED 的守卫事实。 */
export function evaluateEvidenceGate(input: EligibilityInput): EligibilityOutcome {
  const guards: EligibilityGuards = {
    evidence_conclusive: input.decision.status === "SATISFIED",
    not_disputed: !input.disputed,
    not_self_approved: input.decision.self_evaluation_counted === false,
    evidence_binding_correct: input.bindingCorrect,
  };
  const failed: string[] = [];
  if (!guards.evidence_conclusive) failed.push("evidence_conclusive");
  if (!guards.not_disputed) failed.push("not_disputed");
  if (!guards.not_self_approved) failed.push("not_self_approved");
  if (!guards.evidence_binding_correct) failed.push("evidence_binding_correct");

  if (failed.length === 0) {
    return { kind: "EVIDENCE_GATE_PASSED", guards, decision: input.decision };
  }
  // FAILED/INCONCLUSIVE/争议/自批准/错绑定 → 不得进入 EVIDENCE_ACCEPTED（fail-closed）。
  const inconclusive = input.decision.status === "INCONCLUSIVE";
  return {
    kind: "EVIDENCE_GATE_BLOCKED",
    guards,
    decision: input.decision,
    reason: `invariant-6 gate failed: ${failed.join(", ")} (decision status ${input.decision.status})`,
    routing: failed.includes("not_disputed")
      ? "fail_closed"
      : inconclusive
        ? input.decision.routing_hint === "next_expert"
          ? "next_expert"
          : input.decision.routing_hint === "retry_within_budget"
            ? "retry_within_budget"
            : input.decision.routing_hint === "independent_review"
              ? "independent_review"
              : "fail_closed"
        : "next_expert",
  };
}

export type PayoutGateGuards = {
  all_predicates_passed: boolean;
  caller_authenticity_verified: boolean;
  task_binding_verified: boolean;
};

export type PayoutGateOutcome =
  | { kind: "READY_TO_RELEASE"; guards: PayoutGateGuards }
  | {
      kind: "NOT_READY";
      guards: PayoutGateGuards;
      reason: string;
    };

/**
 * 资格闸门第二步：EVIDENCE_ACCEPTED → READY_TO_RELEASE。
 * 事实来源 = 冻结 ProofPolicySnapshot.payout_gate（创建时钉死、不可追溯削弱）
 * + 决策本身。P2/P3 决策在此永远 NOT_READY：PVP1.0 §3 要求 rubric 加独立
 * 评审批准 —— 独立评审记录属于 AR2-009（fail-closed，绝不自动放行）。
 */
export function evaluatePayoutGate(
  decision: ProofDecision,
  policy: ProofPolicySnapshot,
): PayoutGateOutcome {
  const gate = policy.payout_gate;
  const guards: PayoutGateGuards = {
    all_predicates_passed:
      decision.status === "SATISFIED" && satisfiesReleaseRequires(decision, gate.release_requires),
    caller_authenticity_verified: gate.caller_authenticity_verified,
    task_binding_verified: gate.task_binding_verified,
  };
  const failed: string[] = [];
  if (!guards.all_predicates_passed) failed.push("all_predicates_passed");
  if (!guards.caller_authenticity_verified) failed.push("caller_authenticity_verified");
  if (!guards.task_binding_verified) failed.push("task_binding_verified");

  if (failed.length === 0) {
    return { kind: "READY_TO_RELEASE", guards };
  }
  return {
    kind: "NOT_READY",
    guards,
    reason: `payout gate not satisfied: ${failed.join(", ")} (release_requires=${gate.release_requires}, decision status ${decision.status})`,
  };
}

/**
 * release_requires 与决策的合取（PVP1.0 §3）：
 * - all_predicates_pass：P0 语义 —— 决策 SATISFIED 即全部谓词通过；
 * - aggregate_threshold_pass：P1 —— SATISFIED 的 P1 决策已含冻结聚合达标；
 * - rubric_plus_independent_approval：P2 —— 需 AR2-009 独立评审批准记录，
 *   本包不做该判定（fail-closed：无批准记录 → false）；
 * - observation_gate_pass：P3 —— 需可信来源观察/attestation 记录（同上）。
 */
function satisfiesReleaseRequires(
  decision: ProofDecision,
  requires: ProofPolicySnapshot["payout_gate"]["release_requires"],
): boolean {
  switch (requires) {
    case "all_predicates_pass":
      return decision.selected_class === "P0" && decision.status === "SATISFIED";
    case "aggregate_threshold_pass":
      return decision.selected_class === "P1" && decision.status === "SATISFIED";
    case "rubric_plus_independent_approval":
      return false; // AR2-009 独立评审批准记录落地前 fail-closed。
    case "observation_gate_pass":
      return false; // 可信来源观察/attestation 记录落地前 fail-closed。
  }
}
