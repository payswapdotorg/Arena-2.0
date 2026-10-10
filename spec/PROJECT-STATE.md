# Arena 2.0 Project State

Last reconciled: 2026-10-10
Repository: https://github.com/payswapdotorg/arena-2.0
Base: fork of zai-org/ZCode
Pinned base commit: 29628c9acdb81b703bbd4080c207a0e7ce5e276e
Architecture: A2.0 / SA1.0
Work-order registry: spec/work-orders/implementation-plan.md
Maximum implementation workers: three plus Tech Lead

## Current status

**Architecture approved. Product implementation has not yet been verified.** This fork currently contains the upstream ZCode v3.14.3 code foundation. Creating these documents does not mean Arena's API, tenant isolation, database, capsules, payments, verification, expert marketplace or learning pipeline already exist.

The branch architecture/arena-2.0-source-of-truth is the initial architecture setup under review. The TL must reconcile this baseline with actual main and current CI before dispatching code work.

## Product definition

Arena is the Stripe of human expert escalation for AI automation. A third-party app submits a versioned task with constraints, budget and proof policy. Arena matches an eligible expert, runs a bounded isolated session, captures evidence, validates the submitted intervention, returns a typed result and—if policy permits—unlocks an idempotent payment operation. Optional reusable learning is a separate rights- and validation-gated flow.

## Canonical authority

Read in order:

1. AGENTS.md — repo-level operating and coding rules.
2. spec/PROJECT-STATE.md — current status, known gaps and frontier.
3. spec/architecture-lock.md — normative non-negotiable rules.
4. docs/architecture/ARENA-2.0-SYSTEM-ARCHITECTURE.md — system architecture.
5. spec/verification/proof-and-payment-policy.md — proof classes and payout gating.
6. spec/expert-arena/expert-arena.md — author self-evaluation, independent competition reviews and adjudication.
7. spec/contracts/escalation-lifecycle.md — contract/state-machine requirements.
8. spec/work-orders/implementation-plan.md and dependency-graph.md — work order scopes and concurrency.
9. spec/ownership/ownership-map.md — frozen write surfaces and integration ownership.
10. spec/testing/acceptance-gates.md — mandatory verification and release gates.
11. docs/TL-FINAL-HANDOFF.md — executable TL dispatch and final acceptance instructions.
12. Code, tests, migrations and CI — implementation truth, not a reason to leave a spec contradiction unresolved.

If these documents conflict, halt the affected implementation and update them in one reviewed Architecture Change Request. Do not ask the owner to repeat a decision already present here. This repository, not conversation history, is the sole source of truth.

## Milestones

