# AR2-020 — Cross-platform install evidence report

**Date:** 2026-10-12
**Work order:** [AR2-020 — Cross-platform install evidence (macOS and Windows)](https://github.com/payswapdotorg/Arena-2.0/issues/52) — WO3.0 production-readiness release plan (`spec/work-orders/release-plan.md`)
**Turns blocker into evidence:** AR2-015 gate row `grg_00000002` — *"macOS/Windows install proof (required before any cross-platform release claim)"* — classified **BLOCKED** in `docs/evidence/release/AR2-015-gate-report-2026-10-11.md`
**Dispatch base SHA (mandated):** `c9b86d199d9fe95180de0e817b9af4c0b2d0055b`
**Evidence SHA (tree the harness battery ran against):** `ceea2d638839485cad888411387d945a80af9978` (head of the harness commit on `work/AR2-020-install-evidence`; delta vs. base = `scripts/install-verify/**` only)
**Branch:** `work/AR2-020-install-evidence`
**Write fence:** `scripts/install-verify/**` + `docs/evidence/install/**` only (see fence attestation below)

## What was delivered

1. **Install-verification harness** — `scripts/install-verify/`: three self-contained entry points (`verify-linux.sh`, `verify-macos.sh`, `verify-windows.ps1`), each emitting a full human transcript and a machine-readable `install-evidence.json` (schema `arena-install-evidence/1.0`, documented in [README.md](README.md)). Each script: records environment → bootstraps Node 24 + pnpm@10.33.2 (recording the commands) → resolves the EXACT pinned SHA (in-place checkout or fresh clone) → runs the frozen battery (`pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm architecture:check`, arena-contracts corpus, arena-capsule corpus, arena-harness vertical smoke — invoked exactly like CI: `cd <package> && ../../node_modules/.bin/tsx --test ...`) → records a typed OS-isolation-runtime capability probe (never a silent skip) → emits JSON with per-step `{name, command, exit_code, duration_ms, notes}`, node:test summaries, failures with dispositions and the overall verdict. Exit 0 = PASS, 1 = FAIL.
2. **This evidence directory** — the report, the reproduction README, the committed Linux baseline artifacts (`runs/linux-ceea2d6/`), and the proposed CI workflow (`ci-install-evidence.proposal.yml`) for the TL to land under `.github/workflows/` (the recorded path for the actual macOS/Windows runs).

## Per-platform matrix

| Platform | Status | OS / kernel | Arch | Node | pnpm | git | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Linux (baseline)** | ✅ **PASS** — full battery, fresh clone at pinned SHA | Debian GNU/Linux 13 (trixie), Linux 5.10.134 | x86_64 | v24.21.0 | 10.33.2 | 2.47.3 | `runs/linux-ceea2d6/install-evidence.json` + `install-transcript.txt` (this sandbox run; summarized below) |
| **macOS** | ⏳ `pending-runner` — harness delivered; sandbox cannot execute darwin (probes below) | target: `macos-latest` (runner) | arm64/x64 | 24 (bootstrap: `brew install node@24`) | 10.33.2 (bootstrap: `npm install -g pnpm@10.33.2`) | runner-provided | run via `bash scripts/install-verify/verify-macos.sh <sha>`; TL lands `ci-install-evidence.proposal.yml` to produce it |
| **Windows** | ⏳ `pending-runner` — harness delivered; sandbox cannot execute win32 (probes below) | target: `windows-latest` (runner) | x64/arm64 | 24 (bootstrap: nodejs.org ZIP, no admin) | 10.33.2 (bootstrap: `npm install -g pnpm@10.33.2`) | runner-provided | run via `powershell -ExecutionPolicy Bypass -File scripts\install-verify\verify-windows.ps1 -Sha <sha>`; TL lands the proposal workflow to produce it |

## Linux baseline — recorded run (summarized numbers; full log in `runs/linux-ceea2d6/`)

Command (sandbox, Debian 13 container):

```bash
INSTALL_VERIFY_MODE=fresh \
INSTALL_VERIFY_ORIGIN=/home/z/arena \   # local clone of the branch head (pre-push); post-push the canonical URL reproduces the identical tree
INSTALL_VERIFY_OUT=docs/evidence/install/runs/linux-ceea2d6 \
bash scripts/install-verify/verify-linux.sh ceea2d638839485cad888411387d945a80af9978
```

| Step | Command | Exit | Duration | Result / notes |
| --- | --- | --- | --- | --- |
| env | environment capture | 0 | 341 ms | Debian 13, x86_64, 2 CPU, 4.1 GiB RAM; recorded verbatim in transcript |
| bootstrap | ensure node>=24 + pnpm@10.33.2 | 0 | 1836 ms | node v24.21.0 + pnpm 10.33.2 already present in sandbox — recorded as no-op (the script's apt/npm bootstrap path exists for bare runners) |
| resolve-source | fresh `git clone` + `git checkout ceea2d6…` | 0 | 1668 ms | `rev-parse HEAD` verified == pinned SHA; `repo_clean: true` |
| install | `pnpm install --frozen-lockfile` | 0 | 10174 ms | `Done in 10.1s using pnpm v10.33.2`; node_modules did NOT pre-exist (fresh clone). 1 pre-existing warning line: `apps/zcode-cli WARN Unsupported engine: wanted: {"node":"24.14.0"} (current: {"node":"v24.21.0"})` — inherited ZCode surface, non-blocking |
| typecheck | `pnpm typecheck` | 0 | 127410 ms | `tsc -b` across all 31 registered projects — 0 errors |
| lint | `pnpm lint` | 0 | 1158 ms | `Found 70 warnings and 0 errors` (70 pre-existing oxlint warnings, 0 errors — same posture as the CI battery on every accepted WO) |
| architecture-check | `pnpm architecture:check` | 0 | 1213 ms | `architecture: OK; violations: 0; baseline: 0; new: 0` |
| contracts-corpus | `tsx --test test/vectors.test.ts test/transitions.test.ts test/completeness.test.ts test/ownership.test.ts test/contracts.test.ts` | 0 | 2058 ms | **104 pass / 0 fail / 0 cancelled / 0 skipped** |
| capsule-corpus | `tsx --test test/capsule.test.ts test/synthetic-provider.test.ts` | 0 | 2024 ms | **32 pass / 0 fail / 0 cancelled / 0 skipped** |
| harness-smoke | `tsx --test test/vertical-p0.test.ts test/next-expert.test.ts test/p2-review.test.ts test/two-instance-recovery.test.ts` | 0 | 5897 ms | **5 pass / 0 fail** — REAL spawned arena-api processes: P0 vertical (exactly-one payout + signed webhooks + stable-ID trace), next-expert routing, P2 independent review, two-instance SIGKILL crash recovery |
| isolation-runtime-probe | typed capability probe | 0 | — | **not_supported (typed, not skipped):** bwrap absent on this runner; the AR2-019 OS-level isolation runtime is not merged at this pinned SHA (probe: `command -v bwrap`) |

**Verdict: PASS** — `failures: []`, all battery steps exit 0. Machine record: `runs/linux-ceea2d6/install-evidence.json` (`generated_at 2026-10-12T22:01:22Z`).

Honest environment disclosure: the sandbox's pnpm store was already populated by the §4 base battery (below), so the fresh-clone install was store-warm (10.1 s). A cold-runner install downloads packages (the ubuntu-latest CI battery performs the identical install on every accepted WO PR). The store-warm condition affects duration only, never the exit code or the frozen-lockfile resolution.

## §4 verification battery (run before the harness commit, at the mandated base tree `c9b86d1`)

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | OK — `Done in 54.8s` (cold store in this sandbox) |
| `pnpm typecheck` | 0 errors |
| `pnpm lint` | 0 errors (70 pre-existing warnings) |
| `pnpm architecture:check` | PASS — 0 violations |
| `packages/arena-contracts && ../../node_modules/.bin/tsx --test test/vectors.test.ts test/transitions.test.ts test/completeness.test.ts test/ownership.test.ts test/contracts.test.ts` | 104 pass / 0 fail |
| `packages/arena-capsule && ../../node_modules/.bin/tsx --test test/*.test.ts` | 32 pass / 0 fail |
| `packages/arena-harness` vertical corpus (as above) | 5 pass / 0 fail |

## macOS / Windows sandbox probes (why `pending-runner`)

The worker sandbox is a Linux container; the following probes were executed and recorded on 2026-10-12T22:04:36Z:

| Probe command | Result | Consequence |
| --- | --- | --- |
| `command -v sw_vers` | ABSENT (exit 1) | no macOS system surface |
| `ls /Applications` | cannot access — no such directory | not macOS |
| `test -d /Library` | absent | not macOS |
| `command -v pwsh` | ABSENT (exit 1) | no PowerShell (7+) to execute or even syntax-validate `verify-windows.ps1` |
| `command -v powershell` | ABSENT (exit 1) | no Windows PowerShell 5.1 |
| `command -v cmd.exe` | ABSENT (exit 1) | no Windows command surface |
| `test -e /mnt/c/Windows` | absent | not WSL |
| `command -v wine` / `command -v wine64` | ABSENT (exit 1) | no Windows emulation |
| `command -v docker` + `docker info` | ABSENT (`docker: command not found`) | no container engine, hence no Windows containers |

**Disposition:** macOS and Windows are recorded as `pending-runner` with the exact reason *the worker sandbox provides no darwin or win32 execution surface (probes above), and the work order's delivery channel for those legs is the TL-wired GitHub Actions matrix over these scripts*. The scripts are entry-point clean and runner-portable (no interactive input, no sandbox-private paths, pinned-SHA argument, self-bootstrap with recorded commands). `ci-install-evidence.proposal.yml` is the proposed workflow (`workflow_dispatch` + `push` on `scripts/install-verify/**`; matrix `ubuntu-latest` / `macos-latest` / `windows-latest`; uploads transcript + JSON as artifacts) for the TL to land under `.github/workflows/` — TL owns `.github/**`.

## Platform fixes in owning modules

**NONE.** The Linux baseline ran the unmodified workspace (base `c9b86d1` + harness files only) fully green. No package code (`packages/**`) was touched, and no platform-forced fix was required at this stage. Should the pending macOS/Windows runner legs surface a genuine platform defect, the fix belongs in the owning module with a commit message citing that platform evidence (per the AR2-020 fence) — none exists yet.

## Typed capability gaps recorded (never silent skips)

| Capability | Platform | Status | Probe reason |
| --- | --- | --- | --- |
| OS-level capsule isolation runtime (AR2-019, bwrap-based) | Linux (this run) | `not_supported` | `command -v bwrap` → absent; AR2-019 runtime not merged at evidence SHA `ceea2d6…` |
| OS-level capsule isolation runtime (AR2-019, bwrap-based) | macOS | `not_supported` | AR2-019 runtime is registered Linux-only (bwrap); no darwin equivalent at this SHA |
| OS-level capsule isolation runtime (AR2-019, bwrap-based) | Windows | `not_supported` | AR2-019 runtime is registered Linux-only (bwrap); no win32 equivalent at this SHA |

This is informational for the install gate and does not waive anything: OS-level isolation conformance itself is AR2-019's work order (gate row `grg_00000008`), explicitly out of AR2-020 scope.

## Fence attestation

```
git diff --stat c9b86d1..HEAD   # after the evidence commit (see completion report for the exact listing)
```

touches ONLY `scripts/install-verify/**` and `docs/evidence/install/**`. No root manifest, lockfile, workspace config, architecture policy, `.github/**`, spec, or package sources were modified. `pnpm-lock.yaml` was NOT committed.

## Limitations (honest list)

1. **macOS and Windows legs are `pending-runner`** — delivered as runnable, self-contained scripts plus a TL-reviewable workflow proposal; the runs themselves happen when the TL lands the workflow (or any operator with a mac/win box runs the entry points). Until those runs exist, AR2-015 `grg_00000002` can only be partially recomputed (Linux ✅, macOS/Windows ⏳).
2. **PowerShell script not machine-validated in this sandbox** (`pwsh` absent — probe above): `verify-windows.ps1` was written for Windows PowerShell 5.1 compatibility (no PS7-only syntax, ASCII-only source, `.cmd` shims, `-UseBasicParsing`, `Expand-Archive`) and hand-reviewed line by line, but its first real execution will be on the TL-wired `windows-latest` runner. Any syntax/portability fix forced by that run belongs in this fence with a commit message citing the run.
3. **Store-warm install duration** on the Linux baseline (disclosed above); exit codes and resolution are unaffected.
4. **The Linux baseline ran from a local-path origin** (`/home/z/arena`) because the branch head was not yet pushed at run time; the recorded tree is identical to the post-push canonical tree at the same SHA (`git rev-parse` verified). The TL-wired CI runs use the canonical origin.
5. The harness records environment resources "if cheap" (CPU/RAM/disk) — no attempt is made to fingerprint or pin runner hardware beyond the recorded values.
