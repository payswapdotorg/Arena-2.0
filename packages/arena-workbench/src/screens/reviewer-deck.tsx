import type { ReactNode } from "react";
import { ATTEMPT_STATES } from "@arena/contracts";
import type {
  AdjudicationView,
  ReviewDeckView,
  ReviewerCriterionRow,
  VerificationTrail,
} from "../reviewer-deck.js";
import { DemoBanner, StateBadge } from "./requester-cockpit.js";
import { SELF_EVALUATION_IS_NOT_A_VOTE_RULE } from "../expert-flow.js";

/**
 * AR2-003 slice 2 — reviewer/adjudicator 屏（验收场景 3；纯展示）。
 *
 * - criterion 行由冻结 criterionOutcomeSchema 形状驱动；
 * - reviewer_private 证据渲染在独立 RedactionBoundary（视觉分离 +
 *   data-redaction-class + aria-label）；
 * - operator 级证据对 reviewer 面扣留（只披露计数，不渲染内容）；
 * - 自评渲染在独立分区（data-never-vote）且不计入独立评审人数。
 */

export function RedactionBoundary(props: {
  redactionClass: "reviewer_private";
  children: ReactNode;
}): ReactNode {
  return (
    <section
      className={`arena-redaction arena-redaction-${props.redactionClass}`}
      data-redaction-class={props.redactionClass}
      aria-label={`${props.redactionClass} content (visually separated redaction class)`}
    >
      {props.children}
    </section>
  );
}

function CriterionRowView(props: { row: ReviewerCriterionRow }): ReactNode {
  return (
    <tr data-criterion={props.row.criterion_id} data-decision={props.row.decision}>
      <td className="arena-criterion-statement">{props.row.statement}</td>
      <td>
        <span className="arena-decision" data-decision={props.row.decision}>
          {props.row.decision}
        </span>
      </td>
      <td>{props.row.proof_class}</td>
      <td>{props.row.evidence_ids.length > 0 ? props.row.evidence_ids.join(", ") : "—"}</td>
      <td>{props.row.hard_stop_triggered ? "hard stop" : "—"}</td>
      <td>
        {props.row.self_decision === null ? (
          "—"
        ) : (
          <span className="arena-self-decision-side" data-decision={props.row.self_decision}>
            {props.row.self_decision} (self, not a vote)
          </span>
        )}
      </td>
    </tr>
  );
}

export function VerificationTrailView(props: { trail: VerificationTrail }): ReactNode {
  return (
    <section className="arena-verification-trail" aria-label="verification trail">
      <h3>Verification trail</h3>
      <dl>
        <dt>Validators</dt>
        <dd data-validators="true">
          {props.trail.validators
            .map((validator) => `${validator.validator_id}@${validator.validator_version}`)
            .join(", ")}
        </dd>
        <dt>Reviewers</dt>
        <dd data-reviewers="true">{props.trail.reviewer_ids.join(", ")}</dd>
        <dt>Adjudicator</dt>
        <dd data-adjudicator="true">{props.trail.adjudicator_id ?? "—"}</dd>
        <dt>Outcomes</dt>
        <dd data-outcomes="true">{props.trail.outcomes.join(", ")}</dd>
        <dt>Policy version</dt>
        <dd>{props.trail.policy_version}</dd>
      </dl>
      <p
        className="arena-independent-count"
        data-independent-reviews={props.trail.reviewer_ids.length}
      >
        Independent reviews: {props.trail.reviewer_ids.length} (author self-evaluation never
        counted)
      </p>
    </section>
  );
}

