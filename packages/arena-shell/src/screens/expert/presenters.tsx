/**
 * UIA-001 Lane B — 专家工位展示层（纯 props；react-dom/server 可渲染）。
 *
 * 展示纪律：
 * - 队列/资格/冲突 = 类型化事实逐字（从不软化冲突拒绝）；
 * - 隔离姿态 §2.3 FROZEN —— 受限行为如实禁用 + 记录依据；
 * - 自评面板与独立评审视觉区分（data-never-vote + 冻结文本）；
 * - DEMO 数据面如实标注（DemoBanner）；
 * - 排版 text-ui-*；令牌 --arena-*；用户可见面零 ZCode 品牌。
 */
import type { ReactNode } from "react";
import { ARENA_PRODUCT_NAME, type ArenaScreenHost } from "../../contract.js";
import type { AttemptDetailView, SelfEvalEntryState } from "./controller.js";
import { DemoDisclosure, FieldErrors, StateChip } from "../requester/presenters.js";
import {
  SELF_EVALUATION_VISUAL_DISTINCTION,
  isolationPostureViewModel,
  payoutStatusViewModel,
} from "./viewModel.js";

export function ExpertLoading(): ReactNode {
  return (
    <p className="arena-screen-state arena-state-loading" role="status">
      Loading the assignment queue from the projection…
    </p>
  );
}

export function ExpertEmpty(): ReactNode {
  return (
    <section className="arena-screen-state arena-state-empty" aria-label="no assignments">
      <h3>No assignments</h3>
      <p>
        When the routing loop assigns you an eligible task it appears here with its typed
        qualification and conflict facts.
      </p>
    </section>
  );
}

export function ExpertError(props: { message: string; onRetry: () => void }): ReactNode {
  return (
    <section className="arena-screen-state arena-state-error" role="alert" aria-label="queue error">
      <h3>Could not load the queue</h3>
      <p className="arena-typed-error">{props.message}</p>
      <button type="button" className="arena-retry" onClick={props.onRetry}>
        Retry queue load
      </button>
    </section>
  );
}

export function LensContext(props: { lens: ArenaScreenHost["lens"] }): ReactNode {
  return (
    <p className="arena-lens-context" data-arena-lens={props.lens}>
      Viewing as {props.lens} (presentation only — never an authorization)
    </p>
  );
}

/** 队列（类型化事实；demo 标注随行）。 */
export function QueueView(props: {
  rows: readonly {
    attempt_id: string;
    escalation_id: string;
    state: string;
    expert_id: string;
    budget_remaining: number;
    currency: string;
    candidates: number;
    demo: boolean;
  }[];
  selected: string | null;
  onSelect: (attempt_id: string) => void;
}): ReactNode {
  return (
    <ul className="arena-queue" aria-label="expert assignment queue (typed facts)">
      {props.rows.map((row) => (
        <li key={row.attempt_id} data-attempt={row.attempt_id}>
          <button
            type="button"
            className="arena-queue-select"
            data-selected={row.attempt_id === props.selected ? "true" : undefined}
            onClick={() => props.onSelect(row.attempt_id)}
          >
            <span className="arena-queue-id">{row.attempt_id}</span>
            <StateChip machine="attempt" state={row.state} />
            <span className="arena-queue-fact">
              {row.budget_remaining} {row.currency} remaining
            </span>
            <span className="arena-queue-fact">{row.candidates} candidate{row.candidates === 1 ? "" : "s"}</span>
            {row.demo ? <span className="arena-queue-demo">DEMO data</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** 任务上下文 + 隐私边界胶囊入口（如实禁用 + 记录依据 —— §2.3）。 */
export function TaskContextPanel(props: { attempt: AttemptDetailView }): ReactNode {
  const posture = isolationPostureViewModel();
  return (
    <section className="arena-task-context" aria-label="task context" data-attempt={props.attempt.attempt_id}>
      <h3>Task context</h3>
      <p className="arena-task-fact">
        Attempt <code>{props.attempt.attempt_id}</code> on escalation{" "}
        <code>{props.attempt.escalation_id}</code> — <StateChip machine="attempt" state={props.attempt.status} />
      </p>
      <p className="arena-task-fact">
        {props.attempt.budget.remaining_amount} {props.attempt.budget.currency} remaining ·{" "}
        {props.attempt.candidates} candidate{props.attempt.candidates === 1 ? "" : "s"} submitted
      </p>
      <div className="arena-capsule-entry" aria-label="privacy-bounded capsule entry">
        <h4>Capsule entry (privacy-bounded workspace)</h4>
        <p className="arena-capsule-posture" data-untrusted-execution={posture.untrustedExecution}>
          {posture.capsuleDisclosure}
        </p>
        <button type="button" className="arena-capsule-open" disabled aria-disabled="true">
          Open capsule workspace (disabled — untrusted execution {posture.untrustedExecution})
        </button>
      </div>
    </section>
  );
}

/** 候选提交（attempt 级冻结状态机）。 */
export function CandidateSubmissionPanel(props: {
  manifestValue: string;
  notesValue: string;
  errors: readonly { field: string; rule: string }[];
  outcome: string | null;
  onManifestChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onSubmit: () => void;
}): ReactNode {
  return (
    <form
      className="arena-candidate-form"
      aria-label="candidate submission (frozen attempt state machine)"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <h3>Candidate submission</h3>
      <label htmlFor="arena-expert-manifest">Artifact manifest (content)</label>
      <textarea
        id="arena-expert-manifest"
        value={props.manifestValue}
        onChange={(e) => props.onManifestChange(e.target.value)}
      />
      <label htmlFor="arena-expert-notes">Submission notes</label>
      <input
        id="arena-expert-notes"
        value={props.notesValue}
        onChange={(e) => props.onNotesChange(e.target.value)}
      />
      <FieldErrors errors={props.errors} />
      <button type="submit" className="arena-submit">
        Submit candidate version
      </button>
      {props.outcome !== null ? (
        <p className="arena-submit-outcome" role="status">
          {props.outcome}
        </p>
      ) : null}
    </form>
  );
}

/** 结构化自评（视觉区分 —— 永不投票）。 */
export function SelfEvaluationPanelView(props: {
  criteria: readonly { criterion_id: string; statement: string }[];
  entries: Record<string, { decision: string; rationale: string; evidenceIds: string }>;
  errors: readonly { field: string; rule: string }[];
  outcome: string | null;
  onEntryChange: (criterionId: string, patch: Partial<SelfEvalEntryState>) => void;
  onSubmit: () => void;
}): ReactNode {
  return (
    <form
      className="arena-self-eval-form"
      aria-label="structured self-evaluation (visible evidence, never an independent vote)"
      data-never-vote="true"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <h3>Structured self-evaluation</h3>
      <p className="arena-self-eval-distinction">{SELF_EVALUATION_VISUAL_DISTINCTION}</p>
      <DemoDisclosure />
      {props.criteria.map((criterion) => {
        const entry = props.entries[criterion.criterion_id];
        return (
          <fieldset key={criterion.criterion_id} className="arena-self-eval-criterion" data-criterion={criterion.criterion_id}>
            <legend>{criterion.criterion_id}</legend>
            <p className="arena-self-eval-statement">{criterion.statement}</p>
            <label htmlFor={`arena-self-${criterion.criterion_id}-decision`}>Decision</label>
            <select
              id={`arena-self-${criterion.criterion_id}-decision`}
              value={entry?.decision ?? "NOT_EVALUATED"}
              onChange={(e) =>
                props.onEntryChange(criterion.criterion_id, {
                  decision: e.target.value as SelfEvalEntryState["decision"],
                })
              }
            >
              {["PASS", "FAIL", "INCONCLUSIVE", "NOT_EVALUATED"].map((decision) => (
                <option key={decision} value={decision}>{decision}</option>
              ))}
            </select>
            <label htmlFor={`arena-self-${criterion.criterion_id}-rationale`}>Rationale</label>
            <textarea
              id={`arena-self-${criterion.criterion_id}-rationale`}
              value={entry?.rationale ?? ""}
              onChange={(e) => props.onEntryChange(criterion.criterion_id, { rationale: e.target.value })}
            />
            <label htmlFor={`arena-self-${criterion.criterion_id}-evidence`}>Evidence ids (comma-separated)</label>
            <input
              id={`arena-self-${criterion.criterion_id}-evidence`}
              value={entry?.evidenceIds ?? ""}
              onChange={(e) => props.onEntryChange(criterion.criterion_id, { evidenceIds: e.target.value })}
            />
          </fieldset>
        );
      })}
      <FieldErrors errors={props.errors} />
      <button type="submit" className="arena-submit">
        Submit structured self-evaluation
      </button>
      {props.outcome !== null ? (
        <p className="arena-submit-outcome" role="status">
          {props.outcome}
        </p>
      ) : null}
    </form>
  );
}

/** 提交介入（escalation 级规范命令通道 —— 真实绑定路径）。 */
export function InterventionPanel(props: {
  escalationId: string;
  outcome: string | null;
  busy: boolean;
  onEscalationIdChange: (value: string) => void;
  onSubmit: () => void;
}): ReactNode {
  return (
    <form
      className="arena-intervention-form"
      aria-label="intervention submission (canonical escalation command path)"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <h3>Intervention submission (canonical command path)</h3>
      <label htmlFor="arena-intervention-escalation">Escalation id</label>
      <input
        id="arena-intervention-escalation"
        value={props.escalationId}
        onChange={(e) => props.onEscalationIdChange(e.target.value)}
      />
      <FieldErrors errors={[]} />
      <button type="submit" className="arena-submit" aria-disabled={props.busy}>
        Submit intervention
      </button>
      {props.outcome !== null ? (
        <p className="arena-submit-outcome arena-typed-command" role="status" aria-live="polite">
          {props.outcome}
        </p>
      ) : null}
    </form>
  );
}

/** 支付/证明状态（失败/不确定不支付 —— 逐字）。 */
export function PayoutPanel(props: { attemptState: string | null }): ReactNode {
  const vm = payoutStatusViewModel(props.attemptState);
  return (
    <section className="arena-payout-panel" aria-label="payout and proof status">
      <h3>Payout / proof status</h3>
      <p className="arena-payout-rule">{vm.rule}</p>
      <p className="arena-payout-finance" data-finance-mode={vm.financeMode}>
        Ledger mode: {vm.financeMode} (test-mode payments only — never live money in this posture)
      </p>
      {vm.attemptState !== null ? (
        <p className="arena-payout-attempt">
          Attempt state <code>{vm.attemptState}</code> —{" "}
          {vm.verdictEligible === null
            ? "payout stage not reached (no eligibility inferred)"
            : vm.verdictEligible
              ? "eligible for payout pending accepted proof evidence"
              : "NOT payout-eligible (failed or inconclusive proof never pays)"}
        </p>
      ) : null}
    </section>
  );
}

export function ReleasePostureNote(): ReactNode {
  const posture = isolationPostureViewModel();
  return (
    <p
      className="arena-posture-note"
      data-release-decision={posture.posture.releaseDecision}
      data-untrusted-execution={posture.untrustedExecution}
    >
      {ARENA_PRODUCT_NAME} release decision {posture.posture.releaseDecision} · untrusted execution{" "}
      {posture.untrustedExecution} · isolation evidence {posture.isolationEvidence}
    </p>
  );
}
