# AR2-001 Contract Freeze Record

Status: FROZEN (this PR). Corpus version: **CF1.0**.
Canonical implementation: `packages/arena-contracts` (public entrypoint `@arena/contracts` → `src/contract.ts` only).
Normative sources: [escalation-lifecycle.md](escalation-lifecycle.md) (ES2.0), [proof-and-payment-policy.md](../verification/proof-and-payment-policy.md) (PVP1.0), [ownership-map.md](../ownership/ownership-map.md) (OWN1.0), [architecture-lock.md](../architecture-lock.md) (A2.0).
Acceptance rubric: [ar2-001-acceptance.md](../work-orders/ar2-001-acceptance.md) (AC1.0).

This record freezes the domain/public contracts and state machines for Wave 1. After merge, contract changes require a reviewed ACR per architecture-lock. The frozen corpus is schema-validated at runtime (G1), not only typed at compile time.

## 1. The frozen corpus (A1–A15)

| ID  | Deliverable          | Implementation                                                                                                                                                    |
| --- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | EscalationRequest    | `src/envelope/escalation-request.ts` (strict object; every ES2.0 §1 field; no tenant input field by design)                                                       |
| A2  | AcceptanceCriteria   | `src/envelope/acceptance-criteria.ts` (criterion IDs, measurement definitions, hard-stop rules; immutability rule exported)                                       |
| A3  | ProofPolicySnapshot  | `src/envelope/proof-policy-snapshot.ts` (PVP1.0 pin + content_digest; per-class conditional semantics validated)                                                  |
| A4  | Attempt aggregate    | `src/envelope/attempt.ts` (assignment, budget consumption, capsule link, immutable candidate versions, failure records)                                           |
| A5  | CapsuleManifest      | `src/envelope/capsule-manifest.ts` (environment, permitted actions, resource/egress policy, scoped credentials, lifecycle, isolation assurance)                   |
| A6  | EvidenceEnvelope     | `src/envelope/evidence-envelope.ts` (issuer tiers, binding, digests, redaction class, correction linkage)                                                         |
| A7  | ResultEnvelope       | `src/envelope/result-envelope.ts` (ES2.0 §4 fields; payment = eligibility reference, never settlement)                                                            |
| A8  | EventEnvelope        | `src/envelope/event-envelope.ts` (ES2.0 §5 fields; correction-event semantics; outbox observability rule)                                                         |
| A9  | Idempotency/retry    | `src/idempotency.ts` (13 public commands + 9 system triggers; same-key/same-digest replay; same-key/different-digest conflict)                                    |
| A10 | TenantContext        | `src/tenant-context.ts` (derived-from-credentials only; role is never authorization)                                                                              |
| A11 | State machines       | `src/state-machine/` — escalation (13 states), attempt (11), payment eligibility (12), learning publication (9); ten ES2.0 §6 invariants as executable guard sets |
| A12 | Error catalog        | `src/errors.ts` — 31 stable `ARENA_*` codes with HTTP mapping, retryability, idempotent-replay safety                                                             |
| A13 | Compatibility policy | section 3 below                                                                                                                                                   |
| A14 | Ports                | `src/ports.ts` — AggregateStore / Idempotency / Outbox / Job / Migration port interfaces (engine-neutral)                                                         |
| A15 | Test vectors         | `vectors/*.json` — 11 envelopes, 72 cases (≥1 valid + ≥4 negatives each incl. tenant-override); consumed by CI                                                    |

Verification gates B1–B7 are wired into the `ci` workflow (contract suite step) and documented in the acceptance comment on issue #3.

## 2. The five open contract questions — CLOSED (A16)

### 2.1 arena-api mount — DECIDED: new sibling package, not `packages/server`

AR2-002 implements the API edge in a **new `packages/arena-api` package** with its own listener entry point. Rationale: architecture-lock rule 3 forbids creating the Arena business domain inside ZCode's existing service internals; `packages/server` is upstream surface that must keep absorbing upstream evolution; a separate package gives Wave 1 a disjoint write fence (one worker owns a whole package directory). The upstream server's HTTP framing (tsup entry, route composition patterns) is a _precedent to learn from_, not a surface to modify. Mounting Arena API capability into the ZCode desktop/server shell later requires an ACR.

