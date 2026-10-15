/**
 * UIA-001 Lane B — 请求方驾驶舱展示层（纯 props；react-dom/server 可渲染）。
 *
 * 展示纪律：
 * - 排版一律 text-ui-* 令牌字号；颜色/间距/圆角一律 --arena-*；
 * - 状态 chip / 字段错误复用 @arena/workbench 公开面（StateBadge /
 *   FieldErrorList —— 冻结词表 1:1 流转）；
 * - 一切类型化失败逐字渲染（不软化、不吞掉）；
 * - 用户可见面零 ZCode 品牌（Arena 身份法）。
 */
import type { ReactNode } from "react";
import { stateView, type TimelineEvent, WORKBENCH_DEMO_DISCLOSURE } from "@arena/workbench";
import { ARENA_PRODUCT_NAME, ARENA_RELEASE_POSTURE, type ArenaScreenHost } from "../../contract.js";
import { routingPanelViewModel } from "./routingModel.js";
import { paymentVocabularyPanel } from "./paymentModel.js";
import type { RequesterSnapshot } from "./controller.js";
import type { AsyncViewModel } from "./viewModel.js";

/**
 * Lane B 共享展示原语（在 fence 内实现；词表来自 @arena/workbench 的
 * 纯函数/常量面 —— stateView / WORKBENCH_DEMO_DISCLOSURE。不渲染
 * workbench 的 JSX 组件：tsx 测试运行器对 include 外文件用 classic
 * JSX runtime，跨包渲染其组件会挂；真词汇表仍 1:1 流转）。
 */
export function StateChip(props: { machine: "escalation" | "attempt" | "payment" | "learning"; state: string }): ReactNode {
  const view = stateView(props.machine, props.state);
  if ("unknown" in view) {
    return (
      <span className="arena-state-badge arena-state-unknown" data-unknown-state={view.state}>
        unknown (no invented states)
      </span>
    );
  }
  return (
    <span className={`arena-state-badge arena-state-${view.kind}`} data-state={view.state}>
      {view.label}
    </span>
  );
}

export function FieldErrors(props: { errors: readonly { field: string; rule: string }[] }): ReactNode {
  if (props.errors.length === 0) return null;
  return (
    <ul
      className="arena-field-errors"
      aria-label="form validation errors"
      tabIndex={-1}
      data-error-count={props.errors.length}
    >
      {props.errors.map((error) => (
        <li key={`${error.field}:${error.rule}`} data-field={error.field}>
          <span className="arena-field">{error.field}</span>: {error.rule}
        </li>
      ))}
    </ul>
  );
}

export function DemoDisclosure(): ReactNode {
  return (
    <aside
      className="arena-demo-banner"
      role="note"
      aria-label="demo data disclosure"
      data-demo="true"
    >
      {WORKBENCH_DEMO_DISCLOSURE}
    </aside>
  );
}

export function RequesterLoading(): ReactNode {
  return (
    <p className="arena-screen-state arena-state-loading" role="status">
      Loading your requests from the server projection…
    </p>
  );
}

export function RequesterEmpty(): ReactNode {
  return (
    <section className="arena-screen-state arena-state-empty" aria-label="no requests yet">
      <h2>No requests yet</h2>
      <p>
        {ARENA_PRODUCT_NAME} submits your capability gap to the routing loop — compose your first
        request below and track its evidence-graded outcome here.
      </p>
    </section>
  );
}

export function RequesterError(props: { message: string; onRetry: () => void }): ReactNode {
  return (
    <section className="arena-screen-state arena-state-error" role="alert" aria-label="tracking error">
      <h2>Could not load requests</h2>
      <p className="arena-typed-error">{props.message}</p>
      <button type="button" className="arena-retry" onClick={props.onRetry}>
        Retry tracking load
      </button>
    </section>
  );
}

export function SubmitOutcomeView(props: { outcome: RequesterSnapshot["submitOutcome"] }): ReactNode {
  const o = props.outcome;
  if (o.kind === "NONE") return null;
  if (o.kind === "SUBMITTED") {
    return (
      <p className="arena-submit-outcome arena-submit-ok" role="status" data-outcome="SUBMITTED">
        Submitted <code>{o.escalation_id}</code> — server status <code>{o.status}</code>
        {o.replayed ? " (idempotent replay — the same request was already recorded)" : ""}
      </p>
    );
  }
  if (o.kind === "REJECTED") {
    return (
      <p className="arena-submit-outcome arena-submit-rejected" role="alert" data-outcome="REJECTED">
        Rejected by validation — see the field errors above (typed, verbatim).
      </p>
    );
  }
  return (
    <p
      className={`arena-submit-outcome arena-submit-${o.kind.toLowerCase()}`}
      role="alert"
      data-outcome={o.kind}
    >
      {o.kind}: {o.message}
    </p>
  );
}

