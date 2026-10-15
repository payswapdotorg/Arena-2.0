/**
 * UIA-001 Lane C — 运维/治理屏容器（React 薄胶水；UIA-003 扩展：真实 ops 挂接面）。
 */
import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { ArenaScreenHost } from "../../contract.js";
import type { OperationsController } from "./controller.js";
import {
  AuditTrailPanel,
  CapacityPanel,
  CustodianPanel,
  DeadLetterPanel,
  HealthReadinessPanel,
  LensContext,
  ProviderHealthPanel,
  ReleasePostureNote,
  ReleasePosturePanel,
  StateVocabularyPanel,
} from "./presenters.js";

export interface OperationsScreenProps {
  host: ArenaScreenHost;
  controller: OperationsController;
}

export function OperationsScreen(props: OperationsScreenProps): ReactNode {
  const { host, controller } = props;
  const snap = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.snapshot(),
    () => controller.snapshot(),
  );

  return (
    <section className="arena-screen arena-operations" data-arena-screen="operations" aria-label="operations and governance">
      <LensContext lens={host.lens} />
      <h1>Operations</h1>
      <ReleasePostureNote />

      <div className="arena-operations-grid">
        <ReleasePosturePanel />
        <HealthReadinessPanel readiness={snap.readiness} />
        <ProviderHealthPanel />
        <CapacityPanel />
        <DeadLetterPanel />
        <CustodianPanel />
        <StateVocabularyPanel />
        <AuditTrailPanel trail={snap.auditTrail} />
      </div>

      <form
        className="arena-audit-lookup"
        aria-label="run the readiness aggregate"
        onSubmit={(event) => {
          event.preventDefault();
          void controller.runReadiness();
        }}
      >
        <button
          type="submit"
          className="arena-submit"
          disabled={snap.readiness.kind === "unwired"}
        >
          Run readiness aggregate (explicit per-probe statuses; any non-UP fails closed)
        </button>
      </form>

      <form
        className="arena-audit-lookup"
        aria-label="audit trail lookup"
        onSubmit={(event) => {
          event.preventDefault();
          void controller.loadAuditTrail(snap.auditEscalationId);
        }}
      >
        <label htmlFor="arena-audit-escalation">Audit trail — escalation id</label>
        <input
          id="arena-audit-escalation"
          value={snap.auditEscalationId}
          onChange={(e) => controller.setAuditEscalationId(e.target.value)}
        />
        <button type="submit" className="arena-submit">
          Load audit trail
        </button>
      </form>
    </section>
  );
}
