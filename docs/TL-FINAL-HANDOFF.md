# Arena 2.0 — Final Tech Lead Handoff

Status: owner-approved architecture; code implementation still NOT STARTED / NOT VERIFIED.
Repository: payswapdotorg/arena-2.0
Upstream base: zai-org/ZCode, commit 29628c9acdb81b703bbd4080c207a0e7ce5e276e
Architecture: A2.0 / SA1.0
Maximum concurrent implementation workers: three

This handoff is complete and repo-native. Do not depend on chat history, a prior Arena repository, or hidden decisions. Use the repository's canonical documents and live source/CI as the only truth.

## 1. Read and obey these in order

1. AGENTS.md — execution rules and inherited ZCode engineering guidance.
2. spec/PROJECT-STATE.md — exact baseline, implemented status, gaps and current frontier.
3. spec/architecture-lock.md — binding product/security/authority rules.
4. docs/architecture/ARENA-2.0-SYSTEM-ARCHITECTURE.md — runtime, modules, entities, state and data flows.
5. spec/contracts/escalation-lifecycle.md — request, event, result, commands, state ownership and invariants.
6. spec/verification/proof-and-payment-policy.md — proof classes and payment trigger.
7. spec/expert-arena/expert-arena.md — Expert Arena, own-solution self-evaluation, reviewer independence and adjudication.
8. spec/testing/acceptance-gates.md — mandatory tests.
9. spec/work-orders/implementation-plan.md — work order scope/dependencies/acceptance.
10. spec/work-orders/dependency-graph.md — dispatch readiness and concurrency.
11. spec/ownership/ownership-map.md — write fences.
12. spec/decisions/ADR-0001-zcode-foundation.md — approved reuse and separation decision.

If anything conflicts, stop only the affected work and raise an ACR. Do not ask the project owner to restate a decision already captured here.

## 2. Start by checking the actual repository

- Verify the default branch, base SHA, open PRs, branch-protection rules, CI requirements and remote HEAD. Do not assume the setup branch was merged until live GitHub says so.
- Run the inherited workspace-freshness check, clean install/bootstrap, typecheck, lint, format and architecture checks. Confirm actual commands against package.json and the installed upstream scripts. Find the real test entry points; do not invent a root test command.
- Record OS, Node/pnpm versions, SHA, commands, test counts, failures and known inherited failures in a baseline evidence file linked from PROJECT-STATE.
- Inventory actual route mounts, workspace packages, auth/session models, execution entry points, persistence, remote/RPC paths and all relevant plugin/MCP hooks.
- Review upstream NOTICE.md, LICENSE, third-party notices and execution-risk declarations. Preserve them and explicitly decide what carries into each shipped artifact.
- Create no Arena runtime modules merely to match a diagram. First inspect current workspace boundaries; write an implementation map from the approved logical modules to actual paths.
- Confirm main CI and protection rules after the setup docs merge. Require CI gates and review policy if the repository's governance options support them. Report unavailable features honestly.

## 3. Product outcome to build first

A generic, non-Epoch application calls a real Arena API with a versioned task, constraints, budget, acceptance criteria and proof policy. Arena persists the accepted request; matches and assigns an eligible expert; provisions a bounded isolated capsule; records observable changes and evidence; evaluates the submission under the correct proof class; returns a typed result; and changes payment eligibility only when its proof policy is satisfied.

Use a test payment adapter only. The initial end-to-end demonstration must include:
1. A controlled software task whose baseline does not compile or fails an exact agreed test.
2. An expert intervention that changes a versioned candidate.
3. A trusted, task-bound validator rerun that passes the predefined acceptance condition.
4. Durable evidence linking baseline, patch, toolchain, validator and exact outcome.
5. One and only one test-mode payment release operation tied to the accepted attempt.
6. A second scenario where the first expert fails; the attempt and evidence are retained, payment is not released for that attempt, and the next eligible expert may try within the authorized aggregate budget.
7. A P2 task whose truth is not established by an application predicate; it must not release from self-evaluation or popularity alone and must pass independent review/adjudication.
8. Recovery and duplicate tests with at least two API processes and two workers.

A successful compile establishes the compile/test criteria actually specified. It does not automatically establish security, maintainability, professional safety or every other possible claim. The criteria need to be frozen and scoped before the work starts.

## 4. Do not skip the baseline / contract freeze

AR2-000 and AR2-001 are TL-owned and serialized. Do not dispatch implementation workers until:
- the actual ZCode baseline is measured;
- app/domain boundaries and path owners are verified;
- request, acceptance-criteria, proof-policy snapshot, attempt, capsule manifest, evidence, result and event schemas are frozen;
- state transitions and error semantics are documented;
- idempotency/outbox/persistence ports are agreed;
- worker scope fences and contract test vectors exist.

