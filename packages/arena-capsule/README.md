# @arena/capsule

AR2-004 — Capsule contract and isolation adapter seam. This package defines the
**CapsuleProvider port** and the fail-closed semantics every capsule host must
satisfy before untrusted expert execution can reach ENVIRONMENT_READY.

> **SYNTHETIC LOCAL PROVIDER — NON-PRODUCTION.** The synthetic provider (slice 2)
> is a process/workspace-based simulation: it makes **no system-isolation claim**,
> its results are **NON-EVIDENCE** for production approval, and the production
> provider stays disabled until a system-level isolation conformance suite passes
> (`CAPSULE_FAIL_CLOSED_RULE` in `@arena/contracts`).

## Why this seam exists (frozen rule)

The inherited ZCode agent runtime provides **no default OS-level sandboxing**
(upstream `NOTICE.md`) and is **not a tenant boundary**
(`UPSTREAM_RUNTIME_NOT_A_BOUNDARY_RULE` in `@arena/contracts`). A workspace, a
Git worktree or a UI boundary does not prove tenant isolation. Untrusted expert
work must therefore go through this seam, where isolation class, egress policy,
scoped credentials and verified teardown are explicit, typed and testable.

## Slice 1 surface (this delivery)

| Area               | Export                                                 | Semantics                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest gate      | `checkCapsuleManifest` / `requireValidCapsuleManifest` | schema (strict) → frozen semantics → supplementary semantics; any failure is `ARENA_CAPSULE_MANIFEST_INVALID` with per-field issues — never partially accepted                              |
| Provider port      | `CapsuleProviderPort`                                  | engine-neutral role interface: `provision` → `heartbeat` → `transferArtifact` → `teardown`; typed outcome unions; no provider engine types leak in                                          |
| Tenant binding     | `checkCapsuleBinding`, `CapsuleBindingRegistry`        | capsule bound to tenant/escalation/attempt A refuses B; cross-tenant access is indistinguishable from not-found                                                                             |
| Scoped credentials | `ScopedCredentialLedger`, `redactCredential`           | short-TTL issuance (≤ manifest ceiling ≤ 24h); structured state keeps digest only; the only safe display form is `redactCredential`; teardown revokes and verifies all manifest credentials |
| Disclosure         | `CAPSULE_SYNTHETIC_PROVIDER_DISCLOSURE`                | the mandatory NON-PRODUCTION labelling constant                                                                                                                                             |

## Slice 2 (delivered)

| Area                    | Export                                                    | Semantics                                                                                                                                                                                                                                      |
| ----------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synthetic provider      | `SyntheticLocalProvider`                                  | `CapsuleProviderPort` reference implementation: subprocess/workspace-based, dependency-injected (clock / ledger / registry / workspace root); typed refusals preserve binding codes (cross-tenant indistinguishable, aggregate mismatch typed) |
| Session execution       | `executeCommand` → `ExecuteOutcome`                       | command allowlist, session duration cap (`SESSION_DURATION_EXCEEDED`), remaining-budget kill (`EXEC_TIMEOUT`), minimal env subprocess in the capsule workspace                                                                                 |
| Artifact enforcement    | `transferArtifact`                                        | `max_artifact_bytes` cap (`OVERSIZE`); pull→`artifacts/`, push→`outbox/`; flat-id guard against path injection                                                                                                                                 |
| Verified teardown       | `teardown`                                                | revokes all manifest credentials and verifies; failure retains the workspace as evidence (`TEARDOWN_FAILED` + `unrevoked`); success removes the workspace and closes the capsule                                                               |
| Lifecycle state machine | `CAPSULE_LIFECYCLE_TRANSITIONS`, `capsuleLifecycleAllows` | PROVISIONING → ENVIRONMENT_READY → TEARDOWN_REQUESTED → TERMINATED; no skip over teardown; TERMINATED is terminal                                                                                                                              |
| Production flag         | `PRODUCTION_ENABLED: false`                               | `false` **literal type** — the type system forbids any assignment flipping it; no env/config code path touches it                                                                                                                              |
| Provider identity       | `identity: CapsuleProviderIdentity`                       | name, disclosure string, engine, `production_enabled: false` — the visible NON-PRODUCTION label on every runtime surface                                                                                                                       |

Credentials are issued clipped to the session bound (`max_duration_seconds`) so
they never outlive the capsule; secrets appear once at issuance and only as
digests in structured state.

## Conformance suite design (full document)

The OS-level isolation conformance suite that gates any **real** provider is
specified in [`docs/conformance-suite-design.md`](docs/conformance-suite-design.md)
(v1.0.0): five check classes (process / filesystem / network / credential /
teardown), probe-at-the-enforcement-point principles, evidence classification
(Class A–D), and the digest binding into `isolationAssuranceSchema`.

The synthetic provider's results on any of these are **NON-EVIDENCE**.

## House notes

- Public surface is `src/contract.ts` only (architecture guard: deep imports
  into this module are violations).
- Depends only on `@arena/contracts` (frozen corpus CF1.0). No engine types in
  the port file — engine selection lives behind adapters.
