# @arena/isolation — OS-level capsule isolation runtime (AR2-019)

`LinuxNamespaceIsolationProvider` implements the engine-neutral
`CapsuleProviderPort` from `@arena/capsule` (AR2-004) behind a **real
OS-level isolation runtime** built on Linux namespaces via `bubblewrap`
(bwrap). It exists to close the release-gate blocker `grg_00000008`
(OS-level capsule isolation BLOCKED — see
`docs/evidence/release/AR2-015-gate-report-2026-10-11.md`): the SYNTHETIC
provider is explicitly not isolation evidence; this package is the
instrument plus runtime that produces it.

**This package does not enable anything by itself.** Untrusted expert/
scraper execution stays disabled until the strict-mode conformance battery
passes on the release-gate station AND a recorded owner decision (AR2-023)
authorizes it (`CAPSULE_FAIL_CLOSED_RULE`). `ISOLATION_PROVIDER_IDENTITY
.production_enabled` is the literal type `false`; flipping it is a
release-gate act, not a code toggle.

## The isolation stack

Every sandboxed command (`executeCommand`) runs through:

| Layer | Mechanism | Enforcement |
| --- | --- | --- |
| User namespace | `--unshare-user --uid 0 --gid 0` (unprivileged) | sandbox uid 0 maps to the invoking uid; parent verifies `/proc/<pid>/uid_map` = `0 <uid> 1` |
| Mount namespace | `--tmpfs /` + read-only `/usr` + merged-usr symlinks | **tmpfs-only writable scratch** (`--size` capped at the manifest disk ceiling, `0700`); no host `/etc`, `$HOME`, credentials, repo or other tenants' workspaces exist inside |
| PID namespace | `--unshare-pid` | host PIDs invisible; child sees only namespace-local pids (its `$$` is small; the host parent pid is absent from `/proc`) |
| IPC / UTS | `--unshare-ipc --unshare-uts` + `--hostname arena-<capsule>` | isolated IPC objects, namespace-local hostname |
| Network namespace | `--unshare-net` (empty netns, loopback down) | **deny-by-default egress**: a live host listener on 127.0.0.1 and all private/metadata ranges are unreachable |
| Syscall filter | `--seccomp <fd>` (hand-rolled BPF denylist, no libseccomp) | keyctl/add_key/request_key/init_module/finit_module/delete_module/bpf/kexec_load/kexec_file_load/perf_event_open → `SECCOMP_RET_KILL_PROCESS` → kernel SIGSYS; bwrap's supervisor propagates it as exit code 159 (128+31) |
| Resource ceilings | `prlimit -- bwrap ...` (rlimits inherit into the sandbox) | `RLIMIT_AS`, `RLIMIT_FSIZE`, `RLIMIT_NPROC`, `RLIMIT_NOFILE`, `RLIMIT_CPU` |
| Wall clock | parent supervisor kills the sandbox process group + `--die-with-parent` | typed `EXEC_TIMEOUT` |
| Secret hygiene | `--clearenv` + explicit `--setenv` allowlist only | the host environment never crosses the boundary; captured evidence records contain no secrets |
| Hardening extras | `--new-session`, `--die-with-parent`, `--disable-userns` (bwrap ≥ 0.12 with a real procfs) | detached tty session; no nested userns creation when supported |

The bwrap wrapper is a **fully typed spawn layer**: argv arrays only (no
shell string interpolation anywhere on the execution path), stdout/stderr
captured as bounded evidence records, and every exit code/signal mapped to
a typed outcome — setup failures return `ISOLATION_NOT_SUPPORTED` /
`ISOLATION_SETUP_FAILED`, never a silent fallback to non-isolated
execution. The exact bwrap argv is recorded in the per-run evidence.

Parent-side isolation evidence (`SandboxIsolationEvidence`): bwrap's own
`--info-fd` JSON (sandbox pid + ipc/mnt/net/pid/uts namespace inode
numbers), cross-checked against `/proc/<pid>/ns/*` and `/proc/<pid>/uid_map`
sampled while the sandbox is live.

## Degrade policy: strict vs auto

`LinuxNamespaceIsolationProvider` is constructed with
`mode: "strict" | "auto"` (default `auto`).

