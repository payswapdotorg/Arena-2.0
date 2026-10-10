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
Owner: TL. Dependencies: none. State: EVIDENCE EXECUTED 2026-10-10 (clean-clone battery at 96e3edf; report at docs/evidence/baseline/AR2-000-baseline-report-2026-10-10.md; classification PASS WITH EXISTING FAILURES; [PR #21](https://github.com/payswapdotorg/arena-2.0/pull/21) awaiting merge).
Inventory upstream base commit, workspace package graph, app entry points, identity/auth modes, service composition roots, persistence, background jobs, remote/RPC boundaries, sandbox limitations, plugin/MCP capability, licensing, CI and build/test commands. Record exact commands and pre-existing failures. Preserve upstream LICENSE, NOTICE, dependency license records, provider disclosures and attribution.
Acceptance: clean clone/install and available baseline checks recorded; actual file paths verified; every planned Arena integration point has an owner; no assumption that ZCode workspace equals OS isolation.

### AR2-001: Domain and public contract freeze
Owner: TL. Dependencies: AR2-000. State: NOT STARTED (acceptance rubric frozen: spec/work-orders/ar2-001-acceptance.md).
Freeze EscalationRequest, acceptance criteria, proof policy snapshot, Attempt, CapsuleManifest, EvidenceEnvelope, ResultEnvelope, EventEnvelope, idempotency/retry contract, tenant context and major state machines. Runtime schema validation is mandatory. Define API error catalog and compatibility policy. Review contract schemas with workers before dispatch.
Acceptance: examples and transition tests agreed; APIs and field ownership explicit; no unresolved blocking interface question.

## Wave 1 — Three disjoint foundational lanes (after AR2-001)

### AR2-002: API edge and generic lifecycle use cases
Owner: Worker 1. Dependencies: AR2-001. Write fence: Arena API transport, application use cases and API tests only; no root manifest/lockfile; no capsule provider implementation; coordinate any shared domain file through TL.
Scope: request validation, authentication/tenant context, use-case invocation, idempotent command port, typed errors, result/status/timeline query paths, health/readiness and versioned public contract.
Acceptance: real HTTP listener locally callable; tenant scoping tested; contract conformance and negative tests; persistence port remains explicit, never process-local source of truth.

### AR2-003: Workbench and multi-role UI shell
Owner: Worker 2. Dependencies: AR2-001. Write fence: Arena-specific UI routes, components and UI tests; may use frozen mocks until API integration; do not write domain/persistence contracts or root manifests without TL approval.
Scope: requester cockpit, expert queue/workbench, candidate submission/self-evaluation, reviewer/adjudicator screens, persistent role/lens switcher, loading/empty/error/inconclusive states and responsive accessible design.
Acceptance: role is presentation only; all mutations use typed client/services and server authorization; responsive keyboard-accessible E2E smoke tests; demo data visibly labelled.

### AR2-004: Capsule contract and isolation adapter seam
Owner: Worker 3. Dependencies: AR2-001. Write fence: capsule contract/provider adapter, capsule conformance tests and security documentation.
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
Dependencies: integrated previous waves.
Scope: cross-tenant adversarial suite, capsule breakout/egress tests, malicious input/prompt injection tests, performance/capacity, platform install/build, keyboard/mobile UX, evidence registry, release gate and residual findings.
Acceptance: every gate in spec/testing/acceptance-gates.md is explicitly PASS, FAIL, BLOCKED or WAIVED with evidence and authorized rationale. Critical/high issues block release unless permitted written owner acceptance is recorded. A build alone is not a release decision.

## Parallel dispatch graph

W0: AR2-000 -> AR2-001, serialized under TL.
Wave 1: AR2-002 || AR2-003 || AR2-004.
Wave 2: AR2-005 (after API/persistence port) || AR2-006 (after AR2-002) || AR2-007 (after AR2-004 and evidence contract).
Wave 3: AR2-008 || AR2-009 || AR2-010 only when all listed dependencies and frozen interfaces are truly ready; if not, pull the next independent ready WO from the graph.
Wave 4: AR2-011 || AR2-013 || AR2-014 when their dependencies are satisfied; AR2-012 and AR2-015 integrate after the vertical slice exists.

The table is a ceiling, not a mandate to dispatch all three. The TL recomputes readiness, branch drift, write-surface overlap, worker capacity and integration risk before each wave. Do not parallelize root manifests, lockfiles, migrations that touch the same ledger/schema, a state-machine contract and its implementation before the contract freezes, or tests that rewrite the same evidence files.

## WOs and acceptance are repo-owned

Update status only with links to merged PRs, CI checks and retained evidence. Failed/deferred tests stay visible. Keep historical work order IDs; do not reassign a closed ID to another feature. The canonical registry is the table in this document plus spec/PROJECT-STATE.md and spec/work-orders/dependency-graph.md; update them in the same PR as the status-changing work.
