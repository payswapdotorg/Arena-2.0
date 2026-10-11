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