### 2.2 Arena package layout — DECIDED: sibling `packages/arena-*` packages

The Arena codebase grows as **sibling packages** (`packages/arena-contracts`, `packages/arena-api`, `packages/arena-application`, `packages/arena-domain`, `packages/arena-capsule-*`, `packages/arena-verification`, `packages/arena-payments`, …), matching the existing `packages/*` workspace glob **without touching `pnpm-workspace.yaml`**. Rationale: the alternative (one `packages/arena` multi-module package) would require a glob change plus a shared package.json across all three Wave-1 workers — exactly the serialized-surface contention OWN1.0 forbids. Sibling layout = each worker owns entire package dirs; the architecture guard registers each package as its own module (`arena-contracts` registered in this PR; later packages register at their own WO). Naming: `@arena/*` npm scope, distinct from `@zcode/*` provenance.

### 2.3 Persistence engine neutrality — DECIDED: engine-neutral ports; engine choice belongs to AR2-005

The frozen `src/ports.ts` defines role interfaces (AggregateStore with optimistic versioning, Idempotency with atomic reserve/replay/conflict, transactional Outbox, Job with lease/fencing, Migration) over domain types only. **No engine types, DDL, drivers or connection strings appear in contracts** (enforced by test). Engine selection (embedded-Postgres precedent or otherwise) is AR2-005 implementation space requiring its own evidence; swapping engines must never require a contract change.

### 2.4 formal-proof reuse scope — DECIDED: none for validators

Inspection of `packages/formal-proof` shows it is a **vite/d3 web demo application** (formal-proof visualization playground: `main.ts`, `model.ts`, `styles.css`, d3 dependency), not a validation-primitives library. It exposes no reusable validator API. Arena verification validators therefore **reuse nothing from it**; the frozen ValidatorDescriptor contract stays provider-neutral. If formal-methods tooling is ever wanted for validators, it arrives as a new package + ADR. (The demo app remains untouched upstream surface.)

### 2.5 Format drift normalization — DECIDED: yes, dedicated TL commit before Wave 1 forks

