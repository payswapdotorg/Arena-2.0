import type { ReactNode } from "react";
import { LENS_VIEWS, ROLE_IS_NOT_AUTHORIZATION_RULE, type WorkbenchLens } from "../roles.js";
import { stateView, type StateView } from "../states.js";
import { WORKBENCH_DEMO_DISCLOSURE } from "../demo-fixtures.js";
import type { FieldError } from "../requester-form.js";
import type { EscalationSummary } from "../mock-client.js";

/**
 * AR2-003 slice 1 — 纯展示屏（无客户端调用、无 DOM 副作用；SSR 可冒烟）。
 * 组件只消费视图模型 props；数据/校验/授权都在 mock client 与表单层。
 */

export function DemoBanner(): ReactNode {
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

export function RoleSwitcher(props: {
  selected: WorkbenchLens;
  onSelect: (lens: WorkbenchLens) => void;
}): ReactNode {
  return (
    <nav
      className="arena-role-switcher"
      aria-label="workbench lens"
      title={ROLE_IS_NOT_AUTHORIZATION_RULE}
      data-role-is-not-authorization="true"
    >
      {(Object.keys(LENS_VIEWS) as WorkbenchLens[]).map((lens) => (
        <button
          key={lens}
          type="button"
          aria-pressed={props.selected === lens}
          data-lens={lens}
          onClick={() => props.onSelect(lens)}
        >
          {LENS_VIEWS[lens]?.label}
        </button>
      ))}
    </nav>
  );
}

export function StateBadge(props: {
  machine: "escalation" | "attempt" | "payment" | "learning";
  state: string;
}): ReactNode {
  const view = stateView(props.machine, props.state);
  if ("unknown" in view) {
    return (
      <span className="arena-state-badge arena-state-unknown" data-unknown-state={view.state}>
        unknown (no invented states)
      </span>
    );
  }
  const typed = view as StateView;
  return (
    <span className={`arena-state-badge arena-state-${typed.kind}`} data-state={typed.state}>
      {typed.label}
    </span>
  );
}

export function FieldErrorList(props: { errors: readonly FieldError[] }): ReactNode {
  if (props.errors.length === 0) {
    return null;
  }
  return (
    <ul className="arena-field-errors" aria-label="form validation errors">
      {props.errors.map((error) => (
        <li key={`${error.field}:${error.rule}`} data-field={error.field}>
          <span className="arena-field">{error.field}</span>: {error.rule}
        </li>
      ))}
    </ul>
  );
}

export function RequesterCockpit(props: {
  lens: WorkbenchLens;
  title: string;
  outcomeDescription: string;
  budgetLimit: string;
  errors: readonly FieldError[];
  tracking: readonly EscalationSummary[];
  onSubmit: () => void;
  onTitleChange: (value: string) => void;
  onOutcomeChange: (value: string) => void;
  onBudgetChange: (value: string) => void;
}): ReactNode {
  return (
    <section
      className="arena-requester-cockpit"
      data-lens={props.lens}
      aria-label="requester cockpit"
    >
      <DemoBanner />
      <h2>Requester cockpit</h2>
      <form className="arena-escalation-form" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="arena-task-title">Task title</label>
        <input
          id="arena-task-title"
          value={props.title}
          onChange={(event) => props.onTitleChange(event.target.value)}
        />
        <label htmlFor="arena-task-outcome">Outcome description</label>
        <textarea
          id="arena-task-outcome"
          value={props.outcomeDescription}
          onChange={(event) => props.onOutcomeChange(event.target.value)}
        />
        <label htmlFor="arena-budget-limit">Budget limit</label>
        <input
          id="arena-budget-limit"
          inputMode="decimal"
          value={props.budgetLimit}
          onChange={(event) => props.onBudgetChange(event.target.value)}
        />
        <FieldErrorList errors={props.errors} />
        <button type="submit" onClick={props.onSubmit}>
          Submit escalation
        </button>
      </form>
      <h3>Tracking</h3>
      {props.tracking.length === 0 ? (
        <p className="arena-empty">No escalations yet (empty state)</p>
      ) : (
        <ul className="arena-tracking" aria-label="escalation tracking">
          {props.tracking.map((item) => (
            <li key={item.escalation_id} data-escalation={item.escalation_id}>
              <span className="arena-tracking-title">{item.title}</span>
              <StateBadge machine="escalation" state={item.state} />
              <span className="arena-tracking-budget">
                {item.budget_limit} {item.currency}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
