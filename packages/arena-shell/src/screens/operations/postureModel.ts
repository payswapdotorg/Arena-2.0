/**
 * UIA-001 Lane C — 运维/治理视图模型（packet C3；§2.3 FROZEN 真相法；UIA-003 扩展）。
 *
 * 冻结纪律：
 * - 发布姿态面板从 ARENA_RELEASE_POSTURE 逐字渲染（NOT_GO / test_mode /
 *   disabled + 记录依据文档名）；绝不暗示 GO、生产隔离或真实支付；
 * - 受限/所有者门控行为渲染为「如实禁用 + 记录依据」，绝不渲染为不存在；
 * - UIA-003：@arena/ops / @arena/acquisition 已可解析（模块 requires 扩展，
 *   TL 注册提交 4b4c2f6）—— 手抄的 PROVIDER_HEALTH_STATUSES 回退词表与
 *   OPS_RESOLUTION_CONSTRAINT 约束披露一并退役：提供方健康词表改从真实
 *   providerStatusSchema（ACQ1.0 公开契约）运行时枚举；真实 ops 挂接面
 *   （聚合就绪 + 容量/死信/看门人）见 healthModel / opsModel / presenters。
 */
import {
  ARENA_EVIDENCE_GRADES,
  ARENA_RELEASE_POSTURE,
  type ArenaReleasePosture,
} from "../../contract.js";
import { WORKBENCH_STATE_VIEWS, WORKBENCH_MACHINES } from "@arena/workbench";
import { providerStatusSchema } from "@arena/acquisition";

/** 发布姿态面板（逐字 —— 真相法）。 */
export interface ReleasePosturePanelViewModel {
  posture: ArenaReleasePosture;
  restrictedActions: readonly { action: string; basis: string }[];
}

export const RESTRICTED_ACTIONS: readonly { action: string; basis: string }[] = [
  {
    action: "record a release decision (GO / LIMITED_SCOPE_GO / NOT_GO_HOLD)",
    basis: `the AR2-023 authorization instrument (${ARENA_RELEASE_POSTURE.authorizationInstrument}) — owner signature surface, two unsigned candidate records standing`,
  },
  {
    action: "enable untrusted expert execution (capsule workspaces)",
    basis: `untrusted execution is disabled per the recorded posture; isolation evidence per ${ARENA_RELEASE_POSTURE.isolationEvidence}`,
  },
  {
    action: "enable live-money payments",
    basis: `finance mode is ${ARENA_RELEASE_POSTURE.financeMode} (test-mode ledger only; no live money in this release posture)`,
  },
];

export function releasePosturePanelViewModel(): ReleasePosturePanelViewModel {
  return { posture: ARENA_RELEASE_POSTURE, restrictedActions: RESTRICTED_ACTIONS };
}

/** 提供方健康词表（真实 ACQ1.0 providerStatusSchema.options —— 逐字枚举）。
 * 只有 ACTIVE 可被路由（ACQ 注册表法）；证据等级词表逐字流转。 */
export const PROVIDER_STATUSES: readonly string[] = providerStatusSchema.options;

export function providerHealthVocabulary(): readonly {
  status: string;
  evidenceGrades: readonly string[];
}[] {
  return PROVIDER_STATUSES.map((status) => ({
    status,
    evidenceGrades: ARENA_EVIDENCE_GRADES,
  }));
}

/** 运维状态机词表参考（可解析面 —— WORKBENCH_STATE_VIEWS 1:1）。 */
export function operationalStateVocabulary(): readonly {
  machine: string;
  states: readonly string[];
}[] {
  return WORKBENCH_MACHINES.map((machine) => ({
    machine,
    states: WORKBENCH_STATE_VIEWS[machine].map((view) => view.state),
  }));
}

/** 审计轨迹口径（服务端 timeline —— 追加只读）。 */
export const AUDIT_TRAIL_BASIS =
  "the audit trail renders the server-recorded event stream verbatim (append-only; no client-side synthesis)";
