import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  // screens (workbench presentational surface, as-is)
  RoleSwitcher,
  RequesterCockpit,
  ExpertQueue,
  ExpertWorkspace,
  SelfEvaluationPanel,
  ReviewerDeckScreen,
  AdjudicatorDeckScreen,
  // typed mock client + frozen fixtures (as-is)
  MockArenaClient,
  validateEscalationDraft,
  adjudicationView,
  DEMO_EXPERT_PRINCIPAL,
  DEMO_ACCEPTANCE_CRITERIA,
  DEMO_PROOF_POLICY_PRESET,
  // view-model types
  type AttemptSummary,
  type EscalationSummary,
  type FieldError,
  type ReviewDeckView,
  type StructuredSelfEvaluation,
  type WorkbenchLens,
} from "../../../src/contract.js";
import type { Attempt } from "@arena/contracts";
import {
  DECK_CHOICES,
  PAYOUT_HAPPY_PATH,
  REQUESTER_PRINCIPAL,
  SUBMIT_CONTEXT,
  buildDraft,
  type DeckChoice,
  type EvidenceEnvelopeView,
} from "./drive.js";
import { PayoutStatusPanel } from "./payout-panel.js";
import { EvidenceDetailDialog } from "./evidence-dialog.js";

/**
 * AR2-021 — accessibility render host (app shell).
 *
 * Minimal React host that mounts the workbench screens with the workbench's
 * OWN mock-client fixtures (demo-fixtures / demo-fixtures-expert /
 * expert-seeds via MockArenaClient — consumed as-is, no new fixture data).
 * The screens stay pure presentational (AR2-003 pattern); all state,
 * validation and transitions live here in the composition layer, exactly as
 * a product shell would wire them.
 *
 * Journeys mounted (one lens at a time, selected with the workbench's own
 * RoleSwitcher):
 *   requester  — RequesterCockpit (submit lifecycle: empty / validation
 *                error / submitting / submitted) + PayoutStatusPanel
 *                (frozen PAYMENT_STATES progression pending -> paid)
 *   expert     — ExpertQueue + ExpertWorkspace (candidate submission +
 *                structured self-evaluation through the frozen attempt
 *                state machine) + SelfEvaluationPanel after submission
 *   reviewer   — ReviewerDeckScreen (convergent + divergent seeded decks,
 *                evidence inspection dialog with focus trap)
 *   adjudicator— AdjudicatorDeckScreen (live-region adjudication status)
 *
 * Test control surface (render-host scaffolding, documented): the async
 * submission gate can be held/released via window.__arenaHostControl so the
 * "submitting" rendered state is deterministic for the browser suite.
 */

interface HostControl {
  /** Next submission waits for releaseSubmission() (deterministic submitting state). */
  holdSubmission(): void;
  releaseSubmission(): void;
  /** Live state snapshot for assertions (rendered-state probe). */
  snapshot(): Record<string, unknown>;
}

declare global {
  interface Window {
    __arenaHostControl?: HostControl;
  }
}

