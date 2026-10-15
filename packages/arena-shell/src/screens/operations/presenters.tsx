/**
 * UIA-001 Lane C — 运维/治理展示层（纯 props；react-dom/server 可渲染）。
 * UIA-003：真实 @arena/ops 挂接面 —— HEALTH_DISCLOSURE 逐字 + 聚合就绪
 * （探针状态显式、fail-closed 语义）；CAPACITY/DEAD_LETTER/CUSTODIAN
 * 披露逐字 + EMPTY 标注的 typed 形状；提供方健康词表改从真实 ACQ1.0
 * providerStatusSchema 枚举（手抄回退词表退役）。
 */
import type { ReactNode } from "react";
import {
  CAPACITY_DISCLOSURE,
  CUSTODIAN_DISCLOSURE,
  DEAD_LETTER_DISCLOSURE,
  HEALTH_DISCLOSURE,
} from "@arena/ops";
import { ARENA_PRODUCT_NAME, ARENA_RELEASE_POSTURE, type ArenaScreenHost } from "../../contract.js";
import type { OperationsSnapshot } from "./controller.js";
import { readinessPanelViewModel } from "./healthModel.js";
import {
  capacityPanelViewModel,
  custodianPanelViewModel,
  deadLetterPanelViewModel,
} from "./opsModel.js";
import {
  AUDIT_TRAIL_BASIS,
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

/** 聚合就绪面板（真实探词语义：状态显式；任何非 UP → fail-closed）。 */
export function HealthReadinessPanel(props: { readiness: OperationsSnapshot["readiness"] }): ReactNode {
  const readiness = props.readiness;
  return (
    <section className="arena-ops-panel" aria-label="aggregate readiness (real probe semantics)">
      <h2>Aggregate readiness</h2>
      <p className="arena-queue-fact" role="note">{HEALTH_DISCLOSURE}</p>
      {readiness.kind === "unwired" ? (
        <p className="arena-queue-fact" role="note">
          no station probes wired at this composition root — the aggregate is never evaluated on
          fabricated inputs (the operations registration accepts a probes dependency; the aggregate
          over zero probes would claim ready, which this surface refuses to render as truth)
        </p>
      ) : null}
      {readiness.kind === "idle" ? (
        <p className="arena-queue-fact">probes wired — the aggregate has not been run yet</p>
      ) : null}
      {readiness.kind === "running" ? (
        <p className="arena-timeline-state" role="status">running the readiness aggregate…</p>
      ) : null}
      {readiness.kind === "ready" ? (
        <div>
          <p
            className="arena-queue-fact"
            data-readiness-ready={String(readiness.report.ready)}
            data-readiness-fail-closed={readiness.report.ready ? "false" : String(readiness.report.fail_closed)}
          >
            {readiness.report.ready
              ? "ready — every dependency probe reported UP"
              : "NOT ready — fail closed: a non-UP dependency failed readiness (degraded service never silently keeps accepting work)"}
          </p>
          <ul className="arena-health-list" aria-label="dependency probe reports (explicit statuses)">
            {readinessPanelViewModel(readiness.report).probes.map((probe) => (
              <li key={probe.id} data-probe={probe.id} data-probe-status={probe.status}>
                <span className={`arena-health-status arena-health-${probe.status.toLowerCase()}`}>{probe.status}</span>
                <span className="arena-queue-fact">
                  {probe.id} ({probe.kind}) — {probe.detail}
                </span>
                <time dateTime={probe.checked_at}>{probe.checked_at}</time>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** 提供方健康词表（真实 ACQ1.0 providerStatusSchema 枚举 + 证据等级逐字）。 */
export function ProviderHealthPanel(): ReactNode {
  const vocabulary = providerHealthVocabulary();
  return (
    <section className="arena-ops-panel" aria-label="provider health vocabulary">
      <h2>Provider health</h2>
      <p className="arena-queue-fact">
        Typed statuses enumerated at runtime from the real @arena/acquisition providerStatusSchema
        (ACQ1.0 — only ACTIVE is routable); evidence grades rendered verbatim (never inflated):
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

/** 容量面板（CAPACITY_DISCLOSURE 逐字 + 真实 computeQueueLag × EMPTY 输入）。 */
export function CapacityPanel(): ReactNode {
  const vm = capacityPanelViewModel();
  return (
    <section className="arena-ops-panel" aria-label="capacity (quota fail-closed + queue lag gauge)">
      <h2>Capacity</h2>
      <p className="arena-queue-fact" role="note">{CAPACITY_DISCLOSURE}</p>
      <p className="arena-queue-fact" data-empty-input="true">{vm.emptyInputLabel}</p>
      <dl className="arena-trail-facts">
        <div><dt>due_count</dt><dd>{vm.queueLag.due_count}</dd></div>
        <div><dt>oldest_age_seconds</dt><dd>{String(vm.queueLag.oldest_age_seconds)}</dd></div>
        <div><dt>level</dt><dd data-queue-lag-level={vm.queueLag.level}>{vm.queueLag.level}</dd></div>
      </dl>
    </section>
  );
}

/** 死信面板（DEAD_LETTER_DISCLOSURE 逐字 + 真实 identifyDeadLetters × EMPTY 输入）。 */
export function DeadLetterPanel(): ReactNode {
  const vm = deadLetterPanelViewModel();
  return (
    <section className="arena-ops-panel" aria-label="dead letters (visibility over the durable outbox)">
      <h2>Dead letters</h2>
      <p className="arena-queue-fact" role="note">{DEAD_LETTER_DISCLOSURE}</p>
      <p className="arena-queue-fact" data-empty-input="true">{vm.emptyInputLabel}</p>
      <dl className="arena-trail-facts">
        <div><dt>flagged (attempts ≥ {vm.maxAttempts})</dt><dd>{vm.report.dead_lettered.length}</dd></div>
        <div><dt>in_flight</dt><dd>{vm.report.in_flight}</dd></div>
        <div><dt>dispatched</dt><dd>{vm.report.dispatched}</dd></div>
        <div><dt>retained</dt><dd data-dead-letter-retained={String(vm.report.retained)}>{String(vm.report.retained)}</dd></div>
      </dl>
    </section>
  );
}

/** 看门人面板（CUSTODIAN_DISCLOSURE 逐字 + 真实 CapsuleCustodian × 空台账）。 */
export function CustodianPanel(): ReactNode {
  const vm = custodianPanelViewModel(new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
  return (
    <section className="arena-ops-panel" aria-label="capsule custodian (teardown drift + recovery)">
      <h2>Capsule custodian</h2>
      <p className="arena-queue-fact" role="note">{CUSTODIAN_DISCLOSURE}</p>
      <p className="arena-queue-fact" data-empty-input="true">{vm.emptyInputLabel}</p>
      <dl className="arena-trail-facts">
        <div><dt>ledger entries</dt><dd>{vm.ledgerEntries}</dd></div>
        <div><dt>teardown drift</dt><dd>{vm.teardownDrift}</dd></div>
      </dl>
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

export function ReleasePostureNote(): ReactNode {
  return (
    <p className="arena-posture-note" data-release-decision={ARENA_RELEASE_POSTURE.releaseDecision}>
      {ARENA_PRODUCT_NAME} operations — release decision {ARENA_RELEASE_POSTURE.releaseDecision},
      finance {ARENA_RELEASE_POSTURE.financeMode}, untrusted execution{" "}
      {ARENA_RELEASE_POSTURE.untrustedExecution}
    </p>
  );
}
