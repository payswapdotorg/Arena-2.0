/**
 * UIA-001 Lane C — 运维/治理视图模型（packet C3；§2.3 FROZEN 真相法）。
 *
 * 冻结纪律：
 * - 发布姿态面板从 ARENA_RELEASE_POSTURE 逐字渲染（NOT_GO / test_mode /
 *   disabled + 记录依据文档名）；绝不暗示 GO、生产隔离或真实支付；
 * - 受限/所有者门控行为渲染为「如实禁用 + 记录依据」，绝不渲染为不存在；
 * - 提供方健康词表 + 证据等级（DEMO/FIXTURE/REAL）逐字；
 * - @arena/ops 在 base 上不可从本模块解析（约束记录 —— 队列/容量/
 *   事件/保留词表经可解析面呈现：状态机词表 + 服务端 timeline）。
 */
import {
  ARENA_EVIDENCE_GRADES,
  ARENA_RELEASE_POSTURE,
  type ArenaReleasePosture,
} from "../../contract.js";
import { WORKBENCH_STATE_VIEWS, WORKBENCH_MACHINES } from "@arena/workbench";

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

/** 提供方健康词表（类型化状态 + 证据等级逐字）。 */
export const PROVIDER_HEALTH_STATUSES = ["ACTIVE", "SUSPENDED", "DEGRADED", "RETIRED"] as const;

export function providerHealthVocabulary(): readonly {
  status: string;
  evidenceGrades: readonly string[];
}[] {
  return PROVIDER_HEALTH_STATUSES.map((status) => ({
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

/** @arena/ops 可解析性约束（诚实披露）。 */
export const OPS_RESOLUTION_CONSTRAINT =
  "@arena/ops (queue/capacity, incidents, retention, custodian, observability) is not resolvable " +
  "from @arena/shell at this base (module requires: arena-contracts + arena-workbench; the " +
  "package manifest is TL-owned); this surface renders the resolvable operational vocabulary " +
  "(the frozen state-machine vocabularies + the server-recorded audit trail) and the ops " +
  "package's typed panels mount at TL integration when the module requires extend";

/** 审计轨迹口径（服务端 timeline —— 追加只读）。 */
export const AUDIT_TRAIL_BASIS =
  "the audit trail renders the server-recorded event stream verbatim (append-only; no client-side synthesis)";
