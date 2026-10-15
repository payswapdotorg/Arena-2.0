/**
 * UIA-001 Lane C — 运维/治理展示层（纯 props；react-dom/server 可渲染）。
 */
import type { ReactNode } from "react";
import { ARENA_PRODUCT_NAME, ARENA_RELEASE_POSTURE, type ArenaScreenHost } from "../../contract.js";
import type { OperationsSnapshot } from "./controller.js";
import {
  AUDIT_TRAIL_BASIS,
  OPS_RESOLUTION_CONSTRAINT,
  operationalStateVocabulary,
  providerHealthVocabulary,
  releasePosturePanelViewModel,
} from "./postureModel.js";

export function LensContext(props: { lens: ArenaScreenHost["lens"] }): ReactNode {
  return (
    <p className="arena-lens-context" data-arena-lens={props.lens}>
      Viewing as {props.lens} (presentation only — never an authorization)
    </p>
  );
}

/** 发布姿态面板（§2.3 FROZEN 真相法 —— 逐字；受限行为如实禁用）。 */
export function ReleasePosturePanel(): ReactNode {
  const vm = releasePosturePanelViewModel();
  return (
    <section
      className="arena-ops-posture"
      aria-label="release posture (recorded truth)"
      data-release-decision={vm.posture.releaseDecision}
    >
      <h2>Release posture</h2>
      <dl className="arena-trail-facts">
        <div><dt>Release decision</dt><dd data-posture-decision="true">{vm.posture.releaseDecision}</dd></div>
        <div><dt>Decision basis</dt><dd><code>{vm.posture.decisionBasis}</code></dd></div>
        <div><dt>Finance mode</dt><dd data-posture-finance="true">{vm.posture.financeMode}</dd></div>
        <div><dt>Untrusted execution</dt><dd data-posture-execution="true">{vm.posture.untrustedExecution}</dd></div>
        <div><dt>Isolation evidence</dt><dd><code>{vm.posture.isolationEvidence}</code></dd></div>
        <div><dt>Authorization instrument</dt><dd><code>{vm.posture.authorizationInstrument}</code></dd></div>
      </dl>
      <h2>Restricted actions (truthfully disabled — never absent)</h2>
      <ul className="arena-restricted-actions" aria-label="restricted owner-gated actions">
        {vm.restrictedActions.map((restricted) => (
          <li key={restricted.action} data-restricted="true">
            <button type="button" className="arena-capsule-open" disabled aria-disabled="true">
              {restricted.action} (disabled)
            </button>
            <p className="arena-queue-fact">basis: {restricted.basis}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 提供方健康词表（类型化状态 + 证据等级逐字）。 */
export function ProviderHealthPanel(): ReactNode {
  const vocabulary = providerHealthVocabulary();
  return (
    <section className="arena-ops-panel" aria-label="provider health vocabulary">
      <h2>Provider health</h2>
      <p className="arena-queue-fact">
        Typed statuses with evidence grades rendered verbatim (never inflated):
      </p>
      <ul className="arena-health-list">
        {vocabulary.map((row) => (
          <li key={row.status} data-status={row.status}>
            <span className={`arena-health-status arena-health-${row.status.toLowerCase()}`}>{row.status}</span>
            <span className="arena-queue-fact">
              evidence grades: {row.evidenceGrades.join(" / ")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 运维状态机词表参考（可解析面 —— 1:1）。 */
export function StateVocabularyPanel(): ReactNode {
  const vocabulary = operationalStateVocabulary();
  return (
    <section className="arena-ops-panel" aria-label="operational state vocabulary">
      <h2>Operational state vocabulary</h2>
      <p className="arena-queue-fact">
        The frozen state machines this surface operates on (1:1 from the typed vocabularies —
        queue/capacity panels derive from these states):
      </p>
      {vocabulary.map((machine) => (
        <div key={machine.machine} className="arena-vocab-machine" data-machine={machine.machine}>
          <h2>{machine.machine} ({machine.states.length} states)</h2>
          <ul className="arena-field-list">
            {machine.states.map((state) => (
              <li key={state}><code>{state}</code></li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** 审计/可观测面板（服务端 timeline —— 追加只读）。 */
export function AuditTrailPanel(props: { trail: OperationsSnapshot["auditTrail"] }): ReactNode {
  const t = props.trail;
  return (
    <section className="arena-ops-panel" aria-label="audit and observability">
      <h2>Audit trail</h2>
      <p className="arena-queue-fact">{AUDIT_TRAIL_BASIS}</p>
      {t.kind === "loading" ? <p className="arena-timeline-state" role="status">Loading the audit trail…</p> : null}
      {t.kind === "empty" ? <p className="arena-timeline-state">No recorded events for this escalation.</p> : null}
      {t.kind === "error" ? (
        <p className="arena-timeline-state arena-typed-error" role="alert">{t.message}</p>
      ) : null}
      {t.kind === "ready" ? (
        <ol className="arena-timeline" aria-label="audit trail (append-only)">
          {t.data.map((event, index) => (
            <li key={index} data-event={event.event_type}>
              <span className="arena-timeline-type">{event.event_type}</span>
              <time dateTime={event.occurred_at}>{event.occurred_at}</time>
              <span className="arena-timeline-actor">actor {event.actor}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

export function OpsResolutionNote(): ReactNode {
  return (
    <p className="arena-dev-constraint" role="note">
      {OPS_RESOLUTION_CONSTRAINT}
    </p>
  );
}

export function ReleasePostureNote(): ReactNode {
  return (
    <p className="arena-posture-note" data-release-decision={ARENA_RELEASE_POSTURE.releaseDecision}>
      {ARENA_PRODUCT_NAME} operations — release decision {ARENA_RELEASE_POSTURE.releaseDecision},
      finance {ARENA_RELEASE_POSTURE.financeMode}, untrusted execution{" "}
      {ARENA_RELEASE_POSTURE.untrustedExecution}
    </p>
  );
}
