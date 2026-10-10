# Arena 2.0 Dispatch Ledger

This is the canonical record of active and completed work-order dispatches. Update it in the same integration step that opens/merges each work order. It complements GitHub Issues/PRs and never replaces their URLs.

## Current bootstrap state

| Field | Value |
|---|---|
| Architecture setup | [PR #1 merged to main](https://github.com/payswapdotorg/arena-2.0/pull/1), merge SHA 78a64381662ed7c2c6818ed280823c57be57c7c6 |
| Baseline source commit | 29628c9acdb81b703bbd4080c207a0e7ce5e276e |
| Baseline inventory AR2-000 | EVIDENCE EXECUTED 2026-10-10 — [report](../docs/evidence/baseline/AR2-000-baseline-report-2026-10-10.md), classification PASS WITH EXISTING FAILURES; acceptance PR in flight |
| Contract freeze AR2-001 | UNBLOCKED PENDING AR2-000 MERGE — acceptance rubric defined in [ar2-001-acceptance.md](ar2-001-acceptance.md) |
| Feature dispatch | NOT AUTHORIZED UNTIL AR2-001 ACCEPTED |
| Concurrent worker slots | 3 maximum; currently none assigned |
| Live payment mode | DISABLED |
| Production capsule provider | NOT APPROVED / NOT VERIFIED |

Replace this table only with evidence-backed status. PR #1 and the issue-registration PR #18 are merged. The initial bootstrap documents are canonical on main; implementation status remains NOT STARTED until work orders produce accepted code/evidence.

## Active dispatch table

| WO | Issue | Branch | Worker | Base SHA | Write fence | Status | Evidence/PR |
|---|---|---|---|---|---|---|---|
| AR2-000 | [#2](https://github.com/payswapdotorg/arena-2.0/issues/2) | ar2/000-baseline-evidence | TL | 96e3edf48f76987b6682b74fc8d1e8669ca5cfd4 | Baseline inventory/evidence only | EVIDENCE EXECUTED — PR in flight | [AR2-000-baseline-report-2026-10-10.md](../docs/evidence/baseline/AR2-000-baseline-report-2026-10-10.md) |
| AR2-001 | [#3](https://github.com/payswapdotorg/arena-2.0/issues/3) | To be recorded | TL | After AR2-000 acceptance | Contracts/state machines only | RUBRIC DEFINED — execution next | [ar2-001-acceptance.md](ar2-001-acceptance.md) |
| AR2-002 | [#4](https://github.com/payswapdotorg/arena-2.0/issues/4) | To be recorded | Available worker | Current main at dispatch | Work-order fence in issue | PLANNED / DEPENDENCIES NOT MET | None |
| AR2-003 | [#5](https://github.com/payswapdotorg/arena-2.0/issues/5) | To be recorded | Available worker | Current main at dispatch | Work-order fence in issue | PLANNED / DEPENDENCIES NOT MET | None |
| AR2-004 | [#6](https://github.com/payswapdotorg/arena-2.0/issues/6) | To be recorded | Available worker | Current main at dispatch | Work-order fence in issue | PLANNED / DEPENDENCIES NOT MET | None |
| AR2-005 | [#7](https://github.com/payswapdotorg/arena-2.0/issues/7) | To be recorded | Available worker | Current main at dispatch | Work-order fence in issue | PLANNED / DEPENDENCIES NOT MET | None |
| AR2-006 | [#8](https://github.com/payswapdotorg/arena-2.0/issues/8) | To be recorded | Available worker | Current main at dispatch | Work-order fence in issue | PLANNED / DEPENDENCIES NOT MET | None |
| AR2-007 | [#9](https://github.com/payswapdotorg/arena-2.0/issues/9) | To be recorded | Available worker | Current main at dispatch | Work-order fence in issue | PLANNED / DEPENDENCIES NOT MET | None |
| AR2-008 | [#10](https://github.com/payswapdotorg/arena-2.0/issues/10) | To be recorded | Available worker | Current main at dispatch | Work-order fence in issue | PLANNED / DEPENDENCIES NOT MET | None |
| AR2-009 | [#11](https://github.com/payswapdotorg/arena-2.0/issues/11) | To be recorded | Available worker | Current main at dispatch | Work-order fence in issue | PLANNED / DEPENDENCIES NOT MET | None |
| AR2-010 | [#12](https://github.com/payswapdotorg/arena-2.0/issues/12) | To be recorded | Available worker | Current main at dispatch | Work-order fence in issue | PLANNED / DEPENDENCIES NOT MET | None |
| AR2-011 | [#13](https://github.com/payswapdotorg/arena-2.0/issues/13) | To be recorded | Available worker | Current main at dispatch | Work-order fence in issue | PLANNED / DEPENDENCIES NOT MET | None |
| AR2-012 | [#14](https://github.com/payswapdotorg/arena-2.0/issues/14) | To be recorded | Available worker | Current main at dispatch | Work-order fence in issue | PLANNED / DEPENDENCIES NOT MET | None |
| AR2-013 | [#15](https://github.com/payswapdotorg/arena-2.0/issues/15) | To be recorded | Available worker | Current main at dispatch | Work-order fence in issue | PLANNED / DEPENDENCIES NOT MET | None |
| AR2-014 | [#16](https://github.com/payswapdotorg/arena-2.0/issues/16) | To be recorded | Available worker | Current main at dispatch | Work-order fence in issue | PLANNED / DEPENDENCIES NOT MET | None |
| AR2-015 | [#17](https://github.com/payswapdotorg/arena-2.0/issues/17) | To be recorded | Available worker | Current main at dispatch | Work-order fence in issue | PLANNED / DEPENDENCIES NOT MET | None |

No Worker 1/2/3 assignment is active until AR2-001 is accepted.

## Dispatch record format

For every work order, add a row and record these fields in the matching issue body:
- WO ID and canonical spec link.
- Exact target main SHA and worker branch name.
- Assigned worker/agent identity and TL integrator.
- Dependencies and evidence that each dependency is accepted.
- Allowed paths and forbidden shared files.
- Public contract/schema version.
- Acceptance scenarios and required tests.
- Commands executed and exact outcomes.
- CI URL, PR URL, head SHA, review state and merge SHA.
- Known limitations, unresolved findings and release-gate impact.

## Concurrency rules

- Never have two open work orders writing the same file/path unless a written TL merge plan explicitly serializes the overlapping edits.
- Root package manifests, lockfiles, common config, code generation, canonical contract versioning and shared migration order are TL-owned.
- A worker finding a contract gap records an interface proposal and proceeds only with independent scoped work.
- If a worker is blocked, immediately pull the next ready independent WO from dependency-graph.md; do not invent a parallel task with unresolved interfaces.
- Each accepted PR starts from fresh main (or merges/rebases safely using the current project policy) and repeats relevant contract/boundary tests.


## GitHub work-order issue index

All implementation Work Orders now have one matching GitHub Issue. Issues are planned, not automatically dispatched; dependencies and path fences in the canonical work-order registry govern readiness.

| Work Order | Issue | Summary |
|---|---|---|
| AR2-000 | [#2](https://github.com/payswapdotorg/arena-2.0/issues/2) | Fork baseline and inherited surface inventory |
| AR2-001 | [#3](https://github.com/payswapdotorg/arena-2.0/issues/3) | Freeze Arena domain/public contracts and state machines |
| AR2-002 | [#4](https://github.com/payswapdotorg/arena-2.0/issues/4) | Arena API edge and generic lifecycle use cases |
| AR2-003 | [#5](https://github.com/payswapdotorg/arena-2.0/issues/5) | Requester, expert and reviewer workbench |
| AR2-004 | [#6](https://github.com/payswapdotorg/arena-2.0/issues/6) | Capsule contracts, provider seam and isolation conformance |
| AR2-005 | [#7](https://github.com/payswapdotorg/arena-2.0/issues/7) | Durable persistence, idempotency, transactional outbox and jobs |
| AR2-006 | [#8](https://github.com/payswapdotorg/arena-2.0/issues/8) | Bind Arena workbench to real API |
| AR2-007 | [#9](https://github.com/payswapdotorg/arena-2.0/issues/9) | Evidence capture and proof-class validator pipeline |
| AR2-008 | [#10](https://github.com/payswapdotorg/arena-2.0/issues/10) | Expert capability, qualification, matching and conflict checks |
| AR2-009 | [#11](https://github.com/payswapdotorg/arena-2.0/issues/11) | Expert Arena, self-evaluation, independent review and adjudication |
| AR2-010 | [#12](https://github.com/payswapdotorg/arena-2.0/issues/12) | Test-mode payment ledger and outcome-linked payout |
| AR2-011 | [#13](https://github.com/payswapdotorg/arena-2.0/issues/13) | Typed SDK, MCP, signed webhooks and generic integration |
| AR2-012 | [#14](https://github.com/payswapdotorg/arena-2.0/issues/14) | Integrated vertical end-to-end and next-expert path |
| AR2-013 | [#15](https://github.com/payswapdotorg/arena-2.0/issues/15) | Operations, capacity, retention and observability |
| AR2-014 | [#16](https://github.com/payswapdotorg/arena-2.0/issues/16) | Rights-gated learning and Agent Body/version marketplace |
| AR2-015 | [#17](https://github.com/payswapdotorg/arena-2.0/issues/17) | Integrated security, resilience, accessibility and release gate |
