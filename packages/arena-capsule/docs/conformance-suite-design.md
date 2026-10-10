# Capsule Isolation Conformance Suite — Design (v1.0.0)

> **Status: DESIGN ONLY.** This document specifies the suite that a **production**
> CapsuleProvider must pass before `PRODUCTION_ENABLED` may be flipped from its
> frozen `false` literal. The **synthetic local provider**
> (`src/synthetic-provider.ts`) cannot execute this suite — its results on every
> check below are **NON-EVIDENCE** (`CAPSULE_FAIL_CLOSED_RULE`,
> `UPSTREAM_RUNTIME_NOT_A_BOUNDARY_RULE`).

## 1. Purpose and scope

The acceptance criteria of AR2-004 require that no production isolation claim is
made until an OS/provider-level isolation conformance suite passes. This design
defines that suite: what it measures, where the enforcement point of each
measurement sits, how evidence is classified, and what pass criteria gate the
production flag.

Two principles govern every check:

1. **Probe at the enforcement point, never inside the guest.** A check that runs
   inside the capsule and observes "no egress" proves nothing — the guest can
   lie, and a shared network namespace can hide host-level leaks. Probes execute
   on the host (or a third probe VM) and observe the boundary itself.
2. **Fail closed on absent evidence.** A probe that cannot reach its enforcement
   point (missing kernel feature, provider cannot expose the observation hook)
   counts as **FAILED**, not "not applicable".

## 2. Check classes

### C1 — Process boundary

**Claim under test:** the guest cannot enumerate, inspect (ptrace/procfs), or
signal host processes or sibling capsules' processes.

**Probes (host-side):**

- P1.1 Spawn a marker process on the host; from inside the guest attempt
  `/proc` enumeration, `ptrace(PTRACE_ATTACH)`, and `kill()` against the marker
  PID. Expect: all three fail with the OS-level denial (`EPERM`/`ESRCH` or
  namespace-invisible).
- P1.2 Verify the guest PID namespace is disjoint: the set of PIDs visible to
  the guest (via its own `/proc` read, exported as a _result artifact_, not as
  a probe) intersects the host marker PID set in zero elements.
- P1.3 Resource-exhaustion probe: attempt `fork()` bomb inside the guest up to
  `resource_policy` limits; host marker process must remain responsive
  (p99 latency budget: 2s).

**Pass criterion:** P1.1 all denied; P1.2 disjoint; P1.3 host unaffected.

### C2 — Filesystem boundary

**Claim under test:** the guest cannot read or write host paths outside its
declared workspace, and the provider declares the workspace root.

**Probes:**

- P2.1 Read probes against a canary directory tree planted outside the
  workspace (host `/etc` shadow files, provider state dirs, sibling capsule
  workspaces). Expect: every open fails closed (`ENOENT`/`EPERM`), and —
  critically — error _contents_ are indistinguishable across paths (no oracle
  for existence).
- P2.2 Write probes against the same tree: every write fails and no canary
  checksum changes.
- P2.3 Mount-map verification at the provider level: the isolation layer's
  mount table (container mounts / microVM block devices) contains exactly the
  declared workspace plus read-only declared inputs — verified via the
  provider's engine API, not guest observation.

**Pass criterion:** P2.1–P2.3 all clean across ≥ 100 randomized path probes
per class.

### C3 — Network boundary (egress default-deny)

**Claim under test:** `egress_policy.denied_default: true` drops all
non-allowlisted traffic **at the enforcement point**.

**Probes:**

- P3.1 Packet-level: run a DNS + TCP + UDP receiver on a probe host; from the
  guest attempt outbound connections to allowlisted and non-allowlisted
  targets. Allowlisted: connection completes. Non-allowlisted: **no packet
  arrives** at the receiver (verified by packet capture, not by guest-side
  error messages).
- P3.2 Ingress: when `allow_ingress: false`, unsolicited inbound SYN to the
  guest's address is dropped at the boundary (verified from the probe host).
- P3.3 DNS exfil channel: non-allowlisted DNS resolution must fail at the
  resolver enforcement point (capture-verified).

**Pass criterion:** zero leaked packets across all non-allowlisted probes,
repeated over ≥ 1,000 connection attempts with randomized timing.

### C4 — Credential scoping at the enforcement point

**Claim under test:** credentials issued to capsule A are unusable from capsule
B, and revocation takes effect at the point where credentials are checked.

