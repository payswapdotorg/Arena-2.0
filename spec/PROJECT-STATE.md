# Arena 2.0 Project State

Last reconciled: 2026-10-09
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

| Milestone | Status | Evidence required |
|---|---|---|
| M0: Fork baseline inventory and reproducible checks | NOT STARTED | Exact SHA, clean install/build/test baseline, source/license inventory, CI evidence |
| M1: Contract freeze and architecture governance | DOCUMENTED / VERIFY ON MAIN | Reviewed contracts, state machines, work orders, ownership map and dependency gate |
| M2: Vertical slice: real generic client → API → expert attempt → validator → result | NOT STARTED | End-to-end trace using real process/network path and durable records |
| M3: Durable multi-instance runtime | NOT STARTED | restart/concurrency/outage/recovery evidence |
| M4: Secure capsule execution and evidence provenance | NOT STARTED | isolation and tenant-boundary proofs |
| M5: Expert Arena and non-application-verifiable adjudication | NOT STARTED | self-evaluation, blind review, quorum, conflict and dispute tests |
| M6: Test-mode financial workflow | NOT STARTED | ledger, duplicate release, reconciliation and refund/dispute tests |
| M7: Rights-gated learning and Body marketplace | NOT STARTED | provenance, rights, evaluation, immutable versions and rejection paths |
| M8: Production-readiness decision | NOT STARTED | every gate classified, live evidence where necessary, explicit release owner approval |

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

1. Verify the architecture setup commit has been reviewed/merged to main.
2. Run the M0 baseline inventory in full; do not begin feature implementation on uninspected modules.
3. Freeze public contracts, escalation state machine, proof policy snapshot, evidence envelope and database boundaries.
4. Start the first three disjoint workstreams per docs/TL-FINAL-HANDOFF.md.
