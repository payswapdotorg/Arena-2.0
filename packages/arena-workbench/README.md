# @arena/workbench

AR2-003 — Requester, expert and reviewer workbench. This package is the
Arena-specific UI surface: **typed mock client**, **requester cockpit form**
(client-side validated against the frozen CF1.0 zod schemas), **role/lens
switcher** (presentation only), **state views** for the four frozen state
machines, and React presentational screens.

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

## Slice 1 surface (this delivery)

| Area           | Export                                                           | Semantics                                                                                                                                                                                                                                       |
| -------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mock client    | `MockArenaClient`, `ArenaWorkbenchClient`                        | fail-closed intake via `escalationRequestSchema` (per-field `REJECTED`); tenant-scoped list/get (cross-tenant = `NOT_FOUND`); demo-tagged records                                                                                               |
| Requester form | `validateEscalationDraft`                                        | draft (caller-editable subset) → full envelope (system fields composed: contract version, digest, proof-policy preset) → CF1.0 zod + frozen criterion semantics → typed field errors; unknown draft fields (e.g. injected `tenant_id`) rejected |
| Role/lens      | `RoleSwitcher`, `roleSwitcherModel`, `WORKBENCH_LENSES`          | requester/expert/reviewer/adjudicator lenses; `aria-pressed` per lens; rule text embedded in the switcher (`data-role-is-not-authorization`)                                                                                                    |
| State views    | `WORKBENCH_STATE_VIEWS`, `stateView`                             | 1:1 derived from the frozen 13/11/12/9 states with explicit kind sets; unknown state values render as `unknown (no invented states)` — fail closed                                                                                              |
| Demo fixtures  | `DEMO_PROOF_POLICY_PRESET`, `DEMO_ACCEPTANCE_CRITERIA`           | deterministic, CF1.0-valid snapshot fixtures (PVP1.0 literal, rubric review policy, payout gate with `dispute_blocks_release: true`)                                                                                                            |
| Screens        | `RequesterCockpit`, `StateBadge`, `DemoBanner`, `FieldErrorList` | pure presentational React components (SSR-renderable); loading/empty/error/inconclusive states surfaced                                                                                                                                         |

## Tests

- `test/workbench.test.ts` — UI-logic: form validation (valid / unknown field /
  invalid budget / unknown preset), role-rule assertion, state-registry 1:1
  derivation + unknown-state fail-closed, mock-client fail-closed intake +
  tenant isolation + demo labelling.
- `test/render.test.tsx` — SSR smoke via `renderToStaticMarkup`: demo banner,
  lens switcher accessibility, state badges (frozen + unknown), typed field
  errors, cockpit form + empty tracking + summaries.

## Manual smoke script (documented — acceptance scenario 6 minimum)

Run locally from the repo root:

```
pnpm --filter @arena/workbench exec ../../node_modules/.bin/tsx --test \
  packages/arena-workbench/test/workbench.test.ts \
  packages/arena-workbench/test/render.test.tsx
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

## Slice 2 (pending)

Expert queue/workbench, candidate submission + structured self-evaluation,
reviewer/adjudicator screens with reviewer-private redaction classes, evidence
timeline, and Playwright-grade E2E when the runner lands (this WO's minimum is
node:test UI-logic + the documented smoke script above).

## House notes

- Public surface is `src/contract.ts` only (architecture guard: deep imports
  are violations).
- React is a workspace-pinned dependency (`react` 19.2.x override at the repo
  root); `react-dom` is a dev dependency used only by the SSR smoke tests.
- No API/domain/persistence writes, no server authorization in UI (write
  fence, OWN1.0 lane 2).
