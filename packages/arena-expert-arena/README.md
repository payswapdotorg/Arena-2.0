# @arena/expert-arena

AR2-009 — Expert Arena: competition rounds, immutable candidate versions,
structured author self-evaluation, conflict-checked independent review, rubric
scoring, quorum, adjudication and round-outcome selection (issue #11; spec
[EA1.0](../../spec/expert-arena/expert-arena.md)).

Write fence held: Expert Arena rounds, candidate/review assignments and
adjudication only — **no independent payment authority** (payment moves by
operation-id reference into `@arena/payment`, AR2-010's domain).

## Frozen surfaces consumed

- `@arena/contracts`: `StateMachineDefinition` + `evaluateTransition` engine and
  the frozen command enum (`SubmitSelfEvaluation`, `SubmitReviewerEvaluation`,
  `RequestRevision`, `SubmitAppeal`, `SubmitIntervention` + system triggers).
- `@arena/evidence` (AR2-007): `evaluateProof` / `ProofDecision` — the identical
  predeclared validation applied to every eligible candidate; P0/P1 winners are
  bound to a SATISFIED decision.
- `@arena/matching` (AR2-008): `evaluateConflictOfInterest` — the shared
  conflict screen for reviewer assignment (never a second implementation).

## Non-negotiable semantics

- **Self-evaluation is never a vote**: the structured self-evaluation carries a
  compile-time `never_an_independent_vote: true` literal; quorum counts only
  finalized independent reviews — the author's evaluation is structurally absent
  from the counted set.
- **Timeout never approves**: reviewer timeout/forfeit lands in `REPLACED` with
  a replacement request; no machine edge anywhere infers approval from absence.
- **Popularity cannot override proof**: hard-stop criterion failures block
  acceptance regardless of means, votes or ratings; P0/P1 winners require
  SATISFIED validator evidence; P2/P3 winners require an independent decision
  (quorum or adjudication).
- **Missing quorum fails closed**: `QUORUM_NOT_REACHED` → request replacement
  or escalate; `approval_implied: false` is a structural literal.
- **Immutable versions**: revisions append a new version; prior versions are
  preserved read-only.

## Machines (EA1.0 §6)

- `roundStateMachine`: DRAFT → FROZEN → OPEN_FOR_ATTEMPTS → SUBMISSIONS_CLOSED
  → VALIDATING → REVIEWING → ADJUDICATING (conditional) → DECIDED →
  PAYMENT_PENDING (reference only) → CLOSED.
- `candidateStateMachine`: DRAFT → SUBMITTED → VALIDATING →
  VALIDATOR_PASSED/FAILED/INCONCLUSIVE → INDEPENDENT_REVIEW →
  REVISION_REQUESTED (optional) → ACCEPTED / REJECTED / WITHDRAWN.
- `reviewStateMachine`: ASSIGNED → ACCEPTED_BY_REVIEWER → IN_PROGRESS →
  SUBMITTED → CHALLENGED (optional) → FINALIZED; REPLACED is the only
  timeout/forfeit destination.

All transitions run through the frozen contracts engine with typed
`INVALID_TRANSITION` / `INVARIANT_VIOLATION` failures. Machine refinements
require an ACR and contract tests (EA1.0 §6).

## Disclosures

In-memory reference registries (durable wiring rides the frozen AR2-005 ports
at the composition root); reviewer notes carry only structured public parts —
confidential evaluator notes and redaction partitions are the workbench's
presentation concern (AR2-003). See `src/*.ts` header disclosures.