Workers may prepare mock fixtures or inspect assigned paths in parallel, but must not implement against a guessed or mutable contract.

## 5. First worker wave

After the contract freeze, dispatch no more than three disjoint PRs:

- Worker 1, AR2-002: Arena API transport/use-case adapter and conformance tests. Owns its fenced API paths, not root manifests, DB migrations, UI or capsule implementation.
- Worker 2, AR2-003: requester/expert/reviewer workbench on frozen mocks and schemas. Owns Arena UI routes/components/tests, not state authority or API schema.
- Worker 3, AR2-004: capsule contract/provider seam and conformance/security tests. Owns capsule paths, not API routes, payment decisions or root manifests.

Record the worker identities, issue IDs, branch names, exact base SHA, file fences, dependencies, acceptance evidence and PR links in the active dispatch ledger. One WO = one issue = one branch = one PR. Merge only after fresh-base integration and relevant gate checks pass.

Second wave: AR2-005 durable relational persistence/outbox/jobs, AR2-006 real UI API bindings and AR2-007 evidence/validator pipeline, with the contract and path fences in the work-order document. Later waves add matching, Expert Arena, test payments, SDK/MCP/webhooks, generic integration, operations and rights-gated learning.

The TL may pull a ready independent task forward only if the dependency graph remains valid and write surfaces remain disjoint. Three parallel workers is a maximum, not a target; quality and mergeability take precedence.

## 6. Payment rule: do not improvise

Follow spec/verification/proof-and-payment-policy.md without exceptions:
- P0 deterministic application proof: pinned baseline plus task-bound post-intervention verification; only accepted criteria become payment-eligible.
- P1 variable application-observable proof: apply the prespecified repetitions and aggregate thresholds; flaky or inconclusive results do not pass.
- P2 Arena-adjudicated work: versioned rubric, independent qualified reviewers, conflict checks, quorum and adjudication thresholds.
- P3 delayed/external outcomes: hold/milestone/observation policy defined before the work begins.

Failed or inconclusive attempts do not pay by automatic success. They may route to the next eligible expert within the aggregate budget. The ledger, payout operation, provider settlement and actual balance reconciliation are separate states. Only a unique, durable operation may unlock or execute a transfer. Keep live-money transfer disabled until written release-owner approval and jurisdiction/provider/commercial controls are recorded.

## 7. Expert Arena rule

The author expert must be able to produce a structured self-evaluation covering each criterion, claims, evidence, confidence, assumptions, limitations and validator result. It is stored as an immutable candidate-version artifact. It is not an independent vote, does not count toward the review quorum and cannot trigger payment.

Independent reviewers must be qualified and conflict-checked. Blind candidate IDs should be used where feasible without removing evidence or professional credentials needed for safe judgement. Reviewer timeout is not approval. Disagreement, conflicts, missing required dimensions or safety concerns trigger replacement/escalation or adjudication. Reviewers score evidence-backed rubric dimensions. Popularity and star averages never override a failing hard criterion or verification result.

## 8. Must-pass resilience/security conditions

Do not call the vertical slice complete until tests cover:
- same idempotency key + same digest returns a durable replay;
- same key + different digest returns typed conflict;
- concurrent request to two API processes creates one logical task;
- process crash after DB commit recovers outbox work;
- two workers cannot own one active job without fencing/lease correctness;
- provider timeout reconciles before retry;
- evidence forgery/replay/wrong-tenant/wrong-attempt rejection;
- capsule command/file/network/credential isolation tested at OS/provider boundary;
- tenant-crossing object and artifact IDs fail closed;
- Expert Arena self-vote and conflict routes rejected;
- failed first attempt to next eligible expert is bounded and traceable;
- duplicate payment/webhook/release commands produce no duplicate transfer;
- demo state never enters customer state.

## 9. Definition of done per PR

- Exact base/head SHA and scoped files are stated.
- Acceptance criteria map to tests/evidence.
- Typecheck/lint/format and relevant unit/contract/integration/E2E checks run; truthfully report skips or failures.
- Security/privacy/cost and data-retention impact are recorded.
- No hidden dependency, in-memory source of truth, duplicate business logic or silent contract change is introduced.
- Fresh-main intake passes and no unrelated changes are merged.
- PROJECT-STATE, work-order status and dependency frontier are updated in the same PR or coordinated TL integration change.
- Known limitations remain explicit.
- PR is not merged solely because a worker says complete.

## 10. Final launch decision

The production gate cannot be GO until applicable acceptance gates are evidenced, critical/high findings are closed or formally accepted by an authorized owner where allowed, isolation is proven, real persistence and recovery are proven, application/Expert Arena paths pass, payment reconciliation is tested, and commercial/legal release responsibilities are written down.

Architecture branch/document setup and successful CI on documentation do not mean the product is implemented or production-ready.
