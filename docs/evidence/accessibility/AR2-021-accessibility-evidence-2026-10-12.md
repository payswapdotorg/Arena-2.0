# AR2-021 — Accessibility end-to-end coverage evidence

**Date:** 2026-10-12  
**Repository:** payswapdotorg/Arena-2.0  
**Work order:** AR2-021 (issue [#53](https://github.com/payswapdotorg/Arena-2.0/issues/53)) — turn the AR2-015 `grg_00000013` blocker ("Responsive, keyboard-accessible E2E coverage across requester/expert/reviewer/developer/operations flows — BLOCKED") into real, rendered-state accessibility evidence for the Arena workbench surfaces  
**Base SHA (dispatch record):** `c9b86d199d9fe95180de0e817b9af4c0b2d0055b`  
**Branch:** `work/AR2-021-accessibility-e2e`  
**Evidence SHA (code tree the transcripts were generated on):** `e3ab8b2` (all code commits; this document and the transcripts are committed on the same branch immediately after)  
**Environment:** local sandbox (linux x64, Node v24.21.0, pnpm 10.33.2 workspace, non-frozen install for this package's devDependencies — `pnpm-lock.yaml` is TL-owned and NOT committed on this branch)

> Scope statement: this evidence covers the **arena-workbench rendered surfaces** (requester cockpit, expert queue/workspace, reviewer/adjudicator decks, state-badge views) mounted by a minimal render host with the workbench's own mock-client fixtures. It is browser-rendered, interacted-state evidence (axe-core injected into live Chromium pages), never static-markup scanning. It recomputes the accessibility portion of `grg_00000013` for the workbench surfaces; developer/operations console surfaces and CI browser wiring are explicitly dispositioned below, not silently claimed.

## Toolchain (recorded from the live run — `transcripts/environment.json`)

| Tool | Version |
| --- | --- |
| Playwright | 1.64.0 |
| Chromium (bundled, headless) | 156.0.8078.4 (`~/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`) |
| axe-core | 4.14.0 (`axe.min.js` injected per page) |
| esbuild (render-host bundler) | 0.27.7 |
| React (bundled into the host) | 19.2.7 (workspace pin) |
| Rule set | axe tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `best-practice` |

## Render host (what was actually scanned)

- **Bundle:** esbuild IIFE of the workbench PUBLIC entry (`src/contract.ts`) → the real screens, the typed `MockArenaClient`, the frozen demo fixtures (`demo-fixtures.ts`, `demo-fixtures-expert.ts`, `expert-seeds.ts` via the client) and CF1.0 contracts all run in the browser. Served over local HTTP (`127.0.0.1:<ephemeral>`); Playwright loads `http://…/`.
- **node:crypto shim:** the form layers compute request digests with `node:crypto`; the bundle aliases it to a pure-JS SHA-256 that `build-host.mjs` verifies against `node:crypto` on every build (fail closed on any mismatch) — browser digests are byte-identical to the Node-side suites.
- **Stylesheet:** the workbench screens ship class hooks but no stylesheet (product shell is upstream). The host authors one product-plausible stylesheet (`workbench.css`); every text/background pair was numerically verified ≥ 4.5:1 before use, and axe `color-contrast` computes REAL rendered styles on every scan. Responsive (375×667 pass: 16px inputs, section-level table scroll, zero horizontal document overflow).
- **Deterministic async:** `window.__arenaHostControl` (documented render-host scaffolding) holds/releases the mock submission gate so the *submitting* rendered state is deterministic; a live snapshot probe backs state assertions. No fixture data was added anywhere — journeys drive the workbench's own fixtures through its public API.

## Journeys and states covered (20 axe scans; full detail in `transcripts/`)

| # | Journey (work-order name → actual surface) | States scanned |
| --- | --- | --- |
| 1 | Requester submits a capability request → `RequesterCockpit` (+ host payout panel under the requester lens) | empty · validation-error · submitting (held gate, aria-disabled/aria-busy) · submitted (announcement + tracking row) |
| 2 | Expert reviews an attempt → `ExpertQueue` + `ExpertWorkspace` + `SelfEvaluationPanel` | queue-pristine (4 seeded attempts) · candidate-error (typed field errors) · candidate-submitted (ENVIRONMENT_READY→SUBMITTED) · selfevaluation-submitted (SUBMITTED→VERIFYING, non-vote panel) |
| 3 | Reviewer adjudication view → `ReviewerDeckScreen` + evidence-detail dialog + `AdjudicatorDeckScreen` | deck-pending (convergent, PARTIALLY_ACCEPTED, no adjudicator) · evidence-dialog-open (role=dialog, aria-modal, focus inside) · deck-divergent (hard-stop dispute, operator evidence withheld) · adjudicator-pending · adjudicator-resolved |
| 4 | Payout status view → host-composed payout panel driven 1:1 by frozen `PAYMENT_STATES` (see disposition P-1) | pending (PENDING_EVIDENCE) · releasing (READY_TO_RELEASE) · paid (SETTLED, terminal) |
| — | Responsive pass (375×667, one representative state per journey + overflow check) | requester-empty · expert-queue-pristine · reviewer-deck-pending · payout-pending |

**Aggregate:** 20 scans (16 desktop + 4 mobile), **0 violations, 0 incomplete checks**, 807 rule-passes, 993 rules inapplicable (rule ids recorded per transcript). Every scan asserts zero violations — nothing is silently ignored.

## Findings (found on rendered states → fixed in-module or dispositioned)

| Finding | Rule / class | Severity | Element / state | Resolution |
| --- | --- | --- | --- | --- |
| F-1 | `label-content-name-mismatch` (wcag2aa, WCAG 2.5.3 Label in Name) | serious | evidence inspect buttons, reviewer deck states (desktop + 375px) | **FIXED** — accessible name now embeds the full visible text (`<id> — <class> (inspect evidence details)`); commit `e3ab8b2` |
| F-2 | Keyboard focus discarded mid-submit (Chromium moves `document.activeElement` to `<body>` when a focused submit button becomes natively `disabled`, and never restores it) — empirical browser probe + keyboard journey | WCAG 2.4.3 / 2.1.1 class defect (not an axe rule) | requester submit control, submitting state; payout advance at terminal | **FIXED** — async submit controls use `aria-disabled` + composition-layer guard (focus retained through submitting→submitted and at terminal SETTLED); commit `e7924f5` |
| F-3 | No live-region announcements for async state transitions (submitting→submitted; adjudication pending→resolved) — the root `grg_00000013` gap | WCAG 4.1.3 class gap (not an axe rule) | cockpit/expert workspace/adjudicator deck | **FIXED** — persistent `role="status"` `LiveAnnouncer` wired into the screens; adjudication divergence notice is `role="status"`; commits `7abb851` |
| F-4 | Typed validation-error summary not programmatically focusable (errors not announced/moved-to on submit failure) | WCAG 3.3.1/3.3.2 class gap | `FieldErrorList` on both forms | **FIXED** — `tabIndex={-1}` + host moves focus to the summary on submit failure; commit `7abb851` |
| F-5 | Evidence entries were plain list items — no keyboard path to evidence detail | WCAG 2.1.1 class gap | reviewer deck shared + reviewer-private evidence lists | **FIXED** — optional `onInspectEvidence` renders keyboard-activatable buttons (plain rendering unchanged for SSR consumers); commit `7abb851` |
| F-6 | Skip-link target (`<main>`) not focusable — hash navigation does not move focus to non-focusable elements | WCAG 2.4.1 class gap (render host) | host document chrome | **FIXED** — `<main tabIndex={-1}>` (standard skip-link target); commit `d106018` |
| D-1 | The workbench ships no stylesheet; contrast conformance is evidenced against the render host's authored stylesheet (all pairs ≥ 4.5:1, axe `color-contrast` green on 20 rendered states) | disposition | all states | **DISPOSITIONED** — product stylesheet/desktop-web shell integration is TL/upstream-owned; remediation owner: TL at integration |
| D-2 | Adjudication "accepted/rejected" terminal outcomes are not representable with the frozen demo corpus (no FAIL criterion decision fixture; attempt ACCEPTED/REJECTED unreachable through the mock client's frozen transitions). Covered instead: pending, resolved-divergent, criterion PASS/INCONCLUSIVE rows | disposition | adjudicator deck | **DISPOSITIONED** — corpus extension requires `arena-contracts`/fixture changes (frozen, out of this WO's fence); remediation owner: TL |
| D-3 | Payout status view: the workbench has no dedicated payout screen | disposition | payout panel | **DISPOSITIONED** — equivalent surface is the host-composed panel driven 1:1 by frozen `PAYMENT_STATES` with test-mode disclosure; a product payout screen is future work-order scope (TL) |
| D-4 | CI browser wiring (`ci.yml` battery entry + lockfile regeneration for this package's devDeps) | disposition | CI | **DISPOSITIONED** — `.github/**` and `pnpm-lock.yaml` are TL-owned; the suite skip-guards cleanly (typed NOT_SUPPORTED) on frozen-lockfile checkouts so CI stays green either way; remediation owner: TL |
| D-5 | True screen-reader announcement observation (NVDA/JAWS/VoiceOver manual audit) | disposition | live regions | **DISPOSITIONED** — automation asserts live-region semantics (`role="status"`, persistent node, content per step, same-node mutation proof); manual SR audit is release-owner acceptance work |

**Totals: violations found = 6 (all fixed in-module, commits `7abb851`, `e7924f5`, `e3ab8b2`, `d106018`); dispositioned = 5 (D-1..D-5); remaining open on the scanned surfaces = 0.**

## Keyboard-only journeys (Playwright keyboard API — no mouse input anywhere)

All four journeys assert observable focus (`document.activeElement` descriptor: tag/id/text/class) and announcement content at every step; full step-by-step transcripts in `transcripts/keyboard-*.json`.

| Journey | Result | Key assertions |
| --- | --- | --- |
| 1 — requester form (16 steps) | **GREEN** | body→skip link→main focus jump (Enter); complete tab order (4 lens buttons → title → outcome → budget → submit); empty-budget submit moves focus ONTO the typed error summary (`ul.arena-field-errors`) + rejection announcement; Shift+Tab recovery; focus retained on the submit control through submitting→submitted; live announcements at every transition (`Submitting escalation request…` → `Escalation submitted — esc_00000001`); tracking row appears |
| 2 — expert flow (10 steps) | **GREEN** | keyboard lens switch (Enter, focus retained); tab order traverses remaining lens buttons then workspace controls; candidate submitted through the frozen attempt machine (announcement `Candidate version 1 submitted — attempt SUBMITTED`, badge change, focus retained); self-evaluation submitted (announcement includes "never an independent vote", panel appears, attempt + queue badges show Verifying) |
| 3 — evidence dialog + adjudication (10 steps) | **GREEN** | dialog opened by keyboard; focus moves to the dialog close control; Tab ×6 + Shift+Tab stay INSIDE the dialog (trap holds — `activeElement.closest('[role=dialog]')` at every step); Escape closes AND focus RETURNS to the evidence trigger; adjudication live region flips pending→resolved on the SAME DOM node (mutation, not remount — proven via a node marker) |
| 4 — payout status (7 steps) | **GREEN** | keyboard advance through the frozen payment states with an announcement per transition (Pending Evidence → Evidence Accepted → Ready To Release → Release Submitted → Settled); terminal control is `aria-disabled` with focus retained and Enter a guarded no-op; `aria-current="step"` lands on SETTLED |

## Verification battery (re-run at the evidence SHA)

| Command (exact) | Result |
| --- | --- |
| `node_modules/.bin/tsc -b packages/arena-workbench` | 0 errors |
| `node_modules/.bin/oxlint packages/arena-workbench` | 0 errors, 0 warnings |
| `cd packages/arena-workbench && ../../node_modules/.bin/tsx --test test/*.test.ts` | 48 pass / 0 fail / 0 skipped — includes the a11y entry executing fully (13 of the 48: the suite parent + 12 subtests) |
| `cd packages/arena-workbench && ../../node_modules/.bin/tsx --test test/*.test.tsx` (SSR render suites — the glob `test/*.test.ts` does not match `.tsx`) | 16 pass / 0 fail / 0 skipped |
| `cd packages/arena-contracts && ../../node_modules/.bin/tsx --test test/vectors.test.ts test/transitions.test.ts test/completeness.test.ts test/ownership.test.ts test/contracts.test.ts` | 104 pass / 0 fail (CF1.0 corpus stays green) |

**Skip semantics (honest, typed — verified):** on a checkout where the suite module cannot load (frozen-lockfile CI before TL lockfile integration), `test/a11y.test.ts` records exactly **1 skipped test carrying the typed reason** (`ERR_MODULE_NOT_FOUND …` + the install instruction) — 0 pass / 0 fail / 1 skipped, battery green, no fake pass, no silent ignore. The guard path was exercised by removing the suite module and re-running; in the recorded toolchain-present run all 12 a11y subtests execute and pass. (Note: this sandbox carries a global `playwright@1.64.0` under `$HOME/node_modules`, which masks a fully-clean missing-toolchain simulation — the import-failure guard verification above is the honest evidence of the skip path.)

## Re-run commands (exact)

```bash
git clone https://github.com/payswapdotorg/Arena-2.0.git arena && cd arena
git checkout work/AR2-021-accessibility-e2e
pnpm install                                   # regenerates devDeps (TL lockfile integration) — or: pnpm install --no-frozen-lockfile
pnpm --filter @arena/workbench a11y:install-browser   # npx playwright install chromium (bundled Chromium 156)
cd packages/arena-workbench && ../../node_modules/.bin/tsx --test test/a11y.test.ts
# → 12 subtests: environment, 4 axe journeys (16 states), 4 keyboard journeys, responsive, summary
# transcripts (regenerated under docs/evidence/accessibility/transcripts/) record every axe result,
# keyboard step and the toolchain versions.
```

## Limitations (explicit)

- Coverage is the **workbench package's rendered surfaces**; AR2-015's "developer/operations flows" wording maps to console surfaces outside this package (see D-1/D-3/D-4 disposition and the gate report's scope row) — recomputing `grg_00000013` to PASS across ALL five flows is a TL integration decision over this evidence plus those surfaces.
- Announcements are asserted via live-region semantics + content (the standard automation proxy), not a physical screen reader (D-5).
- One browser engine (bundled Chromium 156) is exercised; multi-engine (WebKit/Gecko) runs are CI-scope work for the TL.
- The submitting state is made deterministic by the documented host gate; in a production shell the same state would be driven by real network latency.

## Fence attestation

Only `packages/arena-workbench/**` and `docs/evidence/accessibility/**` were touched. `pnpm-lock.yaml` was regenerated locally (expected, non-frozen install for this package's devDependencies) and is **NOT committed** — the TL owns lockfile integration. No other package, no root manifests, no `.github/**`, no `spec/**` files were modified (`git diff --stat c9b86d1..HEAD` verifies).
