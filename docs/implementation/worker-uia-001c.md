# Worker Report — UIA-001 Lane C (reviewer/adjudicator deck, developer portal, operations surfaces)

**Executor disclosure (honest):** executed **TL-direct at the station** on 2026-10-15 (the platform's generation window stayed closed ~4h after the original dispatch — the same wedge class Lanes A/B disclosed; AR2-015 precedent). The sentinel kept retrying C for real worker capacity until this delivery started; workers do not self-accept — the station gate battery below is the acceptance evidence; final acceptance at TL integration on fresh main.

**Branch:** `work/uia-001c-portals`, based on current main `b8f8e74` (Lane B merged at `b8f8e74` + the prior reconciliations — the reviewer screen composes Lane B's in-fence presentation primitives and command-outcome helpers).

## What was built

1. **The reviewer/adjudicator workbench (`src/screens/reviewer/`)** — evidence-first review as the dominant surface:
   - **The review deck** renders `buildReviewDeck`'s frozen product directly: criterion rows (typed decisions PASS/FAIL/INCONCLUSIVE/NOT_EVALUATED, proof classes P0–P3, evidence ids, hard-stop flags), the verification trail verbatim (validators/versions, independent reviewer ids, adjudicator, outcomes, policy version), and the redaction partitions — shared / reviewer-private visually separated, **operator-class evidence withheld with count-only disclosure** (content never rendered).
   - **Self-evaluation vs independent review separation**: the author's self-evaluation renders in a dedicated visually-distinct section (`data-never-vote`, dashed pattern, the frozen never-a-vote rule verbatim); quorum counts ONLY the trail's reviewer_ids (self-evaluations never count — asserted).
   - **Adjudication**: `adjudicationView`'s frozen semantics (divergent outcomes / hard-stop disputes → the adjudication path) with the recorded trigger.
   - **Independent review vote**: through the **canonical escalation command path** (real binding — `SubmitReviewerEvaluation`; typed 409/404 rendered verbatim).
   - **Audit trail**: the server-recorded timeline rendered append-only (no client-side synthesis).
   - **Payout eligibility**: result-linked (ACCEPTED/PARTIALLY_ACCEPTED eligible pending proof; REJECTED/INCONCLUSIVE/EXPIRED/FAILED never pay; duplicate operations cannot double pay — the idempotency law verbatim; test-mode ledger disclosure).
   - **States**: loading/empty/error with the honesty laws; evidence grade DEMO verbatim (never inflated).
2. **The developer portal (`src/screens/developer/`)** — the typed contract reference:
   - **Contract shapes enumerated at runtime from the REAL frozen zod schemas** (escalation request envelope fields, event envelope fields, result status vocabulary, delivery preferences — never hand-mirrored; REAL contract-shape tests assert them).
   - **Webhook/transport setup**: the canonical headers (authorization Bearer — never a UI role; x-idempotency-key — apply-once/replay/typed-conflict) + the CF1.0 `IDEMPOTENCY_SEMANTICS` verbatim (same-key-same-digest, digest mismatch, concurrent, retry-bound).
   - **Keys & scopes**: the credential model presentation with provisioning **truthfully pending** (no live provider at base — never fake success; the demo registry disclosure).
   - **Delivery status**: FIXTURE-labelled rows with semantics verbatim from the idempotency law (DELIVERED / DUPLICATE_IGNORED / PENDING).
   - **Provider configuration**: the read-only routing vocabulary (spec §1.1) with the acquisition-resolution constraint disclosed.
3. **Operations & governance (`src/screens/operations/`)** — the FROZEN truth law (§2.3):
   - **The release posture panel**: `ARENA_RELEASE_POSTURE` verbatim — NOT_GO / test_mode / disabled + the recorded bases (AR2-015 gate report, AR2-019 strict-mode evidence, AR2-023 authorization instrument).
   - **Restricted actions render truthfully disabled with their recorded bases** (release decision recording, untrusted execution enablement, live-money enablement) — never absent.
   - **Provider health vocabulary** (typed statuses; evidence grades DEMO/FIXTURE/REAL verbatim).
   - **The operational state vocabulary** (the four frozen state machines 1:1) + **the audit trail from the REAL server timeline** (append-only basis).
4. **Architecture**: the lane-B controller/headless pattern carried over (`ReviewerController`, `OperationsController`); the developer portal is a pure reference surface (no async deps). Registration factories for all three screens (`reviewerRegistration`/`developerRegistration`/`operationsRegistration`) + composition adapters (`mockDecksAdapter`, `bindingReviewerAdapters`, `bindingAuditAdapter`). One shared CSS file (`reviewer.css`) covering the three screens' classes (on top of Lane B's shared classes — both load together at integration).

## Resolution constraints (packet's own fallback clause, recorded)

- **@arena/sdk and @arena/ops are not resolvable from @arena/shell at this base** (the module's `requires` are arena-contracts + arena-workbench; the package manifest is TL-owned and outside this lane's fence; adding dependencies is forbidden). Per the packet's fallback: the developer portal presents the typed contract surfaces through the **resolvable frozen schemas** (`@arena/contracts`' escalationRequestSchema/eventEnvelopeSchema/resultStatusSchema/deliveryPreferencesSchema/IDEMPOTENCY_SEMANTICS — the SAME envelopes the SDK transports), and the operations screen renders the resolvable operational vocabulary (the frozen state machines + the server audit timeline). Both surfaces carry the constraint verbatim; the SDK client surface, MCP facade, and the ops package's typed panels mount at TL integration when the module requires extend.
- **The acquisition routing vocabulary** (provider kinds) likewise lives in the unresolvable `@arena/acquisition` — the provider-configuration panel presents the frozen spec §1.1 vocabulary read-only (same constraint class Lane B disclosed for routing transparency).

