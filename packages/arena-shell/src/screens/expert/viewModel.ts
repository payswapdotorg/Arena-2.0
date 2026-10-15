/**
 * UIA-001 Lane B — 专家工位视图模型（spec §1.1/§2.3）。
 *
 * 冻结纪律（packet B2）：
 * - 队列/资格/冲突 = 类型化事实逐字（从不软化冲突拒绝）；
 * - SECURITY-STATE HONESTY（§2.3 FROZEN）：隔离姿态从 ARENA_RELEASE_POSTURE
 *   展示（untrusted execution DISABLED）；受限制行为渲染为「如实禁用 +
 *   记录依据」，绝不渲染为不存在，也绝不暗示安全隔离超出记录证据；
 * - 自评是可见证据、永不构成独立投票（SELF_EVALUATION_IS_NOT_A_VOTE_RULE
 *   逐字 + 视觉区分）；
 * - 支付：失败/不确定证明绝不支付（类型化结果逐字）。
 */
import type { AttemptSummary } from "@arena/workbench";
import { ARENA_RELEASE_POSTURE, type ArenaReleasePosture } from "../../contract.js";

/** 隔离姿态（§2.3 —— 每个角色面必须诚实展示的记录姿态）。 */
export interface IsolationPostureViewModel {
  posture: ArenaReleasePosture;
  untrustedExecution: string;
  isolationEvidence: string;
  capsuleDisclosure: string;
}

export const CAPSULE_ENTRY_DISABLED_DISCLOSURE =
  "Untrusted expert execution is DISABLED in the recorded release posture — the privacy-bounded " +
  "capsule entry point is truthfully disabled (never absent) with the recorded basis: " +
  ARENA_RELEASE_POSTURE.isolationEvidence;

export function isolationPostureViewModel(): IsolationPostureViewModel {
  return {
    posture: ARENA_RELEASE_POSTURE,
    untrustedExecution: ARENA_RELEASE_POSTURE.untrustedExecution,
    isolationEvidence: ARENA_RELEASE_POSTURE.isolationEvidence,
    capsuleDisclosure: CAPSULE_ENTRY_DISABLED_DISCLOSURE,
  };
}

/** 队列行（类型化事实；demo 标注随行 —— 数据面是 DEMO 时如实显示）。 */
export interface QueueRowViewModel {
  attempt_id: string;
  escalation_id: string;
  state: string;
  expert_id: string;
  budget_remaining: number;
  currency: string;
  candidates: number;
  demo: boolean;
}

export function queueRowViewModel(summary: AttemptSummary): QueueRowViewModel {
  return {
    attempt_id: summary.attempt_id,
    escalation_id: summary.escalation_id,
    state: summary.state,
    expert_id: summary.expert_id,
    budget_remaining: summary.budget_remaining,
    currency: summary.currency,
    candidates: summary.candidates,
    demo: summary.demo.demo === true,
  };
}

export function queueRowsViewModel(summaries: readonly AttemptSummary[]): readonly QueueRowViewModel[] {
  return summaries.map(queueRowViewModel);
}

/** 支付/证明状态（失败/不确定不支付法逐字）。 */
export const PAYOUT_FOLLOWS_PROOF_RULE =
  "payout follows the typed proof outcome verbatim — failed or inconclusive proof never pays " +
  "(test-mode ledger; no live money in this release posture)";

export interface PayoutStatusViewModel {
  rule: string;
  financeMode: string;
  attemptState: string | null;
  verdictEligible: boolean | null;
}

/**
 * 支付资格视图：attempt 态经冻结词表推导「可支付性」的展示事实。
 * ACCEPTED → 有支付资格（待证明结果）；REJECTED/FAILED/EXPIRED → 无；
 * INCONCLUSIVE → 明确「不确定 —— 不支付」；其它（进行中）→ null（未到
 * 支付阶段，不推断）。这是展示推导（非授权）：权威在服务端。
 */
export function payoutStatusViewModel(attemptState: string | null): PayoutStatusViewModel {
  let verdictEligible: boolean | null = null;
  if (attemptState !== null) {
    if (attemptState === "ACCEPTED") verdictEligible = true;
    else if (attemptState === "REJECTED" || attemptState === "FAILED" || attemptState === "EXPIRED" || attemptState === "SUPERSEDED") verdictEligible = false;
    else if (attemptState === "INCONCLUSIVE") verdictEligible = false;
  }
  return {
    rule: PAYOUT_FOLLOWS_PROOF_RULE,
    financeMode: ARENA_RELEASE_POSTURE.financeMode,
    attemptState,
    verdictEligible,
  };
}

/** 自评面板的视觉区分法（永不投票 —— 冻结文本 + 结构标记）。 */
export const SELF_EVALUATION_VISUAL_DISTINCTION =
  "structured self-evaluation — visible evidence, never an independent vote, never a verifier " +
  "decision, never the sole payment trigger";
