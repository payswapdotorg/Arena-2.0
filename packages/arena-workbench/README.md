# @arena/workbench

AR2-003 — Requester, expert and reviewer workbench. This package is the
Arena-specific UI surface: **typed mock client**, **requester cockpit form**
(client-side validated against the frozen CF1.0 zod schemas), **expert flow**
(candidate submission + structured self-evaluation driven by the frozen
attempt state machine), **reviewer/adjudicator decks** (criterion outcomes +
verification trail + redaction partition), **role/lens switcher**
(presentation only), **state views** for the four frozen state machines, and
React presentational screens.

> **DEMO — deterministic fixtures, never customer state** (architecture-lock
> 23). Every mock record carries a `DemoTag`; the disclosure banner is rendered
> on every screen.

## Role is not authorization (frozen rule)

`ROLE_IS_NOT_AUTHORIZATION_RULE`: the workbench lens selects which screens are
shown, never what is allowed. Every mock-client method takes a
`WorkbenchPrincipal` (tenant/user — the stand-in for server-side credential
derivation) and **never receives the UI role**. Authorization itself lives on
the server side (AR2-002 surface); binding the workbench to the real API is
AR2-006.

## Slice 1 surface

| Area           | Export                                                           | Semantics                                                                                                                                                                                                                                       |
| -------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mock client    | `MockArenaClient`, `ArenaWorkbenchClient`                        | fail-closed intake via `escalationRequestSchema` (per-field `REJECTED`); tenant-scoped list/get (cross-tenant = `NOT_FOUND`); demo-tagged records                                                                                               |
| Requester form | `validateEscalationDraft`                                        | draft (caller-editable subset) → full envelope (system fields composed: contract version, digest, proof-policy preset) → CF1.0 zod + frozen criterion semantics → typed field errors; unknown draft fields (e.g. injected `tenant_id`) rejected |
| Role/lens      | `RoleSwitcher`, `roleSwitcherModel`, `WORKBENCH_LENSES`          | requester/expert/reviewer/adjudicator lenses; `aria-pressed` per lens; rule text embedded in the switcher (`data-role-is-not-authorization`)                                                                                                    |
| State views    | `WORKBENCH_STATE_VIEWS`, `stateView`                             | 1:1 derived from the frozen 13/11/12/9 states with explicit kind sets; unknown state values render as `unknown (no invented states)` — fail closed                                                                                              |
| Demo fixtures  | `DEMO_PROOF_POLICY_PRESET`, `DEMO_ACCEPTANCE_CRITERIA`           | deterministic, CF1.0-valid snapshot fixtures (PVP1.0 literal, rubric review policy, payout gate with `dispute_blocks_release: true`)                                                                                                            |
| Screens        | `RequesterCockpit`, `StateBadge`, `DemoBanner`, `FieldErrorList` | pure presentational React components (SSR-renderable); loading/empty/error/inconclusive states surfaced                                                                                                                                         |

## Slice 2 surface

| Area                  | Export                                                                                 | Semantics                                                                                                                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Expert flow           | `validateCandidateDraft`, `validateSelfEvaluationDraft`, `evaluateCandidateSubmission` | candidate draft → immutable candidate version (`candidateVersionSchema`, unknown-key rejection); self-evaluation is criterion-level, evidence-referencing, covers every criterion, and carries `never_an_independent_vote: true` + the frozen rule text (architecture-lock 17) |
| Frozen-machine wiring | `evaluateSelfEvaluationSubmission`, `evaluateExpertTransition`                         | ENVIRONMENT_READY → SUBMITTED (`SubmitIntervention` + candidate guards) and SUBMITTED → VERIFYING (`SubmitSelfEvaluation` + `self_evaluation_structured`) only via `evaluateTransition` — no hand-written state assignments, `INVALID_TRANSITION` surfaced as typed outcome    |
| Mock client (expert)  | `listAssignments`, `getAttempt`, `submitCandidate`, `submitSelfEvaluation`             | tenant-scoped; cross-tenant = `NOT_FOUND` (indistinguishable); seeds are fail-closed validated (schema + semantics) and instance-isolated via `structuredClone`; live transitions mutate only the instance copy                                                                |
| Reviewer deck         | `buildReviewDeck`, `ReviewerCriterionRow`, `VerificationTrail`                         | criterion rows merge `criterionOutcomeSchema` decisions with frozen criterion statements; trail exposes validators/versions/reviewers/adjudicator/outcomes/policy_version; `independent_review_count` counts only `trail.reviewer_ids` (self-evaluation never counted)         |
| Redaction             | `partitionByRedactionClass`, `RedactionBoundary`                                       | public/tenant → shared area; `reviewer_private` → visually separated boundary (`data-redaction-class`); `operator` → withheld from the reviewer surface (count only, no evidence ids rendered)                                                                                 |
| Adjudication          | `adjudicationView`, `AdjudicatorDeckScreen`                                            | divergence = differing rubric outcome bands or a hard-stop dispute; adjudicator presence and trigger from the frozen review policy                                                                                                                                             |
| Screens (expert)      | `ExpertQueue`, `ExpertWorkspace`, `SelfEvaluationPanel`                                | pure presentational; empty state for the queue; non-vote rule text rendered on the workspace and the panel (`data-never-vote="true"`)                                                                                                                                          |
| Screens (reviewer)    | `ReviewerDeckScreen`, `AdjudicatorDeckScreen`, `VerificationTrailView`                 | SSR smoke-tested; result statuses that are not frozen attempt states (e.g. `PARTIALLY_ACCEPTED`) render as plain text — no invented state badges                                                                                                                               |

