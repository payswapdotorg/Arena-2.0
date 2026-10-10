import {
  ATTEMPT_STATES,
  ESCALATION_STATES,
  LEARNING_STATES,
  PAYMENT_STATES,
  type AttemptState,
  type EscalationState,
  type LearningState,
  type PaymentState,
} from "@arena/contracts";

/**
 * AR2-003 — 四个冻结状态机的 UI 视图登记表（验收场景 5）。
 *
 * 关键不变量：登记表从 CF1.0 的冻结状态数组 1:1 派生，不发明任何状态。
 * 展示类别（kind）用显式集合分类（终端/不确定/进行中/待办），
 * stateView() 是渲染前守卫——未知状态值返回 unknown 失败关闭标记，
 * 绝不猜测。加载/空/错误/不确定四类覆盖由屏层完成（见 screens）。
 */

export const WORKBENCH_MACHINES = ["escalation", "attempt", "payment", "learning"] as const;
export type WorkbenchMachine = (typeof WORKBENCH_MACHINES)[number];

/** 状态的展示类别（仅影响样式与可达性标签，不影响语义）。 */
export type StateViewKind = "pending" | "active" | "terminal" | "inconclusive";

export interface StateView {
  machine: WorkbenchMachine;
  state: string;
  kind: StateViewKind;
  label: string;
}

/** 显式分类集合（与冻结状态值字面一致；测试断言全集合无遗漏）。 */
const KIND_SETS: Readonly<
  Record<WorkbenchMachine, Readonly<Record<StateViewKind, readonly string[]>>>
> = {
  escalation: {
    pending: ["CREATED"],
    active: [
      "CLARIFICATION",
      "OFFERED",
      "ASSIGNED",
      "ENVIRONMENT_READY",
      "VERIFYING",
      "REVISION_REQUESTED",
      "APPEALED",
      "ACCEPTED",
    ],
    terminal: ["CLOSED", "CANCELLED", "EXPIRED", "FAILED_EXHAUSTED"],
    inconclusive: [],
  },
  attempt: {
    pending: ["CREATED", "ASSIGNED"],
    active: ["ENVIRONMENT_READY", "SUBMITTED", "VERIFYING"],
    terminal: ["ACCEPTED", "REJECTED", "FAILED", "EXPIRED", "SUPERSEDED"],
    inconclusive: ["INCONCLUSIVE"],
  },
  payment: {
    pending: ["NOT_APPLICABLE", "RESERVED", "PENDING_EVIDENCE"],
    active: ["EVIDENCE_ACCEPTED", "READY_TO_RELEASE", "RELEASE_SUBMITTED"],
    terminal: ["SETTLED", "REFUNDED", "CANCELLED"],
    inconclusive: ["DISPUTED", "REFUND_PENDING", "FAILED_REQUIRES_RECONCILIATION"],
  },
  learning: {
    pending: ["PROPOSED", "UNDER_REVIEW"],
    active: ["RIGHTS_CLEARED", "CONSENT_RECORDED", "VALIDATED", "APPROVED"],
    terminal: ["PUBLISHED", "RETRACTED", "REJECTED"],
    inconclusive: [],
  },
};

function labelOf(state: string): string {
  return state
    .toLowerCase()
    .split("_")
    .map((part) => (part.length > 0 ? (part[0] ?? "").toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function viewsOf(machine: WorkbenchMachine, states: readonly string[]): StateView[] {
  const sets = KIND_SETS[machine];
  return states.map((state) => {
    let kind: StateViewKind | undefined;
    for (const candidate of ["pending", "active", "terminal", "inconclusive"] as const) {
      if ((sets[candidate] as readonly string[]).includes(state)) {
        kind = candidate;
        break;
      }
    }
    if (kind === undefined) {
      throw new Error(`workbench state classification incomplete: ${machine}.${state}`);
    }
    return { machine, state, kind, label: labelOf(state) };
  });
}

/** 1:1 派生自冻结数组（长度与成员身份在测试中与 CF1.0 断言一致）。 */
export const WORKBENCH_STATE_VIEWS: Readonly<Record<WorkbenchMachine, readonly StateView[]>> = {
  escalation: viewsOf("escalation", ESCALATION_STATES),
  attempt: viewsOf("attempt", ATTEMPT_STATES),
  payment: viewsOf("payment", PAYMENT_STATES),
  learning: viewsOf("learning", LEARNING_STATES),
};

/** 渲染守卫：只有冻结状态值才返回视图；未知值返回 unknown 标记（失败关闭）。 */
export function stateView(
  machine: WorkbenchMachine,
  value: string,
): StateView | { machine: WorkbenchMachine; state: string; unknown: true } {
  const view = WORKBENCH_STATE_VIEWS[machine].find((v) => v.state === value);
  if (view === undefined) {
    return { machine, state: value, unknown: true };
  }
  return view;
}

export function isWorkbenchMachine(value: unknown): value is WorkbenchMachine {
  return typeof value === "string" && (WORKBENCH_MACHINES as readonly string[]).includes(value);
}

/** 类型再导出（屏层从领域对象取状态值时使用）。 */
export type { AttemptState, EscalationState, LearningState, PaymentState };