| Milestone                                                                           | Status                                                                                                                       | Evidence required                                                                                                                              |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| M0: Fork baseline inventory and reproducible checks                                 | ACCEPTED (issue #2 closed; PR #21 merged 1f8bca1)                                                                            | Clean-install battery recorded at docs/evidence/baseline/AR2-000-baseline-report-2026-10-10.md; CI battery live + main protected since 547dd6f |
| M1: Contract freeze and architecture governance                                     | ACCEPTED (issue #3 closed; PR #24 merged 9cd8ad8; CI run 38029694675)                                                        | Reviewed contracts, state machines, work orders, ownership map and dependency gate                                                             |
| M2: Vertical slice: real generic client → API → expert attempt → validator → result | IN PROGRESS — AR2-002 ACCEPTED (API edge + lifecycle use cases, TL-direct); AR2-004 ACCEPTED (capsule seam + synthetic provider + conformance suite design, TL-direct); workbench/evidence/durable lanes pending | End-to-end trace using real process/network path and durable records                                                                           |
| M3: Durable multi-instance runtime                                                  | NOT STARTED                                                                                                                  | restart/concurrency/outage/recovery evidence                                                                                                   |
| M4: Secure capsule execution and evidence provenance                                | NOT STARTED                                                                                                                  | isolation and tenant-boundary proofs                                                                                                           |
| M5: Expert Arena and non-application-verifiable adjudication                        | NOT STARTED                                                                                                                  | self-evaluation, blind review, quorum, conflict and dispute tests                                                                              |
| M6: Test-mode financial workflow                                                    | NOT STARTED                                                                                                                  | ledger, duplicate release, reconciliation and refund/dispute tests                                                                             |
| M7: Rights-gated learning and Body marketplace                                      | NOT STARTED                                                                                                                  | provenance, rights, evaluation, immutable versions and rejection paths                                                                         |
| M8: Production-readiness decision                                                   | NOT STARTED                                                                                                                  | every gate classified, live evidence where necessary, explicit release owner approval                                                          |

## Known inherited risks and constraints

- The upstream NOTICE.md states the shared Agent execution adapter has no default operating-system sandbox. A workspace, Git worktree or UI boundary does not prove tenant isolation. This must be addressed before untrusted expert work is exposed.
- Upstream docs describe multiple runtime paths and permissions; determine which execution path is used by each product workflow.
- No production payment provider or legal/commercial authority is assumed.
- No live provider, hosting, database, secret or branch-protection setup is assumed merely because a source file exists.
- Do not equate unit tests or cached build output with independent integrated production evidence.
- Preserve all upstream licenses, third-party notices and disclosures.

## Work policy

One work order = one issue = one branch = one PR. Work on a fresh main base, state the exact base SHA, follow write fences, and submit evidence. Maximum three worker PRs in flight; dependencies must be satisfied before dispatch. The TL owns shared contracts, root manifests/lockfiles, common migrations coordination, acceptance decisions and final state reconciliation.

Every merged work order updates PROJECT-STATE, the work-order registry and dependency frontier in the same PR or in its required TL integration commit. Work orders never close from a claim in a PR description alone: a required test or inspectable evidence must exist.

## Current frontier

1. Architecture setup PR [#1](https://github.com/payswapdotorg/arena-2.0/pull/1) merged at 78a6438. [AR2-000 / issue #2](https://github.com/payswapdotorg/arena-2.0/issues/2) ACCEPTED and closed (PR #21 → 1f8bca1; classification PASS WITH EXISTING FAILURES).
2. Repository governance active: CI `battery` workflow required on `main` (PR #22 → 5b6c659), branch protection on (required check, force-push blocked, TL admin bypass documented), format drift normalized (PR #23 → 5e1a856, `fmt:check` now a zero-drift gate).
3. [AR2-001 / issue #3](https://github.com/payswapdotorg/arena-2.0/issues/3) ACCEPTED and closed: frozen contract corpus CF1.0 in `packages/arena-contracts` (schemas, state machines, error catalog, ports, vectors — 104-test suite wired into CI; PR #24 merged 9cd8ad8); the five open contract questions CLOSED in [spec/contracts/ar2-001-freeze.md](contracts/ar2-001-freeze.md) §2.
4. [AR2-002 / issue #4](https://github.com/payswapdotorg/arena-2.0/issues/4) ACCEPTED and closed (TL-direct; worker brain outage — OpenRouter 402, recorded on the issue): PR #25 (a452e9d — API edge + application use cases + TL harvest wiring) + PR #26 (2f6b8fd — ES2.0 §2 query surface 8/8 via typed transport stubs); acceptance record on the issue.
5. [AR2-004 / issue #6](https://github.com/payswapdotorg/arena-2.0/issues/6) ACCEPTED and closed (TL-direct; worker brain outage continues — OpenRouter 402): PR #27 (3a6b9a4 — CapsuleProvider port + fail-closed manifest gate + tenant binding + scoped credentials) + PR #28 (df1f374 — synthetic local provider with allowlist/duration/artifact enforcement + verified teardown + lifecycle state machine + `PRODUCTION_ENABLED: false` frozen literal + conformance suite design v1.0.0 at packages/arena-capsule/docs/); acceptance record on the issue (comment 6097567345).
6. Next: AR2-003 (workbench, [#5](https://github.com/payswapdotorg/arena-2.0/issues/5)) — the remaining Wave-1 lane; AR2-005 (durable store, [#7](https://github.com/payswapdotorg/arena-2.0/issues/7)) is the unblocked Wave-2 frontier (dependencies = AR2-002 ✅). Worker dispatch re-arms when OpenRouter credits allow worker-grade max_tokens.
7. Track all 16 WOs through spec/work-orders/dispatch-ledger.md and their [GitHub Issues](https://github.com/payswapdotorg/arena-2.0/issues).

## GitHub issue map

The architecture setup was merged as [PR #1](https://github.com/payswapdotorg/arena-2.0/pull/1). The implementation work orders have one matching issue each; creation does not mean a work order is dispatched or its dependencies are satisfied.

| Work Order | Issue                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| AR2-000    | [#2 — Fork baseline and inherited surface inventory](https://github.com/payswapdotorg/arena-2.0/issues/2)                        |
| AR2-001    | [#3 — Freeze Arena domain/public contracts and state machines](https://github.com/payswapdotorg/arena-2.0/issues/3)              |
| AR2-002    | [#4 — Arena API edge and generic lifecycle use cases](https://github.com/payswapdotorg/arena-2.0/issues/4)                       |
| AR2-003    | [#5 — Requester, expert and reviewer workbench](https://github.com/payswapdotorg/arena-2.0/issues/5)                             |
| AR2-004    | [#6 — Capsule contracts, provider seam and isolation conformance](https://github.com/payswapdotorg/arena-2.0/issues/6)           |
| AR2-005    | [#7 — Durable persistence, idempotency, transactional outbox and jobs](https://github.com/payswapdotorg/arena-2.0/issues/7)      |
| AR2-006    | [#8 — Bind Arena workbench to real API](https://github.com/payswapdotorg/arena-2.0/issues/8)                                     |
| AR2-007    | [#9 — Evidence capture and proof-class validator pipeline](https://github.com/payswapdotorg/arena-2.0/issues/9)                  |
| AR2-008    | [#10 — Expert capability, qualification, matching and conflict checks](https://github.com/payswapdotorg/arena-2.0/issues/10)     |
| AR2-009    | [#11 — Expert Arena, self-evaluation, independent review and adjudication](https://github.com/payswapdotorg/arena-2.0/issues/11) |
| AR2-010    | [#12 — Test-mode payment ledger and outcome-linked payout](https://github.com/payswapdotorg/arena-2.0/issues/12)                 |
| AR2-011    | [#13 — Typed SDK, MCP, signed webhooks and generic integration](https://github.com/payswapdotorg/arena-2.0/issues/13)            |
| AR2-012    | [#14 — Integrated vertical end-to-end and next-expert path](https://github.com/payswapdotorg/arena-2.0/issues/14)                |
| AR2-013    | [#15 — Operations, capacity, retention and observability](https://github.com/payswapdotorg/arena-2.0/issues/15)                  |
| AR2-014    | [#16 — Rights-gated learning and Agent Body/version marketplace](https://github.com/payswapdotorg/arena-2.0/issues/16)           |
| AR2-015    | [#17 — Integrated security, resilience, accessibility and release gate](https://github.com/payswapdotorg/arena-2.0/issues/17)    |