The 48-file pre-existing drift was normalized in a dedicated TL formatting PR (#23, oxfmt, content-identical) merged **before** this freeze, so Wave 1 workers fork from a format-clean tree and `fmt:check` becomes a zero-drift gate for all future PRs (B7 tightens from "no worse than 48" to "0").

## 3. Compatibility and versioning policy (A13)

1. **Version pins.** `contract_version` = `ES2.0` (envelope family), corpus = `CF1.0`, proof policy = `PVP1.0`, events = `ES2.0-EV1`. All are schema literals: a payload with any other value is rejected with `ARENA_CONTRACT_VERSION_UNSUPPORTED`.
2. **Additive-only within a major.** New optional fields, new enum members _at the end of documented semantic groups_, new error codes and new transitions may be added within CF1.0 provided: (a) every existing vector still passes unchanged; (b) field ownership is updated in the same PR; (c) the freeze record's corpus inventory table gains a row. Removing, renaming or re-typing a field, narrowing an enum, or weakening a guard requires a **new major** (CF2.0) plus an ACR.
3. **Unknown fields are rejected**, never silently interpreted (strict objects everywhere; the tenant-override vectors pin this behavior). Opt-in acceptance of newer-client fields happens only through a bumped `contract_version`.
4. **Deprecation window.** A field or enum member marked deprecated stays accepted and documented for at least one full minor cycle before removal, and removal happens only at a major boundary with an ACR.
5. **Error codes are contract.** `ARENA_*` codes are additive-only; HTTP mapping/retryability may evolve only through this recorded policy with the catalog test updated in the same PR.
6. **State machines are contract.** Adding a transition requires an invariant-registry review; removing one requires a major. Guards may strengthen (fail-closed) within CF1.0 only with an ACR documenting the operational impact.

## 4. Field ownership (B5) — summary

Full machine-checkable table: `src/ownership.ts` (`FIELD_OWNERSHIP`), cross-checked against every schema shape by test. Domain modules per ES2.0 §3: escalation, attempt, capsule_host, evidence_store, verification, payment, learning, requester_app — plus four documented infrastructure owners: `api_edge` (command envelope, AR2-002), `idempotency_store` (idempotency records, AR2-005 port), `emitting_aggregate` (event envelopes — writer is the aggregate named by `aggregate.type`), `tenant_service` (TenantContext derivation at the edge). Notable single-writer decisions: the result envelope is owned by **verification** (the proof-decision record) with exactly one field (`payment_eligibility_reference`) owned by **payment**; the capsule manifest is wholly **capsule_host**; the proof-policy snapshot is persisted once by **escalation** at creation (verification owns runtime proof decisions, not the immutable snapshot). Derived reads (e.g. result artifact lineage from attempt-owned candidate versions) are not dual writes.

## 5. State machines (A11) — summary

| Machine              | States                                                                                                                                                                                     | Initial        | Terminals                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------- |
| escalation           | CREATED, CLARIFICATION, OFFERED, ASSIGNED, ENVIRONMENT_READY, VERIFYING, REVISION_REQUESTED, APPEALED, ACCEPTED, CLOSED, CANCELLED, EXPIRED, FAILED_EXHAUSTED                              | CREATED        | CLOSED, CANCELLED, EXPIRED, FAILED_EXHAUSTED                  |
| attempt              | CREATED, ASSIGNED, ENVIRONMENT_READY, SUBMITTED, VERIFYING, ACCEPTED, REJECTED, INCONCLUSIVE, FAILED, EXPIRED, SUPERSEDED                                                                  | CREATED        | ACCEPTED, REJECTED, INCONCLUSIVE, FAILED, EXPIRED, SUPERSEDED |
| payment-eligibility  | NOT_APPLICABLE, RESERVED, PENDING_EVIDENCE, EVIDENCE_ACCEPTED, READY_TO_RELEASE, RELEASE_SUBMITTED, SETTLED, DISPUTED, REFUND_PENDING, REFUNDED, FAILED_REQUIRES_RECONCILIATION, CANCELLED | NOT_APPLICABLE | SETTLED, REFUNDED, CANCELLED                                  |
| learning-publication | PROPOSED, UNDER_REVIEW, RIGHTS_CLEARED, CONSENT_RECORDED, VALIDATED, APPROVED, PUBLISHED, RETRACTED, REJECTED                                                                              | PROPOSED       | RETRACTED, REJECTED                                           |

Notes: PUBLISHED is stable-but-retractable (retraction is a new record, never a rewrite). Every state is reachable, documented (entry/exit) and non-orphan (B4 tests). The ten ES2.0 §6 invariants are encoded as guard sets on specific transitions in the invariant registry; INV5's OR-semantics (P0/P1 validator conjunction OR P2/P3 adjudication) is carried by the composite `proof_satisfied` fact with the disjunction recorded in the registry.

## 6. Wave 1 dispatch readiness (D4)

With this freeze merged and CI/protection active on main, Wave 1 is **DISPATCHABLE**:

- **AR2-002** (Worker 1 — API edge): writes `packages/arena-api` + `packages/arena-application` (+ `packages/arena-domain` if split), consumes `@arena/contracts`, implements the 13 commands/8 queries behind a real HTTP listener with runtime schema validation at the trust boundary, typed error mapping from the catalog, and the idempotent command port against `ports.ts`. No root manifests, no capsule, no UI.
- **AR2-003** (Worker 2 — workbench UI): Arena routes/components in the web shell per OWN1.0 lane, driven by frozen mock clients generated from the contract schemas; demo data visibly labelled.
- **AR2-004** (Worker 3 — capsule seam): consumes CapsuleManifest + the CapsuleProvider port; fail-closed manifest validation; synthetic local provider marked non-production.

Exact base SHA, branch names, path fences, test/evidence plans are recorded in the dispatch ledger and in each issue's dispatch brief. The three lanes are file-disjoint by construction (different package roots).

## 7. Evidence

- CI: `battery` job on this PR head (typecheck 12 projects, lint, architecture:check, contract suite 104 tests, upstream unit tests 16).
- Local station battery: identical results on Debian 13 / node 24.21.0 / pnpm 10.33.2 (logs at the TL station, `tool-results/arena2-*`).
- Acceptance decision record for issue #3 is posted as the closing comment with head/merge SHAs and per-gate outcomes.
