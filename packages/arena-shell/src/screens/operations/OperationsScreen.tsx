/**
 * UIA-001 Lane C — 运维/治理屏容器（React 薄胶水）。
 */
import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { ArenaScreenHost } from "../../contract.js";
import type { OperationsController } from "./controller.js";
import {
  AuditTrailPanel,
  LensContext,
  OpsResolutionNote,
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
      <OpsResolutionNote />

      <div className="arena-operations-grid">
        <ReleasePosturePanel />
        <ProviderHealthPanel />
        <StateVocabularyPanel />
        <AuditTrailPanel trail={snap.auditTrail} />
      </div>

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
