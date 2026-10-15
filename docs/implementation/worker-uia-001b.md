# Worker Report — UIA-001 Lane B (requester cockpit + expert workbench)

**Executor disclosure (honest):** executed **TL-direct at the station** on 2026-10-15 (the platform's generation window stayed closed ~3h after the original dispatch — all lane packets server-side, zero assistant turns; the same wedge class Lane A disclosed; AR2-015 precedent "TL-direct until a real worker is available"). The sentinel kept retrying B/C for real worker capacity throughout; this delivery closes lane B's scope. **Workers do not self-accept**: the station gate battery below is the acceptance evidence; final acceptance at TL integration on fresh main.

**Branch:** `work/uia-001b-workbenches`, based on current main `9b18b52` (lane A merged at `fc49cb2` + the ledger reconciliation — the screens compose the real product shell Lane A delivered).

## What was built

1. **The requester cockpit (`src/screens/requester/`)** — the product's primary loop as the dominant surface:
   - **Compose/submit**: the capability-gap request form over the frozen `validateEscalationDraft` (fail-fast, field-level errors verbatim). Enumerated contract fields are **typed selects read directly from the CF1.0 zod enums** (`.options` on `riskTierSchema`/`privacyProfileSchema`/`retentionProfileSchema`/`escalationModeSchema` — never hand-mirrored, never free-text where the contract enumerates); budget/delivery per the frozen schemas; webhook URL only when the channel is webhook (builder turns it into the typed reference).
   - **Tracking**: from the server projection (`binding.tracking` — `GET /v1/escalations*`); state chips via `stateView` (1:1 frozen vocabulary, unknown states fail closed); SLA/clock display only from server timestamps (`updated_at`).
   - **Routing transparency**: the four routing concepts from the frozen spec §1.1 product loop (human expert / scraper / external API / combination) with when/why explanations; per-escalation routing status derives ONLY from server timeline events — absent routing events render the honest "not recorded in the server projection (never invented client-side)" disclosure.
   - **Evidence/results inspection**: the server timeline (canonical event stream verbatim) + the typed result stub (`NOT_AVAILABLE` + AR2-007 disclosure verbatim).
   - **Payment state**: test-mode disclosure verbatim (`ARENA_RELEASE_POSTURE.financeMode`), the failed/inconclusive-never-pays rule, and the payment state vocabulary chips 1:1.
   - **States**: loading / empty (Arena-branded) / error (typed failures verbatim + retry affordance).
2. **The expert workbench (`src/screens/expert/`)** — the two-channel honest architecture:
   - **Queue**: attempt summaries with typed facts (state chips, budget, candidates) + the DEMO tag rendered honestly.
   - **Task context + capsule entry**: §2.3 SECURITY-STATE HONESTY — the privacy-bounded capsule entry renders **truthfully disabled** with the recorded basis (`untrusted execution DISABLED`, `AR2-019-strict-mode-station-evidence` doc path), never absent, never implying isolation beyond the recorded evidence.
   - **Candidate submission** through the attempt-level frozen state machine (typed REJECTED/INVALID_TRANSITION/NOT_FOUND verbatim).
   - **Structured self-evaluation**: a per-criterion form driven by the escalation's acceptance criteria (full coverage enforced by the frozen validator), **visually distinct** from an independent review (`data-never-vote`, the frozen never-a-vote text).
   - **Intervention submission** through the **canonical escalation command path** (the real binding's `command` route — `SubmitIntervention`; typed 409/404 failures rendered verbatim).
   - **Payout/proof status**: proof-gated payout presentation (failed/inconclusive never pays; test-mode ledger disclosure).
3. **Controllers, not just views**: each screen's state machine lives in a headless controller (`RequesterController` / `ExpertController`) with a subscribable immutable snapshot; the React components are thin glue (`useSyncExternalStore`). Tests drive the controllers without a DOM; `react-dom/server` renders every produced state.
4. **Registration factories**: `requesterRegistration(deps)` / `expertRegistration(deps)` construct the `ArenaScreenRegistration` objects the TL integration will mount in the shell registry; deps (binding/attempt port/command port/principal) are injected by the composition root — zero hardcoded endpoints in the lane. Composition adapters included: `mockAttemptsAdapter` (MockArenaClient → attempt port) and `bindingCommandAdapter` (RealWorkbenchBinding.command, principal-bound).
5. **Styles**: `requester.css` / `expert.css` — every token `--arena-*`, typography `text-ui-*`, focus rings drawn on wrapper layers (the inherited global focus-reset law), responsive grid (≥960px two-column; <960px single; 390×844 no horizontal overflow), reduced-motion support. CSS files are standalone in-fence (no TS imports — same as Lane A; TL integration wires them).

## Composition-law decision (disclosed): in-fence primitives over cross-package JSX rendering

Lane B renders state chips, field-error lists, and the demo disclosure through **in-fence primitives** (`StateChip`, `FieldErrors`, `DemoDisclosure` in `src/screens/requester/presenters.tsx`) driven by the workbench's **pure surfaces** (`stateView`, `WORKBENCH_DEMO_DISCLOSURE`, `FieldError` types) rather than rendering the workbench's own JSX components. Root cause: the repo's `tsx` test runner applies the **classic JSX runtime** to files outside the resolved tsconfig's `include` (documented in `packages/arena-workbench/test/render.test.tsx`'s import of React) — importing the workbench package from arena-shell's cwd compiles its `.tsx` screens classic, and rendering them throws `React is not defined`. The frozen vocabulary still flows 1:1 (the chip renders `stateView`'s output; the disclosure renders `WORKBENCH_DEMO_DISCLOSURE` verbatim); nothing was re-invented — the presentation primitives are Lane B's own, which the spec's composition law explicitly reserves to the shell ("the inherited component vocabulary … via the shell's own composition").

## Routing-vocabulary source (disclosed)

The packet pointed at `@arena/contracts` for the capability-acquisition routing vocabulary; the actual `providerKindSchema` (SCRAPER/EXTERNAL_API/HUMAN_EXPERT) lives in `@arena/acquisition`, which is **not** in `arena-shell`'s module `requires` (arena-contracts + arena-workbench only — module manifest + architecture-policy). The routing concepts therefore render from the **frozen UX spec §1.1's product-loop vocabulary** (the binding frozen text: "route (human expert / scraper / external API / combination)"), and per-escalation routing decisions come only from server timeline events. No client-side routing rationale is ever invented.

## Test inventory (all labeled; `tsx --test` from `packages/arena-shell`)

- `test/requester/requester-model.test.ts` (13, **PURE**) — form enumerations verbatim from the frozen schemas; valid/invalid drafts through the frozen validator; tenant never in the draft; routing concepts (four, verbatim) + not_recorded honesty; payment test_mode/never-pays verbatim + vocabulary 1:1 + unknown fail-closed; the four honest states; typed NOT_FOUND/NOT_AVAILABLE verbatim; six submit-outcome kinds.
- `test/requester/requester-screen.test.tsx` (12, **RENDERED** via `react-dom/server` + fake-binding controllers) — loading/empty/error/main flows; submit success/failure/CONFLICT verbatim; lens presentation-only (two lenses → identical deps call logs + identical surface modulo the lens context line); zero ZCode; registration wiring; payment/posture verbatim; structural a11y (labels/roles/live regions/fieldset).
- `test/requester/requester-real.test.tsx` (2, **REAL** — spawns a real arena-api process, real HTTP, demo-token auth; mirrors the workbench e2e precedent) — submit → server projection → tracking → timeline (EscalationCreated) → typed result stub (AR2-007 disclosure) **rendered from real data**; idempotent replay (same key + same digest → REPLAYED, never double-creates) + digest-mismatch CONFLICT verbatim.
- `test/expert/expert-model.test.ts` (5, **PURE**) — isolation posture §2.3 verbatim (incl. the capsule-disabled basis); payout follows proof (failed/inconclusive never pays; in-progress never infers); queue typed facts + demo tag; never-a-vote distinction text; command outcome text verbatim across the typed space.
- `test/expert/expert-screen.test.tsx` (13, **RENDERED + FIXTURE** — MockArenaClient journeys, DEMO-tagged) — queue loading/empty/typed facts; selection opens the workspace; capsule truthfully disabled with the recorded basis; candidate submission journey (frozen state machine) + REJECTED fail-fast verbatim; structured self-evaluation journey (full coverage submits, never-a-vote visible); payout panel; intervention typed 409 verbatim; empty-id honest notice; lens presentation-only; registration wiring; structural a11y.
- `test/expert/expert-real.test.tsx` (3, **REAL** — real arena-api process) — SubmitIntervention against a real CREATED escalation → the server's typed 409 verbatim on the surface; unknown escalation → typed 404 verbatim; structural assertion that the command port's request path carries no lens/role.

## Verification battery (real numbers, station)

| gate | command | result |
| --- | --- | --- |
| fence law (merge-base diff vs owned paths) | gate script lane-b regex | PASS — 22 files, all in-fence |
| frozen contract (`contract.ts`/`module.ts`) | `git diff BASE...HEAD --` | byte-identical PASS |
| architecture guard | `node scripts/architecture/architecture-check.mjs check` | 0 violations (baseline 0, new 0) |
| scoped typecheck | `tsc -b packages/arena-shell` | 0 errors |
| oxlint | `oxlint packages/arena-shell` | 0 errors, 4 warnings (Lane A's pre-existing classes — nav model `n`, ArenaShell imports, tokens test) |
| lane tests | `tsx --test test/requester/* test/expert/*` | **49/49** pass, 0 fail, 0 skipped |
| full shell suite (lane A regression) | + `test/shell/* test/identity/* test/nav/*` | **83/83** pass, 0 fail, 0 skipped |
| file-size law (`<400` lines/src file) | `find … wc -l` | PASS (largest: RequesterScreen.tsx 252) |
| full-workspace `pnpm typecheck` | NOT RUN at station | 4GB OOM class (disclosed; CI runs it) |

## Deviations / blockers / known-remaining

- **TL-direct execution** (disclosed above) — same class as Lane A; the sentinel continues retrying for real worker capacity on lane C.
- **CI gap (TL integration item)**: the CI battery (`.github/workflows/ci.yml`) has **no arena-shell test step yet** — lane A's 34 and this lane's 49 tests are station-run only. The TL integration commit should add the step (and the shell mounting) so the battery covers the package.
- **PENDING-station (honest)**: real-browser keyboard/focus journeys + screenshots (AR2-021 class) — deferred to TL integration which mounts the shell in the real web app; rendered-state coverage here is `react-dom/server` class.
- **Attempt-level projection is demo-tagged**: the expert queue/workspace operate on the MockArenaClient (deterministic fixtures, DEMO-tagged, disclosed on the surface). The canonical escalation command path (intervention submission) is the REAL binding. The real attempt-level API surface is a recorded frontier; when it lands, the `mockAttemptsAdapter` is replaced without screen-contract change.
- **Criteria source for seeded demo attempts**: the mock's self-eval validator validates against the frozen `DEMO_ACCEPTANCE_CRITERIA`; the adapter shows that same frozen set for seeded attempts (the truthful preview of what validation expects). For escalations submitted through the mock, the real request's criteria are used.
- **TL integration known-remaining**: mount both registrations in the shell registry (`packages/web/src/main.tsx` + desktop renderer entry), wire the CSS (tokens + shell + lane styles), add the arena-shell CI step, browser journeys, `main.tsx` share-page titles (lane A's list, unchanged).