function WorkbenchHostApp(): ReactNode {
  const clientRef = useRef<MockArenaClient | null>(null);
  if (clientRef.current === null) {
    clientRef.current = new MockArenaClient();
  }
  const client = clientRef.current;

  const [lens, setLens] = useState<WorkbenchLens>("requester");

  // --- requester journey state -------------------------------------------
  const [title, setTitle] = useState("");
  const [outcome, setOutcome] = useState("");
  const [budget, setBudget] = useState("");
  const [errors, setErrors] = useState<readonly FieldError[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [tracking, setTracking] = useState<readonly EscalationSummary[]>([]);
  const submissionGate = useRef<{ held: boolean; resolve: (() => void) | null }>({
    held: false,
    resolve: null,
  });

  // --- expert journey state ----------------------------------------------
  const [queue, setQueue] = useState<readonly AttemptSummary[]>([]);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [manifest, setManifest] = useState("");
  const [notes, setNotes] = useState("");
  const [candidateErrors, setCandidateErrors] = useState<readonly FieldError[]>([]);
  const [selfEvaluationErrors, setSelfEvaluationErrors] = useState<readonly FieldError[]>([]);
  const [expertStatus, setExpertStatus] = useState("");
  const [selfPanel, setSelfPanel] = useState<StructuredSelfEvaluation | null>(null);

  // --- reviewer / adjudicator journey state --------------------------------
  const [deckChoice, setDeckChoice] = useState<DeckChoice>("res_00000001");
  const [deck, setDeck] = useState<ReviewDeckView | null>(null);
  const [dialogEnvelope, setDialogEnvelope] = useState<EvidenceEnvelopeView | null>(null);

  // --- payout journey state -------------------------------------------------
  const [payoutStep, setPayoutStep] = useState(0);

  // Keep a live snapshot ref for the host control probe.
  const snapshotRef = useRef<Record<string, unknown>>({});
  snapshotRef.current = {
    lens,
    submitting,
    statusMessage,
    errorCount: errors.length,
    trackingCount: tracking.length,
    attemptId: attempt?.attempt_id ?? null,
    attemptStatus: attempt?.status ?? null,
    candidateErrorCount: candidateErrors.length,
    selfEvaluationErrorCount: selfEvaluationErrors.length,
    expertStatus,
    selfPanelPresent: selfPanel !== null,
    deckChoice,
    deckResultId: deck?.result_id ?? null,
    dialogEvidenceId: dialogEnvelope?.evidence_id ?? null,
    payoutState: PAYOUT_HAPPY_PATH[payoutStep] ?? PAYOUT_HAPPY_PATH[0],
    payoutStep,
  };

  // Initial fixture load (mock client, as-is fixtures).
  useEffect(() => {
    void (async () => {
      const [listed, assignments, found] = await Promise.all([
        client.listEscalations(REQUESTER_PRINCIPAL),
        client.listAssignments(DEMO_EXPERT_PRINCIPAL),
        client.getAttempt("att_00000001", DEMO_EXPERT_PRINCIPAL),
      ]);
      setTracking(listed);
      setQueue(assignments);
      if (found.kind === "FOUND") {
        setAttempt(found.attempt);
      }
      document.documentElement.dataset.arenaHostReady = "true";
    })();
  }, [client]);

  // Review deck (re)load on case switch.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const outcome = await client.getReviewDeck(deckChoice, DEMO_EXPERT_PRINCIPAL);
      if (!cancelled && outcome.kind === "FOUND") {
        setDeck(outcome.deck);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, deckChoice]);

  // Keyboard a11y: on validation errors, move focus to the typed error
  // summary (programmatically focusable via the AR2-021 src fix).
  useEffect(() => {
    if (lens === "requester" && errors.length > 0) {
      document.querySelector<HTMLElement>(".arena-requester-cockpit .arena-field-errors")?.focus();
    }
  }, [errors, lens]);
  useEffect(() => {
    if (lens === "expert" && candidateErrors.length > 0) {
      document
        .querySelector<HTMLElement>(".arena-expert-workspace .arena-candidate-form .arena-field-errors")
        ?.focus();
    }
  }, [candidateErrors, lens]);

  // Host control surface (test scaffolding; deterministic submitting state).
  useEffect(() => {
    const control: HostControl = {
      holdSubmission() {
        submissionGate.current.held = true;
      },
      releaseSubmission() {
        submissionGate.current.held = false;
        submissionGate.current.resolve?.();
        submissionGate.current.resolve = null;
      },
      snapshot() {
        return { ...snapshotRef.current };
      },
    };
    window.__arenaHostControl = control;
    return () => {
      delete window.__arenaHostControl;
    };
  }, []);

  const maybeAwaitGate = useCallback(() => {
    return new Promise<void>((resolveGate) => {
      if (!submissionGate.current.held) {
        resolveGate();
        return;
      }
      submissionGate.current.resolve = resolveGate;
      // safety release so a forgotten hold cannot hang the host
      setTimeout(resolveGate, 30_000);
    });
  }, []);

  // --- requester: submit lifecycle ---------------------------------------
  const handleSubmit = useCallback(async () => {
    if (submitting) {
      return;
    }
    const validation = validateEscalationDraft(buildDraft(title, outcome, budget), SUBMIT_CONTEXT);
    if (!validation.ok) {
      setErrors(validation.fieldErrors);
      setStatusMessage(
        `Escalation rejected — ${validation.fieldErrors.length} field error(s); see the validation summary`,
      );
      return;
    }
    setErrors([]);
    setSubmitting(true);
    setStatusMessage("Submitting escalation request…");
    await maybeAwaitGate();
    const result = await client.submitEscalation(validation.request, REQUESTER_PRINCIPAL);
    setSubmitting(false);
    if (result.kind === "SUBMITTED") {
      setStatusMessage(`Escalation submitted — ${result.escalation_id}`);
      const listed = await client.listEscalations(REQUESTER_PRINCIPAL);
      setTracking(listed);
    } else {
      setErrors(result.fieldErrors);
      setStatusMessage("Escalation rejected — see the validation summary");
    }
  }, [budget, client, maybeAwaitGate, outcome, submitting, title]);

  // --- expert: candidate submission through the frozen attempt machine ----
  const refreshAttemptAndQueue = useCallback(async () => {
    const found = await client.getAttempt("att_00000001", DEMO_EXPERT_PRINCIPAL);
    if (found.kind === "FOUND") {
      setAttempt(found.attempt);
    }
    const listed = await client.listAssignments(DEMO_EXPERT_PRINCIPAL);
    setQueue(listed);
  }, [client]);

  const handleCandidateSubmit = useCallback(async () => {
    if (attempt === null) {
      return;
    }
    const result = await client.submitCandidate(
      attempt.attempt_id,
      { artifact_manifest: manifest, submission_notes: notes },
      DEMO_EXPERT_PRINCIPAL,
    );
    if (result.kind === "REJECTED") {
      setCandidateErrors(result.fieldErrors);
      setExpertStatus(
        `Candidate submission rejected — ${result.fieldErrors.length} field error(s); see the validation summary`,
      );
      return;
    }
    if (result.kind === "INVALID_TRANSITION") {
      setExpertStatus(
        `Candidate submission refused — ${result.code} (frozen attempt state machine; no invented edges)`,
      );
      return;
    }
    if (result.kind === "NOT_FOUND") {
      setExpertStatus("Candidate submission refused — attempt not found");
      return;
    }
    setCandidateErrors([]);
    setExpertStatus(`Candidate version ${result.candidate_version} submitted — attempt ${result.state}`);
    await refreshAttemptAndQueue();
  }, [attempt, client, manifest, notes, refreshAttemptAndQueue]);

  // --- expert: structured self-evaluation (never an independent vote) -----
  const handleSelfEvaluationSubmit = useCallback(async () => {
    if (attempt === null) {
      return;
    }
    // Host test-driving draft: covers every frozen demo criterion (the same
    // pattern the Node-side suites use to drive the mock client).
    const draft = {
      entries: DEMO_ACCEPTANCE_CRITERIA.map((criterion) => ({
        criterion_id: criterion.criterion_id,
        decision: "NOT_EVALUATED" as const,
        evidence_ids: [],
        rationale: "a11y render host: structured entry (demo driving data)",
      })),
    };
    const result = await client.submitSelfEvaluation(attempt.attempt_id, draft, DEMO_EXPERT_PRINCIPAL);
    if (result.kind === "REJECTED") {
      setSelfEvaluationErrors(result.fieldErrors);
      setExpertStatus(
        `Self-evaluation rejected — ${result.fieldErrors.length} field error(s); see the validation summary`,
      );
      return;
    }
    if (result.kind === "INVALID_TRANSITION") {
      setExpertStatus(
        `Self-evaluation refused — ${result.code} (frozen attempt state machine; no invented edges)`,
      );
      return;
    }
    if (result.kind === "NOT_FOUND") {
      setExpertStatus("Self-evaluation refused — attempt not found");
      return;
    }
    setSelfEvaluationErrors([]);
    setExpertStatus(
      `Structured self-evaluation submitted — attempt ${result.state} (visible evidence, never an independent vote)`,
    );
    setSelfPanel(result.evaluation);
    await refreshAttemptAndQueue();
  }, [attempt, client, refreshAttemptAndQueue]);

  // --- payout: advance the frozen payment lifecycle ------------------------
  const handlePayoutAdvance = useCallback(() => {
    setPayoutStep((step) => Math.min(step + 1, PAYOUT_HAPPY_PATH.length - 1));
  }, []);

  return (
    <>
      <header className="site-header">
        <a className="skip-link" href="#arena-main">
          Skip to main content
        </a>
        <h1>Arena workbench — accessibility render host</h1>
        <p className="site-subtitle">
          DEMO render host: workbench screens mounted with their own mock-client fixtures
          (deterministic, in-memory)
        </p>
      </header>
      {/* tabIndex -1: standard skip-link target so hash navigation moves
          keyboard focus onto the main landmark (screen readers announce it) */}
      <main id="arena-main" className="site-main" tabIndex={-1}>
        <RoleSwitcher selected={lens} onSelect={setLens} />
        {lens === "requester" ? (
          <>
            <RequesterCockpit
              lens={lens}
              title={title}
              outcomeDescription={outcome}
              budgetLimit={budget}
              errors={errors}
              tracking={tracking}
              submitting={submitting}
              statusMessage={statusMessage}
              onSubmit={() => void handleSubmit()}
              onTitleChange={setTitle}
              onOutcomeChange={setOutcome}
              onBudgetChange={setBudget}
            />
            <PayoutStatusPanel step={payoutStep} onAdvance={handlePayoutAdvance} />
          </>
        ) : null}
        {lens === "expert" ? (
          <>
            <ExpertQueue assignments={queue} />
            {attempt !== null ? (
              <ExpertWorkspace
                attempt={attempt}
                manifestValue={manifest}
                notesValue={notes}
                candidateErrors={candidateErrors}
                selfEvaluationErrors={selfEvaluationErrors}
                statusMessage={expertStatus}
                onManifestChange={setManifest}
                onNotesChange={setNotes}
                onCandidateSubmit={() => void handleCandidateSubmit()}
                onSelfEvaluationSubmit={() => void handleSelfEvaluationSubmit()}
              />
            ) : null}
            {selfPanel !== null ? <SelfEvaluationPanel evaluation={selfPanel} /> : null}
          </>
        ) : null}
        {lens === "reviewer" || lens === "adjudicator" ? (
          <section className="arena-deck-selector" aria-label="review case selector">
            <h2>Review case</h2>
            {DECK_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                aria-pressed={deckChoice === choice}
                data-deck-choice={choice}
                onClick={() => setDeckChoice(choice)}
              >
                {choice === "res_00000001"
                  ? "Load convergent case (res_00000001)"
                  : "Load divergent case (res_00000002)"}
              </button>
            ))}
          </section>
        ) : null}
        {lens === "reviewer" && deck !== null ? (
          <ReviewerDeckScreen deck={deck} onInspectEvidence={setDialogEnvelope} />
        ) : null}
        {lens === "adjudicator" && deck !== null ? (
          <AdjudicatorDeckScreen
            deck={deck}
            adjudication={adjudicationView(deck, DEMO_PROOF_POLICY_PRESET.review_policy)}
          />
        ) : null}
        {dialogEnvelope !== null ? (
          <EvidenceDetailDialog envelope={dialogEnvelope} onClose={() => setDialogEnvelope(null)} />
        ) : null}
      </main>
      <footer className="site-footer">
        <p>
          AR2-021 accessibility render host — Arena workbench demo fixtures only; test-mode
          finance; live money and untrusted execution stay disabled.
        </p>
      </footer>
    </>
  );
}

const container = document.getElementById("root");
if (container === null) {
  throw new Error("render host: #root container missing");
}
createRoot(container).render(<WorkbenchHostApp />);
