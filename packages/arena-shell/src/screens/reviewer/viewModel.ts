/**
 * UIA-001 Lane C — 评审/裁决视图模型（spec §1.1/§2.2/§2.3）。
 *
 * 冻结纪律（packet C1）：
 * - 证据优先：deck 视图直接消费 workbench 公开面的 buildReviewDeck
 *   产物（criterion 行 / trail / 脱敏分区 / 自评分离 —— 全部冻结形状）；
 * - 独立评审与自评视觉区分（SELF_EVALUATION_IS_NOT_A_VOTE_RULE）；
 *   independent_review_count 只来自 trail.reviewer_ids，自评永不计入；
 * - 裁决路径经 adjudicationView（分歧/hard-stop 争议 —— 冻结语义）；
 * - 支付资格与结果挂钩：failed/inconclusive 绝不支付；重复操作不能
 *   双重支付（幂等法逐字）；test_mode 披露；
 * - 证据等级（DEMO/FIXTURE/REAL）逐字流转，绝不升值。
 */
import {
  adjudicationView,
  SELF_EVALUATION_IS_NOT_A_VOTE_RULE,
  type AdjudicationView,
  type ReviewDeckView,
  type ReviewPolicyLike,
} from "@arena/workbench";
import { ARENA_RELEASE_POSTURE } from "../../contract.js";

/** 评审结论 chip 的展示类别（从冻结 decision 词表派生）。 */
export type ReviewDecision = "PASS" | "FAIL" | "INCONCLUSIVE" | "NOT_EVALUATED";

/** 法定人数视图：独立评审数 vs 策略下限（自评不计入）。 */
export interface QuorumViewModel {
  independentReviewCount: number;
  minimumIndependentReviews: number | null;
  satisfied: boolean | null;
  basis: string;
}

export function quorumViewModel(deck: ReviewDeckView, policy: ReviewPolicyLike | null): QuorumViewModel {
  const minimum = policy?.minimum_independent_reviews ?? null;
  return {
    independentReviewCount: deck.independent_review_count,
    minimumIndependentReviews: minimum,
    satisfied: minimum === null ? null : deck.independent_review_count >= minimum,
    basis:
      "the independent review count comes exclusively from the verification trail's reviewer_ids; " +
      "a self-evaluation never counts toward quorum",
  };
}

/** 裁决视图（冻结 adjudicationView 的展示包装）。 */
export interface AdjudicationPanelViewModel {
  view: AdjudicationView;
  triggerRecorded: boolean;
}

export function adjudicationPanelViewModel(deck: ReviewDeckView, policy: ReviewPolicyLike | null): AdjudicationPanelViewModel {
  return {
    view: adjudicationView(deck, policy),
    triggerRecorded: policy?.adjudication_trigger != null,
  };
}

/** 支付资格（结果挂钩 —— 冻结规则逐字）。 */
export const PAYOUT_ELIGIBILITY_RULE =
  "payout eligibility follows the typed result status verbatim: ACCEPTED may pay pending accepted " +
  "proof evidence; REJECTED / INCONCLUSIVE / EXPIRED / FAILED never pay; duplicate operations " +
  "cannot double pay (idempotency: same key replays the stored outcome, no second side effect)";

export const TEST_MODE_LEDGER_DISCLOSURE =
  `ledger mode ${ARENA_RELEASE_POSTURE.financeMode} — no live money moves in this release posture ` +
  `(release decision ${ARENA_RELEASE_POSTURE.releaseDecision} per ${ARENA_RELEASE_POSTURE.decisionBasis})`;

export type PayoutEligibility =
  | { kind: "eligible_pending_proof"; status: string }
  | { kind: "not_eligible"; status: string; rule: string }
  | { kind: "unknown_status"; status: string };

/** 结果状态 → 支付资格展示（词表 1:1；未知状态失败关闭）。 */
export function payoutEligibility(status: string): PayoutEligibility {
  switch (status) {
    case "ACCEPTED":
      return { kind: "eligible_pending_proof", status };
    case "PARTIALLY_ACCEPTED":
      return { kind: "eligible_pending_proof", status };
    case "REJECTED":
    case "INCONCLUSIVE":
    case "EXPIRED":
    case "FAILED":
      return { kind: "not_eligible", status, rule: "failed or inconclusive proof never pays" };
    default:
      return { kind: "unknown_status", status };
  }
}

export const SELF_EVALUATION_DISTINCTION_TEXT = SELF_EVALUATION_IS_NOT_A_VOTE_RULE;

/** 证据等级展示（逐字 —— 绝不升值）。 */
export function evidenceGradeOf(deck: ReviewDeckView): string {
  return deck.demo.demo ? "DEMO" : "REAL";
}
