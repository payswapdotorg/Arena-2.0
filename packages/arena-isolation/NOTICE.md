# NOTICE — @arena/isolation (AR2-019)

This package is part of Arena 2.0, a fork of zai-org/ZCode. The upstream
license (Apache-2.0), notices, dependency notices, attribution and security
disclosures are retained at the repository root (LICENSE, NOTICE.md,
THIRD-PARTY-NOTICES.md); this package adds to them and erases nothing.

## What this package adds

- `LinuxNamespaceIsolationProvider` — a `CapsuleProviderPort` implementation
  executing capsule work inside Linux user/mount/PID/IPC/UTS/network
  namespaces with a seccomp denylist, tmpfs-only scratch, rlimit ceilings
  and parent-enforced wall clock, driven by the external `bubblewrap`
  binary through a typed argv spawn layer.
- Capability probes, a hand-rolled BPF seccomp denylist builder, the
  adversarial escape battery, and the `ConformanceEvidenceRecord`
  instrument (see README.md).

## External tools (not vendored, not linked)

- **bubblewrap (bwrap)** — LGPL-2.1+ (project:
  https://github.com/containers/bubblewrap). Arena invokes it as a separate
  process at arm's length (exec, no linking, no source vendoring); its
  license obligations remain with the binary's distributor (see
  SUPPLY-CHAIN.md for provenance). No claim is made that this package is a
  derivative work of bubblewrap.
- **prlimit(1)** — util-linux (GPL-2.0-or-later with exceptions), likewise
  invoked as a separate process; not vendored or linked.

No bwrap or util-linux source or binaries are committed to this repository
by this work order; environments are probed at runtime and missing tools
produce typed `NOT_SUPPORTED` outcomes.

## No isolation claim beyond the evidence

`production_enabled` is the literal type `false` in this package. Untrusted
execution enablement requires the strict-mode conformance battery to pass
on the release-gate station and a recorded owner decision
(`CAPSULE_FAIL_CLOSED_RULE`, AR2-015 gate report, AR2-023 instrument).
