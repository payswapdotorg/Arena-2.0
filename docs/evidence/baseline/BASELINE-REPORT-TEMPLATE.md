# Arena 2.0 Fork Baseline Report

Copy this file to a dated, commit-addressed report for AR2-000. Do not mark checks passed until their actual output is available.

## Identity

- Repository:
- Commit SHA:
- Base upstream SHA:
- Branch:
- UTC timestamp:
- OS / architecture:
- Node version:
- pnpm version:
- Toolchain source (mise.toml):
- Clean checkout verified:
- Worktree status:

## Inherited source inventory

- Desktop/web/CLI entry points:
- API and server entry points:
- Auth/session/tenant capabilities:
- Persistence providers and authoritative stores:
- Background jobs, outbox, leases, retry and recovery:
- RPC/WebSocket/remote workspace boundaries:
- Plugin/MCP/hook/process capability paths:
- Filesystem/network/credential permissions:
- Object storage and artifact flows:
- Payment or user billing paths inherited from upstream:
- Third-party notices/licenses/required disclosures:
- Known limitations and source references:

## Commands and results

Record each command separately. Include exit code, duration, test count where applicable, log/evidence link, whether result came from a clean state, and any pre-existing failure.

| Check | Exact command | Exit/result | Evidence path/URL | Notes |
|---|---|---|---|---|
| Dependency install | | NOT RUN | | |
| Workspace freshness | | NOT RUN | | |
| Build/bootstrap | | NOT RUN | | |
| Typecheck | | NOT RUN | | |
| Lint | | NOT RUN | | |
| Format | | NOT RUN | | |
| Architecture guard | | NOT RUN | | |
| Package/unit tests | | NOT RUN | | |
| E2E/desktop/web smoke | | NOT RUN | | |
| Secret/dependency/license scan | | NOT RUN | | |
| Fresh-clone smoke | | NOT RUN | | |

## Architecture/path map

For every planned logical module, record the real package/path and decision: reuse, wrap, extend, isolate, deprecate or new. Include public entry points, owning state store and dependencies. A diagram or package graph should be attached.

## Security and threat notes

- Inherited execution paths with shell/filesystem/network access:
- OS isolation capabilities actually demonstrated:
- Untrusted plugin/MCP/tool paths:
- Secret sources and propagation:
- Remote/listener/auth constraints:
- Tenant isolation tests:
- What remains unproven:
- Required mitigations before untrusted expert sessions:

## Outcome

- Baseline classification: PASS / PASS WITH EXISTING FAILURES / BLOCKED.
- AR2-000 acceptance checklist:
- Issues/PRs opened:
- Exact follow-on contract questions:
- TL reviewer:
- Decision on AR2-001 readiness:
- Link from spec/PROJECT-STATE.md:

Do not include tokens, credentials, private customer data or unredacted secret-bearing environment dumps in this report.