export function ReviewerDeckScreen(props: { deck: ReviewDeckView }): ReactNode {
  const deck = props.deck;
  return (
    <section
      className="arena-reviewer-deck"
      data-result={deck.result_id}
      aria-label="reviewer deck"
    >
      <DemoBanner />
      <h2>Reviewer deck</h2>
      <p className="arena-result-status" data-result-status={deck.status}>
        Result <code>{deck.result_id}</code> —{" "}
        {(ATTEMPT_STATES as readonly string[]).includes(deck.status) ? (
          <StateBadge machine="attempt" state={deck.status} />
        ) : (
          <span className="arena-result-status-plain">{deck.status} (result status)</span>
        )}
      </p>
      <table className="arena-criterion-outcomes" aria-label="criterion outcomes">
        <thead>
          <tr>
            <th>Criterion</th>
            <th>Decision</th>
            <th>Proof</th>
            <th>Evidence</th>
            <th>Hard stop</th>
            <th>Self (not a vote)</th>
          </tr>
        </thead>
        <tbody>
          {deck.criterion_rows.map((row) => (
            <CriterionRowView key={row.criterion_id} row={row} />
          ))}
        </tbody>
      </table>
      <VerificationTrailView trail={deck.trail} />
      <section className="arena-evidence-shared" aria-label="shared evidence (public/tenant)">
        <h3>Shared evidence</h3>
        <ul>
          {deck.redaction.shared.map((envelope) => (
            <li key={envelope.evidence_id} data-evidence={envelope.evidence_id}>
              {envelope.evidence_id} — {envelope.redaction_class}
            </li>
          ))}
        </ul>
      </section>
      {deck.redaction.reviewer_private.length > 0 ? (
        <RedactionBoundary redactionClass="reviewer_private">
          <h3>Reviewer-private evidence and rationale</h3>
          <ul>
            {deck.redaction.reviewer_private.map((envelope) => (
              <li key={envelope.evidence_id} data-evidence={envelope.evidence_id}>
                {envelope.evidence_id} — {envelope.redaction_class}
              </li>
            ))}
          </ul>
        </RedactionBoundary>
      ) : null}
      <p
        className="arena-withheld-evidence"
        data-withheld-operator={deck.redaction.withheld_operator_count}
      >
        Operator-class evidence withheld from reviewer surface:{" "}
        {deck.redaction.withheld_operator_count} object
        {deck.redaction.withheld_operator_count === 1 ? "" : "s"} (count only)
      </p>
      {deck.self_evaluation !== null ? (
        <aside
          className="arena-reviewer-self-evaluation"
          aria-label="author self-evaluation (visible evidence, never an independent vote)"
          data-never-vote="true"
        >
          <h3>Author self-evaluation — separated, never an independent vote</h3>
          <ul>
            {deck.self_evaluation.entries.map((entry) => (
              <li key={entry.criterion_id} data-criterion={entry.criterion_id}>
                <span data-decision={entry.decision}>{entry.decision}</span> — {entry.rationale}
              </li>
            ))}
          </ul>
          <p>{SELF_EVALUATION_IS_NOT_A_VOTE_RULE}</p>
        </aside>
      ) : (
        <p className="arena-self-evaluation-absent">No author self-evaluation on record</p>
      )}
    </section>
  );
}

export function AdjudicatorDeckScreen(props: {
  deck: ReviewDeckView;
  adjudication: AdjudicationView;
}): ReactNode {
  const { deck, adjudication } = props;
  return (
    <section
      className="arena-adjudicator-deck"
      data-result={deck.result_id}
      aria-label="adjudicator deck"
    >
      <DemoBanner />
      <h2>Adjudicator deck</h2>
      <p className="arena-divergence" data-divergent={adjudication.divergent}>
        {adjudication.divergent ? "Divergence detected" : "No divergence detected"}
      </p>
      {adjudication.trigger !== null ? (
        <p className="arena-adjudication-trigger">Trigger: {adjudication.trigger}</p>
      ) : null}
      <p className="arena-adjudicator" data-adjudicator="true">
        Adjudicator: {adjudication.adjudicator_id ?? "—"}
      </p>
      <VerificationTrailView trail={deck.trail} />
    </section>
  );
}
