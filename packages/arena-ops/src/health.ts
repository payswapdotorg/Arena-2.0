/**
 * AR2-013 — 依赖探针 + 聚合就绪（issue #15）。
 *
 * 冻结纪律：
 * - 「可见性优先」：每个依赖（持久化/队列/capsule provider/支付 provider/
 *   jobs）的探针状态显式上报（UP/DEGRADED/DOWN + detail）；
 * - fail-closed：任何非 UP（DOWN 或 DEGRADED）→ 聚合就绪 = false ——
 *   绝不在降级状态静默继续接单；
 * - ops 包只观察与组合 —— 不持有任何域状态机权威。
 */

export type ProbeStatus = "UP" | "DEGRADED" | "DOWN";

export type ProbeKind = "persistence" | "queue" | "jobs" | "capsule_provider" | "payment_provider";

export interface ProbeReport {
  id: string;
  kind: ProbeKind;
  status: ProbeStatus;
  detail: string;
  checked_at: string;
}

export interface DependencyProbe {
  id: string;
  kind: ProbeKind;
  check(): Promise<ProbeStatus | { status: ProbeStatus; detail: string }>;
}

export type OpsReadiness =
  | { ready: true; dependencies: readonly ProbeReport[] }
  | {
      ready: false;
      fail_closed: true;
      dependencies: readonly ProbeReport[];
      not_up: readonly ProbeReport[];
    };

/** 聚合就绪：全部 UP 才 ready（可见 + fail-closed）。 */
export async function aggregateReadiness(input: {
  probes: readonly DependencyProbe[];
  now?: () => string;
}): Promise<OpsReadiness> {
  const now = input.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
  const reports: ProbeReport[] = [];
  for (const probe of input.probes) {
    const outcome = await probe.check();
    const status = typeof outcome === "string" ? outcome : outcome.status;
    const detail = typeof outcome === "string" ? "" : outcome.detail;
    reports.push({ id: probe.id, kind: probe.kind, status, detail, checked_at: now() });
  }
  const notUp = reports.filter((report) => report.status !== "UP");
  if (notUp.length === 0) return { ready: true, dependencies: reports };
  return { ready: false, fail_closed: true, dependencies: reports, not_up: notUp };
}

/** 静态探针（组合根接线用 —— 真实组件由调用方包装）。 */
export function staticProbe(
  id: string,
  kind: ProbeKind,
  status: ProbeStatus,
  detail = "",
): DependencyProbe {
  return {
    id,
    kind,
    check: async () => (detail.length > 0 ? { status, detail } : status),
  };
}

export const HEALTH_DISCLOSURE =
  "Ops readiness is an aggregate of per-dependency probes; every probe status is reported " +
  "explicitly and ANY non-UP dependency fails readiness closed — degraded service never " +
  "silently keeps accepting work";
