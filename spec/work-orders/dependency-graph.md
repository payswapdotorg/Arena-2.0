# Arena 2.0 Work-Order Dependency Graph

The graph is normative alongside spec/work-orders/implementation-plan.md. An edge indicates a dependency for acceptance. Preparatory code/tests can begin earlier only where the API contract is frozen and the work is isolated; partial fixture-based work must never be reported as full integration.

## Canonical graph

```text
W0 (TL-owned, serialized)
AR2-000 Fork baseline / inventory
        |
        v
AR2-001 Contract freeze / state machines
        |
        +---------------------+---------------------+
        |                     |                     |
        v                     v                     v
AR2-002 API/use cases   AR2-003 Workbench UI   AR2-004 Capsule seam
        |                     |                     |
        +----------+----------+                     |
                   |                                |
                   v                                v
            AR2-005 Durable store/jobs        AR2-007 Evidence/validators
                   |                                ^
                   |                                |
                   v                                |
            AR2-006 UI/API binding  -----------------+
            (requires API; uses fixture contract tests
             until durable host is accepted)
                   |
        +----------+----------------+------------------+
        |                           |                  |
        v                           v                  v
AR2-008 Matching            AR2-010 Test payments   AR2-011 SDK/MCP/webhooks
        |                           |                  |
        +---------------------------+------------------+
                                    |
                                    v
                          AR2-009 Expert Arena
                      (also requires AR2-007)
                                    |
                                    v
                         AR2-012 Integrated E2E
                  (all API, durable, capsule, evidence,
                   matching, Expert Arena and payment paths)
                                    |
                         +----------+-----------+
                         |                      |
                         v                      v
              AR2-013 Operations         AR2-014 Learning
              (can begin once            (requires accepted
               adapters exist)            E2E and rights path)
                         \                      /
                          \                    /
                           v                  v
                      AR2-015 Integrated acceptance
```

## Dispatch waves (max three workers)

### W0 — TL serial lane

AR2-000 then AR2-001. No feature worker dispatch until the baseline report exists and the contract freeze is accepted.

### W1 — three parallel foundational lanes

- Worker 1: AR2-002 API transport/use-case adapter.
- Worker 2: AR2-003 workbench UI and contract-fixture tests.
- Worker 3: AR2-004 capsule contracts/provider seam and conformance tests.

These lanes have separate write fences. Canonical contracts and public schemas remain TL-owned/frozen.

### W2 — exploit all three slots

Dispatch concurrently:

- Worker 1: AR2-005 durable persistence, outbox and jobs.
- Worker 2: AR2-006 client binding to the stable AR2-002 HTTP contract. The UI tests may use contract-faithful fixtures; full durable E2E is not accepted until AR2-005 has merged.
- Worker 3: AR2-007 evidence/validator pipeline against AR2-004 and the frozen EvidenceEnvelope.

The UI does not own canonical state. The evidence pipeline does not own payout state.

### W3 — three independent product lanes

After the respective dependencies in implementation-plan.md are accepted, dispatch:

- Worker 1: AR2-008 qualification, matching and next-eligible-expert routing.
- Worker 2: AR2-010 test-mode ledger and outcome-linked payment.
- Worker 3: AR2-011 SDK/MCP/webhooks/generic integration.

These three have disjoint domain/adapter fences and can use the same frozen API, durable store, evidence and payment-operation contracts.

### W4 — quality, review and integrated acceptance

- AR2-009 Expert Arena depends on AR2-007 evidence semantics and AR2-008 expert qualification/conflict data; do not dispatch it in parallel with the still-unimplemented qualification/conflict contract it relies on.
- AR2-013 operations can advance once durable jobs, capsule adapters and payment/test adapters exist; it can overlap AR2-009 where write fences remain disjoint.
- AR2-012 final E2E acceptance waits for all required product paths. Harness scaffolding may be prepared earlier but must not be called integrated until the real API, store, capsule, validator, match, Expert Arena, payment and client paths are connected.

