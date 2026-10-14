# Arena 2.0 Project State

Last reconciled: 2026-10-13
Repository: https://github.com/payswapdotorg/arena-2.0
Base: fork of zai-org/ZCode
Pinned base commit: 29628c9acdb81b703bbd4080c207a0e7ce5e276e
Architecture: A2.0 / SA1.0
Work-order registry: spec/work-orders/implementation-plan.md
Maximum implementation workers: three plus Tech Lead

## Current status

**Architecture approved; core implementation AR2-000 through AR2-015 accepted with linked CI and integration evidence — the core roadmap (16 of 19 work orders) is COMPLETE. Production release decision RECORDED: NOT_GO (machine, evidence-backed) — OS-level capsule isolation unproven, cross-platform install and accessibility E2E outstanding; untrusted execution and live-money payments stay disabled. A limited-scope release (Linux, test-mode finance, no untrusted execution) may be authorized separately by the release owner on the recorded basis: docs/evidence/release/AR2-015-gate-report-2026-10-11.md. The capability-acquisition extension is COMPLETE: AR2-016 (ACQ1.0 acquisition contracts + provider router) ACCEPTED 2026-10-11 — PR #48 squash-merged ddea6e48; AR2-017 (SCRP1.0 scraper factory, crawler runtime, external API adapters) ACCEPTED 2026-10-12 — PR #49 merged 12043d0; AR2-018 (UPG1.0 evidence-to-capability packaging, evaluation and controlled learning) ACCEPTED 2026-10-12 — PR #50 squash-merged e0eed65, CI green first-run, issues #32/#33/#34 all closed. Roadmap: 19/19 accepted — the registered work-order roadmap is COMPLETE. Production-readiness release plan (WO3.0) COMPLETE: AR2-019 (PR #58 squash 0004d10), AR2-020 (PR #56 squash 8a925dc), AR2-021 (PR #59 squash 564d464), AR2-022 (PR #61 squash 6f3a34f) ACCEPTED, plus MAINT-001 (PR #60 squash e1b6ea4); AR2-023 (issue #55, PR #62 squash 71c7d63) delivers the release-decision instrument — RGR1.0 deterministic gate recomputation + RDR1.0 versioned decision record + amendment chain + the authorization workflow (docs/evidence/release/AR2-023-authorization-workflow-2026-10-14.md). The production release decision REMAINS NOT_GO: the instrument authorizes nothing, and a GO requires the release owner to commit a valid decision record per the workflow. Live-money payments and untrusted expert/scraper execution stay disabled.**

The initial architecture setup PR #1 is merged. Treat the milestone table, current frontier, accepted work-order records and linked CI/evidence as the live implementation state; do not use historical setup-branch notes as current dispatch authority.

## Product definition

Arena is the Stripe of capability escalation/acquisition for AI automation. A third-party app submits a versioned task or capability-gap request with constraints, budget and proof policy. Arena can route to a qualified human expert, compatible scraper/data provider, approved external API or a policy-permitted combination; it records evidence, validates results and returns a typed outcome. Any reusable data/learning is a separate rights-, provenance- and evaluation-gated flow. The capability-acquisition extension (ACR-0002) is COMPLETE and ACCEPTED: AR2-016 delivered the ACQ1.0 contract family and provider router (packages/arena-acquisition), AR2-017 the SCRP1.0 scraper factory, crawler runtime and external API adapters (packages/arena-scraper), and AR2-018 the UPG1.0 evidence-to-capability packaging, evaluation and controlled-learning flow (packages/arena-upgrade).

## Canonical authority

Read in order:

1. AGENTS.md — repo-level operating and coding rules.
2. spec/PROJECT-STATE.md — current status, known gaps and frontier.
3. spec/architecture-lock.md — normative non-negotiable rules.
4. docs/architecture/ARENA-2.0-SYSTEM-ARCHITECTURE.md — system architecture.
5. spec/verification/proof-and-payment-policy.md — proof classes and payout gating.
6. spec/expert-arena/expert-arena.md — author self-evaluation, independent competition reviews and adjudication.
7. spec/contracts/escalation-lifecycle.md — contract/state-machine requirements.
8. spec/work-orders/implementation-plan.md, dependency-graph.md and release-plan.md — work order scopes, concurrency and the production-readiness release plan.
9. spec/ownership/ownership-map.md — frozen write surfaces and integration ownership.
10. spec/testing/acceptance-gates.md — mandatory verification and release gates.
11. docs/TL-FINAL-HANDOFF.md — executable TL dispatch and final acceptance instructions.
12. Code, tests, migrations and CI — implementation truth, not a reason to leave a spec contradiction unresolved.
13. spec/decisions/ACR-0002-capability-acquisition.md and spec/capability-acquisition/scraper-factory-and-capability-routing.md — scope, safety rules and work-order dependencies for the scraper/provider-routing extension.

