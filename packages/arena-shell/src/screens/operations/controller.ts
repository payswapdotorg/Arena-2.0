/**
 * UIA-001 Lane C — 运维/治理控制器（审计轨迹 = 服务端 timeline；REAL）。
 * UIA-003：聚合就绪 = 真实 @arena/ops aggregateReadiness × 组合根注入的
 * 真实探针（未注入时如实 unwired —— 绝不对零探针求值伪造 ready）。
 */
import { aggregateReadiness, type DependencyProbe, type OpsReadiness } from "@arena/ops";
import type { TimelineOutcome } from "@arena/workbench";

export interface OperationsPrincipal {
  tenant_id: string;
  user_id: string;
}

export interface OperationsAuditPort {
  timeline(escalation_id: string, principal: OperationsPrincipal): Promise<TimelineOutcome>;
}

export type AsyncState<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "empty" }
  | { kind: "error"; message: string };

/** 聚合就绪状态（unwired = 组合根未注入探针 —— 从不求值）。 */
export type ReadinessState =
  | { kind: "unwired" }
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ready"; report: OpsReadiness };

export interface OperationsSnapshot {
  auditTrail: AsyncState<readonly { event_type: string; occurred_at: string; actor: string }[]>;
  auditEscalationId: string;
  readiness: ReadinessState;
}

type Listener = () => void;

export class OperationsController {
  private readonly audit: OperationsAuditPort;
  private readonly principal: OperationsPrincipal;
  private readonly probes: readonly DependencyProbe[];
  private readonly listeners = new Set<Listener>();
  private trailOutcome: TimelineOutcome | null = null;
  private auditEscalationId = "";
  private readinessState: ReadinessState;

  constructor(deps: {
    audit: OperationsAuditPort;
    principal: OperationsPrincipal;
    probes?: readonly DependencyProbe[];
  }) {
    this.audit = deps.audit;
    this.principal = deps.principal;
    this.probes = deps.probes ?? [];
    this.readinessState = this.probes.length === 0 ? { kind: "unwired" } : { kind: "idle" };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private cachedSnapshot: OperationsSnapshot | null = null;

  snapshot(): OperationsSnapshot {
    // useSyncExternalStore 契约：状态未变时必须返回同一引用（否则 React
    // 会判定 store 每次都变化 → 无限重渲 → Minified error #185）。
    if (this.cachedSnapshot !== null) return this.cachedSnapshot;
    this.cachedSnapshot = this.buildSnapshot();
    return this.cachedSnapshot;
  }

  private buildSnapshot(): OperationsSnapshot {    const trail: OperationsSnapshot["auditTrail"] =
      this.trailOutcome === null
        ? { kind: "loading" }
        : this.trailOutcome.kind === "FOUND"
          ? this.trailOutcome.events.length === 0
            ? { kind: "empty" }
            : { kind: "ready", data: this.trailOutcome.events }
          : this.trailOutcome.kind === "NOT_FOUND"
            ? {
                kind: "error",
                message: `${this.trailOutcome.envelope.code}: ${this.trailOutcome.envelope.message}`,
              }
            : this.trailOutcome.kind === "UNAUTHENTICATED"
              ? { kind: "error", message: "UNAUTHENTICATED — the server rejected the credentials" }
              : { kind: "error", message: `TRANSPORT_ERROR — ${this.trailOutcome.message}` };
    return { auditTrail: trail, auditEscalationId: this.auditEscalationId, readiness: this.readinessState };
  }

  private emit(): void {
    this.cachedSnapshot = null;
    for (const listener of this.listeners) listener();
  }

  setAuditEscalationId(value: string): void {
    this.auditEscalationId = value;
    this.emit();
  }

  async loadAuditTrail(escalation_id: string): Promise<void> {
    this.auditEscalationId = escalation_id;
    this.trailOutcome = null;
    this.emit();
    this.trailOutcome = await this.audit.timeline(escalation_id, this.principal);
    this.emit();
  }

  /** 运行聚合就绪（真实探针 → aggregateReadiness；任何非 UP → fail-closed）。 */
  async runReadiness(): Promise<void> {
    if (this.probes.length === 0) return;
    this.readinessState = { kind: "running" };
    this.emit();
    const report = await aggregateReadiness({ probes: this.probes });
    this.readinessState = { kind: "ready", report };
    this.emit();
  }
}
