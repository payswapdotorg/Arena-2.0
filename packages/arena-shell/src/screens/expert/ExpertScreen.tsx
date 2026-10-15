/**
 * UIA-001 Lane B — 专家工位容器（React 薄胶水；状态在 ExpertController）。
 */
import { useEffect, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { ArenaScreenHost } from "../../contract.js";
import { ExpertController } from "./controller.js";
import {
  CandidateSubmissionPanel,
  ExpertEmpty,
  ExpertError,
  ExpertLoading,
  InterventionPanel,
  LensContext,
  PayoutPanel,
  QueueView,
  ReleasePostureNote,
  SelfEvaluationPanelView,
  TaskContextPanel,
} from "./presenters.js";
import { DemoDisclosure } from "../requester/presenters.js";

export interface ExpertScreenProps {
  host: ArenaScreenHost;
  controller: ExpertController;
}

export function ExpertScreen(props: ExpertScreenProps): ReactNode {
  const { host, controller } = props;
  const snap = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.snapshot(),
    () => controller.snapshot(),
  );

  useEffect(() => {
    void controller.loadQueue();
  }, [controller]);

  const attemptData =
    snap.attempt.kind === "ready"
      ? snap.attempt.data
      : null;

  return (
    <section className="arena-screen arena-expert" data-arena-screen="expert" aria-label="expert workbench">
      <LensContext lens={host.lens} />
      <h2>Expert work</h2>
      <ReleasePostureNote />
      <DemoDisclosure />

      <section className="arena-queue-section" aria-label="assignment queue">
        <h3>Queue</h3>
        {snap.queue.kind === "loading" ? <ExpertLoading /> : null}
        {snap.queue.kind === "empty" ? <ExpertEmpty /> : null}
        {snap.queue.kind === "error" ? (
          <ExpertError message={snap.queue.message} onRetry={() => void controller.loadQueue()} />
        ) : null}
        {snap.queue.kind === "ready" ? (
          <QueueView
            rows={snap.queue.data}
            selected={snap.selectedAttemptId}
            onSelect={(id) => void controller.selectAttempt(id)}
          />
        ) : null}
      </section>

      <div className="arena-expert-grid">
        {snap.attempt.kind === "ready" && attemptData !== null ? (
          <>
            <TaskContextPanel attempt={attemptData} />
            <CandidateSubmissionPanel
              manifestValue={snap.manifestValue}
              notesValue={snap.notesValue}
              errors={snap.candidateErrors}
              outcome={snap.candidateOutcome}
              onManifestChange={(v) => controller.setManifest(v)}
              onNotesChange={(v) => controller.setNotes(v)}
              onSubmit={() => void controller.submitCandidate()}
            />
            <SelfEvaluationPanelView
              criteria={snap.criteria}
              entries={snap.selfEvalEntries}
              errors={snap.selfEvalErrors}
              outcome={snap.selfEvalOutcome}
              onEntryChange={(id, patch) => controller.setSelfEvalEntry(id, patch)}
              onSubmit={() => void controller.submitSelfEvaluation()}
            />
            <PayoutPanel attemptState={attemptData.status} />
          </>
        ) : (
          <section className="arena-expert-selection" aria-label="no attempt selected">
            <h3>Workspace</h3>
            <p>Select an assignment from the queue to open its workspace.</p>
            <p className="arena-expert-projection-note">
              The attempt-level projection in this composition is demo-tagged (deterministic
              fixtures, never customer state); the canonical escalation command path below is the
              real binding.
            </p>
          </section>
        )}

        <InterventionPanel
          escalationId={snap.interventionEscalationId}
          outcome={snap.interventionOutcome}
          busy={snap.commandBusy}
          onEscalationIdChange={(v) => controller.setInterventionEscalationId(v)}
          onSubmit={() => void controller.submitIntervention()}
        />
      </div>
    </section>
  );
}