export function TrackingList(props: {
  rows: readonly {
    escalation_id: string;
    state: string;
    updated_at: string;
    title: string;
  }[];
  selected: string | null;
  onSelect: (escalation_id: string) => void;
}): ReactNode {
  return (
    <ul className="arena-tracking-list" aria-label="escalation tracking from the server projection">
      {props.rows.map((row) => (
        <li
          key={row.escalation_id}
          data-escalation={row.escalation_id}
          data-selected={row.escalation_id === props.selected ? "true" : undefined}
        >
          <button type="button" className="arena-tracking-select" onClick={() => props.onSelect(row.escalation_id)}>
            <span className="arena-tracking-title">{row.title || row.escalation_id}</span>
            <StateChip machine="escalation" state={row.state} />
            <time className="arena-tracking-updated" dateTime={row.updated_at}>
              updated {row.updated_at}
            </time>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function RoutingPanel(props: { timelineEvents: readonly TimelineEvent[] | null }): ReactNode {
  const vm = routingPanelViewModel(props.timelineEvents);
  return (
    <section className="arena-routing-panel" aria-label="routing transparency">
      <h2>Routing transparency</h2>
      <p className="arena-routing-intro">
        The routing step of the {ARENA_PRODUCT_NAME} loop selects a provider class for your
        capability gap:
      </p>
      <dl className="arena-routing-concepts">
        {vm.concepts.map((concept) => (
          <div key={concept.concept} className="arena-routing-concept" data-concept={concept.concept}>
            <dt>{concept.concept}</dt>
            <dd>
              <span className="arena-routing-when">when: {concept.when}</span>
              <span className="arena-routing-why">why: {concept.why}</span>
            </dd>
          </div>
        ))}
      </dl>
      {vm.status.kind === "not_recorded" ? (
        <p className="arena-routing-status arena-routing-not-recorded" data-routing-status="not_recorded">
          {vm.status.disclosure}
        </p>
      ) : (
        <ul className="arena-routing-status" data-routing-status="recorded">
          {vm.status.events.map((event, index) => (
            <li key={index}>
              {event.event_type} — {event.occurred_at} (actor {event.actor})
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TimelineList(props: { timeline: AsyncViewModel<readonly TimelineEvent[]> }): ReactNode {
  const t = props.timeline;
  if (t.kind === "loading") return <p className="arena-timeline-state">Loading timeline…</p>;
  if (t.kind === "empty") return <p className="arena-timeline-state">No timeline events yet.</p>;
  if (t.kind === "error") {
    return <p className="arena-timeline-state arena-typed-error" role="alert">{t.message}</p>;
  }
  return (
    <ol className="arena-timeline" aria-label="server timeline (canonical event stream)">
      {t.data.map((event, index) => (
        <li key={index} data-event={event.event_type}>
          <span className="arena-timeline-type">{event.event_type}</span>
          <time dateTime={event.occurred_at}>{event.occurred_at}</time>
          <span className="arena-timeline-actor">actor {event.actor}</span>
        </li>
      ))}
    </ol>
  );
}

export function ResultPanel(props: { result: RequesterSnapshot["result"] }): ReactNode {
  const r = props.result;
  if (r.kind === "loading") return <p className="arena-result-state">Loading result view…</p>;
  return (
    <section className="arena-result-panel" aria-label="result inspection" data-result={r.kind}>
      <h2>Result</h2>
      <p className={`arena-result-message arena-result-${r.kind}`} role={r.kind === "error" ? "alert" : undefined}>
        {r.message}
      </p>
      {r.disclosure !== null ? (
        <p className="arena-result-disclosure">{r.disclosure}</p>
      ) : null}
    </section>
  );
}

export function PaymentPanel(): ReactNode {
  const vm = paymentVocabularyPanel();
  return (
    <section className="arena-payment-panel" aria-label="payment state (test mode)">
      <h2>Payment state</h2>
      <p className="arena-payment-disclosure" data-finance-mode={vm.posture.financeMode}>
        {vm.disclosure}
      </p>
      <p className="arena-payment-rule">{vm.rule}</p>
      <p className="arena-payment-vocab-label">
        Payment lifecycle vocabulary (typed states, rendered 1:1 — never invented):
      </p>
      <ul className="arena-payment-chips" aria-label="payment state vocabulary">
        {vm.chips.map((chip, index) => (
          <li key={index} className="arena-payment-chip">
            {"view" in chip ? (
              <StateChip machine="payment" state={chip.view.state} />
            ) : (
              <span className="arena-state-badge arena-state-unknown">unknown (no invented states)</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ReleasePostureNote(): ReactNode {
  return (
    <p className="arena-posture-note" data-release-decision={ARENA_RELEASE_POSTURE.releaseDecision}>
      Release decision {ARENA_RELEASE_POSTURE.releaseDecision} · finance {ARENA_RELEASE_POSTURE.financeMode} ·
      untrusted execution {ARENA_RELEASE_POSTURE.untrustedExecution}
    </p>
  );
}

export function LensContext(props: { lens: ArenaScreenHost["lens"] }): ReactNode {
  return (
    <p className="arena-lens-context" data-arena-lens={props.lens}>
      Viewing as {props.lens} (presentation only — never an authorization)
    </p>
  );
}
