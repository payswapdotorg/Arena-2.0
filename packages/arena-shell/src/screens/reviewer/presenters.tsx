/**
 * UIA-001 Lane C — 评审/裁决工位展示层（纯 props；react-dom/server 可渲染）。
 *
 * 展示纪律：
 * - 证据优先：criterion 行 / verification trail / 脱敏分区全部直接渲染
 *   buildReviewDeck 的冻结产物（类型化事实逐字，从不软化冲突）；
 * - 自评与独立评审视觉区分（独立分区 + data-never-vote + 冻结文本；
 *   operator 级扣留只披露计数，绝不渲染内容）；
 * - 支付资格与结果挂钩（failed/inconclusive 绝不支付 —— 逐字）；
 * - 证据等级逐字；test_mode 披露；零 ZCode 品牌。
 */
import type { ReactNode } from "react";
import type { ReviewDeckView } from "@arena/workbench";
import { ARENA_PRODUCT_NAME, ARENA_RELEASE_POSTURE, type ArenaScreenHost } from "../../contract.js";
import type { ReviewerSnapshot } from "./controller.js";
import {
  adjudicationPanelViewModel,
  evidenceGradeOf,
  PAYOUT_ELIGIBILITY_RULE,
  payoutEligibility,
  quorumViewModel,
  SELF_EVALUATION_DISTINCTION_TEXT,
  TEST_MODE_LEDGER_DISCLOSURE,
} from "./viewModel.js";

const DEMO_REVIEW_POLICY = {
  adjudication_trigger: "divergent_outcomes_or_hard_stop_dispute",
  minimum_independent_reviews: 2,
} as const;

export function LensContext(props: { lens: ArenaScreenHost["lens"] }): ReactNode {
  return (
    <p className="arena-lens-context" data-arena-lens={props.lens}>
      Viewing as {props.lens} (presentation only — never an authorization)
    </p>
  );
}

export function ReviewerLoading(): ReactNode {
  return (
    <p className="arena-screen-state arena-state-loading" role="status">
      Loading the review queue from the projection…
    </p>
  );
}

export function ReviewerEmpty(): ReactNode {
  return (
    <section className="arena-screen-state arena-state-empty" aria-label="no review decks">
      <h3>No review decks</h3>
      <p>When a result lands for evidence-first review it appears here with its typed rubric and verification trail.</p>
    </section>
  );
}

export function ReviewerError(props: { message: string; onRetry: () => void }): ReactNode {
  return (
    <section className="arena-screen-state arena-state-error" role="alert" aria-label="review queue error">
      <h3>Could not load the review queue</h3>
      <p className="arena-typed-error">{props.message}</p>
      <button type="button" className="arena-retry" onClick={props.onRetry}>
        Retry queue load
      </button>
    </section>
  );
}

