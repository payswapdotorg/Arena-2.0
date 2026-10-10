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

## Slice 2 (pending)

Synthetic local provider implementation (lifecycle state machine, command
allowlist / duration / artifact-size enforcement, subprocess workspace), the
OS-level isolation conformance suite **design document** for real providers, and
the `productionEnabled` flag (default `false`, no code path flips it).

## Conformance suite design (preview — full document in slice 2)

A production provider must pass, at the **actual isolation layer** (process /
container / microVM boundary — not inside the guest):

1. **Process boundary**: guest cannot see host process list, ptrace host
   processes, or signal host processes.
2. **Filesystem boundary**: guest cannot read host paths outside its declared
   workspace; writes outside the workspace fail closed.
3. **Network boundary**: default-deny egress actually drops non-allowlisted
   traffic at the enforcement point (verified by packet-level probes, not by
   guest-side observation).
4. **Credential scoping**: credentials issued to capsule A are unusable from
   capsule B; revocation takes effect at the enforcement point.
5. **Teardown assurance**: after teardown, no guest processes/sockets/mounts
   survive; the teardown record carries the verified revocation list.

The synthetic provider's results on any of these are **NON-EVIDENCE**.

## House notes

- Public surface is `src/contract.ts` only (architecture guard: deep imports
  into this module are violations).
- Depends only on `@arena/contracts` (frozen corpus CF1.0). No engine types in
  the port file — engine selection lives behind adapters.