If these documents conflict, halt the affected implementation and update them in one reviewed Architecture Change Request. Do not ask the owner to repeat a decision already present here. This repository, not conversation history, is the sole source of truth.

## Milestones

| Milestone                                                             | Status                                                                                                                                                                                     | Evidence / outstanding gate                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0: Fork baseline inventory                                           | ✅ ACCEPTED                                                                                                                                                                                | Issue #2 closed; PR #21 merged; clean-clone evidence report records the inherited limitations.                                                                                                                                                                        |
| M1: Contract freeze and governance                                    | ✅ ACCEPTED                                                                                                                                                                                | Issue #3 closed; PR #24 merged; frozen CF1.0 schemas/state machines/vector suite and CI governance.                                                                                                                                                                   |
| M2: Core vertical slice                                               | ✅ ACCEPTED / COMPLETE                                                                                                                                                                     | AR2-000–014 accepted; core closed out by AR2-015 (security/resilience/release gate, PR #47) — PR #44 records real-process acceptance profiles for P0 payout, failed-first-expert routing, P2 adjudication and multi-process crash recovery.                                                                                           |
| M3: Durable multi-instance runtime                                    | ✅ ACCEPTED within tested scope                                                                                                                                                            | AR2-005, AR2-013 and AR2-012 evidence durable shared state, two API processes and SIGKILL/restart recovery using the current SQLite reference engine. Do not infer production-scale database readiness beyond tested scope.                                           |
| M4: Secure capsule execution and evidence provenance                  | IMPLEMENTED (AR2-019, PR #58 squash 0004d10; MAINT-002, PR #65 squash 21287c2) — release-target strict-mode conformance instrument now GREEN on shared-host stations                                                                                                        | LinuxNamespaceIsolationProvider in @arena/isolation: bwrap mount/pid/net/user namespaces, syscall filtering, resource ceilings, isolated fs/process views, deny-by-default networking; adversarial escape battery green in a worker environment with bubblewrap (60/60 incl. nproc-ceiling suite); TL station (bwrap 0.13.0, ambient uid count ~170-199) 60/60 with strict-mode-evidence 3 PASS + 7 DENIED_EXPECTED, 0 FAIL after MAINT-002 (was 29/45 with 16 EAGAIN failures at base). Untrusted expert/scraper execution stays DISABLED until strict-mode conformance passes on the release-gate environment AND the owner records the enabling decision through the AR2-023 instrument.                                                        |
| M5: Expert Arena and non-application-verifiable adjudication          | ✅ ACCEPTED within tested scope                                                                                                                                                            | AR2-009 accepted in PR #42; AR2-012 profile C integrates independent review/adjudication for a P2 scenario.                                                                                                                                                           |
| M6: Test-mode financial workflow                                      | ✅ ACCEPTED                                                                                                                                                                                | AR2-010 accepted in PR #39; AR2-012 validates exactly-once test payout and failed-attempt non-payment. Live-money mode remains disabled.                                                                                                                              |
| M7: Rights-gated learning and Body marketplace                        | ✅ ACCEPTED within tested scope                                                                                                                                                            | AR2-014 accepted in PR #45; rights fail closed, provenance is append-only, BodyVersions immutable, certification is bound to tested composition/policy/environment/scope.                                                                                             |
| M8: Production-readiness decision                                     | DECISION RECORDED — NOT_GO (production) per the AR2-015 gate report (machine decision blocked_core_gate; owner authorization open; limited-scope release available to an authorized owner) | Complete applicable gate evidence, actual isolation proof, residual-finding disposition and explicit authorized release decision remain the requirements for any future GO; the classified evidence lives at docs/evidence/release/AR2-015-gate-report-2026-10-11.md. WO3.0 accepted 5/5 (AR2-019 #58, AR2-020 #56, AR2-021 #59, AR2-022 #61, AR2-023 #62/71c7d63) + MAINT-001 #60; the standing owner-decision instrument (RGR1.0 recomputation + RDR1.0 record, per docs/evidence/release/AR2-023-authorization-workflow-2026-10-14.md) is the recorded path for any GO/HOLD. |
| M9: Capability-gap acquisition (scrapers, API providers and learning) | ✅ ACCEPTED / COMPLETE                                                                                                                                                                    | ACR-0002 merged through PR #35; AR2-016 (#32, PR #48 ddea6e48), AR2-017 (#33, PR #49 12043d0) and AR2-018 (#34, PR #50 e0eed65) all ACCEPTED 2026-10-11/12 — the extension is implemented and evidenced; tested scope excludes live external services (mock-server adapters) per the acceptance records.                             |

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

1. **Core complete: AR2-000 through AR2-015 accepted (16 of 19 work-order IDs, inclusive).** The final core WO AR2-015 landed as [PR #47](https://github.com/payswapdotorg/arena-2.0/pull/47) (squash 7d117f1; CI battery green) with the typed G0–G8 gate registry, four adversarial profiles on real surfaces and the classified gate report `docs/evidence/release/AR2-015-gate-report-2026-10-11.md`.
2. **Core release decision recorded: NOT_GO (production).** Machine decision `blocked_core_gate` — OS-level capsule isolation BLOCKED (the synthetic provider is explicitly not isolation evidence), cross-platform install proof BLOCKED, accessibility E2E coverage BLOCKED. Untrusted expert/scraper execution and live-money payments stay disabled. A limited-scope release (Linux, test-mode finance, no untrusted execution) may be authorized separately by the release owner with the gate report as the recorded basis.
3. Do not reopen accepted work unless new evidence identifies a defect; create a scoped fix in the owning module.
4. **Post-core extension frontier: COMPLETE.** ACR-0002 is merged via PR #35; its three work orders are all ACCEPTED — AR2-016 (#32, PR #48 ddea6e48), AR2-017 (#33, PR #49 12043d0), AR2-018 (#34, PR #50 e0eed65). The registered 19/19 roadmap is complete. New work requires a newly registered work order with the TL's dependency/capacity/base-SHA/write-fence verification; no silent scope expansion into core AR2-012 acceptance.
5. **Production-readiness extension (WO3.0): COMPLETE 2026-10-13 — all five work orders accepted** (AR2-019 #58 / AR2-020 #56 / AR2-021 #59 / AR2-022 #61 evidence + AR2-023 #62 decision instrument; MAINT-001 #60 lane fix). The remaining frontier is OWNER DECISIONS AND INFRASTRUCTURE, not implementation: macOS/Windows install runner evidence (grg_00000002 — the AR2-020 harness is ready, runners are the missing input), release-target strict-mode isolation conformance (grg_00000008 — the AR2-019 runtime is merged and MAINT-002 fixed the shared-host nproc collision: the instrument is now reproducible on shared-host gate stations, TL-verified 0 FAIL; the release-gate environment still needs bubblewrap provisioned), accessibility scope disposition (grg_00000013 — extend coverage to developer/operations surfaces or record the owner-accepted residual risk), operator IdP choice, and the recorded release decision itself — each through the AR2-023 workflow. Registration-era sequencing lived in spec/work-orders/release-plan.md; no release is authorized, and live-money and untrusted execution stay disabled.
6. Worker-brain status (reconciled 2026-10-12): the 2026-10-10 OpenRouter/DashScope outage is historical; capacity is provided by chat.z.ai agent sessions (GLM-5.3, Full-Stack) dispatched via the replay stack, proven by the AR2-016/017/018 acceptance records (three dispatched WOs, merged PRs #48/#49/#50). Verify identities and runs live before relying on capacity.

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
| AR2-016    | [#32 — Capability-gap acquisition contract and provider router](https://github.com/payswapdotorg/Arena-2.0/issues/32)            |
| AR2-017    | [#33 — Scraper Factory, crawler runtime and external API adapters](https://github.com/payswapdotorg/Arena-2.0/issues/33)         |
| AR2-018    | [#34 — Evidence-to-capability packaging and controlled learning](https://github.com/payswapdotorg/Arena-2.0/issues/34)           |
| AR2-019    | [#51 — OS-level capsule isolation conformance and untrusted-execution gate](https://github.com/payswapdotorg/Arena-2.0/issues/51) |
| AR2-020    | [#52 — Cross-platform install evidence (macOS and Windows)](https://github.com/payswapdotorg/Arena-2.0/issues/52)              |
| AR2-021    | [#53 — Accessibility end-to-end coverage](https://github.com/payswapdotorg/Arena-2.0/issues/53)                                  |
| AR2-022    | [#54 — Production identity adapter (tenant isolation beyond demo auth)](https://github.com/payswapdotorg/Arena-2.0/issues/54)    |
| AR2-023    | [#55 — Release-owner decision record and authorization workflow](https://github.com/payswapdotorg/Arena-2.0/issues/55)           |
| MAINT-002  | [#64 — RLIMIT_NPROC ambient-count collision on shared-host stations](https://github.com/payswapdotorg/Arena-2.0/issues/64)        |
