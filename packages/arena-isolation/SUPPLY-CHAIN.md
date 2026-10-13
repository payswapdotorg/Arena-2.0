# SUPPLY-CHAIN RECORD — @arena/isolation (AR2-019)

## npm dependencies

| Dependency | Version constraint | Kind | Note |
| --- | --- | --- | --- |
| `@arena/contracts` | `workspace:*` | runtime | frozen CF1.0 corpus — consumed read-only, never modified |
| `@arena/capsule` | `workspace:*` | runtime | AR2-004 seam (port, validator, binding, ledger, lifecycle) — consumed read-only, never modified |
| `typescript` | `^6.0.2` | dev | same pin family as every other arena package |

**Zero external npm runtime dependencies.** The seccomp filter is
hand-rolled BPF emitted as raw `struct sock_filter` buffers; no libseccomp
binding, no native modules, no postinstall steps, no network access at
install or runtime.

## External system tools (probed at runtime, never vendored)

| Tool | Purpose | Provenance discipline |
| --- | --- | --- |
| `bwrap` (bubblewrap) | namespace sandbox supervisor | resolved from `bwrapPath` option, `ARENA_ISOLATION_BWRAP_PATH`, or PATH; version parsed and recorded in every environment report |
| `prlimit` (util-linux) | rlimit ceilings around the bwrap chain | same resolution order (`prlimitPath` / `ARENA_ISOLATION_PRLIMIT_PATH` / PATH) |
| `gcc` | test-time compilation of the C escape helper | optional; absence degrades battery probes to honest `NOT_SUPPORTED` markers |

### Dev-sandbox acquisition record (informational, not a shipped artifact)

The development sandbox (Debian trixie userland, kernel 5.10) had no bwrap
preinstalled and no root; bubblewrap `0.12.0-1~deb13u1` was fetched from
`deb.debian.org` (official Debian mirror, main component) as a `.deb` and
extracted locally with `dpkg-deb -x` — never installed system-wide, never
committed. The .deb's full dependency closure (libselinux, libcap, libpcre2)
was already present on the host. CI (ubuntu-latest) ships its own bwrap via
the runner image. The release-gate station records ITS OWN bwrap provenance
when reproducing the strict-mode run.

## Data provenance

- **Syscall numbers** for the seccomp denylist come from the Linux UAPI
  headers (`asm/unistd_64.h` and `asm-generic/unistd.h` of the target
  kernel family), not from third-party tables. Keyring/module/bpf/kexec/
  perf class only — see `src/seccomp.ts`.
- **bwrap flag semantics** (`--info-fd` JSON keys, seccomp fd format,
  exit-status propagation as 128+signum) verified against the bubblewrap
  0.12.0 upstream source and empirically probed in this sandbox.

## Integrity properties

- The spawn layer constructs **argv arrays only** — no shell string
  interpolation exists on any execution path (auditable in the recorded
  `bwrap_argv` evidence of every run).
- Input mount host paths are `realpath`-resolved and must lie inside the
  capsule's own tenant-scoped workspace directory; cross-tenant paths fail
  closed with the typed `ARENA_TENANT_MISMATCH` refusal.
- Sandbox environment is built exclusively from an explicit allowlist
  (`--clearenv` first); host environment variables never pass through.
- The capability report records raw probe stderr samples and limitations —
  environment gaps are reported, never converted to success.