### W5 — rights and release gate

- AR2-014 learning publication requires evidence, Expert Arena decision, rights/provenance and accepted integrated path.
- AR2-015 release acceptance is serialized by TL after applicable feature paths and the acceptance-gate evidence are available. Threat-model documentation may start earlier but cannot imply integrated acceptance.

## Corrected dependency rules

- AR2-005 depends on frozen persistence/outbox ports and the AR2-002 application/API contract.
- AR2-006 can bind to the API independently of the persistence adapter. Its full durable end-to-end acceptance still depends on AR2-005.
- AR2-007 depends on AR2-004 plus the frozen evidence envelope and proof policy.
- AR2-008 depends on accepted request/attempt state and durable budget semantics.
- AR2-009 depends on AR2-007 and AR2-008, not merely on an expert profile type; it must use authoritative qualification/conflict decisions.
- AR2-010 depends on AR2-005 and AR2-007 and must not create a parallel correctness authority.
- AR2-011 depends on stable AR2-002 public contracts and AR2-005 durable outbox/retry semantics.
- AR2-012 integrates real paths. Mocks are allowed for unit/contract tests but not as evidence of integrated production behavior.
- AR2-013 needs the actual adapters whose capacity/recovery/retention it observes.
- AR2-014 cannot publish customer-derived learning before rights, consent, provenance, validation and scope are in place.
- AR2-015 cannot be GO until the required gate evidence and residual-finding dispositions exist.

## Dispatch protocol

Every issue/branch/PR record includes exact base SHA, worker identity, dependency evidence, frozen write paths, acceptance scenarios, commands/tests and known limitations. TL must recompute readiness before each dispatch and merge.

Never parallelize root manifests, lockfiles, canonical shared schemas, contract generation or overlapping database migrations. If a shared-surface change is needed, the TL serializes it or opens a specific coordination issue. The next ready independent work may be pulled forward, but dependencies may not be waived informally.


## Capability-acquisition extension — AR2-016 through AR2-018

This is an explicit post-core extension. It does not redefine completion of the core Arena vertical slice and it does not silently add fields to frozen CF1.0.

~~~text
AR2-002 API accepted -----------+
AR2-005 durable runtime accepted+--> AR2-016 contracts/provider router
AR2-008 matching accepted ------+              |
                                               v
AR2-004 capsule accepted --------------+   AR2-017 Scraper Factory /
AR2-005 durable jobs accepted ---------+--> crawler + API adapters
AR2-016 route contract accepted -------+              |
                                                      v
AR2-007 evidence accepted --------------------+  AR2-018 Dataset-to-
AR2-014 rights-gated learning accepted -------+-> capability pipeline
AR2-016 router accepted ----------------------+     + before/after evaluation
AR2-017 scraper runtime accepted -------------+
~~~

- AR2-016: a new versioned acquisition contract and router. Existing CF1.0 requests/envelopes remain frozen; any shared-contract change requires a reviewed ACR, compatibility vectors and an explicit migration/version decision.
- AR2-017: use Crawlee as the initial open-source runtime substrate, plus an optional Apify API adapter and provider-neutral external API connectors. No scraper runs in the API process or an unverified synthetic capsule.
- AR2-018: convert acquired data to a retrieval/index/knowledge/tool/rules capability or, only with approval and proven rights, training data; require source provenance and gap-specific before/after evaluation.
- Modes are explicit: PINNED_PROVIDER, ANY_COMPATIBLE_PROVIDER, AUTO. Candidate eligibility checks for authorization, rights, output schema, budget, quotas and deadline precede ranking. AUTO may choose scraper, API or human only within policy.
- Worker fences are recorded per issue before dispatch. Shared contract, persistence, root manifest, lockfile and migration changes stay TL-owned.
- Security/quality blockers (SSRF, untrusted page prompt injection, restricted sources, unclear rights, cross-tenant access, quota exhaustion or failed evaluation) fail closed; they never become an implicit paid/human fallback.

