# AR2-020 — Cross-platform install evidence

Work order: [AR2-020 — Cross-platform install evidence (macOS and Windows)](https://github.com/payswapdotorg/Arena-2.0/issues/52) (WO3.0 release plan, `spec/work-orders/release-plan.md`)

This directory holds the install/run evidence machinery and records for the
AR2-015 release-gate blocker **grg_00000002 — cross-platform install proof
BLOCKED** (see `docs/evidence/release/AR2-015-gate-report-2026-10-11.md`).
It proves, per platform, that a fresh runner can install the Arena 2.0
workspace at an EXACT pinned SHA and run the frozen install batteries — not
merely compile, but run the vertical scenario smoke.

## Contents

| Path | What it is |
| --- | --- |
| `AR2-020-install-evidence-2026-10-12.md` | The evidence report: per-platform matrix, exact commands, results, dispositions, sandbox probes, limitations |
| `ci-install-evidence.proposal.yml` | Proposed GitHub Actions workflow (ubuntu/macos/windows matrix, transcripts + JSON as artifacts). The TL owns `.github/**` and lands it at integration — that is the recorded path for the actual macOS/Windows runs |
| `runs/linux-<sha>/` | Committed baseline artifacts: `install-evidence.json` (machine-readable, schema `arena-install-evidence/1.0`) and `install-transcript.txt` (full human transcript) from the real sandbox run |

The harness itself lives in `scripts/install-verify/` (see below).

## How a release owner reproduces a platform run

All three entry points share one contract: resolve the EXACT pinned SHA
(argument 1; default is the AR2-020 mandated base `c9b86d1`), bootstrap
Node 24 + pnpm@10.33.2 if absent (recording every bootstrap command), run
the frozen battery with every command echoed to the transcript, and emit
`install-evidence.json` + `install-transcript.txt` into the output directory.
Exit code 0 = overall PASS, 1 = FAIL.

```bash
# Linux (the baseline; runs end to end on a plain Linux box)
bash scripts/install-verify/verify-linux.sh <sha>

# macOS (git + Homebrew-available tooling assumed on a fresh runner)
bash scripts/install-verify/verify-macos.sh <sha>

# Windows (Windows PowerShell 5.1 or pwsh 7+)
powershell -ExecutionPolicy Bypass -File scripts\install-verify\verify-windows.ps1 -Sha <sha>
pwsh -File scripts/install-verify/verify-windows.ps1 -Sha <sha>          # equivalent
```

The battery (identical to the CI invocation shapes):

1. `pnpm install --frozen-lockfile`
2. `pnpm typecheck`
3. `pnpm lint`
4. `pnpm architecture:check`
5. `packages/arena-contracts` corpus — `../../node_modules/.bin/tsx --test test/vectors.test.ts test/transitions.test.ts test/completeness.test.ts test/ownership.test.ts test/contracts.test.ts`
6. `packages/arena-capsule` corpus — `../../node_modules/.bin/tsx --test test/capsule.test.ts test/synthetic-provider.test.ts`
7. `packages/arena-harness` vertical smoke — `../../node_modules/.bin/tsx --test test/vertical-p0.test.ts test/next-expert.test.ts test/p2-review.test.ts test/two-instance-recovery.test.ts`
8. typed OS-isolation-runtime capability probe (recorded as `not_supported` with the probe reason where it cannot run — NEVER a silent skip)

Environment overrides (all scripts):

| Variable | Meaning | Default |
| --- | --- | --- |
| `INSTALL_VERIFY_MODE` | `auto` (in-place when CWD HEAD == pinned SHA, else fresh clone), `in-place`, `fresh` | `auto` |
| `INSTALL_VERIFY_ORIGIN` | git URL or local path used by fresh-clone mode | origin remote of the CWD repo, else the canonical GitHub URL |
| `INSTALL_VERIFY_OUT` | output directory for the two artifacts | invocation CWD |
| `INSTALL_VERIFY_KEEP` | `1` = keep the fresh-clone temp dir for post-mortem | unset |
| `INSTALL_VERIFY_DISPOSITION_<STEP>` | operator classification of a failed step (`fixed-in-commit` / `platform-limitation` / `not-supported`; STEP upper-cased, `-`→`_`, e.g. `INSTALL_VERIFY_DISPOSITION_CAPSULE_CORPUS`) | failures record `unclassified` and must be dispositioned in the evidence report |

## Where the evidence lands

- **Local runs:** `install-evidence.json` + `install-transcript.txt` in
  `INSTALL_VERIFY_OUT` (or the invocation directory). Do not commit these
  incidentally; committed baseline records live under `runs/` here with the
  platform and SHA in the directory name.
- **CI runs (TL-wired):** the proposed workflow uploads both files per
  platform as workflow artifacts named `install-evidence-<os>`. A release
  owner cites those artifacts (or a committed `runs/` record) in the
  AR2-023 decision record.

## JSON evidence schema (`arena-install-evidence/1.0`)

```jsonc
{
  "schema": "arena-install-evidence/1.0",
  "work_order": "AR2-020",
  "harness": "scripts/install-verify/verify-<platform>.sh|.ps1",
  "platform": "linux|darwin|win32",
  "platform_label": "human-readable OS + arch",
  "os": { "name": "...", "version": "...", "arch": "...", "kernel": "...", "shell": "..." },
  "resources": { "cpu_count": "...", "mem_total": "...", "disk_free": "..." },
  "pinned_sha": "<40-hex the battery ran against>",
  "source_mode": "fresh-clone|in-place-checkout",
  "origin": "<origin used for fresh-clone>",
  "repo_clean": "true|false",
  "tools": { "node": "...", "pnpm": "...", "git": "...", "tsx": "..." },
  "bootstrap": { "commands": "<exact bootstrap commands recorded>", "notes": "..." },
  "steps": [
    {
      "name": "install|typecheck|lint|architecture-check|contracts-corpus|capsule-corpus|harness-smoke|...",
      "command": "<exact command as echoed>",
      "exit_code": 0,
      "duration_ms": 1234,
      "notes": "...",
      "tests": { "pass": 104, "fail": 0, "cancelled": 0, "skipped": 0 }  // node:test steps only
    }
  ],
  "capabilities": [ { "name": "os-level-isolation-runtime", "status": "available|not_supported", "reason": "<typed probe reason>" } ],
  "failures": [ { "step": "...", "disposition": "fixed-in-commit|platform-limitation|not-supported|unclassified", "reason": "..." } ],
  "verdict": { "overall": "PASS|FAIL", "generated_at": "<ISO-8601 UTC>" }
}
```

Failure dispositions follow the AR2-020 vocabulary: `fixed-in-commit`
(a platform-forced fix landed in the owning module — each such commit
message must cite the platform evidence), `platform-limitation`,
`not-supported`. A run with any failed battery step is `FAIL` regardless of
disposition — dispositions explain, they never waive.

## Frozen-corpus policy

The three corpora are frozen to the test files above (the exact set CI runs
at the pinned SHA). If `test/*.test.ts` in a package drifts from the frozen
list, the harness prints a `corpus drift` note into the transcript — it does
not silently widen the corpus. Re-freezing belongs to the owning work order.
