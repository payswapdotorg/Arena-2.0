# AR2-001 Acceptance Checks — Domain and Public Contract Freeze

Version: AC1.0 (defined 2026-10-10 as TL governance, riding the AR2-000 integration window)
Work order: [AR2-001 / issue #3](https://github.com/payswapdotorg/arena-2.0/issues/3) · Owner: TL · Dependencies: AR2-000 accepted
Normative inputs: spec/contracts/escalation-lifecycle.md (ES2.0), spec/verification/proof-and-payment-policy.md, spec/ownership/ownership-map.md (OWN1.0), spec/testing/acceptance-gates.md (G1), docs/TL-FINAL-HANDOFF.md §4.

This document defines what "AR2-001 accepted" means. The one-line acceptance in the implementation plan ("examples and transition tests agreed; APIs and field ownership explicit; no unresolved blocking interface question") is operationalized here into checkable gates. AR2-001 is NOT accepted until every gate in sections B–D is PASS or explicitly WAIVED with recorded rationale, and no section E rejection condition holds.

## Scope fence

AR2-001 delivers contracts and their verification only: schemas, state machines, test vectors, error/compatibility policy and frozen interface decisions. No runtime implementation, no database, no HTTP listener, no UI and no capsule provider code. Implementation begins in Wave 1 (AR2-002/003/004) strictly against the frozen output of this WO.

## A. Required deliverables (the frozen corpus)

| ID  | Deliverable                                                                                                                                                                                                 | Form                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A1  | EscalationRequest schema (every field of ES2.0 §1, incl. tenant-derivation rule and unknown-field policy)                                                                                                   | Machine-readable schema + typed source + field-ownership table |
| A2  | AcceptanceCriteria structure (criterion IDs, measurement definitions, hard-stop rules; immutable once accepted)                                                                                             | Same                                                           |
| A3  | ProofPolicySnapshot (P0–P3 definitions, payout gating, retry/next-expert policy pinned by version + content hash)                                                                                           | Same + version pin                                             |
| A4  | Attempt aggregate contract (assignment, budget consumption, capsule link, candidate versions)                                                                                                               | Same                                                           |
| A5  | CapsuleManifest contract (environment, permitted actions/tools, resource & egress policy, lifecycle, assurance record)                                                                                      | Same                                                           |
| A6  | EvidenceEnvelope contract (immutable objects, provenance, digests, redaction class)                                                                                                                         | Same                                                           |
| A7  | ResultEnvelope contract (statuses, criterion decisions, proof class, eligibility reference — never settlement)                                                                                              | Same                                                           |
| A8  | EventEnvelope contract (ES2.0 §5 fields, immutability, correction-event semantics)                                                                                                                          | Same                                                           |
| A9  | Idempotency/retry contract (same-key/same-digest replay, same-key/different-digest typed conflict, command causation/correlation IDs)                                                                       | Same                                                           |
| A10 | TenantContext contract (derived-from-credentials rule; caller-provided tenant never overrides)                                                                                                              | Same                                                           |
| A11 | State machines: escalation, attempt, payment eligibility, learning publication — enumerated states, allowed transitions, terminal states, and the ten invariants of ES2.0 §6 as executable transition tests | Test suite + diagram/table                                     |
| A12 | API error catalog: stable typed codes, HTTP mapping, retryability, idempotency semantics                                                                                                                    | Table + typed source                                           |
| A13 | Compatibility & versioning policy: contract_version gating, additive-only within major, deprecation windows, unknown-field rejection vs versioned acceptance                                                | Policy doc                                                     |
| A14 | Persistence/idempotency/outbox PORT definitions (interfaces only — engine-neutral; no implementation)                                                                                                       | Typed interface source                                         |
| A15 | Contract test vectors: per envelope ≥1 valid example and ≥3 negative examples (missing required field, wrong type, unknown field, tenant-override attempt)                                                  | Vector files consumed by CI                                    |
| A16 | The five open contract questions from the AR2-000 baseline report closed and recorded (API mount, package layout, persistence engine neutrality, formal-proof reuse scope, format-drift normalization)      | Decisions section in the freeze doc                            |

## B. Mechanical verification gates (CI must prove)

| ID  | Gate                                                                                                                                     | Evidence                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| B1  | Vector suite green: every A1–A10 schema validates its valid vectors and rejects every negative vector                                    | CI check run on the freeze PR head     |
| B2  | Runtime validation demonstrated: schemas validate at a trust boundary in the vector harness (compile-time types alone do not satisfy G1) | Harness code + CI output               |
| B3  | Transition suite green: all ten ES2.0 §6 invariants have tests; invalid transitions rejected; correction events never mutate history     | CI check                               |
| B4  | State-machine completeness: every enumerated state has ≥1 reachable path and ≥1 documented entry/exit; no orphan states                  | Test + generated table                 |
| B5  | Field ownership cross-check: every field in A1–A10 maps to exactly one owning module per OWN1.0; zero unowned/shared-write fields        | Generated ownership table diff         |
| B6  | No-cycle/no-deep-import check passes for the new contract package(s) via the existing architecture guard                                 | `pnpm architecture:check` output in CI |
| B7  | Repo battery on freeze PR: typecheck, lint, architecture:check all green; format check no worse than baseline (48 pre-existing files)    | CI checks on PR                        |

## C. Review and agreement gates

| ID  | Gate                                                                                                                                                                                           | Evidence                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| C1  | The frozen schemas are reviewed against AR2-002 (API), AR2-003 (workbench), AR2-004 (capsule) needs — recorded as acknowledgment comments on issue #3 or in the dispatch briefs of #4/#5/#6    | Issue comments                                                                        |
| C2  | No unresolved blocking interface question remains open (implementation-plan AR2-001 acceptance line)                                                                                           | Open-questions section empty or all questions marked CLOSED with decision + rationale |
| C3  | Write fences re-validated: ownership-map wave lanes still disjoint against the final chosen package layout; AR2-002/003/004 issue bodies updated with frozen contract version + exact base SHA | Updated issue bodies                                                                  |

## D. Governance and state gates

| ID  | Gate                                                                                                                                                                                                 | Evidence                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| D1  | CI exists and is required: `.github/workflows/` with at least install + typecheck + lint + architecture:check + contract vector suite; required status check configured on `main`                    | Workflow file + branch protection API state               |
| D2  | Branch protection active on `main` (require CI check; block force-push; direct-push restricted per TL policy)                                                                                        | Protection API 200 (baseline report recorded 404 absence) |
| D3  | Registry updates in the freeze PR: PROJECT-STATE (M1), implementation-plan AR2-001 state, dispatch-ledger row with PR/CI evidence, issue #3 closed with acceptance comment linking head SHA + CI run | Same-PR diffs + issue state                               |
| D4  | Wave 1 dispatch readiness recomputed and recorded (AR2-002/003/004 declared dispatchable or blocked, with reasons)                                                                                   | Dispatch ledger frontier note                             |

## E. Rejection criteria (any one blocks acceptance)

1. Any A1–A15 deliverable missing, or present only as prose without machine-readable schema + vectors.
2. Any B-gate red on the freeze PR head, or not wired into CI at all.
3. Any unresolved blocking interface question (C2 fails).
4. Any field with ambiguous or dual ownership (B5 fails) — parallel Wave 1 dispatch would be unsafe.
5. Contracts that assume an implementation choice as frozen fact without a recorded decision (e.g., persistence engine baked into the port).
6. Branch protection or required CI still absent at freeze time (D1/D2 fail) — Wave 1 must not fork from an unprotected main.
7. A state-machine invariant from ES2.0 §6 lacking a test (B3 fails).
8. Any change to architecture-lock invariants smuggled inside the contract PR without an approved ACR.

## F. Evidence and record requirements

Per the acceptance-gates evidence policy: record evidence class (CI run vs review vs inspection), exact head SHA, commands, environment, results, limitations and reviewer for each gate. The acceptance comment on issue #3 must link: the merge SHA, the CI run URL, the vector/transition suite report, the closed-questions list, and the Wave 1 dispatch decision. Unit tests on vectors prove schema behavior only; they do not prove runtime integration — that remains Wave 1+ work, gated by G1–G7.

## Acceptance decision record (to fill at acceptance)

- Head SHA / merge SHA:
- CI run URL:
- B-gates: B1 ** B2 ** B3 ** B4 ** B5 ** B6 ** B7 \_\_
- C-gates: C1 ** C2 ** C3 \_\_
- D-gates: D1 ** D2 ** D3 ** D4 **
- Waivers (with rationale and authorizer):
- Reviewer / date:
- Wave 1 dispatch decision:
