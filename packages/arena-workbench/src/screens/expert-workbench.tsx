import type { ReactNode } from "react";
import {
  SELF_EVALUATION_IS_NOT_A_VOTE_RULE,
  type StructuredSelfEvaluation,
} from "../expert-flow.js";
import type { AttemptSummary } from "../mock-client.js";
import { DemoBanner, FieldErrorList, StateBadge } from "./requester-cockpit.js";
import type { FieldError } from "../requester-form.js";
import type { Attempt } from "@arena/contracts";

/**
 * AR2-003 slice 2 — 专家工位屏（验收场景 2；纯展示，无客户端调用）。
 * 队列/工作区/自评面板都只消费视图模型 props；状态跃迁与校验在
 * mock client + expert-flow（冻结状态机）层。
 */

export function ExpertQueue(props: { assignments: readonly AttemptSummary[] }): ReactNode {
  return (
    <section className="arena-expert-queue" aria-label="expert queue">
      <h2>Expert queue</h2>
      {props.assignments.length === 0 ? (
        <p className="arena-empty">No assignments (empty state)</p>
      ) : (
        <ul className="arena-assignments" aria-label="attempt assignments">
          {props.assignments.map((item) => (
            <li key={item.attempt_id} data-attempt={item.attempt_id}>
              <span className="arena-assignment-id">{item.attempt_id}</span>
              <StateBadge machine="attempt" state={item.state} />
              <span className="arena-assignment-budget">
                {item.budget_remaining} {item.currency} remaining
              </span>
              <span className="arena-assignment-candidates">
                {item.candidates} candidate{item.candidates === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ExpertWorkspace(props: {
  attempt: Attempt;
  manifestValue: string;
  notesValue: string;
  candidateErrors: readonly FieldError[];
  selfEvaluationErrors: readonly FieldError[];
  onManifestChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onCandidateSubmit: () => void;
  onSelfEvaluationSubmit: () => void;
}): ReactNode {
  return (
    <section
      className="arena-expert-workspace"
      data-attempt={props.attempt.attempt_id}
      aria-label="expert workspace"
    >
      <DemoBanner />
      <h2>Expert workspace</h2>
      <p className="arena-attempt-status">
        Attempt <code>{props.attempt.attempt_id}</code> —{" "}
        <StateBadge machine="attempt" state={props.attempt.status} />
      </p>
      <form className="arena-candidate-form" onSubmit={(event) => event.preventDefault()}>
        <h3>Candidate submission</h3>
        <label htmlFor="arena-artifact-manifest">Artifact manifest (content)</label>
        <textarea
          id="arena-artifact-manifest"
          value={props.manifestValue}
          onChange={(event) => props.onManifestChange(event.target.value)}
        />
        <label htmlFor="arena-submission-notes">Submission notes</label>
        <input
          id="arena-submission-notes"
          value={props.notesValue}
          onChange={(event) => props.onNotesChange(event.target.value)}
        />
        <FieldErrorList errors={props.candidateErrors} />
        <button type="submit" onClick={props.onCandidateSubmit}>
          Submit candidate version
        </button>
      </form>
      <form className="arena-self-evaluation-form" onSubmit={(event) => event.preventDefault()}>
        <h3>Structured self-evaluation</h3>
        <p className="arena-self-evaluation-rule" data-never-vote="true">
          {SELF_EVALUATION_IS_NOT_A_VOTE_RULE}
        </p>
        <FieldErrorList errors={props.selfEvaluationErrors} />
        <button type="submit" onClick={props.onSelfEvaluationSubmit}>
          Submit structured self-evaluation
        </button>
      </form>
    </section>
  );
}

export function SelfEvaluationPanel(props: { evaluation: StructuredSelfEvaluation }): ReactNode {
  return (
    <aside
      className="arena-self-evaluation-panel"
      aria-label="author self-evaluation (visible evidence, never an independent vote)"
      data-never-vote="true"
      data-attempt={props.evaluation.attempt_id}
    >
      <h3>Author self-evaluation — visible evidence, not a vote</h3>
      <ul className="arena-self-evaluation-entries" aria-label="self-evaluation entries">
        {props.evaluation.entries.map((entry) => (
          <li key={entry.criterion_id} data-criterion={entry.criterion_id}>
            <span className="arena-self-decision" data-decision={entry.decision}>
              {entry.decision}
            </span>
            <span className="arena-self-rationale">{entry.rationale}</span>
            {entry.evidence_ids.length > 0 ? (
              <span className="arena-self-evidence">{entry.evidence_ids.join(", ")}</span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="arena-self-evaluation-rule">{SELF_EVALUATION_IS_NOT_A_VOTE_RULE}</p>
    </aside>
  );
}