- **strict** — the release-gate evidence mode: `provision` fails closed
  unless the environment probes `FULL_ISOLATION` (bwrap + unprivileged
  user namespaces + seccomp + prlimit). No session, no
  `ENVIRONMENT_READY`, nothing runs degraded.
- **auto** — CI-portability mode: provision still fails closed when
  isolation is `NOT_SUPPORTED` at all (this provider exists to isolate;
  without capability there is no capsule and no assurance to record — the
  frozen `CAPSULE_FAIL_CLOSED_RULE` forbids `ENVIRONMENT_READY` without
  recorded isolation assurance). `PARTIAL_ISOLATION` environments
  (real namespaces, one auxiliary layer missing) provision with the
  limitation recorded in the session environment report; execution
  degrades only in the missing layer and says so.
- A **pinned** `bwrapPath` that disappears fails closed at execution time
  with the typed `ISOLATION_NOT_SUPPORTED` outcome — the provider never
  silently falls back to a PATH-discovered binary.

### procfs strategies (environment-probed, recorded)

Some containerized kernels deny mounting a fresh pidns-scoped procfs
(e.g. this package's dev sandbox: mounting `proc`/`sysfs` in a user
namespace returns EPERM). The capability probe records which strategy
the environment actually supports:

- `fresh-proc` — `--proc /proc`: a pidns-scoped procfs; `/proc/self/uid_map`
  is observable child-side.
- `masked-proc` — `/proc` is masked by an **empty tmpfs**: no host PIDs are
  visible (the adversarial requirement), and PID-namespace evidence is
  collected parent-side (`/proc/<pid>/ns/pid`, `getpid()` divergence
  between the namespace-local pid and the host pid reported by bwrap).
  `--disable-userns` is skipped in this mode (it needs a writable
  procfs sysctl) and the omission is recorded.

Both strategies deny host PID visibility; the battery asserts that
invariant directly (the host parent pid is absent from the sandbox's
`/proc`).

## Resource ceiling mapping (frozen manifest → rlimits)

| Manifest field | Mapping |
| --- | --- |
| `resource_policy.memory_limit_mb` | `RLIMIT_AS` = MB × 1024² |
| `resource_policy.disk_limit_mb` | `RLIMIT_FSIZE` = MB × 1024², and the scratch tmpfs `--size` |
| `resource_policy.cpu_limit` (cores) × execution wall-clock | `RLIMIT_CPU` seconds (`ceil`) |
| `resource_policy.max_duration_seconds` | session expiry (typed `SESSION_DURATION_EXCEEDED`) + default per-exec wall clock |
| (frozen manifest has no process-count field) | provider `profile.max_processes` → `RLIMIT_NPROC` (default 128) |

`RLIMIT_NPROC` accounting is kernel-version dependent (userns-scoped on
5.15+, uid-global on older kernels); the battery asserts the declared
ceiling is enforced (the fork bomb fails with EAGAIN), not the exact
process count at which it trips. rlimit signal deaths are propagated by
bwrap's supervisor as bash-compatible exit codes (SIGKILL→137,
SIGXCPU→152, SIGSYS→159) — the outcome mapping accepts both forms.

## Conformance + adversarial battery

`test/` (run: `tsx --test test/*.test.ts` from this package):

- **capability probes** — kernel, userns sysctls + empirical bwrap exec,
  bwrap version, procfs strategy, seccomp install, prlimit — recorded as
  the inspectable `IsolationEnvironmentReport`.
- **conformance** — a real manifest executes inside the sandbox; the child
  observes its namespaces (uid 0, custom hostname, namespace-local pid);
  the parent verifies namespace divergence, uid_map, and argv discipline.
- **adversarial escape battery** — each probe is a real attempt from
  inside the sandbox:
  `fs-escape` (host secrets/repo/tenant dirs absent),
  `net-egress` (live host listener + private/metadata ranges unreachable),
  `pid-visibility` (host pid invisible),
  `syscall-filter` (keyctl dies with SIGSYS),
  `resource-ceil-memory/process/cpu` (hog, fork bomb, spin killed at
  declared ceilings),
  `secret-hygiene` (bait env var absent from child env AND evidence
  records; no credential files in scratch),
  `tenant-binding` (tenant A cannot mount tenant B paths — fail closed
  via the AR2-004 binding semantics; positive control mounts tenant A's
  own input),
  plus the wall-clock `EXEC_TIMEOUT` kill.
