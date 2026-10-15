/**
 * UIA-003 — 运维/治理：聚合就绪视图模型（真实 @arena/ops 探针语义）。
 *
 * 冻结纪律：
 * - OpsReadiness 原样上抛（全部探针状态显式；任何非 UP → ready:false +
 *   fail_closed:true + not_up 清单 —— aggregateReadiness 的语义）；
 * - 视图模型只做格式化，绝不修改/综合探针结果；
 * - 未接线（无探针）状态如实呈现 —— 绝不在空输入上伪造 ready（空探针
 *   聚合在真实函数里会返回 ready:true —— 本表面禁止对零探针求值）。
 */
import type { OpsReadiness, ProbeReport } from "@arena/ops";

/** 探针行（显式状态 + detail + 检查时刻 —— 逐字来自真实报告）。 */
export interface ReadinessProbeRow {
  id: string;
  kind: string;
  status: string;
  detail: string;
  checked_at: string;
}

/** 聚合就绪面板视图模型（真实 OpsReadiness 的呈现形状）。 */
export interface ReadinessPanelViewModel {
  ready: boolean;
  failClosed: boolean;
  probes: readonly ReadinessProbeRow[];
  notUp: readonly ReadinessProbeRow[];
}

export function readinessPanelViewModel(readiness: OpsReadiness): ReadinessPanelViewModel {
  const rowOf = (report: ProbeReport): ReadinessProbeRow => ({
    id: report.id,
    kind: report.kind,
    status: report.status,
    detail: report.detail,
    checked_at: report.checked_at,
  });
  return {
    ready: readiness.ready,
    failClosed: readiness.ready ? false : readiness.fail_closed,
    probes: readiness.dependencies.map(rowOf),
    notUp: readiness.ready ? [] : readiness.not_up.map(rowOf),
  };
}
