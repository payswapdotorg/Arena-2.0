# Arena 2.0 Architecture Lock

Status: OWNER-APPROVED; implementation has not yet been verified.
Version: A2.0
Canonical implementation repository: payswapdotorg/arena-2.0
Upstream base: zai-org/ZCode at 29628c9acdb81b703bbd4080c207a0e7ce5e276e
Last reconciled: 2026-10-09

This document is normative. When an implementation detail conflicts with it, stop the affected work, open an Architecture Change Request (ACR), and do not silently redefine the rule. Product behavior, state ownership, public contracts, and acceptance criteria live in this repository, not in chat history.

## Product and boundary rules

1. Arena is human-expert escalation infrastructure for AI applications. The public Escalation API is the product boundary.
2. Epoch is one integrator, not a privileged semantic authority. Generic applications must use the same contracts.
3. Reuse ZCode for its desktop/web shell, shared UI, terminal and agent-runtime foundations, RPC and reusable platform services. Do not create an Arena business domain inside ZCode's existing service internals.
4. Arena owns escalation lifecycle, capability demand, expert matching, sessions/capsules, interventions, verification/adjudication, commercial records, learning proposals and network quality.
5. Use a modular monolith with separately runnable API, worker and capsule-host processes where separation is required. Do not create microservices without an ADR proving a concrete deployment, isolation or scaling need.
6. Every durable fact has one authoritative writer. UI state, caches, events, projections, search indexes and provider objects are not alternative authorities.
7. Authenticated principal, tenant, acting identity, role/lens and authorization decision are distinct. Role/lens context is never authorization.
8. Customer applications retain authority over their live worlds, accounts, repositories, deployments and business state. Arena may return a proposal/result; application-specific apply/commit is a separate explicit act owned by the caller.
9. ZCode workspaces, Git worktrees, browser contexts and process separation alone do not establish system-level isolation. Untrusted expert work requires a validated capsule isolation provider.
10. Agent Body is distinct from Cognitive Substrate. A model is not an expert qualification, not a Body, and not a certified composition.
11. Body versions and accepted evidence must be immutable or append-only where history matters. New learning produces a new version/proposal; it never rewrites prior evidence.
12. Certification applies only to a tested composition, policy, environment and scope. Evaluation, verification, adjudication, certification, qualification and licensure are separate concepts.
13. Observable tool actions, tool inputs/outputs, artifacts, checkpoints, annotations, evidence and corrections may be recorded under policy. Private model chain-of-thought is neither required nor a canonical learning artifact.
14. Immediate customer results and reusable learning artifacts are separate products. Reuse requires explicit rights, provenance, consent where needed, scope, validation and publication approval.
15. Capability discovery, reputation, popularity, expert self-ratings and votes can influence matching or review assignment; none can bypass verification or adjudication.
16. Application-verifiable outcomes may trigger payment only through the proof policy in spec/verification/proof-and-payment-policy.md. Other work requires Arena-owned evidence and stricter adjudication.
17. The author-expert may submit a structured self-evaluation. A self-evaluation is visible evidence but never an independent vote, verifier decision or sole payment trigger.
18. All accepted API commands and long-running jobs need durable identity, correlation, idempotency, bounded retry and explicit failure semantics.
19. Persist critical writes with database transactions. Use a transactional outbox for side effects. Redis, queue services and provider APIs are adapters, not truth authorities.
20. Tenant boundaries and fail-closed authorization are enforced server-side on every read, write, artifact access, capsule action, webhook and financial operation.
21. Payment domain types remain provider-neutral. Sandbox/test payment mode is the default. Live money requires a separate written release decision and commercial/legal readiness record.
22. Safety, privacy, professional limits, jurisdiction, conflicts of interest, licensing and data reuse constraints are explicit task metadata and policy inputs.
23. Demo fixtures never enter customer or production state. Demo mode must be visibly labelled and deterministic.
24. Replay and evidence viewing are observational. Re-running a recorded tool action requires a separate explicit command against an isolated environment.
25. Existing upstream license, notices, dependency notices, attribution and security disclosures must be retained and updated. Arena changes do not erase inherited ZCode terms.
26. All provider-specific SDK types stay in adapter or host packages. Domain/application contracts are provider-agnostic.
27. Root manifests, workspace globs, lockfiles, shared contract generation and release version are serialized TL-owned surfaces.
28. A single source of truth is mandatory: architecture, status, decisions, work orders, ownership, test evidence and current frontier are committed here.
29. A successful build is necessary but never sufficient for product, security, durability, UX or release acceptance.
30. Every feature change includes behavior tests. Every cross-process or external side-effect path includes failure, retry and duplicate-delivery tests appropriate to its risk.
31. High-risk or professional domains cannot treat a software predicate as sufficient evidence of real-world correctness when that predicate does not establish the actual claimed outcome.
32. Expert Arena is an evaluation route that produces structured candidate submissions, blind independent reviews where feasible, conflict-checked evidence and adjudication. Competition does not replace the canonical verification authority.
33. Work orders must respect the dependency graph, fixed write surfaces and acceptance gates. Three workers may operate concurrently only when dependencies and ownership make integration safe.
34. Missing, uncertain, contradictory, stale or unverifiable evidence must fail closed or move to an explicit review state; it must not be silently interpreted as success.
35. Public contracts are versioned and schema-validated at runtime, not only typed at compile time.
36. A cancellation request, timeout, browser close or disconnected worker does not imply that external side effects were rolled back.

## Required Architecture Change Request

An ACR must state: motivating requirement; current and proposed rule; options considered; threat/privacy/commercial impact; affected contracts and data; migration and compatibility strategy; testing and observability; dependency and work-order changes; owner; acceptance criteria; and approval. Update this lock, architecture document, state, dependency graph and handoff in one reviewed change. No worker may approve their own ACR.

## Highest-priority invariants

- No result may be considered proven merely because an expert says it is correct.
- No payment may be released from an unverified, replayed, cross-tenant or self-approved claim.
- No customer's production system may be mutated by an expert capsule.
- No customer data may be reused for general learning without explicit authorization.
- No accepted task may disappear because an API process restarts.
