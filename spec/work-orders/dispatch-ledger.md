# Arena 2.0 Dispatch Ledger

This is the canonical record of active and completed work-order dispatches. Update it in the same integration step that opens/merges each work order. It complements GitHub Issues/PRs and never replaces their URLs.

## Current bootstrap state

| Field | Value |
|---|---|
| Architecture setup | Branch architecture/arena-2.0-source-of-truth |
| Baseline source commit | 29628c9acdb81b703bbd4080c207a0e7ce5e276e |
| Baseline inventory AR2-000 | NOT STARTED |
| Contract freeze AR2-001 | BLOCKED BY AR2-000 |
| Feature dispatch | NOT AUTHORIZED UNTIL AR2-001 ACCEPTED |
| Concurrent worker slots | 3 maximum; currently none assigned |
| Live payment mode | DISABLED |
| Production capsule provider | NOT APPROVED / NOT VERIFIED |

Replace this table only with evidence-backed status. If branch setup is not merged to main, the TL must not treat main as having the documents until GitHub reports the merge.

## Active dispatch table

| WO | Issue | Branch | Worker | Base SHA | Write fence | Status | Evidence/PR |
|---|---|---|---|---|---|---|---|
| AR2-000 | Create at dispatch | To be recorded | TL | To be recorded | Inventory and baseline evidence only | NOT STARTED | None |
| AR2-001 | Create after AR2-000 | To be recorded | TL | To be recorded | Contracts/state machines and architecture docs | BLOCKED | None |

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
