/**
 * UIA-001 Lane B — 支付状态视图模型（spec/ux/arena-native-ui.md §2.3）。
 *
 * 冻结纪律（packet B1.5）：
 * - 支付一律 test_mode 披露（ARENA_RELEASE_POSTURE.financeMode 逐字），
 *   绝不暗示真钱；姿态条上下文来自 ARENA_RELEASE_POSTURE；
 * - 支付状态机的状态 chip 经 WORKBENCH_STATE_VIEWS/stateView 1:1 流转，
 *   绝不发明状态；
 * - 失败/不确定的证明结果绝不支付（类型化结果逐字渲染）。
 */
import {
  ARENA_RELEASE_POSTURE,
  type ArenaReleasePosture,
} from "../../contract.js";
import { stateView, type StateView } from "@arena/workbench";

/** test-mode 支付披露（常量逐字 —— 姿态即证据）。 */
export const TEST_MODE_PAYMENT_DISCLOSURE =
  `Payments run in ${ARENA_RELEASE_POSTURE.financeMode} only — no live money moves in this ` +
  `release posture (release decision ${ARENA_RELEASE_POSTURE.releaseDecision} per ` +
  `${ARENA_RELEASE_POSTURE.decisionBasis})`;

/** 失败/不确定证明不支付法（领域规则文本 —— 逐字）。 */
export const FAILED_PROOF_NEVER_PAYS_RULE =
  "a failed or inconclusive proof outcome never pays; payout follows the typed proof " +
  "outcome verbatim (no payment without accepted evidence)";

export type PaymentStateChip =
  | { view: StateView }
  | { unknown: true; state: string };

/** 支付状态 chip（渲染守卫经 stateView —— 未知值失败关闭标记）。 */
export function paymentChip(state: string): PaymentStateChip {
  const view = stateView("payment", state);
  if ("unknown" in view) {
    return { unknown: true, state: view.state };
  }
  return { view };
}

/** 支付面板视图模型。 */
export interface PaymentPanelViewModel {
  disclosure: string;
  rule: string;
  posture: ArenaReleasePosture;
  chips: readonly PaymentStateChip[];
}

/** 典型支付生命周期的展示面板（词表 1:1；标注为词表参考，非实例状态）。 */
export function paymentVocabularyPanel(): PaymentPanelViewModel {
  const vocabulary = ["RESERVED", "PENDING_EVIDENCE", "EVIDENCE_ACCEPTED", "READY_TO_RELEASE", "SETTLED", "REFUNDED", "DISPUTED"];
  return {
    disclosure: TEST_MODE_PAYMENT_DISCLOSURE,
    rule: FAILED_PROOF_NEVER_PAYS_RULE,
    posture: ARENA_RELEASE_POSTURE,
    chips: vocabulary.map(paymentChip),
  };
}

/** 单条追踪行的支付态视图（实例状态来自服务端投影或类型化结果）。 */
export function paymentStateView(state: string | null): PaymentPanelViewModel {
  const chips: PaymentStateChip[] = state === null ? [] : [paymentChip(state)];
  return {
    disclosure: TEST_MODE_PAYMENT_DISCLOSURE,
    rule: FAILED_PROOF_NEVER_PAYS_RULE,
    posture: ARENA_RELEASE_POSTURE,
    chips,
  };
}