/** 评审队列（结果 id 清单；DEMO 标注随行）。 */
export function ReviewQueueView(props: {
  rows: readonly { result_id: string; escalation_id: string; demo: boolean }[];
  selected: string | null;
  onSelect: (result_id: string) => void;
}): ReactNode {
  return (
    <ul className="arena-queue" aria-label="reviewable results (typed facts)">
      {props.rows.map((row) => (
        <li key={row.result_id} data-result={row.result_id}>
          <button
            type="button"
            className="arena-queue-select"
            data-selected={row.result_id === props.selected ? "true" : undefined}
            onClick={() => props.onSelect(row.result_id)}
          >
            <span className="arena-queue-id">{row.result_id}</span>
            <span className="arena-queue-fact">escalation {row.escalation_id}</span>
            {row.demo ? <span className="arena-queue-demo">DEMO data</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** criterion 行（冻结 decision/proof_class/evidence_ids/hard_stop 逐字）。 */
export function CriterionRows(props: { deck: ReviewDeckView }): ReactNode {
  return (
    <table className="arena-criteria-table" aria-label="criterion outcomes (typed rubric)">
      <thead>
        <tr>
          <th scope="col">Criterion</th>
          <th scope="col">Decision</th>
          <th scope="col">Proof class</th>
          <th scope="col">Evidence</th>
          <th scope="col">Hard stop</th>
          <th scope="col">Self-eval side-by-side</th>
        </tr>
      </thead>
      <tbody>
        {props.deck.criterion_rows.map((row) => (
          <tr key={row.criterion_id} data-criterion={row.criterion_id} data-decision={row.decision}>
            <td>
              <code>{row.criterion_id}</code>
              <p className="arena-criterion-statement">{row.statement}</p>
            </td>
            <td><span className={`arena-decision arena-decision-${row.decision.toLowerCase()}`}>{row.decision}</span></td>
            <td>{row.proof_class}</td>
            <td>
              {row.evidence_ids.length === 0 ? (
                <span className="arena-queue-fact">(none)</span>
              ) : (
                <ul className="arena-evidence-ids">
                  {row.evidence_ids.map((id) => (
                    <li key={id}><code>{id}</code></li>
                  ))}
                </ul>
              )}
            </td>
            <td>{row.hard_stop_triggered ? <span className="arena-hard-stop">HARD STOP</span> : <span className="arena-queue-fact">no</span>}</td>
            <td>
              {row.self_decision === null ? (
                <span className="arena-queue-fact">(no self-evaluation)</span>
              ) : (
                <span className={`arena-decision arena-self-decision arena-decision-${row.self_decision.toLowerCase()}`} data-never-vote="true">
                  {row.self_decision}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 脱敏分区（shared / reviewer-private 视觉分离；operator 只披露计数）。 */
export function RedactionPartitions(props: { deck: ReviewDeckView }): ReactNode {
  const redaction = props.deck.redaction;
  return (
    <div className="arena-redaction" aria-label="evidence redaction partitions">
      <section className="arena-redaction-shared" data-redaction-class="shared">
        <h4>Shared evidence ({redaction.shared.length})</h4>
        <ul className="arena-evidence-ids">
          {redaction.shared.map((envelope) => (
            <li key={envelope.evidence_id}><code>{envelope.evidence_id}</code> · {envelope.redaction_class}</li>
          ))}
        </ul>
      </section>
      <section className="arena-redaction-private" data-redaction-class="reviewer_private">
        <h4>Reviewer-private evidence ({redaction.reviewer_private.length})</h4>
        <ul className="arena-evidence-ids">
          {redaction.reviewer_private.map((envelope) => (
            <li key={envelope.evidence_id}><code>{envelope.evidence_id}</code> · {envelope.redaction_class}</li>
          ))}
        </ul>
      </section>
      <p className="arena-redaction-withheld" data-redaction-class="operator">
        {redaction.withheld_operator_count} operator-class evidence envelope{redaction.withheld_operator_count === 1 ? "" : "s"} withheld from the reviewer surface (count only — content never rendered here)
      </p>
    </div>
  );
}

/** verification trail（逐字段：validators/versions/reviewers/adjudicator/outcomes/policy_version）。 */
export function VerificationTrailView(props: { deck: ReviewDeckView }): ReactNode {
  const trail = props.deck.trail;
  return (
    <section className="arena-verification-trail" aria-label="verification trail (recorded facts)">
      <h4>Verification trail</h4>
      <dl className="arena-trail-facts">
        <div><dt>Validators</dt><dd>{trail.validators.map((v) => `${v.validator_id}@${v.validator_version}`).join(", ") || "(none)"}</dd></div>
        <div><dt>Independent reviewers</dt><dd data-independent-count={trail.reviewer_ids.length}>{trail.reviewer_ids.join(", ") || "(none)"}</dd></div>
        <div><dt>Adjudicator</dt><dd>{trail.adjudicator_id ?? "(not adjudicated)"}</dd></div>
        <div><dt>Outcomes</dt><dd>{trail.outcomes.join(", ") || "(none)"}</dd></div>
        <div><dt>Policy version</dt><dd>{trail.policy_version}</dd></div>
      </dl>
    </section>
  );
}

/** 自评独立分区（视觉区分 —— 永不构成投票，永不计入法定人数）。 */
export function SelfEvaluationSection(props: { deck: ReviewDeckView }): ReactNode {
  const self = props.deck.self_evaluation;
  return (
    <aside
      className="arena-self-eval-section"
      aria-label="author self-evaluation (visible evidence, never an independent review — never counted toward quorum)"
      data-never-vote="true"
      data-self-eval="true"
    >
      <h4>Author self-evaluation — side-by-side evidence, never a vote</h4>
      <p className="arena-self-eval-distinction">{SELF_EVALUATION_DISTINCTION_TEXT}</p>
      {self === null ? (
        <p className="arena-queue-fact">(no self-evaluation recorded for this attempt)</p>
      ) : (
        <ul className="arena-self-eval-entries">
          {self.entries.map((entry) => (
            <li key={entry.criterion_id} data-criterion={entry.criterion_id}>
              <span className={`arena-decision arena-self-decision arena-decision-${entry.decision.toLowerCase()}`}>{entry.decision}</span>
              <span className="arena-self-rationale">{entry.rationale}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

/** 法定人数 + 裁决 + 支付资格面板。 */
export function ReviewDecisionPanels(props: { deck: ReviewDeckView }): ReactNode {
  const quorum = quorumViewModel(props.deck, DEMO_REVIEW_POLICY);
  const adjudication = adjudicationPanelViewModel(props.deck, DEMO_REVIEW_POLICY);
  const payout = payoutEligibility(props.deck.status);
  return (
    <div className="arena-review-panels">
      <section className="arena-quorum-panel" aria-label="independent review quorum">
        <h4>Quorum</h4>
        <p data-independent-count={quorum.independentReviewCount}>
          {quorum.independentReviewCount} independent review{quorum.independentReviewCount === 1 ? "" : "s"}
          {quorum.minimumIndependentReviews !== null
            ? ` (minimum ${quorum.minimumIndependentReviews} — ${quorum.satisfied ? "satisfied" : "NOT satisfied"})`
            : " (no minimum recorded)"}
        </p>
        <p className="arena-queue-fact">{quorum.basis}</p>
      </section>
      <section className="arena-adjudication-panel" aria-label="adjudication state">
        <h4>Adjudication</h4>
        <p data-divergent={adjudication.view.divergent ? "true" : "false"}>
          {adjudication.view.divergent
            ? "DIVERGENT — adjudication path triggered"
            : "not divergent (no adjudication trigger)"}
          {adjudication.view.adjudicator_id !== null ? ` — adjudicator ${adjudication.view.adjudicator_id}` : ""}
        </p>
        {adjudication.view.trigger !== null ? (
          <p className="arena-queue-fact">trigger: {adjudication.view.trigger}</p>
        ) : null}
      </section>
      <section className="arena-payout-panel" aria-label="payout eligibility (result-linked)">
        <h4>Payout eligibility</h4>
        <p data-payout={payout.kind} data-result-status={payout.status}>
          {payout.kind === "eligible_pending_proof"
            ? `${payout.status} — eligible pending accepted proof evidence`
            : payout.kind === "not_eligible"
              ? `${payout.status} — NOT payout-eligible (${payout.rule})`
              : `${payout.status} — unknown status (no invented eligibility)`}
        </p>
        <p className="arena-queue-fact">{PAYOUT_ELIGIBILITY_RULE}</p>
        <p className="arena-queue-fact">{TEST_MODE_LEDGER_DISCLOSURE}</p>
      </section>
    </div>
  );
}

/** 审计轨迹（服务端 timeline —— 追加只读，绝不客户端合成）。 */
export function AuditTrailView(props: { trail: ReviewerSnapshot["auditTrail"] }): ReactNode {
  const t = props.trail;
  if (t.kind === "loading") return <p className="arena-timeline-state">Loading audit trail…</p>;
  if (t.kind === "empty") return <p className="arena-timeline-state">No recorded events yet.</p>;
  if (t.kind === "error") {
    return <p className="arena-timeline-state arena-typed-error" role="alert">{t.message}</p>;
  }
  return (
    <ol className="arena-timeline" aria-label="audit trail (append-only, server-recorded)">
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

/** 独立评审投票（escalation 级规范命令通道 —— 真实绑定路径）。 */
export function ReviewVotePanel(props: {
  escalationId: string;
  outcome: string | null;
  busy: boolean;
  onEscalationIdChange: (value: string) => void;
  onSubmit: () => void;
}): ReactNode {
  return (
    <form
      className="arena-vote-form"
      aria-label="independent review vote (canonical escalation command path)"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <h3>Independent review vote (canonical command path)</h3>
      <p className="arena-queue-fact">
        An independent review vote is a server-side command (SubmitReviewerEvaluation) on the
        escalation — never a self-evaluation, never client-side tallying.
      </p>
      <label htmlFor="arena-vote-escalation">Escalation id</label>
      <input
        id="arena-vote-escalation"
        value={props.escalationId}
        onChange={(e) => props.onEscalationIdChange(e.target.value)}
      />
      <button type="submit" className="arena-submit" aria-disabled={props.busy}>
        Submit independent review vote
      </button>
      {props.outcome !== null ? (
        <p className="arena-submit-outcome arena-typed-command" role="status" aria-live="polite">
          {props.outcome}
        </p>
      ) : null}
    </form>
  );
}

export function ReleasePostureNote(): ReactNode {
  return (
    <p className="arena-posture-note" data-release-decision={ARENA_RELEASE_POSTURE.releaseDecision}>
      {ARENA_PRODUCT_NAME} release decision {ARENA_RELEASE_POSTURE.releaseDecision} · finance{" "}
      {ARENA_RELEASE_POSTURE.financeMode} · untrusted execution {ARENA_RELEASE_POSTURE.untrustedExecution}
    </p>
  );
}

export function EvidenceGradeNote(props: { deck: ReviewDeckView }): ReactNode {
  return (
    <p className="arena-evidence-grade" data-evidence-grade={evidenceGradeOf(props.deck)}>
      Evidence grade: {evidenceGradeOf(props.deck)} (verbatim — never inflated)
    </p>
  );
}
