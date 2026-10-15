# TL Integration Report — UIA-001 (issue #66): the Arena-native web experience mounted

**Executor:** TL-direct at the station (2026-10-15; the standing no-early-returns instruction). This is the wave's closing integration commit the lanes recorded as their frontier.

**Base:** `a1ff4dd` (all three worker lanes merged: A `fc49cb2` · B `b8f8e74` · C `ab934eb` + ledger reconciliations).

## What landed

1. **The web mounting** (`packages/web/src/main.tsx`): the ArenaShell is the product's default first screen — `/` → the shell default (requester cockpit), `#/<screenId>` deep links, all five registrations mounted through the composition adapters (the real binding for the canonical command/timeline paths; the demo-tagged mock client for the attempt/deck projections, disclosed on-surface). The binding's `baseUrl` is configurable (`VITE_ARENA_API_URL`, default same-origin — the arena-api deployment topology is the operator's infrastructure frontier, recorded). The inherited ZCode workspace is **not** a screen: it stays reachable through the explicit fallback entry (`?workspace=1`) during the integration period, per the frozen spec §1.1/§1.2. The share/OAuth routes are untouched.
2. **Document titles**: the web entry's user-visible titles are Arena (`Arena — Sign In`, `Arena 会话分享` / `Arena Conversation Share`, `Arena — Web`, `Arena — solution workspace (inherited)` for the fallback entry, `Arena — Requests` via the shell's `applyDocumentTitle`); the desktop renderer's window title `ZCode` → `Arena` (the `productName` was already Arena from Lane A).
3. **The public surface extension** (TL-owned manifests): `@arena/shell` exports now expose `./shell`, `./screens` (the registration barrel), `./identity` (title ownership), `./styles.css` (the CSS barrel: tokens + shell + the three lanes' files) — with `module.ts` + `architecture-policy.yaml` publicEntrypoints updated to match (the guard's managedOnly law unaffected; the web module is unmanaged).
4. **The browser-node digest seam**: `@arena/workbench`'s form layers default to node:crypto's synchronous sha256, which vite externalizes for the browser — the web bundle now aliases `node:crypto` to a pure-TS sha256 shim (`arenaNodeCryptoShim.ts`), verified byte-identical against node:crypto (9 cases incl. FIPS 180-4 vectors; station script persisted at `scripts/verify_sha256_shim.ts`). Domain code untouched.
5. **The browser journeys** (`packages/arena-shell/test/a11y/`): the AR2-021 harness pattern applied to the shell — an esbuild render host mounting the REAL ArenaShell with the five REAL registrations, driven by Playwright Chromium with axe-core: **11/11 journeys green** — Arena branding (zero user-visible ZCode), the five-screen navigation (tablist semantics + hash deep-links + the keyboard roving tabindex with wrapper-layer focus rings), the role-lens presentation-only law (content identity under lens switching), the honest states (DEMO-tagged queue, capsule entry truthfully disabled, NOT_GO/test_mode/disabled posture verbatim with all recorded bases), the evidence-first reviewer deck (never-a-vote self-eval, operator-class withheld count-only), responsive 390×844 with zero horizontal overflow, and axe audits (wcag2a/2aa/2.1a/2.1aa + best-practice) on every interacted state — **0 violations across all scans**. Evidence: `docs/evidence/ui/screenshots/*.png` + `docs/evidence/ui/transcripts/*.json` (the acceptance checklist's inspectable UI artifacts).
6. **The CI battery step**: `.github/workflows/ci.yml` now runs the arena-shell suite (121 tests: the shell contract suite + the three lanes' tests incl. the REAL arena-api compositions) + the browser journeys with the honest NOT_SUPPORTED skip guard when the toolchain is absent.
7. **Defects the browser journeys caught and the integration fixed** (the point of the harness — each disclosed):
   - **A real Lane A navigation defect**: `effectiveActive` was a never-updated second state — click navigation updated `active` while the render read `effectiveActive`, so hash deep-links worked but clicks never changed screens; SSR single-frame tests cannot catch this class. Fixed by merging the deep-link resolution into the live navigation state.
   - **`useSyncExternalStore` snapshot caching** (all four controllers): fresh snapshot objects per call sent React into an infinite re-render (Minified error #185) in the live browser — cached + invalidated on emit.
   - **WCAG contrast recalibration** (token values, not names/groups): the muted text mix (62%→40% app surface) and the status/evidence palette (pending/denied/info/demo/fixture/real) now meet ≥4.5:1 on the dark surfaces; a light-theme calibration group added under `[data-arena-theme="light"]`.
   - **Heading order + landmarks**: the five screens' headings promoted to a proper h1→h2→h3 cascade; the lens switcher became an `<aside>` landmark; the main scrollable region is keyboard-accessible (`tabIndex={0}`).
   - **The demo-tenant composition bug**: the web/host compositions used the real-binding demo principal for the mock-seeded attempt/deck projections (tenant mismatch → empty queues); now the expert/reviewer surfaces use `DEMO_EXPERT_PRINCIPAL` (the demo-tagged seeds' tenant).

## Verification battery (real numbers, station)

| gate | command | result |
| --- | --- | --- |
| architecture guard | `node scripts/architecture/architecture-check.mjs check` | 0 violations (baseline 0, new 0) |
| scoped typecheck (shell + web) | `tsc -b packages/arena-shell packages/web` | 0 errors |
| oxlint (shell + web entry) | `oxlint packages/arena-shell packages/web/src/main.tsx …` | 0 errors (3 warnings — pre-existing classes) |
| full shell node suite | `tsx --test` (shell + identity + nav + 5 lanes) | **121/121** pass, 0 fail, 0 skipped |
| browser journeys | `tsx --test test/a11y/journeys.test.ts` | **11/11** pass, 0 fail — axe 0 violations across 6 scans (2 viewports) |
| sha256 shim | station script vs node:crypto | 9/9 byte-identical (incl. FIPS vectors) |
| full-workspace `pnpm typecheck` | NOT RUN at station | 4GB OOM class (disclosed; CI runs it) |
| vite production build | attempted at station | transforms 7812 modules then exits in the station's 4GB OOM class (disclosed — CI has no web-build step; the wiring is tsc + guard + journeys verified) |

## Honest remaining frontiers (recorded, not silently skipped)

- **Desktop Arena-first mounting**: the desktop renderer keeps its inherited workspace bootstrap (database admission + message-port services); the window title is Arena and `productName` was already Arena'd. Making the shell the desktop's primary window surface requires re-sequencing that bootstrap — a separately registered work order (recorded in PROJECT-STATE).
- **@arena/sdk / @arena/ops / @arena/acquisition surfaces** mount when the shell module's `requires` extend (the TL-owned manifest decision recorded with the lanes' constraints).
- **The production credential adapter** replaces the demo principal registry (the owner's identity-provider decision, already recorded in the release frontier).
- **The arena-api deployment topology** (the binding's baseUrl) is the operator's infrastructure input.
- **Light-theme activation path**: the `data-arena-theme="light"` calibration group exists; the real app's light theme flows through the inherited host's `--ui-*` variables — the light-path status-color calibration is recorded for the operator-visible light theme.

The wave's acceptance mapping (issue #66 checklist): fresh-launch identity ✓ · coherent visual system ✓ · discoverable role flows ✓ · role-switch presentation-only ✓ (rendered + browser journeys) · truthful security/release status ✓ · keyboard/focus/a11y/states/responsive covered by rendered UI tests ✓ (node suite) **and real-browser journeys ✓** · E2E branding/navigation journeys ✓ (where the harness supports it) · real commands/results ✓ · licensing preserved ✓ · docs reconciliation — this commit + PROJECT-STATE · screenshots/evidence ✓ · TL verifies on fresh main — the merge verification below.
