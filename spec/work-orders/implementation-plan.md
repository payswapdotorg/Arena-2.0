# Arena 2.0 Implementation Plan

Registry version: WO2.0
Maximum concurrent workers: 3
One Work Order = one issue = one branch = one PR.
All statuses are initially NOT STARTED unless explicitly stated otherwise.

## Work-order rules

Every WO must state exact base SHA, owner, allowed paths, forbidden paths, dependencies, acceptance scenarios, tests run, evidence class, known limitations and resulting state updates. Worker PRs must remain within their frozen path fences. The TL serializes shared contracts, workspace manifests, lockfiles, code generation, database migration integration and final merge order. Workers may propose interface changes but may not merge conflicting contract changes independently.

Parallel work is permitted only when contract versions are frozen and write surfaces do not overlap. A theoretically parallel task is not dispatchable while a required contract is still ambiguous. The TL recomputes readiness before every wave.

## W0 — Serialized bootstrap and contract freeze

### AR2-000: Fork baseline and inherited surface inventory

Owner: TL. Dependencies: none. State: ACCEPTED (issue #2 closed; PR #21 merged at 1f8bca1; baseline report at docs/evidence/baseline/AR2-000-baseline-report-2026-10-10.md; classification PASS WITH EXISTING FAILURES).
Inventory upstream base commit, workspace package graph, app entry points, identity/auth modes, service composition roots, persistence, background jobs, remote/RPC boundaries, sandbox limitations, plugin/MCP capability, licensing, CI and build/test commands. Record exact commands and pre-existing failures. Preserve upstream LICENSE, NOTICE, dependency license records, provider disclosures and attribution.
Acceptance: clean clone/install and available baseline checks recorded; actual file paths verified; every planned Arena integration point has an owner; no assumption that ZCode workspace equals OS isolation.

### AR2-001: Domain and public contract freeze

Owner: TL. Dependencies: AR2-000. State: ACCEPTED (issue #3 closed; PR #24 merged at 9cd8ad8; corpus CF1.0 in `packages/arena-contracts`; five contract questions CLOSED in spec/contracts/ar2-001-freeze.md §2; 104-test suite wired into CI; acceptance rubric at spec/work-orders/ar2-001-acceptance.md).
Freeze EscalationRequest, acceptance criteria, proof policy snapshot, Attempt, CapsuleManifest, EvidenceEnvelope, ResultEnvelope, EventEnvelope, idempotency/retry contract, tenant context and major state machines. Runtime schema validation is mandatory. Define API error catalog and compatibility policy. Review contract schemas with workers before dispatch.
Acceptance: examples and transition tests agreed; APIs and field ownership explicit; no unresolved blocking interface question.

## Wave 1 — Three disjoint foundational lanes (after AR2-001)

### AR2-002: API edge and generic lifecycle use cases

Owner: Worker 1. Dependencies: AR2-001. Write fence: Arena API transport, application use cases and API tests only; no root manifest/lockfile; no capsule provider implementation; coordinate any shared domain file through TL.
Scope: request validation, authentication/tenant context, use-case invocation, idempotent command port, typed errors, result/status/timeline query paths, health/readiness and versioned public contract.
Acceptance: real HTTP listener locally callable; tenant scoping tested; contract conformance and negative tests; persistence port remains explicit, never process-local source of truth.

### AR2-003: Workbench and multi-role UI shell

Owner: Worker 2. Dependencies: AR2-001. State: ACCEPTED 2026-10-10 (TL-direct after worker brain outage; slice 1 PR #29 → d08a3a7 + slice 2 PR #30 → dfb1b90, CI green; issue #5 closed with acceptance record comment 6099174698; `packages/arena-workbench` 50-test suite: typed mock client + CF1.0-validated requester form + frozen-machine expert flow with `never_an_independent_vote` self-evaluation + redaction-partitioned reviewer/adjudicator decks). Write fence: Arena-specific UI routes, components and UI tests; may use frozen mocks until API integration; do not write domain/persistence contracts or root manifests without TL approval.
Scope: requester cockpit, expert queue/workbench, candidate submission/self-evaluation, reviewer/adjudicator screens, persistent role/lens switcher, loading/empty/error/inconclusive states and responsive accessible design.
Acceptance: role is presentation only; all mutations use typed client/services and server authorization; responsive keyboard-accessible E2E smoke tests; demo data visibly labelled.

### AR2-004: Capsule contract and isolation adapter seam

Owner: Worker 3. Dependencies: AR2-001. State: ACCEPTED 2026-10-10 (TL-direct after worker brain outage; slice 1 PR #27 → 3a6b9a4 + slice 2 PR #28 → df1f374, CI run 38052459005; issue #6 closed with acceptance record comment 6097567345; `packages/arena-capsule` 32-test suite; synthetic provider labelled NON-PRODUCTION with `PRODUCTION_ENABLED: false` literal type; OS-level isolation conformance suite DESIGN at packages/arena-capsule/docs/conformance-suite-design.md v1.0.0 — synthetic results are NON-EVIDENCE). Write fence: capsule contract/provider adapter, capsule conformance tests and security documentation.
Scope: CapsuleProvider port, task environment manifest, allowed actions/tools, scoped credentials, resource and egress policy, artifact transfer, lifecycle, heartbeat, teardown and assurance record. Provide a synthetic local provider for development and tests, visibly marked non-production.
Acceptance: invalid or over-scoped manifest fails closed; authorization and cleanup paths tested; synthetic provider makes no system-isolation claim; production provider remains disabled until a system-level isolation conformance suite passes.

## Wave 2 — Durable integration and evidence

### AR2-005: Durable persistence, idempotency, transactional outbox and jobs

Owner: Worker 1. Dependencies: AR2-002 and frozen persistence port. Write fence: migrations, persistence/worker adapters and their tests; TL owns lockfiles and final dependency integration.
Scope: relational store for aggregates, idempotency, audit/evidence references, outbox, jobs, leases, attempts, budgets and payment operations; restart-safe recovery, two-instance coordination and migrations.
Acceptance: same-key replay, same-key conflict, concurrent admission from two API instances, process restart and outbox recovery; no accepted request depends on process memory; no blindly retried ambiguous external operation.

### AR2-006: Bind the workbench to the real API

Owner: Worker 2. Dependencies: AR2-002. Write fence: Arena UI client bindings, routes and E2E tests.
Scope: replace mocks with the typed public client; implement request wizard, status and evidence timeline, submission, criterion-level self-evaluation, reviewer rubric scoring, revision/appeal and result views.
Acceptance: UI consumes canonical server projections; role switch does not alter permissions; API errors and inconclusive decisions are legible; no duplicate UI-only lifecycle. UI/API contract tests may use deterministic fixtures; final durable end-to-end acceptance is gated on AR2-005.

### AR2-007: Evidence capture and verification pipeline

Owner: Worker 3. Dependencies: AR2-004, frozen EvidenceEnvelope and proof policy. Write fence: evidence/validator orchestration and tests; do not alter payout state machine.
Scope: append-only evidence envelope, hash/provenance records, validator registry and sandboxed execution interface, output normalization, proof-class evaluator, failed/flaky/inconclusive behavior.
Acceptance: P0 baseline fail/post-state pass demonstration; invalid/replayed/wrong-tenant evidence rejected; P1 aggregation follows frozen policy; P2/P3 cannot pass from author self-evaluation alone.

## Wave 3 — Matching, Expert Arena and payment eligibility

### AR2-008: Expert identity, capability matching, qualification and conflict checks

Owner: available worker selected by TL. Dependencies: AR2-002, AR2-005. Write fence: expert profile/matching modules.
Scope: capability demand, expert evidence, task qualification, availability/capacity, conflict screening, explainable match decisions, offer/decline/timeout/reassignment and attempt budgets.
Acceptance: qualification is not authorization; no assignment before policy checks; next eligible expert receives a separate attempt; no retry can exceed budget/deadline.

### AR2-009: Expert Arena competition, self-review and adjudication

Owner: available worker selected by TL. Dependencies: AR2-003, AR2-007, expert capability contracts.
Write fence: competition rounds, candidate versions, reviewer assignments, rubric scoring and adjudication.
Scope: structured self-evaluation, blind independent review where feasible, conflict detection, quorum, reviewer replacement, disagreement thresholds, adjudicator, revision and appeal.
Acceptance: author self-evaluation is retained but never counts toward quorum or controls payout; conflicted reviewers are excluded; missing quorum fails closed; P0/P1 use validators as primary proof; P2/P3 use independent review/adjudication.

### AR2-010: Test-mode payments, ledger, and payout orchestration

Owner: available worker selected by TL. Dependencies: AR2-005, AR2-007, proof policy and budget contracts.
Write fence: payment domain/application, provider-neutral port, simulator adapter and test suite.
Scope: reservation, per-attempt eligibility, fee calculations, unique payout operations, append-only ledger, refunds/disputes, reconciliation and provider timeout semantics.
Acceptance: successful proof unlocks one test-mode release; failures do not pay; duplicate/concurrent events do not double pay; ambiguous provider timeout reconciles before retry; live provider remains disabled.

## Wave 4 — Network delivery and generic proof of product

### AR2-011: Public SDK, MCP, signed webhooks and generic integration

Dependencies: AR2-002, AR2-005. Owner chosen by TL with frozen API surface.
Scope: typed SDK, MCP facade using identical use cases/authz, signed webhooks, durable retries and dedupe; generic app example independent of Epoch types.
Acceptance: external process calls real URL, gets result, validates signature and recovers from retry without duplicate effects.

### AR2-012: End-to-end acceptance harness and second-expert path

Dependencies: AR2-005 through AR2-010.
Scope: synthetic customer application, expert attempt lifecycle, baseline/post proof, failed first expert then next eligible expert, budget controls, result delivery, payment simulator and Expert Arena P2 case.
Acceptance: all state and evidence durable; two-instance and crash/recovery test profiles pass; one successful P0 payout exactly once and one failed attempt does not pay.

### AR2-013: Operations, capacity, retention and observability

Dependencies: durable jobs, capsule and payment adapters.
Scope: health/readiness, queue lag, capacity limits, cleanup drift, structured logs, trace/correlation, privacy-safe metrics, operational runbooks and no-hidden-paid-fallback checks.
Acceptance: outages and quota exhaustion are visible and fail closed; capsule teardown and orphan recovery are proven.

### AR2-014: Rights-gated learning and Agent Body/version marketplace

Dependencies: AR2-007, AR2-009, AR2-012.
Scope: LearningProposal, RightsGrant, provenance graph, consent/scope checks, validation, immutable BodyVersion, composition/possession metadata and publication/deprecation.
Acceptance: no artifact is reusable by default; rights failure blocks publication; new versions never rewrite historic evidence; certification is tied to tested composition.

### AR2-015: Security, resilience, accessibility and release review

Owner: TL. Dependencies: integrated product path (AR2-000..014 all accepted). State: ACCEPTED 2026-10-11 (TL-direct; PR #47 squash-merged 7d117f1, CI battery green on head c7baad4; issue #17 closed with acceptance record; `packages/arena-release-gate` 25-test suite: typed G0–G8 gate registry + four adversarial profiles on real surfaces + classified gate report at docs/evidence/release/AR2-015-gate-report-2026-10-11.md; machine core release decision NOT_GO — capsule isolation/cross-platform/accessibility BLOCKED, untrusted execution and live payments stay disabled).
Dependencies: integrated previous waves.
Scope: cross-tenant adversarial suite, capsule breakout/egress tests, malicious input/prompt injection tests, performance/capacity, platform install/build, keyboard/mobile UX, evidence registry, release gate and residual findings.
Acceptance: every gate in spec/testing/acceptance-gates.md is explicitly PASS, FAIL, BLOCKED or WAIVED with evidence and authorized rationale. Critical/high issues block release unless permitted written owner acceptance is recorded. A build alone is not a release decision.

### AR2-016: Capability-gap acquisition contract and provider router

Owner: TL-assigned worker. Dependencies: AR2-002 accepted, AR2-005 durable store/jobs accepted, and AR2-008 capability-demand/matching contracts accepted. Status: ACCEPTED 2026-10-11 — issue #32 closed; PR #48 squash-merged ddea6e48; ACQ1.0 contract family + deterministic provider router in packages/arena-acquisition (77/77 package tests; CF1.0 corpus 104/104 green). Write fence: new capability-acquisition contract/router package and tests only; TL owns root manifests, shared frozen contracts, migrations and integration.

Scope: versioned CapabilityGapReport and CapabilityAcquisitionRequest; route modes PINNED_PROVIDER, ANY_COMPATIBLE_PROVIDER and AUTO; registry descriptors for SCRAPER, EXTERNAL_API and HUMAN_EXPERT; deterministic authorization/rights/schema/budget/deadline/quota filters before ranking; auditable route decision and explicit fallback policy. CF1.0 stays immutable—shared contract changes require the reviewed ACR and explicit schema migration/versioning.

Acceptance: machine-readable schemas and positive/negative vectors; current CF1.0 corpus remains green; deterministic routing tests for all three modes; pinned-provider failure does not silently fall back; tenant, budget, deadline, attempt, idempotency and schema compatibility are enforced; route alternatives have reason codes and exact provider versions.

### AR2-017: Scraper Factory, crawler runtime and external API adapters

Owner: TL-assigned worker. Dependencies: AR2-004 accepted capsule seam, AR2-005 accepted durable jobs, AR2-016 frozen provider contract. Status: ACCEPTED 2026-10-12 — issue #33 closed; PR #49 merged 12043d0; SCRP1.0 scraper factory, Crawlee-based crawler runtime, SSRF/redirect/DNS-rebinding egress guards and external API adapters in packages/arena-scraper (104/104 package tests; mock-server adapters only — no live paid services in tested scope). Write fence: scraper-runtime/definition/build packages, external provider adapters, scraper-specific tests/docs; root manifests and cross-module integration remain TL-owned.

Scope: bounded scraper definition/build/version lifecycle; Crawlee Node/TypeScript first, a Python runtime only if justified; provider-neutral API connector port; optional explicit Apify Actor/task API adapter; immutable output datasets and source metadata; durable execution, cancellation, rate/cost/page/byte/time quotas and connector operation semantics. Do not clone the hosted Apify platform.

Acceptance: local permitted-fixture crawl with pinned version and schema validation; secure capsule required for untrusted code; SSRF/redirect/DNS-rebinding/private-network egress tests; scoped API secrets absent from logs/content; robots/source rights/terms and rate limits policy; prompt-injection fixture treated as data; cancellation/retry/quota/tenant isolation tested; Apify integration defaults to mocked fixtures and cannot incur cost without explicit configuration.

### AR2-018: Evidence-to-capability packaging, evaluation and controlled learning

Owner: TL-assigned worker. Dependencies: AR2-007 accepted evidence/verification, AR2-014 accepted rights-gated learning, AR2-016 and AR2-017 accepted. Status: ACCEPTED 2026-10-12 — issue #34 closed; PR #50 squash-merged e0eed65 (CI run green first-run); UPG1.0 dataset intake, transformation lineage, capability-pack build, before/after evaluation, publication and rollback in packages/arena-upgrade (91/91 package tests; deterministic mock target-agent harness and gated fine-tuning stub — no live-model evaluation or training in tested scope). Write fence: acquisition dataset validation, transformation lineage, CapabilityUpgradeProposal and before/after evaluation modules/tests; coordinate immutable BodyVersion and rights records with the AR2-014 owner.

Scope: provenance/rights/privacy/source-policy gate; immutable dataset; choose retrieval/index, knowledge pack, tool/connector, rules/examples or explicitly approved fine-tuning strategy; build a versioned capability proposal; evaluate gap-specific success and regressions; publish/adopt/rollback under policy.

Acceptance: passing scrape/schema does not itself count as capability completion; a reproducible before/after evaluation improves the requested target; unknown/denied rights, missing provenance, hostile input or evaluation failure blocks publication; no fine-tuning by default; customer data stays private unless explicitly granted for broader reuse; exact dataset, transformations, target composition and evaluation versions are immutable and traceable.

## Parallel dispatch graph

W0: AR2-000 -> AR2-001, serialized under TL.
Wave 1: AR2-002 || AR2-003 || AR2-004.
Wave 2: AR2-005 (after API/persistence port) || AR2-006 (after AR2-002) || AR2-007 (after AR2-004 and evidence contract).
Wave 3: AR2-008 || AR2-009 || AR2-010 only when all listed dependencies and frozen interfaces are truly ready; if not, pull the next independent ready WO from the graph.
Wave 4: AR2-011 || AR2-013 || AR2-014 when their dependencies are satisfied; AR2-012 and AR2-015 integrate after the vertical slice exists.
Capability-acquisition extension: AR2-016 after AR2-002/005/008; AR2-017 after AR2-004/005/016; AR2-018 after AR2-007/014/016/017. These were planned additions and did not delay the separately releasable core vertical slice; all three are now ACCEPTED (2026-10-11/12) and the registered roadmap is complete at 19/19.

## WO3.0 — Production-readiness release plan (registered 2026-10-12)

AR2-019 through AR2-023 (issues #51–#55) are NEWLY REGISTERED post-completion work orders that turn the AR2-015 NOT_GO blockers into evidence work: OS-level capsule isolation conformance, cross-platform install evidence, accessibility E2E coverage, production identity adapter, and the release-owner decision record. Sequencing, capacity and disabled-capability boundaries are normative in `spec/work-orders/release-plan.md`. These are separate from the completed 19/19 implementation roadmap; registration authorizes no release, and live-money payments plus untrusted execution stay disabled pending AR2-019 evidence and a recorded owner decision.

The table is a ceiling, not a mandate to dispatch all three. The TL recomputes readiness, branch drift, write-surface overlap, worker capacity and integration risk before each wave. Do not parallelize root manifests, lockfiles, migrations that touch the same ledger/schema, a state-machine contract and its implementation before the contract freezes, or tests that rewrite the same evidence files.

## UIA-001 — Arena-native product UI (registered 2026-10-15, issue #66)

Post-roadmap product work order: make the desktop and web experience unmistakably Arena, not ZCode. The TL froze the UX architecture and Wave 0 contracts at `spec/ux/arena-native-ui.md` with the new sibling package `packages/arena-shell` (@arena/shell; module `arena-shell` registered in `architecture-policy.yaml`; frozen public contract: screen vocabulary, navigation port with typed refusals, role lens law, product identity constants, honest release-posture constants, `--arena-*` design-token namespace). Three parallel lanes with disjoint write fences recorded in the dispatch ledger: A (design system/shell/identity/navigation + the enumerated user-visible branding files), B (requester + expert workbenches over the @arena/workbench public contract), C (reviewer/adjudicator + developer portal + operations surfaces). One issue = three lane branches = three PRs, merged by the TL and integrated (web/desktop mounting is TL-owned wiring). Safety: no live-money enablement, no release claims, no untrusted-execution enablement, no internal-identifier renames, no arena-* domain behavior changes; upstream license/NOTICE attribution preserved verbatim. COMPLETE 2026-10-15: lanes A/B/C (PR #67/#68/#69) + TL integration (PR #70) all merged; issue #66 closed completed; the web experience is Arena-native and browser-journey-verified. The recorded remaining frontiers live in `docs/implementation/tl-integration-uia-001.md` and PROJECT-STATE §6.

## UIA-002 — Desktop Arena-first mounting (registered 2026-10-15, issue #71)

The first successor work order from the UIA-001 recorded frontiers: re-sequence the desktop renderer bootstrap so the Arena shell is the desktop's primary window surface (spec/ux/arena-native-ui.md §1.2 desktop law), with the inherited solution workspace reachable through the explicit fallback entry (`?workspace=1` / `app=workspace` — the same predicate the web entry uses) during the integration period. Scope: `packages/desktop/src/renderer/src/main.tsx` re-sequencing, a NEW pure node-testable decision/composition module (`arenaDesktopMount.ts`: entry-mode predicate, composition construction, baseUrl resolution law), the renderer sha256 shim + vite `node:crypto` alias (the web precedent), and a NEW node suite under `packages/desktop/test/renderer/`. The database-admission, update-status-window and service-port lifecycles are preserved verbatim; only the business-root render target changes. Honest posture laws apply in full: unconfigured `VITE_ARENA_API_URL` renders typed failure states verbatim (no mock-by-default); real Electron app E2E is disclosed not-run at station (no Electron runtime class) with the bootstrap decision + composition node-tested instead. TL pre-wires the `@arena/shell` + `@arena/workbench` workspace deps into `packages/desktop/package.json` + lockfile in the registration commit (manifests/lockfiles are TL-owned); the CI battery step for the desktop renderer suite lands with the TL integration at harvest. Worker identity and lane disclosure are recorded in the dispatch ledger row; acceptance criteria are the issue #71 checklist. COMPLETE 2026-10-15: PR #72 squash-merged a66a949 (issue #71 closed completed) — the worker session's deadline incident + TL completion disclosed in the PR body; MAINT-003 (issue #73, the web shim padding defect found during the lane) fixed in the owning module at b84c70b; the desktop-renderer CI battery step added at integration.

## UIA-003 — SDK/ops/acquisition surface mounts (registered 2026-10-15, issue #74)

The second successor WO from the UIA-001 recorded frontiers: mount the @arena/sdk / @arena/ops / @arena/acquisition surfaces in the Arena shell's developer portal and operations surface — retiring the honest resolution-constraint disclosures the Lane C delivery recorded (`SDK_OPS_RESOLUTION_CONSTRAINT`, `PROVIDER_CONFIGURATION_CONSTRAINT`, the provider-health fallback). The TL extends the module's `requires` (arena-contracts + arena-workbench + arena-sdk + arena-ops + arena-acquisition) and pre-wires the package deps + lockfile in the registration commit `4b4c2f6` (manifests/lockfiles/policy are TL-owned; the ledger/impl-plan rows amended in the immediate follow-up — an anchor-drift in the registration edit, disclosed). The worker fence is the Lane C precedent: the developer + operations screen/test trees only; the three consumed packages are public-API-import only. The mounts render the REAL typed surfaces — the SDK quickstart (real submit/lookup/timeline outcomes against the configurable binding baseUrl), the MCP facade tool surface, canonicalRequestDigest, the ACQ1.0 provider-routing vocabulary, and the operations health vocabulary (HEALTH_DISCLOSURE verbatim + aggregate readiness with explicit per-probe statuses and fail-closed semantics) + the capacity/dead-letter/custodian disclosures. The honest-state law §2.3 applies in full; REAL-composition tests where constructible (the real spawned arena-api precedent). Implementation-scoped worker dispatch with TL-run battery/PR mechanics (the UIA-002 deadline-incident lesson, disclosed). COMPLETE 2026-10-16: PR #77 squash-merged 649e573 (issue #76 closed completed) — the endpoint + the browser-safe remote probes + the web/desktop root wiring all landed in one PR (the worker lane + the TL integration); station battery green (arch 0 / tsc 0 / oxlint 0-73 / shell 153/153 / renderer 24/24 / api 25/25); the a11y host fixture stays uninjected by design (disclosed); at this station the endpoint honestly reports ready:false (persistence UP, bwrap DOWN — the typed truth). COMPLETE 2026-10-15: PR #75 squash-merged 0081345 (issue #74 closed completed) — the full shell suite 145/145 at station incl. the REAL spawned-arena-api composition test; the TL integration fixed the pre-existing CI glob gap (test/developer/*.test.tsx was missing from the battery since UIA-001 Lane C) and reconciled the records.

## UIA-004 — Station-probe injection into the browser composition roots (registered 2026-10-16, issue #76)

The third successor work order from the UIA-001 recorded frontiers — the UIA-003 recorded follow-up: the browser composition roots don't yet inject the station probes (the node-side injection point `arena-shell/src/screens/operations/stationProbes.ts` exists but is node-only: node:fs + node:sqlite are unimportable from browser roots; the web `renderArenaShell()` and desktop `buildArenaDesktopComposition()` both compose `operationsRegistration` without `probes`, so the aggregate-readiness surface honestly renders unwired). The design: the station that the probes measure is the ARENA RUNTIME station (the arena-api binding baseUrl target — deployment topology is the recorded operator frontier), so the node-side measurement surface moves behind a typed HTTP endpoint and the browser roots inject fetch-based live probes. The TL extends `arena-api`'s `requires` (+= arena-ops) and pre-wires the package dep + lockfile in the registration commit (the UIA-003 requires-extension precedent; manifests/lockfiles/policy are TL-owned). Worker fence: `packages/arena-api/src/stationProbes.ts` (NEW — node-side real measurement: node:sqlite resolvability, bwrap detection mirroring arena-isolation's resolveBwrap law, `aggregateReadiness` over the station probes) + the `GET /v1/ops/station-probes` route in `packages/arena-api/src/server.ts` (health-class, no auth — the /healthz /readyz precedent; typed OpsReadiness JSON) + `packages/arena-api/test/station-probes.test.ts` (NEW — the real-HTTP spawn precedent) + `packages/arena-shell/src/screens/operations/remoteStationProbes.ts` (NEW, browser-safe: fetch-based live probes with per-capability row mapping; fetch/parse failure → typed DOWN fail-closed, never fake-ready — the honest-state law §2.3) + `packages/arena-shell/test/operations/remote-station-probes.test.ts` (NEW — a real local HTTP server serving the endpoint shape). The TL integration wires both browser roots (web `renderArenaShell()` + desktop `buildArenaDesktopComposition()` inject `remoteStationProbes(baseUrl)`), reconciles the records, and re-measures the station gates. Implementation-scoped worker dispatch with TL-run battery/PR mechanics (the UIA-002 deadline-incident lesson, disclosed).

## UIA-005 — Light-theme activation calibration (registered 2026-10-16, issue #78)

The fourth successor work order from the UIA-001 recorded frontiers: the light-theme activation calibration. The light fallback token group exists (`:root[data-arena-theme="light"]` in `packages/arena-shell/src/design/arena-tokens.css`) but nothing ever sets the attribute — the light theme is INERT. The scope: (1) the activation law — a pure, browser-safe, DOM-injected theme module in arena-shell (`arenaTheme.ts`: the resolver deriving the arena theme from the host theme classes both roots already maintain (`dark`/`theme-zai-light`/`theme-zai-dark` on documentElement, with the system-preference fallback), the applier (`data-arena-theme` attribute), and a class-change observer factory for runtime host-theme switches — node-testable via injected stubs); (2) the calibration — a light-theme axe journey on the real mounted shell (0 violations; the journeys harness precedent) with light token VALUE recalibration only where contrast fails (the frozen `--arena-*` namespace unchanged; the UIA-001 dark-calibration precedent, disclosed); (3) the TL integration wires the web `renderArenaShell()` and the desktop renderer bootstrap (apply + observe — TL-owned roots). No pre-wiring needed (no package deps/policy changes). Worker fence: the arena-shell design tree + the theme test + the journeys extension; implementation-scoped dispatch with TL-run battery/PR mechanics. COMPLETE 2026-10-16: PR #79 squash-merged 6be4cde1 (issue #78 closed completed) — the activation module + the one-value calibration + the light journey + the TL root wiring + the public surface extension + the CI glob fix all landed; station battery green (arch 0 / tsc 0 / oxlint 0-73 / shell 162/162 / renderer 24/24 / journeys 12/12 incl. light); the light-theme frontier is CLOSED.

## UIA-006 — Desktop mounted-app browser-journey class (registered 2026-10-16, issue #80)

The fifth successor work order from the UIA-001 recorded frontiers — the last TL-actionable implementation frontier: the desktop mounted-app browser-journey class (the web journeys precedent applied to the real desktop shell — recorded as needing the Electron runtime class; the station probe now confirms it: ELECTRON_BOOT_OK 41.0.3 under Xvfb :99, xvfb present, playwright's _electron API available). The scope: an Electron journey harness in `packages/desktop/test/journeys/**` — a minimal test-only main process (BrowserWindow with the production renderer security posture: context isolation, no node integration) loading an esbuild-bundled host page that mounts the REAL `buildArenaDesktopComposition` (the desktop-specific composition module, consumed as-is — the a11y host-app precedent applied to desktop); the journey runner drives Playwright `_electron` under Xvfb. Journey classes: the arena-first vs workspace-fallback entry predicate (the real `parseDesktopEntryMode` semantics on the loaded URL), the honest unconfigured-sentinel posture (typed TRANSPORT_ERROR rendered verbatim), the configured-baseUrl real-binding flow (a real local HTTP server — the composition test precedent), the navigation/keyboard rail semantics (roving tabindex), the light + dark theme activation (`data-arena-theme` per the UIA-005 law), axe 0-violation scans, and responsive window sizes. The renderer sha256/node:crypto seam: the harness esbuild bundle applies the same alias treatment the renderer vite config uses (disclosed if the composition's transitive imports require it). The TL pre-wires `packages/desktop` devDeps (playwright ^1.64.0 + esbuild ^0.27.7 + lockfile intake — TL-owned manifests). The journeys remain a station/TL-run gate (not a CI step — the shell-journeys posture). Evidence under `docs/evidence/ui/uia-006-desktop/**`. Implementation-scoped dispatch with TL-run battery/PR mechanics.

## WOs and acceptance are repo-owned

Update status only with links to merged PRs, CI checks and retained evidence. Failed/deferred tests stay visible. Keep historical work order IDs; do not reassign a closed ID to another feature. The canonical registry is the table in this document plus spec/PROJECT-STATE.md and spec/work-orders/dependency-graph.md; update them in the same PR as the status-changing work.