- **port discipline** — manifest gate, isolation-class gate, strict/auto
  provisioning, typed NOT_SUPPORTED paths, cross-tenant refusal
  indistinguishability, verified teardown, non-regression against the
  frozen families (`@arena/capsule`, `@arena/contracts` stay green and
  unmodified).

When bwrap/userns are absent (CI ubuntu-latest, the integration station),
the suite stays green with **typed skips and port-logic fixtures**:

- real-execution probes (conformance, escape battery) record the typed skip
  `bwrap/userns unavailable` via the capability gate — the honest
  `NOT_SUPPORTED` marker, never a faked result;
- the port-discipline tests (tenant refusal indistinguishability, aggregate
  mismatch, lifecycle/teardown, duration ceiling, action allowlist, egress
  fail-closed, transfer limits) construct the provider directly with a
  clearly-labeled **synthetic environment** injected through the documented
  `probeEnvironment` seam (`provisionedPortLogicSession` in `test/helpers.ts`).
  Every assertion there targets decisions the port makes **before any spawn**
  (registries, allowlist, manifest ceilings, state machine); the fixture
  records no isolation claim, and the real-environment fail-closed path
  itself is asserted by the dedicated NOT_SUPPORTED tests.

## Reproducing the strict-mode run (release-gate owner)

From the repository root after `pnpm install`:

```bash
cd packages/arena-isolation
../../node_modules/.bin/tsx test/strict-mode-evidence.ts
```

The script (a) probes the environment and fails closed unless it classifies
as `FULL_ISOLATION`, (b) provisions a strict-mode capsule, (c) runs the
registered probe set as real escape attempts, and (d) prints the
machine-readable `ConformanceEvidenceRecord` (mode, environment report,
per-probe name/result/duration, battery HEAD sha, summary) to stdout.
Exit code 0 = all probes DENIED/PASS; 1 = any FAIL or NOT_SUPPORTED.
The committed evidence DOC for the gate decision is TL-owned at
integration — this package ships the instrument; run numbers above come
from the dev sandbox (see the work-order completion report).

The auto-mode battery (CI-portable):

```bash
cd packages/arena-isolation && ../../node_modules/.bin/tsx --test test/*.test.ts
```

## Limitations (honest list)

- **Linux-only.** No macOS/Windows claim (those are AR2-020's cross-platform
  install evidence, not isolation evidence). On non-Linux the probe reports
  `NOT_SUPPORTED`.
- **bwrap is an external tool** (probed at runtime; not vendored — see
  SUPPLY-CHAIN.md). Version-bound flags: `--disable-userns` only on
  bwrap ≥ 0.12 with a real procfs. The seccomp denylist covers x86_64 and
  aarch64 syscall tables; other arches report the seccomp layer as
  unsupported (typed limitation, never faked).
- **Empty-netns egress only.** A manifest granting `allowed_hosts` fails
  closed with `EGRESS_GRANT_NOT_SUPPORTED` — this runtime does not pretend
  to proxy egress.
- **masked-proc** environments trade in-sandbox `/proc` observability for
  an empty tmpfs mask (see degrade policy); pid-namespace evidence is
  parent-side in that mode.
- **32-bit binaries** inside the sandbox are killed by the seccomp arch
  check (fail closed, documented).
- `--seccomp` exit-code nuance: bwrap's supervisor propagates SIGSYS as
  159; the typed `SYSCALL_FILTER_KILLED` outcome keys on the signal or the
  propagated exit code with the filter installed.
- The battery's C escape helper is compiled at test time when gcc is
  available; without gcc the affected probes record `NOT_SUPPORTED`
  markers (the shell-based probes still run).
- Scratch is tmpfs-only by design: outcomes return through captured
  stdout/stderr (evidence records) and `push_scoped` artifact transfers,
  not through host-side writable scratch.

## Integration notes (TL-owned surfaces)

This package declares `@arena/contracts` and `@arena/capsule`
(`workspace:*`) as its only dependencies and consumes the AR2-004 seam
without modifying it. Root workspace wiring (`pnpm-workspace.yaml` globs
already cover `packages/*`), `architecture-policy.yaml` registration for
module id `arena-isolation` (see `src/module.ts` for the declared
requires/provides/publicEntrypoints), and CI battery wiring happen at the
TL integration station per the write fence.
