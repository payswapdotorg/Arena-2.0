# Arena 2.0 Fork Baseline Report — AR2-000

Report generated from a live clean checkout and verification battery. No result below is inferred from a template, a prior run, or a claim in a PR description.

## Identity

- Repository: https://github.com/payswapdotorg/arena-2.0
- Commit SHA: 96e3edf48f76987b6682b74fc8d1e8669ca5cfd4 (main at battery time; unchanged since 2026-10-09T19:08:32Z)
- Base upstream SHA: 29628c9acdb81b703bbd4080c207a0e7ce5e276e (zai-org/ZCode v3.14.3)
- Branch: ar2/000-baseline-evidence (evidence branch; battery executed on clean main checkout)
- UTC timestamp: 2026-10-10T00:55Z–01:30Z (install through battery)
- OS / architecture: Debian GNU/Linux 13 (trixie), x86_64, 2 vCPU, 3 GB RAM, ~7.3 GB free disk
- Node version: v24.21.0 (upstream mise.toml pins 24.14.0 — toolchain drift recorded; type stripping and node:test used from 24.x line)
- pnpm version: 10.33.2 (matches mise.toml pin)
- Toolchain source (mise.toml): node 24.14.0 / pnpm 10.33.2, `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`, `COREPACK_ENABLE_PROJECT_SPEC=0`; mise itself is not installed in this environment — pnpm installed via npm to the pinned version; ELECTRON_MIRROR exported manually per mise env
- Clean checkout verified: yes — fresh `git clone` at 2026-10-10T00:55Z; `git status` clean before install; `.git` verified at 96e3edf
- Worktree status: clean at start; after battery, untracked build outputs exist (`packages/*/dist`, `packages/*/out`, `.tsbuildinfo` files, `node_modules`) — all gitignored upstream, verified with `git status --short` showing no tracked-file modifications

## Inherited source inventory

- Desktop/web/CLI entry points:
  - `packages/desktop` — Electron main/host/renderer; build composes main bundle (vite/rolldown) + renderer; scripts `pre-dev`, `build`, `bundle`, runtime-asset preparation.
  - `packages/web` — vite React web client (`vite build`).
  - `apps/zcode-cli` — CLI/TUI/Agent runtime monorepo (own packages: `core`, `tui`, `adapters`, `shared-types`, `debug`, `dynamic-workflow`, `tools/typescript`); build orchestrated by **turbo** (`turbo run build`).
  - `packages/zcode-server-cli` — server CLI packaging.
- API and server entry points: `packages/server` — HTTP/WebSocket server built with tsup (`src/entry-http.ts`), includes `ssh-backend`, `wsl-backend`, `broker-helper` modules; remote connectivity modes.
- Auth/session/tenant capabilities: Z.ai OAuth (public client id in `.env.example`), credential cipher (`apps/zcode-cli/packages/adapters/src/auth/`), workspace identity concept in AGENTS.md. **Upstream is a single-user product: no multi-tenant authn/authz, no tenant-scoped object model exists.**
- Persistence providers and authoritative stores: file-system/config-directory based (`packages/services/src/paths.ts`, app config dirs; session snapshots on disk via zcode-task-service). **No relational database, no migrations, no durable outbox upstream.**
- Background jobs, outbox, leases, retry and recovery: **none durable.** Task/session history is process-local with disk snapshots; no lease/fencing semantics upstream.
- RPC/WebSocket/remote workspace boundaries: `packages/rpc` (protocol/types), `packages/server` WS, remote desktop modes (`dev-desktop-remote-prod.mjs`); listener/auth restrictions must be re-verified before exposure (per upstream NOTICE).
- Plugin/MCP/hook/process capability paths: `apps/zcode-cli/packages/adapters/src/mcp/` (incl. OAuth credentials), `packages/provider`/`provider-node`/`model-option-map` (model provider plugins + builtin provider config), desktop hooks/extension loading (turbovpn-style extension loading observed in replay infra, not in repo).
- Filesystem/network/credential permissions: agent runtime has shell/filesystem/network access by design; **NOTICE.md: shared Agent execution adapter provides no default OS-level sandboxing** (inherited risk, locked in spec/architecture-lock.md).
- Object storage and artifact flows: none upstream (CDN remote assets only: `ZCODE_REMOTE_ASSET_CDN_BASE_URL`).
- Payment or user billing paths inherited from upstream: **none.**
- Third-party notices/licenses/required disclosures: `LICENSE` (Apache-2.0), `NOTICE.md` (27.7 KB), `THIRD-PARTY-NOTICES.md` (1.95 MB), `scripts/license-texts/`, `scripts/generate-third-party-notices.mjs` — all present on main and unmodified.
- Known limitations and source references: see "Security and threat notes" below; upstream ZCode v3.14.3 ships **no test-runner configuration** (details in Commands table).

