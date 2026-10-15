/**
 * UIA-001 Lane C — 运维/治理控制器（审计轨迹 = 服务端 timeline；REAL）。
 */
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

export interface OperationsSnapshot {
  auditTrail: AsyncState<readonly { event_type: string; occurred_at: string; actor: string }[]>;
  auditEscalationId: string;
}

type Listener = () => void;

export class OperationsController {
  private readonly audit: OperationsAuditPort;
  private readonly principal: OperationsPrincipal;
  private readonly listeners = new Set<Listener>();
  private trailOutcome: TimelineOutcome | null = null;
  private auditEscalationId = "";

  constructor(deps: { audit: OperationsAuditPort; principal: OperationsPrincipal }) {
    this.audit = deps.audit;
    this.principal = deps.principal;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): OperationsSnapshot {
    const trail: OperationsSnapshot["auditTrail"] =
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
    return { auditTrail: trail, auditEscalationId: this.auditEscalationId };
  }

  private emit(): void {
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
}
