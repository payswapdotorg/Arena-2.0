# Arena Native UI Architecture — WO #66 (issue #66)

**Status:** FROZEN Wave 0 contracts (TL) — 2026-10-15
**Base SHA at freeze:** recorded in the dispatch ledger (the commit that adds this file)
**Owner:** arena-tl (UX architecture, design-token/navigation decisions, shared contracts, cross-surface integration)
**Scope authority:** [issue #66](https://github.com/payswapdotorg/arena-2.0/issues/66) + `spec/PROJECT-STATE.md` + `spec/architecture-lock.md`
**Implementation lanes:** Worker A (design system/shell/identity/navigation), Worker B (requester + expert workbenches), Worker C (reviewer/adjudicator + developer portal + operations)

This document is the binding UX architecture for making the product unmistakably **Arena**, not ZCode. It records the Arena-vs-inherited-shell boundary, the frozen navigation/identity contracts, the design-token namespace, the write fences, and the acceptance-evidence law. Workers implement BEHIND these names; semantic changes require a TL ACR, never a silent edit.

## 1. Product information architecture

Arena is the human-expert escalation and capability-acquisition platform. The product's primary loop is: **submit a capability gap → route (human expert / scraper / external API / combination) → capture evidence → verify outcome → typed result + payment state**. The UI's job is to make that loop the dominant, discoverable surface.

### 1.1 Screen vocabulary (FROZEN — closed set)

`ArenaScreenId` (in `packages/arena-shell/src/contract.ts`):

| id           | lane | purpose                                                                                                                                                                    |
| ------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requester`  | B    | Requester cockpit: create/submit capability-gap request, constraints/budget/proof policy, status + SLA, routing options explained, evidence/results, payment state         |
| `expert`     | B    | Expert workbench: queue, qualifications/conflicts, task context, privacy-bounded capsule entry, work/evidence submission, self-evaluation, payout/proof status             |
| `reviewer`   | C    | Reviewer/adjudicator workbench: evidence-first review, independent vote/quorum, conflicts, rubric, adjudication, audit trail, payout eligibility                           |
| `developer`  | C    | Developer portal: API/SDK/MCP + webhook setup, typed request/result contracts, integration examples, keys/scopes, delivery status, capability-provider configuration       |
| `operations` | C    | Operations & governance: tenant/identity, queue/capacity, incidents, retention, audit/observability, release gates + NOT_GO/restricted capability display, provider health |

The inherited ZCode chat/coding workspace is NOT a screen in this vocabulary. It is the **solution workspace**: a tool surface the shell can host inside expert task context (and only there, plus an explicit fallback entry while integration lands). It must never dominate navigation, empty states, or the product's first-launch identity.

### 1.2 Navigation model (FROZEN)

- One `ArenaShellPort` with `navigate(screenId: ArenaScreenId)` and typed refusals (`ArenaNavigationRefusal`). Screens NEVER mutate routes or URLs themselves; they request navigation through the port and render refusals verbatim.
- A screen id not registered in the shell's registry is a typed refusal (`"unregistered_screen"`), displayed honestly — never silently hidden.
- Web URL mapping (TL wiring, post-lane integration): `/` → shell default (`requester`); `#/<screenId>` deep links; the share/OAuth routes of the inherited web entry remain untouched.
- Desktop: the Arena shell is the primary window surface; the solution workspace opens as an embedded surface within expert context.

### 1.3 Role lens law (carried from AR2-003)

`ROLE_IS_NOT_AUTHORIZATION_RULE` is inherited unchanged: the role switcher (`ArenaRoleLens`: requester | expert | reviewer | developer | operator) changes PRESENTATION ONLY. Server-side authorization stays authoritative; switching lens never changes what the API accepts. Role-specific surfaces display the principal's real credentials/tenant, never inferred authority.

## 2. Arena identity and the inherited boundary

### 2.1 User-visible naming law

- The product name rendered to users is **Arena** (wordmark treatment per the design tokens; no ZCode logos, names, or coding-agent branding in Arena flows).
- Scope of the sweep (Worker A): application titles, menus, welcome/empty/loading/error states, navigation labels, command surfaces, notifications, settings surfaces, and i18n locale strings (`packages/ui/src/i18n/locales/en-US.ts`, `zh-CN.ts`) — every user-visible "ZCode" becomes "Arena" where it names the product.
- Preserved verbatim (license/attribution law): `LICENSE`, `NOTICE.md`, `THIRD-PARTY-NOTICES.md`, upstream security disclosures, and any legally required provenance text. Upstream attribution is never erased.
- Internal implementation identifiers are NOT renamed in this work order: package scopes (`@zcode/*`), storage keys (`zcode-theme`), CSS attribute hooks (`data-zcode-*`), file names, and the `apps/zcode-cli` runtime. Renaming those is a separate, explicitly registered maintenance order if ever needed.
- Desktop `productName` and window titles become Arena; the web `index.html` title becomes Arena; document titles set by the shell use `ARENA_PRODUCT_NAME`.

### 2.2 Design tokens (FROZEN namespace)

- All Arena visual identity tokens live in one namespace: `--arena-*` (seeded in `packages/arena-shell/src/design/arena-tokens.css`; Worker A completes the set: color, status, evidence-pattern, focus, surface tokens).
- The inherited `DESIGN.md` laws remain binding: the `text-ui-*` typography scale, calm/dense/operational character, light/dark + Zai theme variants, i18n length tolerance, desktop/web parity.
- Arena status/evidence patterns: every status chip, evidence grade, and disclosure renders from typed vocabulary (the arena-\* packages' honest-evidence labels — DEMO/FIXTURE/REAL grades flow VERBATIM; no grade inflation, no "production" claims anywhere in UI copy).
- No bright full-surface brand fills, no marketing spacing; Arena identity is carried by wordmark, token accents, and information architecture, consistent with the design system's product character.

### 2.3 Truthful capability display (FROZEN)

- The shell and every role surface display the recorded release posture honestly: test-mode finance, untrusted execution DISABLED, isolation status per the recorded evidence (`docs/evidence/isolation/AR2-019-strict-mode-station-evidence-2026-10-14.md`), release decision NOT_GO per the AR2-015 gate report. No screen may imply production isolation, live payments, or a release GO.
- Restricted/owner-gated actions render as truthfully disabled with a pointer to the recorded basis (the AR2-023 instrument), never as absent.

## 3. Package and module structure

- NEW sibling package `packages/arena-shell` (`@arena/shell`), managed module `arena-shell`, `requires: [arena-contracts, arena-workbench]`, `publicEntrypoints: [packages/arena-shell/src/contract.ts]`, owner `arena-tl` (registered in `architecture-policy.yaml` at the Wave 0 freeze).
- The shell consumes `@arena/workbench` only through its public contract (screens, real binding, state views, role models); it never imports workbench internals.
- Web/desktop mounting is TL-owned wiring (Wave 0 leaves the mounting seam + contract in place; the TL integration commit after the lanes mounts `ArenaShell` in `packages/web/src/main.tsx` and the desktop renderer, preserving the inherited share/OAuth routes and the solution-workspace handoff).

### 3.1 Write fences (recorded in the dispatch ledger; violations are require-changes)

| lane     | owns                                                                                                                                                                                                                                                                                                                                                                                                                      | forbidden                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Worker A | `packages/arena-shell/src/{shell,identity,nav,design}/**`, `packages/arena-shell/src/arena-tokens.css`, `packages/arena-shell/test/{shell,identity,nav}/**`, the enumerated branding files: `packages/ui/src/i18n/locales/en-US.ts`, `packages/ui/src/i18n/locales/zh-CN.ts`, `packages/ui/src/WindowsTopLeftLogo.tsx`, `packages/web/index.html` (title/meta only), `packages/desktop/package.json` (`productName` only) | everything else — no `packages/web/src/**`, no `packages/desktop/src/**` (beyond the enumerated fields), no root manifests, no lockfile, no `architecture-policy.yaml`, no arena-workbench edits |
| Worker B | `packages/arena-shell/src/screens/{requester,expert}/**`, `packages/arena-shell/test/{requester,expert}/**`                                                                                                                                                                                                                                                                                                               | everything else — in particular no shell/nav/identity edits (request through the frozen port), no reviewer/developer/operations screens                                                          |
| Worker C | `packages/arena-shell/src/screens/{reviewer,developer,operations}/**`, `packages/arena-shell/test/{reviewer,developer,operations}/**`                                                                                                                                                                                                                                                                                     | everything else — same law                                                                                                                                                                       |

- File-size law: `< 400` lines per src file (the repo's existing discipline).
- Zero new dependencies in the lanes; reuse `@arena/contracts`, `@arena/workbench`, and the inherited component vocabulary (`@zcode/ui` primitives via the shell's own composition — screens do not import `@zcode/ui` internals directly; the shell re-exports the approved primitive set through its contract if needed, decided at integration).
- Tests use the repo's runner law (`tsx --test`), REAL-composition where constructible, honestly-labeled FIXTURE/PURE otherwise (the AR2-003/AR2-021 precedents).

## 4. Acceptance evidence (maps to issue #66's checklist)

1. Fresh-launch identity: rendered-title/logo assertions in tests + before/after screenshots in the PR description (A).
2. Coherent visual system: token coverage + no mixed-branding assertions (A).
3. Role flows discoverable + meaningful states: per-screen journey tests incl. loading/empty/error (B, C).
4. Role switching presentation-only: lens-switch test asserting no API authority change (B — carried from the workbench's frozen rule).
5. Truthful security/release status: copy assertions against the recorded posture (A, C).
6. Keyboard/focus/a11y: rendered-state coverage per the AR2-021 axe/keyboard precedent (each lane on its screens).
7. E2E branding + navigation journeys: web harness where the current harness supports it (integration phase).
8. Real commands, real numbers: `pnpm typecheck`, `pnpm lint`, `pnpm architecture:check --changed`, lane test suites — exact commands/results/skips in each worker report.
9. Licensing/NOTICE preserved: attribution diff shows only user-visible product naming changed (A).
10. Spec/ledger reconciliation: TL integration commit (PROJECT-STATE, dispatch-ledger, handoff) after the lanes.
11. Inspectable UI artifacts: screenshots/evidence in PR descriptions + `docs/evidence/ui/**` (integration).
12. TL verifies the integrated result on fresh main; workers do not self-accept.

## 5. Out of scope (safety)

No live-money enablement, no production-release claims, no untrusted-execution enablement, no changes to arena-\* domain modules' behavior, no renaming of internal identifiers, no new release gates. The existing release-gate instrument stays authoritative. This work order changes the product's user-facing identity and workflows only.