**Probes:**

- P4.1 Cross-capsule replay: credential secret issued to capsule A (different
  tenant) presented at capsule B's enforcement point (mounted secret store /
  token verifier). Expect: denied, and denial is indistinguishable from
  "unknown credential" (no tenant oracle).
- P4.2 Revocation latency: revoke a credential, then present it at the
  enforcement point at t+0ms, t+100ms, t+1s. Expect: denied from t+0 — the
  ledger revocation must be synchronous with the enforcement point, not
  eventually consistent.
- P4.3 Expiry: presentation after `expires_at` denied even if the guest clock
  is skewed (enforcement clock is host-authoritative).

**Pass criterion:** all presentations denied at the correct times; no
plaintext secret appears in any provider log or state dump during the run
(grepped for the issued secret patterns).

### C5 — Teardown assurance

**Claim under test:** after teardown, no guest processes, sockets, mounts, or
workspace residue survive; the teardown record carries the verified revocation
list.

**Probes:**

- P5.1 Process sweep: host-side scan for guest PIDs (by namespace membership
  or cgroup) — zero remaining.
- P5.2 Socket/file sweep: no open FDs into the workspace; no listening sockets
  owned by the dead guest UID; workspace directory removed.
- P5.3 Kill-resistance: teardown issued while the guest runs a
  `SIGKILL`-shielding helper (uninterruptible `D` state / nested PID 1 that
  ignores SIGTERM) still completes within `lifecycle.teardown_timeout_seconds`
  (force-kill path).
- P5.4 Record: teardown outcome is `TORN_DOWN` with `verified: true` and the
  full revocation list; any `TEARDOWN_FAILED` must retain the workspace as
  evidence (observed behavior, not just type shape).

**Pass criterion:** P5.1–P5.4 clean; teardown wall time within the manifest
timeout on ≥ 50 consecutive cycles.

## 3. Evidence classification

| Evidence class             | Produced by                                                                            | Counts toward production approval       |
| -------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------- |
| **A — boundary probe**     | This suite, executed against a real provider                                           | Yes (the only class that counts)        |
| **B — engine attestation** | Provider engine's own isolation guarantees (documented kernel features, VM boundaries) | Supporting only; never sufficient alone |
| **C — synthetic result**   | `SyntheticLocalProvider` run of any check                                              | **NON-EVIDENCE**                        |
| **D — code review**        | Review of provider implementation                                                      | Supporting only                         |

The synthetic provider's typed outcomes (`COMMAND_NOT_ALLOWLISTED`,
`SESSION_DURATION_EXCEEDED`, `OVERSIZE`, `TORN_DOWN`, …) prove that the
**Arena-side seam logic** is correct — manifest gating, binding, lifecycle,
allowlist/duration/artifact-size enforcement, verified revocation. They say
nothing about OS-level isolation, because a subprocess on the host shares the
host kernel, filesystem graph and network namespace with the probe
environment itself.

## 4. Suite harness and digest

- Harness: a host-side runner (future WO) that executes C1–C5 against a
  provider under test and emits a structured result document:
  `{ suite_version, provider_id, isolation_class, checks: [{id, status, evidence_digest}], overall }`.
- `conformance_suite_digest` in `isolationAssuranceSchema` (frozen in CF1.0)
  must be the SHA-256 of the suite document + suite version — the manifest's
  assurance record thereby binds to a _specific executed suite_, not to a
  vague claim.
- `overall` is `PASS` only when every probe in C1–C5 is PASS and no probe
  errored at its enforcement point (fail-closed on absent evidence, §1).

## 5. Production gate

`PRODUCTION_ENABLED` is a `false`-literal constant in
`src/synthetic-provider.ts`; no code path assigns it. Flipping it requires all
of:

1. A real provider implementation whose engine matches a declared
   `isolation_class` ≥ `container` (process class is not a tenant boundary for
   untrusted experts — frozen rule).
2. Class-A evidence from this suite at the suite version recorded in the
   manifest assurance, with `overall: PASS`.
3. A TL-coordinated contract review confirming the assurance digest binding
   (§4) and the teardown record shape (P5.4).

Until 1–3 hold, every runtime surface must continue to label capsule
execution as non-production (the synthetic disclosure string
`CAPSULE_SYNTHETIC_PROVIDER_DISCLOSURE` is the canonical label).
