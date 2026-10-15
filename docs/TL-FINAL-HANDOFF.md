# Arena 2.0 — Final Tech Lead Handoff

**Status date:** 2026-10-11  
**Canonical repository:** [payswapdotorg/Arena-2.0](https://github.com/payswapdotorg/Arena-2.0)  
**Main SHA at handoff review:** `d89182619a995710361883015e53e741eb9eedfa`  
**Upstream base:** `zai-org/ZCode@29628c9acdb81b703bbd4080c207a0e7ce5e276e`  
**Maximum concurrent workers:** three, plus the TL  
**Current frontier:** AR2-015 — integrated security, resilience, accessibility and release gate  
**Core work-order state:** AR2-000 through AR2-014 accepted; AR2-015 in progress  
**Capability-acquisition extension:** ACR-0002 merged; AR2-016/017/018 specified but not started

This file is the operational handoff. The repository—not chat history—is the sole source of truth. Before taking action, verify live GitHub main, PRs, CI and issue state; this document records the most recently reviewed state, not a substitute for live verification.

## 1. TL mission

Finish the core Arena release-gate work with evidence, not assumptions. Reconcile status documents so they agree with merged PRs and accepted work orders. Do not claim production readiness while actual capsule isolation, applicable release gates, or commercial/legal approvals remain unproven.

The second product lane is the owner-approved capability-acquisition extension: targeted scrapers and external APIs as additional providers alongside human experts. It is a separately gated extension and must not silently widen the already accepted core vertical slice.

## 2. Read these repository records first

1. `AGENTS.md` — execution rules and inherited ZCode engineering guidance.
2. `spec/PROJECT-STATE.md` — current milestones, limitations and dispatch frontier.
3. `spec/architecture-lock.md` — non-negotiable product, security and authority rules.
4. `docs/architecture/ARENA-2.0-SYSTEM-ARCHITECTURE.md` — module boundaries and runtime/data flow.
5. `spec/contracts/escalation-lifecycle.md` and `spec/contracts/ar2-001-freeze.md` — frozen CF1.0 contract family.
6. `spec/verification/proof-and-payment-policy.md` — proof classes and payout eligibility.
7. `spec/expert-arena/expert-arena.md` — independent review, quorum and adjudication.
8. `spec/testing/acceptance-gates.md` — G0–G8 acceptance requirements and evidence policy.
9. `spec/work-orders/implementation-plan.md` and `spec/work-orders/dependency-graph.md` — scopes and dependency ordering.
10. `spec/work-orders/dispatch-ledger.md` — active branches, owners, SHAs and acceptance records.
11. `spec/ownership/ownership-map.md` — path fences and serialized shared surfaces.
12. `spec/decisions/ADR-0001-zcode-foundation.md` — approved ZCode reuse boundary.
13. `spec/decisions/ACR-0002-capability-acquisition.md` and `spec/capability-acquisition/scraper-factory-and-capability-routing.md` — scraper and provider-routing extension.

Where documents disagree, treat code, merged PRs, CI evidence and explicit acceptance records as facts, then reconcile all canonical status records in a reviewed PR. Do not silently invent an implementation decision to make conflicting documents appear consistent.

## 3. Current verified state

### Accepted work orders

The latest main history at the time of review records **15 accepted work orders (AR2-000 through AR2-014 inclusive)**:

- **AR2-000–001:** baseline inventory, frozen CF1.0 contracts/state machines, contract vectors and CI governance.
- **AR2-002–004:** API/use-case edge, workbench foundation, CapsuleProvider port and clearly labelled synthetic provider.
- **AR2-005–007:** durable persistence/outbox/jobs, real API binding for the workbench, append-only evidence and P0–P3 proof evaluation.
- **AR2-008–011:** expert qualification/matching/conflict checks, Expert Arena, test-mode payout ledger, typed SDK/MCP/signed webhooks.
- **AR2-012–014:** real-component E2E harness, operations/observability/runbooks, rights-gated learning and Agent Body/version marketplace.

Evidence anchors: PRs #21–#24 and #25–#45 as indexed in the [dispatch ledger](../spec/work-orders/dispatch-ledger.md) and [GitHub PR list](https://github.com/payswapdotorg/Arena-2.0/pulls?q=is%3Apr+is%3Amerged). Verify the actual merge and CI state for the relevant PR before relying on any summary.

### Core E2E evidence

AR2-012 (`packages/arena-harness`, [PR #44](https://github.com/payswapdotorg/Arena-2.0/pull/44)) records four real-process acceptance profiles:
1. P0 baseline-fail/post-intervention-pass workflow with exactly one test payout, signed webhook delivery and stable-ID trace.
2. Failed first attempt does not pay; a next eligible expert can proceed within the authorized budget while preserving attribution.
3. P2 outcome remains blocked pending independent review, then passes through the Expert Arena review/adjudication path; self-evaluation is never a vote.
4. Two API processes share durable SQLite state; SIGKILL/restart yields no state loss and no duplicate outbox delivery.

These results support core integration claims only within their tested scope. They do not prove production-grade capsule isolation, live-money settlement readiness, all operating-system builds, or unlimited database scaling.

### Important limitations

- CapsuleProvider contracts and the synthetic implementation are present, but synthetic capsule tests are **not** evidence of OS-level isolation.
- The current `node:sqlite` implementation is the accepted reference engine. Do not claim that a separate production-scale database/hosting topology has been approved without its own ADR and evidence.
- Live-money mode remains disabled. The payment provider, merchant-of-record/jurisdiction posture, tax/KYC duties, reconciliation responsibilities and release authority must be explicitly established before real payments.
- The extension work orders AR2-016–018 exist but their implementation is not started.
- Worker dispatch was attempted but the repository records an automation/worker-model funding outage (OpenRouter 402). Until live resources are confirmed, use TL-direct execution or verified available workers; do not report planned worker assignments as active workers.

## 4. Immediate priority: AR2-015 release gate

Issue: [AR2-015 — Integrated security, resilience, accessibility and release gate](https://github.com/payswapdotorg/Arena-2.0/issues/17).

The current dispatch record in issue #17 specifies:
- **Base SHA:** `d891826` (verify current main before coding).
- **Branch:** `work/AR2-015-release-gate`.
- **Owner:** TL-direct until a real worker is available.
- **Allowed paths:** new `packages/arena-release-gate/**`, `docs/evidence/release/**`, and explicitly coordinated TL wiring only.
- **Forbidden behavior:** do not disguise fixes to API, capsule, evidence, payment or other owning modules as release-gate work. Record a finding and create/coordinate a fix in the owning module.
- **Planned artifacts:** typed gate registry and `docs/evidence/release/AR2-015-gate-report-2026-10-11.md`, with evidence per gate and adversarial profiles against real integrated surfaces.

Before starting, check for an existing branch, uncommitted work in the TL environment, any newer main commits, and an existing PR so work is not duplicated or overwritten.

### Required gate behavior

Use `spec/testing/acceptance-gates.md` as the norm. Every applicable gate must be explicitly classified `PASS`, `FAIL`, `BLOCKED`, or `WAIVED`; a waiver needs authorized written rationale and cannot bypass a non-waivable safety/legal blocker. Every claim records exact SHA, command or test ID, environment, evidence class, result, limitations and reviewer.

At minimum, the release gate must test or link to evidence for:
- Cross-tenant object-ID guessing and artifact access; failures must be fail-closed and indistinguishable where the API contract requires.
- Real HTTP webhook signature, stale timestamp, replay, duplicate delivery and apply-once behavior.
- Same-key replay versus same-key/different-digest conflict, two-instance admission, job leases/fencing, crash and restart recovery, outbox recovery and ambiguous external-side-effect reconciliation.
- Evidence forgery, replay, wrong tenant/escalation/attempt, supersession and untrusted page/API content treated as data rather than policy.
- Capsule tenant mismatch and real filesystem/process/network/credential boundaries. A synthetic provider cannot pass the production-isolation gate.
- Payment and adjudication safety: failed/inconclusive proof cannot pay; self-evaluation/popularity cannot approve; duplicate operations cannot double pay; live payment remains disabled.
- Accessibility, platform build/install evidence, performance/capacity, quota exhaustion, retention/deletion limitations, and operational runbooks.
- Known baseline/tooling failures, skips, and coverage boundaries. Do not silently turn environment-limited tests into passes.

### Separate the core release from the extension

G8 in `spec/testing/acceptance-gates.md` covers capability acquisition and scraper execution. Classify it explicitly in the release report as a **separate extension gate** while AR2-016–018 remain unimplemented. It is not evidence of a working scraper feature and should not silently expand AR2-012 core acceptance. It remains a hard acceptance gate for the scraper extension itself. The core release must still pass all applicable core gates; if product scope requires scraping in the first production release, then the extension gates are in scope and must block release until satisfied.

### Release decision

Do not set a core production decision to GO unless all in-scope gates are evidenced; critical/high findings are closed or have a disposition explicitly allowed by policy; actual capsule isolation appropriate for the planned execution is proven; durability/recovery and relevant tenant/security controls pass; and an authorized release owner has recorded the decision. If isolation cannot be proven, keep untrusted expert/scraper execution disabled and explicitly limit what can be released.

## 5. Source-of-truth cleanup required

The latest files still contain stale or contradictory statuses. As part of the AR2-015 integration, reconcile these records against merged PRs/issues and CI:

1. In `spec/PROJECT-STATE.md`, update the top-level claim that product implementation “has not yet been verified”; the core product now has accepted implementation and E2E evidence, while production readiness remains unapproved.
2. Mark M2 (core vertical slice) complete rather than `IN PROGRESS` where its same row already says “M2 VERTICAL COMPLETE”.
3. Mark M5 consistent with AR2-009 acceptance and AR2-012 P2 integration, while retaining any still-unproven production claims as separate limits.
4. Keep M4 explicitly scoped to **real secure capsule execution/production isolation**, not to the existence of the CapsuleProvider seam. It is not proven complete.
5. Update the current frontier to AR2-015 and the 15/19 accepted work-order count. AR2-000 through AR2-014 are 15 IDs, inclusive.
6. In `spec/work-orders/implementation-plan.md` and `spec/work-orders/dispatch-ledger.md`, remove old “PR pending merge” states for work orders whose PRs are accepted/merged, and reconcile rows with current issue comments.
7. In the AR2-015 ledger row, record the actual issue-comment dispatch record (branch `work/AR2-015-release-gate`, base `d891826`, TL-direct, exact path fence) and current progress. Do not claim a PR exists until it is opened.
8. In the AR2-016 row, remove the stale statement that ACR-0002 is pending merge: [PR #35 is merged](https://github.com/payswapdotorg/Arena-2.0/pull/35), and its merge decision is recorded in the Git history. Keep AR2-016–018 as planned and not dispatched until TL checks order/readiness.

Make status changes in a narrowly scoped reviewed PR. Avoid rewriting unrelated architecture or accepted contracts merely to normalize wording.

## 6. Capability-acquisition extension: AR2-016–018

ACR-0002 is merged through [PR #35](https://github.com/payswapdotorg/Arena-2.0/pull/35). Canonical specification: `spec/capability-acquisition/scraper-factory-and-capability-routing.md`.

### Product behavior
- **PINNED_PROVIDER:** use the requester-specified scraper/provider and version; do not fall back unless allowed.
- **ANY_COMPATIBLE_PROVIDER:** choose an eligible registered provider meeting the requested capability/output schema.
- **AUTO:** choose among SCRAPER, EXTERNAL_API and HUMAN_EXPERT after hard eligibility filters. Record alternatives and reasons; fallback is explicit, budget-bounded and auditable.

### Technology and trust boundary
- Prefer [Crawlee](https://github.com/apify/crawlee) (Apache-2.0) as the initial Node/TypeScript scraping substrate; a second Python runtime requires a concrete justification.
- Apify Actor/task API is an optional adapter. Do not clone the hosted Apify product or make Arena depend on one vendor.
- Version scraper definitions and builds immutably. Persist runs, leases, retries, quotas, source metadata and dataset lineage.
- All generated or user-authored scraper code requires a validated real-isolation CapsuleProvider; do not execute it in the API process, a ZCode workspace, a Git worktree or the synthetic provider.
- Enforce SSRF/DNS-rebinding/redirect controls, outbound allowlists, source permissions/terms, rate and cost quotas, scoped secrets and cancellation. Do not build access-control, login, paywall, CAPTCHA or anti-bot bypasses.
- Treat fetched content and API responses as adversarial data. They must never override system policy or expose credentials.

### Work-order dependencies and boundaries
- **AR2-016 / issue #32:** acquisition contracts/provider router. Dependencies: accepted API AR2-002, durable runtime AR2-005, matching contracts/implementation AR2-008. TL owns shared contract versions, root manifests, lockfiles, persistence schema and cross-module integration.
- **AR2-017 / issue #33:** Scraper Factory and external API adapters. Dependencies: accepted capsule seam AR2-004, durable jobs AR2-005, accepted AR2-016 contract. Use Crawlee first; optional Apify adapter uses mocks by default and cannot incur paid calls without explicit configuration.
- **AR2-018 / issue #34:** data-to-capability pipeline/evaluation. Dependencies: AR2-007 evidence, AR2-014 rights-gated learning, AR2-016 and AR2-017. Customer data is private by default; reuse requires rights and provenance. Raw scraping/schema validity does not prove a capability. Require target-specific before/after evaluation and immutable version/rollback provenance.
- These are post-core extension lanes. Do not let them silently widen AR2-012 or block the core release if they remain out of scope. The TL may schedule AR2-016 after core AR2-015 only after rechecking worker capacity, dependencies and scope; they must not displace the last core security gate by default.

Full dependency and acceptance detail is in `spec/work-orders/implementation-plan.md`, `spec/work-orders/dependency-graph.md`, `spec/ownership/ownership-map.md` and `spec/testing/acceptance-gates.md`.

## 7. Execution, branching and worker rules

- Maximum three active worker PRs. One work order = one issue = one branch = one PR.
- Before every dispatch, re-read live `main`, confirm dependency acceptance, record exact base SHA, branch, worker identity, contract version, allowed/forbidden paths, test plan and evidence requirements in both issue and ledger.
- Use current repository status, not assumed worker availability. The recorded external worker brain failure does not authorize fictitious assignments or unverified completion.
- TL owns `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, shared contracts, migration sequencing, CI/rules, cross-PR integration and final status reconciliation.
- Workers never change files outside their fence. If shared interface work is needed, raise an ACR or TL coordination change; do not edit frozen CF1.0 silently.
- Rebase/fresh-main integration and rerun the relevant gates. Keep accepted histories immutable and fixes in the owning module.
- Merged work-order acceptance must cite a merged PR, CI run, test evidence, exact SHA, known limitations, and an issue acceptance record. A PR description alone is not evidence.
- Preserve upstream ZCode Apache-2.0 license, NOTICE, third-party disclosures and supply-chain records.

## 8. Definition of done for the immediate handoff

This handoff is operationally complete when the TL has:
1. Reconciled `PROJECT-STATE`, the implementation plan and dispatch ledger.
2. Completed AR2-015 gate registry/report and adversarial tests with exact evidence.
3. Classified real capsule isolation honestly and ensured untrusted execution remains disabled when it is not proven.
4. Recorded a core release decision with scope, blockers, limitations and authorized owner.
5. Left AR2-016–018 visibly planned unless separately dispatched with valid dependencies, exact SHA and write fences.
6. Kept CI, tests, docs and issue statuses synchronized on `main`.

Do not declare Arena production-ready because the core E2E profiles pass. Do not claim the scraper/capability-acquisition extension works until its own runtime, security, rights, integration and before/after capability-evaluation gates pass.

## 9. UIA-001 — the Arena-native UI wave (recorded 2026-10-15; issue #66 CLOSED completed)

The post-roadmap product-identity work order completed end-to-end under the AR2-015 TL-direct
precedent (the platform generation window stayed closed through the wave — every execution
surface disclosed it):

- **Wave 0** `e310a81`: the frozen UX architecture (`spec/ux/arena-native-ui.md`) + the
  `@arena/shell` skeleton + the three lane write fences.
- **Lane A** `fc49cb2`: the design system (38 `--arena-*` tokens, bidirectional CSS/TS coverage),
  the product shell (ARIA tablist rail, roving tabindex, posture footer), the identity kit
  (wordmark, honest state patterns, document-title ownership), the nav model, the branding sweep.
- **Lane B** `b8f8e74`: the requester cockpit (typed selects from the CF1.0 zod enums,
  server-projection tracking, routing transparency with the honest not-recorded disclosure,
  test-mode payment) + the expert workbench (capsule entry truthfully disabled per the recorded
  posture, criteria-driven never-a-vote self-evaluation, the canonical escalation command path
  with typed 409/404 verbatim).
- **Lane C** `ab934eb`: the reviewer/adjudicator deck (buildReviewDeck frozen product, redaction
  partitions with operator count-only withholding), the developer portal (contract shapes
  enumerated at runtime from the real frozen schemas), the operations surface (the FROZEN truth
  law: NOT_GO/test_mode/disabled verbatim with all recorded bases).
- **TL integration** `e1c0b24`: the web mounting (ArenaShell as the default first screen; the
  inherited workspace behind the explicit `?workspace=1` fallback entry), Arena titles, the
  public-surface extension, the browser digest shim (byte-identical sha256), the AR2-021-class
  browser journeys (11/11 green, axe 0 violations, screenshots + transcripts in
  `docs/evidence/ui/**`), the arena-shell CI battery step, and the defects the journeys caught
  (the effectiveActive navigation defect, snapshot caching, contrast recalibration, the heading
  cascade, the demo-tenant composition).

Remaining frontiers for successor WOs: the desktop Arena-first mounting (renderer bootstrap
re-sequencing), the @arena/sdk/@arena/ops/@arena/acquisition surface mounts (module requires
extension), the production credential adapter (owner IdP decision), the arena-api deployment
topology, the light-theme activation calibration.

## 10. UIA-002 — the desktop Arena-first mounting (recorded 2026-10-15; issue #71 CLOSED completed)

The first successor work order from the UIA-001 recorded frontiers, executed under the
resident TL watch loop (monitor → harvest → review → approve/require-changes → dispatch next):

- **Registration** `ab05231`: issue #71 + the dispatch-record comment; ledger row + impl-plan
  section; the desktop manifest pre-wire (`@arena/shell` + `@arena/workbench` workspace deps +
  lockfile intake — TL-owned); station baseline green on the registration tree.
- **Dispatch**: a subagent worker session (GLM, Full-Stack) via the resident TL session's
  in-session Task tool — the replay-dispatch capacity class. The worker session delivered the
  complete 8-file lane in-fence, then hit the platform CONTEXT DEADLINE before battery/commit/
  push — the incident and the TL's completion are disclosed in the PR body (the dispatch-capacity
  lesson: split implement / battery+PR into separate dispatches, or budget tighter scopes).
- **Landed** PR #72 squash `a66a949`: the ArenaShell five-screen composition is the desktop
  renderer's arena-first business-root render (`arenaDesktopMount.ts` — the pure decision +
  composition module: entry-mode predicate mirroring the web `?workspace=1`/`app=workspace`
  fallback semantics, the baseUrl law with the honest port-0 sentinel for the unconfigured
  `VITE_ARENA_API_URL` posture — typed `TRANSPORT_ERROR`/`UNAUTHENTICATED` rendered verbatim);
  the inherited workspace `Root` verbatim behind the fallback entry; the admission/update-status/
  port lifecycles untouched; the renderer sha256 shim (correct `+9` padding) + the vite
  `node:crypto` alias; 22 node tests (REAL composition + a real local `node:http` probe);
  the TL type-program wiring (renderer `types:["node"]`, `env.d.ts`, the interval-handle typing).
- **MAINT-003** (issue #73, `b84c70b`): a real defect the lane surfaced in the WEB shim — the
  `+8` padding bug (wrong digest at message length ≡ 56 mod 64; FIPS 448-bit vector
  station-verified mismatching node:crypto). Scoped TL-direct fix in the owning module;
  `scripts/verify_sha256_shim.ts` now actually persisted (27/27 checks incl. the boundary sweep
  and known-digest anchors — the UIA-001 record had claimed the script but it was absent, and
  its 9-case verification had no boundary coverage, which is how the bug slipped).
- **Integration**: the desktop-renderer CI battery step added; PROJECT-STATE / dispatch ledger /
  implementation-plan reconciled in the same integration commit.

Remaining frontiers for successor WOs (recomputed): the @arena/sdk/@arena/ops/@arena/acquisition
surface mounts (module requires extension), the production credential adapter (owner IdP
decision), the arena-api deployment topology (operator infrastructure), the light-theme
activation calibration, and the desktop mounted-app browser-journey class (the web journeys
precedent applied to the real desktop shell — needs the Electron runtime class).

## 11. UIA-003 — the SDK/ops/acquisition surface mounts (recorded 2026-10-15; issue #74 CLOSED completed)

The second successor work order from the UIA-001 recorded frontiers, executed under the
resident TL watch loop with the **implementation-scoped dispatch** refinement (the UIA-002
deadline-incident lesson: the worker session implements in-fence; the TL runs the battery
and the delivery mechanics — disclosed in the PR body):

- **Registration** `4b4c2f6` + `d8a3a65`: issue #74 + the dispatch-record comment; the module
  `requires` extension (arena-shell += arena-sdk, arena-ops, arena-acquisition) + package deps +
  lockfile intake (TL-owned); the ledger/impl-plan rows amended after an anchor drift, disclosed.
- **Landed** PR #75 squash `0081345`: the developer portal mounts the REAL SDK surfaces (the
  `ArenaSdkClient`/`sdkQuickstart` typed outcomes over the configurable binding baseUrl, the MCP
  facade vocabulary + the disclosure constants verbatim, `canonicalRequestDigest`, the ACQ1.0
  provider-routing vocabulary) — both constraint constants retired + test-asserted gone; the
  operations surface renders `HEALTH_DISCLOSURE` verbatim + REAL station probes (node:sqlite
  resolvability, bwrap PATH detection mirroring arena-isolation's resolveBwrap law) + the
  fail-closed aggregate readiness (the zero-probe edge guarded) + the capacity/dead-letter/
  custodian disclosures verbatim.
- **Evidence**: the full shell suite 145/145 at station (121 at base + 24 new) incl. the REAL
  spawned-arena-api composition test (the quickstart flow, the idempotent REPLAYED replay, the
  typed CONFLICT envelope rendered verbatim); consumed-package regressions sdk 10/10 · ops 4/4 ·
  acquisition 77/77; desktop renderer 22/22; CI green on the PR head.
- **CI coverage gap found and fixed at integration (pre-existing since UIA-001 Lane C):** the
  arena-shell battery glob was missing `test/developer/*.test.tsx` — the Lane C developer screen
  test had never run in CI. Fixed in the integration commit, disclosed.
- **Remaining follow-up recorded:** the browser composition roots don't yet inject the station
  probes (the node-side injection point exists; the web/desktop roots' wiring is the
  TL-integration follow-up surface).

Remaining frontiers for successor WOs (recomputed): the production credential adapter (owner
IdP decision), the arena-api deployment topology (operator infrastructure), the light-theme
activation calibration, the desktop mounted-app browser-journey class, the station-probe
injection into the browser composition roots.

## 12. UIA-004 — the station-probe injection into the browser composition roots (recorded 2026-10-16; issue #76 CLOSED completed)

The third successor work order from the UIA-001 recorded frontiers — the UIA-003 recorded
follow-up — executed under the resident TL watch loop with the implementation-scoped dispatch
refinement (the worker session implements in-fence; the TL runs the battery and the delivery
mechanics — disclosed in the PR body):

- **Registration** `c8131a5`: issue #76 + the dispatch record; ledger row + impl-plan section;
  the arena-api `requires` extension (+= arena-ops) + package dep + lockfile intake (TL-owned;
  the UIA-003 requires-extension precedent); station baseline verified green on the
  registration tree (arch 0 / tsc 0 / oxlint 0 errors 73 warnings / api 14/14 / shell-ops 14/14).
- **Worker lane** (GLM, Full-Stack, in-session Task tool — the replay-dispatch capacity class):
  `packages/arena-api/src/stationProbes.ts` (the node-side REAL station capability probes —
  node:sqlite resolvability + bwrap detection mirroring arena-isolation's resolveBwrap law,
  disclosed) + the `GET /v1/ops/station-probes` health-class route (per-request live
  measurement, `aggregateReadiness` fail-closed, the `/readyz` shape precedent) + the endpoint
  test on a REAL spawned arena-api; `packages/arena-shell/src/screens/operations/remoteStationProbes.ts`
  (browser-safe — zero node imports, MAY be statically imported from browser roots; LIVE
  fetch-per-check; rows VERBATIM; every failure mode typed DOWN fail-closed) + its test on a
  REAL local node:http server (8 cases).
- **TL integration** (PR #77, squash `649e573`): the shell public surface extended
  (`remoteStationProbes` + `STATION_PROBE_ENDPOINT_PATH`); the web `renderArenaShell()` and the
  desktop `buildArenaDesktopComposition()` inject `remoteStationProbes(baseUrl)` — the probes
  measure the ARENA RUNTIME station (the binding baseUrl target; the deployment topology
  remains the recorded operator frontier); the unconfigured port-0 sentinel posture renders the
  typed DOWN rows honestly (never fake-ready, never silently-unwired-pretending-measured);
  +2 REAL desktop composition integration tests (the real local HTTP row mapping + the honest
  sentinel DOWN posture).
- **Evidence**: arch 0 violations / root typecheck 0 / oxlint 0 errors (73 pre-existing
  warnings) / arena-shell 153/153 (145 + 8) / desktop renderer 24/24 (22 + 2) / arena-api
  25/25 / ops 11/11 / sdk 24/24 (incl. the e2e that spawns the real arena-api) /
  acquisition 77/77 / workbench 52-0-1 honest skip; CI battery green on the PR head.
- **Disclosed limitations**: the a11y host fixture stays uninjected by design (fixture
  posture); at this station the endpoint honestly reports `ready: false, fail_closed: true`
  (persistence UP via real node:sqlite; bwrap DOWN — no executable on PATH) — the typed truth
  per the recorded posture.

Remaining frontiers for successor WOs (recomputed): the production credential adapter (owner
IdP decision), the arena-api deployment topology (operator infrastructure), the light-theme
activation calibration, and the desktop mounted-app browser-journey class (needs the Electron
runtime class). The station-probe frontier is CLOSED.

## 13. UIA-005 — the light-theme activation calibration (recorded 2026-10-16; issue #78 CLOSED completed)

The fourth successor work order from the UIA-001 recorded frontiers, executed under the resident
TL watch loop with the implementation-scoped dispatch refinement:

- **Registration** `b2f49c5`: issue #78 + the dispatch record; ledger row + impl-plan section;
  no pre-wiring (arena-shell-internal + root wiring); station baseline green.
- **Worker lane** (GLM, Full-Stack, in-session Task tool — the replay-dispatch capacity class):
  `design/arenaTheme.ts` (pure/total `resolveArenaTheme` over the host theme classes both roots
  maintain — precedence dark → theme-zai-light → theme-zai-dark → system fallback; the applier;
  the observer factory; ZERO DOM globals — all surfaces injected, node-testable, 9 unit tests)
  + the calibration (the pre-calibration light sweep found exactly one failing pair:
  `--arena-text-muted #66707f` on raised = 4.39:1 → `#5f6873` = 4.96:1, disclosed; all five
  screens 0 axe violations post-calibration) + the light browser journey (transcripts +
  screenshots under `docs/evidence/ui/uia-005-light/**`).
- **TL integration** (PR #79, squash `6be4cde1`): the public surface extended
  (`exports["./theme"]` + the policy publicEntrypoints entry); the web `renderArenaShell()` and
  the desktop arena-first branch wire the documented recipe (resolve at mount +
  MutationObserver runtime re-calibration on host class changes); the CI glob gap fixed
  (`test/design/*.test.ts` — the UIA-001 Lane C gap class); one TS2345 readonly-vs-mutable
  cast fixed at integration.
- **Evidence**: arch 0 violations / root typecheck 0 / oxlint 0 errors (73 pre-existing
  warnings) / arena-shell unit glob 162/162 (153 + 9) / desktop renderer 24/24 / a11y journeys
  12/12 incl. the light journey (playwright 1.64.0 / chromium 156.0.8078.4 / axe-core 4.14.0);
  CI battery green on the PR head.
- **Disclosed limitations**: evidence-refresh side-effects (the journeys harness writes
  unconditionally — summary now aggregates 11 scans; 4 UIA-001 screenshots re-rendered with
  byte diffs on the chromium-1248 rebuild); the root glue is browser-only (typechecked, not
  node-unit-tested — the module logic is fully unit-tested and journey-verified); the journeys
  suite remains a station/TL-run gate (not a CI step — unchanged posture).

Remaining frontiers for successor WOs (recomputed): the production credential adapter (owner
IdP decision), the arena-api deployment topology (operator infrastructure), and the desktop
mounted-app browser-journey class (needs the Electron runtime class — station-disclosed
limitation). The light-theme activation calibration frontier is CLOSED.

## 14. UIA-006 — the desktop mounted-app browser-journey class (recorded 2026-10-16; issue #80 CLOSED completed)

- **Registration** (issue #80; commit `f4dfdb4`): the TL pre-wired `packages/desktop`
  devDeps (playwright ^1.64.0 + esbuild ^0.27.7 + lockfile intake — TL-owned manifests) and
  verified the Electron runtime class at station (ELECTRON_BOOT_OK 41.0.3 under Xvfb :99 —
  a BrowserWindow with the production security posture loads a page and exits cleanly; the
  dbus socket warnings are harmless container noise).
- **Dispatch + incident**: implementation-scoped as the UIA-003/004/005 lessons directed —
  but the worker session hit the platform CONTEXT DEADLINE (the UIA-002 incident class,
  second occurrence). The TL harvested the dead worker's tree (~95% of the in-fence lane:
  11 files ~2040 lines + partial evidence — 10 axe scans, 1 violation, the configured
  journey incomplete) and completed the recovery: a leftover TEMP fetch-patch diagnostic
  removed (it crashed rebuilds via misordered references), the fallback disclosure landmark
  fixed (`section` → `main`), everything re-run.
- **The real find — MAINT-004 (issue #81, PR #82 squash `c246987`, landed FIRST)**: the
  configured journey never completed (zero requests reached the local fixture) → a five-probe
  TL diagnostic battery isolated the root cause: `ArenaApiClient` captured the global `fetch`
  and called it as `this.doFetch(...)` — in browser runtimes the receiver is the client
  instance → Chromium/Electron throw `TypeError: Failed to execute 'fetch' on 'Window':
  Illegal invocation` → `raw()` swallowed it → every binding projection silently degraded.
  **The production web app and the production desktop renderer's every real-bind network
  call had failed silently since AR2-006** (node fetch is receiver-insensitive — all node
  suites green; the browser journeys had never exercised a configured fetch until now).
  Fix: `fetch.bind(globalThis)` + a WebIDL-law regression test (verified fail-pre-fix /
  pass-post-fix).
- **The lane** (PR #83, squash `eb713ed`): the harness — `electron-main.cjs` (production
  posture: contextIsolation/nodeIntegration:false/sandbox/webviewTag:false, IPC-free); the
  esbuild render host mounting the REAL `buildArenaDesktopComposition` inside the REAL
  `ArenaShell` AS-IS (zero renderer src edits) with the UIA-005 theme law and the
  `node:crypto` alias to the REAL renderer shim under fail-closed parity; the REAL
  X11-handshake display probe (honest NOT_SUPPORTED); the CORS-postured local arena-api
  fixture. The journey roster (12 tests): entry predicate both postures (the REAL
  `parseDesktopEntryMode` on the loaded URL), the honest unconfigured sentinel (typed
  TRANSPORT_ERROR/DOWN verbatim), **the configured-baseUrl REAL flow** (tracking/timeline/
  result projections over real HTTP, the idempotent submit with the 64-hex digest through
  the real shim, the fail-closed station probes with a real DOWN row), navigation/keyboard
  (roving tabindex, Home/End/ArrowDown, hash deep-links), the presentation-invariant role
  lens, theme light+dark computed surfaces, responsive 1440×900 + 390×844 zero-overflow,
  branding (the title law, the wordmark, zero user-visible ZCode).
- **Evidence**: 12 screenshots + 21 transcripts under `docs/evidence/ui/uia-006-desktop/**`;
  aggregate 12 axe scans, 0 violations. Station battery: arch 0 / root typecheck 0 / oxlint
  0 errors 74 warnings (the disclosed tree-state baseline — A/B-identical without the lane) /
  desktop renderer 24/24 / arena-workbench 39+1 honest skip / journeys 12/12 under Xvfb; CI
  green on the PR head.
- **Disclosed limitations**: the browser's automatic typed-404 resource logs (the
  result-view ARENA_RESULT_NOT_AVAILABLE stub — intentionally driven and asserted as visible
  text) are the one excluded console-noise class (recorded verbatim in the transcripts; every
  other console error and every uncaught page error fails the journey); the host `dist/`
  bundle is gitignored (built at run time — the web a11y host precedent); the journeys stay a
  station/TL-run gate (not a CI step — unchanged posture); the replay-dispatch capacity class
  has now hit the platform context deadline twice (UIA-002, UIA-006) — both recovered by TL
  harvest + completion; budget for the harvest-completion posture.

Remaining frontiers for successor WOs (recomputed): the production credential adapter (owner
IdP decision) and the arena-api deployment topology (operator infrastructure) — both OWNER/
OPERATOR decisions, not TL-actionable implementation. **The desktop mounted-app
browser-journey frontier is CLOSED; every TL-actionable recorded implementation frontier is
now CLOSED.**
