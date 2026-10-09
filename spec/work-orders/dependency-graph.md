# Arena 2.0 Work-Order Dependency Graph

The graph is normative alongside spec/work-orders/implementation-plan.md. Edges mean the downstream order cannot be accepted until the upstream contract/output is available. A worker may start test fixtures or isolated scaffolding earlier only if it cannot bake in an unapproved interface.

~~~text
AR2-000 Fork baseline / inventory [TL]
        |
        v
AR2-001 Contract freeze / domain state machines [TL]
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
                   ^                                ^
                   |                                |
                   +---------------- AR2-006 -------+
                         UI binds API       |
                                             AR2-004
                   |
        +----------+----------------+------------------+
        |                           |                  |
        v                           v                  v
AR2-008 Matching            AR2-009 Expert Arena   AR2-010 Test payments
        |                           ^                  |
        +---------------------------+------------------+
                                    |
                                    v
                     AR2-011 SDK/MCP/webhooks
                                    |
                                    v
                       AR2-012 Vertical E2E harness
                         |                    |
                         v                    v
             AR2-013 Ops/resilience    AR2-014 Rights-gated learning
                                             /
                                            /
                           v                v
                     AR2-015 Integrated acceptance
~~~

## Dependency corrections and readiness rules

- AR2-005 depends on the frozen persistence/outbox port and API/domain contract, not on a specific UI component. API shell and persistence can be separate branches if the interface is frozen.
- AR2-006 can be built against documented schemas and mocks, but replacing mocks and claiming integration requires AR2-002 and AR2-005.
- AR2-007 can implement envelope normalization and synthetic validator tests after contracts and capsule port are frozen. Real validator execution requires the capsule isolation gate.
- AR2-008 requires accepted task/attempt state and durable budget semantics.
- AR2-009 requires candidate/evidence schema, expert qualification and conflict checks. It must not create an independent payout or correctness authority.
- AR2-010 requires durable budget/payment records and proof-decision contract. It does not require a live payment provider.
- AR2-011 requires stable public API and durable outbox/job retry semantics.
- AR2-012 is an integration gate, not an excuse to implement parallel fake versions of modules.
- AR2-014 cannot publish customer-derived assets until provenance, rights and consent contracts are in place.
- AR2-015 cannot run until a runnable integrated path exists, but threat-model work can begin sooner on an isolated docs-only scope.

## Three-worker governance

Every dispatch includes:
- branch name and exact base SHA;
- issue number and work-order ID;
- one-sentence scope and explicit file/path write fence;
- upstream/downstream contract dependencies;
- expected test commands and acceptance evidence;
- named worker and TL integrator;
- prohibited shared surfaces;
- lockfile/schema integration plan.

Recompute the graph after every merge. If one worker finds a contract gap, the worker records an interface-change proposal and continues only on unaffected scoped work. TL issues a contract revision/ACR if needed; no worker silently edits another lane's contract.

## Merge ordering

Merge only after the owning worker's tests and fresh-base integration checks pass. Re-run relevant boundary/contract tests after every integration of API + persistence + capsule + verification. The first product demo is not called complete until AR2-012 proves the application can fail on attempt one, route to the next eligible expert and then produce either a validated result or an explicit terminal failure without losing audit history or exceeding budget.