## Tests

- `test/workbench.test.ts` — UI-logic: form validation (valid / unknown field /
  invalid budget / unknown preset), role-rule assertion, state-registry 1:1
  derivation + unknown-state fail-closed, mock-client fail-closed intake +
  tenant isolation + demo labelling.
- `test/render.test.tsx` — SSR smoke via `renderToStaticMarkup`: demo banner,
  lens switcher accessibility, state badges (frozen + unknown), typed field
  errors, cockpit form + empty tracking + summaries.
- `test/expert-review.test.ts` — slice 2 UI-logic: candidate draft validation
  (immutable version, strict unknown-key rejection), frozen-machine
  transitions (ENVIRONMENT_READY → SUBMITTED; SUBMITTED → VERIFYING only when
  structured; refusals as `INVALID_TRANSITION`), self-evaluation validation
  (unknown criterion / dangling evidence / incomplete coverage all rejected),
  mock-client expert surface (queue, tenant isolation, seed isolation),
  reviewer deck assembly (criterion merge, redaction partition, trail fields,
  self-evaluation never counted), adjudication divergence flags.
- `test/expert-review-render.test.tsx` — slice 2 SSR smoke: expert queue +
  workspace + self-evaluation panel (non-vote labelling), reviewer deck
  (criterion rows, redaction boundary, withheld operator count, verification
  trail, separated self-evaluation), adjudicator deck (divergence + trigger),
  PARTIALLY_ACCEPTED rendered without invented attempt states.

## Manual smoke script (documented — acceptance scenario 6 minimum)

Run locally from the repo root:

```
pnpm --filter @arena/workbench exec ../../node_modules/.bin/tsx --test \
  packages/arena-workbench/test/workbench.test.ts \
  packages/arena-workbench/test/render.test.tsx \
  packages/arena-workbench/test/expert-review.test.ts \
  packages/arena-workbench/test/expert-review-render.test.tsx
```

Manual pass/fail checklist (a reviewer walks the SSR markup or mounts
`RequesterCockpit` into any React host):

1. DEMO banner visible at the top of every screen; text matches
   `WORKBENCH_DEMO_DISCLOSURE`.
2. Role switcher shows four lenses; selecting one changes the visible screen
   only — no mutation call changes (the rule text is the switcher tooltip).
3. Requester cockpit: submitting with an invalid budget shows a per-field
   error under the offending input; submitting a valid draft produces a
   `SUBMITTED` outcome with a demo tag.
4. Tracking list renders one `StateBadge` per escalation; a tampered state
   value renders as `unknown (no invented states)`, never an invented label.
5. Keyboard accessibility: every control is a native `button`/`input`/
   `textarea` with an explicit `label`/`aria-label`.
6. Expert queue → workspace: submit a candidate on the open attempt; the
   second submission is refused as `INVALID_TRANSITION` (no invented edges).
7. Self-evaluation panel: rendered apart from criterion outcomes, labelled
   "visible evidence, not a vote"; the independent-review count never moves.
8. Reviewer deck: reviewer-private evidence sits inside the redaction
   boundary; operator evidence shows only a withheld count; the adjudicator
   deck flags divergence with the frozen trigger text.

## Later work

- Bind the workbench to the real API (AR2-006) — the mock client and its
  outcome types are the replacement seam.
- Attempt/evidence timeline view and Playwright-grade E2E when the runner
  lands (this WO's minimum is node:test UI-logic + the documented smoke
  script above).

## House notes

- Public surface is `src/contract.ts` only (architecture guard: deep imports
  are violations).
- React is a workspace-pinned dependency (`react` 19.2.x override at the repo
  root); `react-dom` is a dev dependency used only by the SSR smoke tests.
- No API/domain/persistence writes, no server authorization in UI (write
  fence, OWN1.0 lane 2).
