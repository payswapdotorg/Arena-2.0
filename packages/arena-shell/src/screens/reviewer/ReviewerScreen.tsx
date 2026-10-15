/**
 * UIA-001 Lane C — 评审/裁决工位容器（React 薄胶水；状态在 ReviewerController）。
 */
import { useEffect, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { ArenaScreenHost } from "../../contract.js";
import type { ReviewerController } from "./controller.js";
import {
  AuditTrailView,
  CriterionRows,
  EvidenceGradeNote,
  LensContext,
  RedactionPartitions,
  ReleasePostureNote,
  ReviewDecisionPanels,
  ReviewerEmpty,
  ReviewerError,
  ReviewerLoading,
  ReviewQueueView,
  ReviewVotePanel,
  SelfEvaluationSection,
  VerificationTrailView,
} from "./presenters.js";
import { DemoDisclosure } from "../requester/presenters.js";

export interface ReviewerScreenProps {
  host: ArenaScreenHost;
  controller: ReviewerController;
}

export function ReviewerScreen(props: ReviewerScreenProps): ReactNode {
  const { host, controller } = props;
  const snap = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.snapshot(),
    () => controller.snapshot(),
  );

  useEffect(() => {
    void controller.loadQueue();
  }, [controller]);

  const deck = snap.deckView !== null && snap.deckView.kind === "FOUND" ? snap.deckView.deck : null;

  return (
    <section className="arena-screen arena-reviewer" data-arena-screen="reviewer" aria-label="reviewer adjudicator workbench">
      <LensContext lens={host.lens} />
      <h1>Review</h1>
      <ReleasePostureNote />
      <DemoDisclosure />

      <section className="arena-queue-section" aria-label="review queue">
        <h2>Review queue</h2>
        {snap.queue.kind === "loading" ? <ReviewerLoading /> : null}
        {snap.queue.kind === "empty" ? <ReviewerEmpty /> : null}
        {snap.queue.kind === "error" ? (
          <ReviewerError message={snap.queue.message} onRetry={() => void controller.loadQueue()} />
        ) : null}
        {snap.queue.kind === "ready" ? (
          <ReviewQueueView
            rows={snap.queue.data}
            selected={snap.selectedResultId}
            onSelect={(id) => void controller.selectResult(id)}
          />
        ) : null}
      </section>

      {deck !== null ? (
        <div className="arena-reviewer-grid">
          <section className="arena-deck-section" aria-label="review deck (evidence first)">
            <h2>Review deck — {deck.result_id}</h2>
            <p className="arena-queue-fact">
              Result status <code>{deck.status}</code> · attempt <code>{deck.attempt_id}</code> ·
              escalation <code>{deck.escalation_id}</code>
            </p>
            <EvidenceGradeNote deck={deck} />
            <CriterionRows deck={deck} />
            <RedactionPartitions deck={deck} />
            <VerificationTrailView deck={deck} />
            <ReviewDecisionPanels deck={deck} />
            <SelfEvaluationSection deck={deck} />
          </section>
        </div>
      ) : (
        <section className="arena-reviewer-selection" aria-label="no deck selected">
          <h2>Review deck</h2>
          <p>Select a result from the queue to open its evidence-first review deck.</p>
          <p className="arena-queue-fact">
            The deck projection in this composition is demo-tagged (deterministic fixtures, never
            customer state); the independent review vote below is the real binding command path.
          </p>
        </section>
      )}

      <section className="arena-audit-section" aria-label="audit trail">
        <h2>Audit trail (server-recorded)</h2>
        <AuditTrailView trail={snap.auditTrail} />
      </section>

      <ReviewVotePanel
        escalationId={snap.voteEscalationId}
        outcome={snap.voteOutcome}
        busy={snap.voteBusy}
        onEscalationIdChange={(v) => controller.setVoteEscalationId(v)}
        onSubmit={() => void controller.submitReviewVote()}
      />
    </section>
  );
}