## Test inventory (all labeled; `tsx --test` from `packages/arena-shell`)

- `test/reviewer/reviewer-model.test.ts` (13, **PURE**) — the deck's frozen shapes; quorum counts only trail reviewers; the never-a-vote distinction verbatim; adjudication triggers; payout eligibility vs result status (failed/inconclusive never pay; unknown fail-closed); test-mode ledger disclosure; evidence grade verbatim; release-posture truth law; provider health vocabulary; operational state vocabulary 1:1; the REAL contract-shape enumerations; idempotency rules verbatim; fixture-labelled delivery rows.
- `test/reviewer/reviewer-screen.test.tsx` (12, **RENDERED + FIXTURE** via MockArenaClient.getReviewDeck) — loading/empty/error; queue with DEMO tags; the deck's rubric table; redaction partitions (operator count-only); the self-eval distinct section; the audit trail verbatim; payout rule; the typed 409 vote outcome verbatim; the empty-id honest notice; lens presentation-only; registration wiring; structural a11y.
- `test/reviewer/reviewer-real.test.tsx` (2, **REAL** — spawns a real arena-api process) — SubmitReviewerEvaluation against a real CREATED escalation → the server's typed 409 verbatim on the surface; the REAL server timeline rendered verbatim.
- `test/developer/developer-screen.test.tsx` (11, **RENDERED**) — the contract reference enumerated from the real schemas; webhook headers + idempotency semantics verbatim; provisioning truthfully pending; FIXTURE-labelled delivery rows; the provider vocabulary + constraints; the SDK/OPS resolution constraint; posture verbatim; lens presentation-only; registration wiring; structural a11y.
- `test/operations/operations-screen.test.tsx` (11, **RENDERED**) — the posture panel verbatim (all three recorded bases); restricted actions disabled-with-basis; provider health; the state vocabulary 1:1; the audit trail (loaded + typed NOT_FOUND error verbatim); the ops constraint; lens presentation-only; registration wiring; structural a11y.

## Verification battery (real numbers, station)

| gate | command | result |
| --- | --- | --- |
| fence law (merge-base diff vs owned paths) | gate script lane-c regex | PASS — 21 files, all in-fence |
| frozen contract (`contract.ts`/`module.ts`) | `git diff BASE...HEAD --` | byte-identical PASS |
| architecture guard | `node scripts/architecture/architecture-check.mjs check` | 0 violations (baseline 0, new 0) |
| scoped typecheck | `tsc -b packages/arena-shell` | 0 errors |
| oxlint | `oxlint packages/arena-shell` | 0 errors, 4 warnings (the pre-existing Lane A classes) |
| lane tests | `tsx --test test/{reviewer,developer,operations}/*` | **49/49** pass, 0 fail, 0 skipped |
| full shell suite (A+B+C regression) | all arena-shell tests | **121/121** pass, 0 fail, 0 skipped |
| file-size law (`<400` lines/src file) | `find … wc -l` | PASS (largest: reviewer/presenters.tsx 393) |
| full-workspace `pnpm typecheck` | NOT RUN at station | 4GB OOM class (disclosed; CI runs it) |

## Deviations / blockers / known-remaining

- **TL-direct execution** (disclosed above) — same class as Lanes A/B.
- **CI gap unchanged (TL integration item)**: the CI battery still has no arena-shell test step — now covering three lanes' 121 tests at the station. The TL integration commit adds the step.
- **PENDING-station (honest)**: real-browser keyboard/focus journeys + screenshots (AR2-021 class) — deferred to TL integration.
- **Deck projection is demo-tagged** (the mock's seeded results); the independent review vote is the REAL binding command path; the real result projection is a recorded frontier (adapter replacement without screen-contract change).
- **Cross-lane composition**: the reviewer/operations screens import Lane B's in-fence primitives (`DemoDisclosure`, `commandOutcomeText`) — Lane B merged (`b8f8e74`) before this lane's delivery; both lanes' CSS files load together at TL integration.
- **TL integration known-remaining** (the full list from Lanes A/B, plus): mount all five registrations in the shell registry; wire the CSS (tokens + shell + all three lanes' files); add the arena-shell CI battery step; browser journeys; `main.tsx` share-page titles; extend module requires if the SDK/ops surfaces mount.