## Commands and results

All commands executed in the clean checkout described above. Durations rounded. Logs retained at the executing station and summarized here; upstream scripts are the source of truth for exact invocations (`package.json` scripts, `mise.toml` tasks).

| Check | Exact command | Exit/result | Duration | Notes |
|---|---|---|---|---|
| Dependency install | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install` | PASS (resumed run: `Done in 17.8s`) | ~4 min total (two-phase) | First run completed 2.6 GB `node_modules` + native builds (ssh2 gyp OK, node-pty electron-rebuild) but the runner session ended mid-postinstall; immediate re-run completed cleanly. Lockfile `pnpm-lock.yaml` (19,252 lines) present and respected. |
| Workspace freshness | `node scripts/check-workspace-freshness.mjs` | PASS — "基线新鲜：main（与 origin/main 同步）ahead 0 / behind 0（阈值 50）" | 1s | Upstream freshness gate works as documented. |
| Build/bootstrap (full) | `pnpm -r build` | **FAIL — exit 137 (SIGKILL/OOM)** | 72s to failure | `apps/zcode-cli` turbo build killed at `@zcode/core#build` after 1m11s. Kernel OOM in 3 GB sandbox — environment-limited, not an upstream code defect. Sub-packages built green first: `debug`, `dynamic-workflow`, `shared-types`, `tools/typescript`. |
| Build (packages/* only) | `pnpm --filter './packages/*' run build` | **PARTIAL — 7 green / 1 OOM / 1 mixed / 5 n.a.** | ~4 min | Green: `model-option-map`, `formal-proof`, `rpc`, `provider`, `provider-node`, `zcode-server-cli`, `server` (tsup + remote build). FAIL: `web` — `vite build` exit 137 (OOM at client build). MIXED: `desktop` — main bundle "Build success in 8485ms" (out/main/index.js 664 KB + chunks), renderer `vite build` SIGKILLed during chunk rendering (OOM). n.a. (no build script, by design): `client`, `services`, `shared`, `ui`, `zcode-cua` — these are consumed as workspace TS source and emit via root `tsc -b`. |
| Typecheck | `pnpm typecheck` (`tsc -b` over 11 projects) | **PASS — 0 errors** | 146s | Full project-reference build graph clean; emits `packages/*/dist` declarations+JS. |
| Lint | `pnpm lint` (oxlint) | **PASS — 0 errors, 70 warnings** | 1.3s / 2613 files | Pre-existing warnings only (unused params etc.). `verify:pre-push` = `lint && architecture:check -- --changed` per root package.json. |
| Format | `pnpm fmt:check` (oxfmt --check) | **FAIL — 48 files with format issues** | 6.1s / 2938 files | Pre-existing upstream formatting drift; not introduced by Arena docs. Recorded as inherited failure; fix belongs to a dedicated formatting commit, not mixed into feature PRs. |
| Architecture guard | `pnpm architecture:check` | **PASS — violations: 0, baseline: 0, new: 0** | 1s | `.architecture-baseline.json` (version 1, empty violations) respected. |
| Package/unit tests | `node_modules/.bin/tsx --test test/*.test.ts` (per package) | **PASS — 16/16** (services 10/10 in 3.65s; ui 6/6 in 1.32s) | ~5s total | **Discovered entry point.** Upstream ships NO root or package `test` script and NO runner config (no vitest/jest/playwright anywhere). The 4 existing test files (`packages/services/test/*.test.ts` ×3, `packages/ui/test/nonCliAcpRetirement.test.ts` ×1) use `node:test` + `node:assert` and import built/TS paths that plain `node --test` cannot resolve (ERR_MODULE_NOT_FOUND on `.js`-suffixed TS imports); they run correctly under the `tsx` loader present in devDependencies. |
| E2E/desktop/web smoke | — | **NOT RUNNABLE — no upstream test infrastructure exists** | — | No playwright/vitest/jest config, no smoke scripts, no test tooling in root devDependencies. E2E coverage is an Arena-side gap to close via AR2-002..007 gates, not an inherited capability. |
| Secret/dependency/license scan | `git ls-files` + pattern scan (`ghp_`, `github_pat_`, `sk-`, `AKIA`, `BEGIN PRIVATE KEY`) over tracked files; `.env*` inspection | **CLEAN** | ~2 min | No hardcoded secrets in tracked files. `.env.development`/`.env.production` contain endpoint comments only; `.env.example` contains public endpoints and an explicitly-public OAuth client id (`ZAI_OAUTH_CLIENT_ID`, annotated "线上公开 OAuth client id，不是 secret"). |
| Fresh-clone smoke | (this battery) | PASS | — | The battery itself ran on a fresh clone: clone → install → typecheck/lint/arch/tests all reproduce. |
| Line count (aux) | `bash scripts/count-lines.sh` | PASS | <1s | Largest files ~403 lines; no god-files. |

Operator errors recorded (not upstream defects): appending `--reporter=append-only` to `pnpm -r build` forwards the flag into child scripts (`turbo`, `tsc` reject it); the correct invocation is plain `pnpm -r build`.

## Architecture/path map

Planned logical modules (docs/architecture/ARENA-2.0-SYSTEM-ARCHITECTURE.md §4) mapped to actual upstream paths with reuse decisions. "NEW" packages follow the existing `packages/*` pnpm workspace convention (pnpm-workspace.yaml `packages/*`); no duplicate workspace tree is created.

| Logical module | Actual path / vehicle | Decision | Owner WO |
|---|---|---|---|
| arena-contracts | new `packages/arena/contracts` (or `packages/arena-contracts`) | NEW — no upstream equivalent; sibling precedent `packages/shared` | AR2-001 |
| arena-domain | new arena domain package | NEW — keep isolated from ZCode services | AR2-001/002 |
| arena-application | new arena application package | NEW | AR2-002+ |
| arena-api | `packages/server` composition OR new arena API package mounted beside it | EXTEND/WRAP — upstream server (tsup, entry-http) is the HTTP precedent; final mount decision frozen at AR2-001 | AR2-002 |
| arena-mcp | new; reuse MCP wiring patterns from `apps/zcode-cli/packages/adapters/src/mcp/` | NEW + pattern-reuse | AR2-011 |
| arena-persistence | new relational store + adapters | NEW — upstream has NO relational persistence | AR2-005 |
| arena-workers | new jobs/outbox runtime | NEW — no durable jobs upstream | AR2-005 |
| arena-capsule-contracts | new | NEW | AR2-004 |
| arena-capsule-host | new; **upstream agent runtime explicitly NOT reused as capsule** (no OS sandbox per NOTICE) | NEW | AR2-004 |
| arena-verification | new; inspect `packages/formal-proof` for reusable validation primitives | NEW (+ investigate reuse) | AR2-007 |
| arena-payments | new | NEW — no payments upstream | AR2-010 |
| arena-experts | new | NEW | AR2-008 |
| arena-learning | new | NEW | AR2-014 |
| arena-ui | `packages/ui` (shared React kit) + `packages/web` shell; Arena routes/components added per ownership map | REUSE shell + NEW routes | AR2-003 |
| arena-sdk | new; precedent `packages/client` | NEW | AR2-011 |
| adapters/ | per-port new adapters; upstream `packages/provider*` is model-provider config, unrelated | NEW | WO-specific |

Every planned Arena integration point above has an owner (work order column). ZCode workspace ≠ OS isolation: recorded as a hard constraint — the capsule seam (AR2-004) is mandatory before any untrusted expert execution.

## Security and threat notes

- Inherited execution paths with shell/filesystem/network access: the ZCode agent runtime (apps/zcode-cli + desktop host) executes tools/processes by design. Any Arena expert execution MUST go through the CapsuleProvider seam; the upstream runtime is not a tenant boundary.
- OS isolation capabilities actually demonstrated: **none.** NOTICE.md declares no default OS sandboxing for the shared Agent execution adapter; nothing in this baseline contradicts that.
- Untrusted plugin/MCP/tool paths: provider plugins (`packages/provider*`), MCP adapters (`adapters/src/mcp/`), desktop hooks — all assume a trusted single user. Treat as untrusted surfaces in Arena threat models.
- Secret sources and propagation: config-dir credentials (cipher at `adapters/src/auth/credential-cipher.ts`), `.env` endpoint overrides; no secrets found in tracked files. Arena must add scoped, short-lived capsule credentials (AR2-004).
- Remote/listener/auth constraints: `packages/server` remote modes and listener restrictions exist but were NOT penetration-tested in this baseline; verify before exposure (AR2-013/015).
- Tenant isolation tests: none possible — no multi-tenant surface exists upstream. Arena tenant tests arrive with AR2-002/005.
- What remains unproven: any CI on GitHub (none exists — see Outcome), branch protection (absent), cross-platform installs (Linux-only evidence here), E2E smoke (no infrastructure), and full heavyweight builds in this 3 GB sandbox.
- Required mitigations before untrusted expert sessions: capsule isolation conformance suite (AR2-004), tenant-scoped authz (AR2-002/005), evidence provenance (AR2-007), payout gating (AR2-010). Live-money remains disabled (ledger: DISABLED).

## Outcome

- Baseline classification: **PASS WITH EXISTING FAILURES** — install/typecheck/lint/architecture/unit-tests green; pre-existing format drift (48 files); environment-limited build failures (OOM at `@zcode/core`, `web` vite, desktop renderer) that are sandbox RAM constraints, not upstream defects; zero upstream test infrastructure beyond 4 node:test files.
- AR2-000 acceptance checklist:
  - [x] Clean clone/install recorded (two-phase install, lockfile respected, natives built)
  - [x] Available baseline checks recorded with exact commands, exits, durations (table above)
  - [x] Actual file paths verified (architecture/path map with real upstream paths)
  - [x] Every planned Arena integration point has an owner (map's WO column)
  - [x] No assumption that ZCode workspace equals OS isolation (explicitly recorded; capsule seam mandatory)
  - [x] Licensing/attribution preserved and inventoried (Apache-2.0, NOTICE, THIRD-PARTY-NOTICES unmodified)
- Issues/PRs opened: this report rides PR "AR2-000 baseline evidence" (branch `ar2/000-baseline-evidence`); issue #2 acceptance comment to follow; CI + branch protection findings below.
- Exact follow-on contract questions for AR2-001:
  1. arena-api mount: extend `packages/server` vs. new arena API package (affects AR2-002 fence) — freeze at AR2-001.
  2. Arena package layout: single `packages/arena/*` multi-module package vs. sibling `packages/arena-*` packages (affects all write fences).
  3. Persistence engine selection for the AR2-005 port (embedded Postgres precedent vs. other) — contract must stay engine-neutral.
  4. `packages/formal-proof` reuse scope for arena-verification validators.
  5. Whether the format drift (48 files) is normalized in a dedicated TL formatting commit before Wave 1 forks (recommended: yes, before three workers fork branches off a drifting tree).
- CI and repository protection findings (verified live 2026-10-10T00:54Z):
  - **No `.github/` directory exists — zero CI workflows defined; 0 check-runs and 0 statuses on main tip 96e3edf.**
  - **Branch protection on `main` is ABSENT** (API 404 "Branch not protected"); force-push and direct push to main are currently possible for any writer.
  - Required follow-up (TL-owned surfaces per ownership-map): add CI workflow (typecheck/lint/architecture checks + test entry via tsx) and enable branch protection before Wave 1 dispatch. Recorded as AR2-001 readiness conditions (see spec/work-orders/ar2-001-acceptance.md).
- TL reviewer: payswapdotorg TL (this report's author), evidence logs retained at the executing station (`tool-results/arena2-*`).
- Decision on AR2-001 readiness: **READY** — the baseline is measured, integration points are mapped and owned, and the contract-freeze questions above are exactly the questions AR2-001 exists to answer. AR2-001 may start immediately after this report merges; Wave 1 (AR2-002/003/004) remains gated on AR2-001 acceptance + CI/protection follow-up.
- Link from spec/PROJECT-STATE.md: updated in the same PR (M0 row + frontier section).

No tokens, credentials, or secret-bearing environment dumps are included in this report.
