# Upstream ZCode Foundation

Arena 2.0 is built on the public fork of zai-org/ZCode. The initial upstream/base commit is:

29628c9acdb81b703bbd4080c207a0e7ce5e276e

Upstream version reported by its package manifest: ZCode 3.14.3. Upstream Node/pnpm versions and commands should be checked against mise.toml and package.json in the checked-out repository.

Relevant inherited areas:
- packages/desktop: Electron main/host/renderer and packaging.
- packages/web: web client.
- packages/server: HTTP/WebSocket and remote connectivity.
- packages/ui: shared React components, hooks and state.
- packages/services: application services and storage boundaries.
- packages/shared and packages/rpc: shared types/protocol and RPC.
- packages/client: agent client SDK.
- apps/zcode-cli: CLI, TUI and Agent runtime.
- scripts, config and third-party: build, distribution, configuration and notices.

This mapping is an upstream inventory hint, not proof that these paths are the final location for Arena modules. The TL must inspect actual package exports and runtime composition before dispatch.

## Mandatory inherited constraints

Upstream NOTICE.md states that its shared Agent execution adapter does not provide default OS-level sandboxing. Workspaces, Git worktrees, browser isolation or UI boundaries are not system-level isolation guarantees. Some remote server modes have listener/auth restrictions that must be checked in source and tested before exposure. Tool permissions, hooks, plugins, MCP servers, child processes and shell startup may create side effects beyond what the model explicitly requests in the UI.

Arena therefore must not use a raw upstream workspace as a secure multi-tenant expert capsule. It needs a capsule provider with enforceable isolation, resource/effect policy, restricted egress, scoped credentials, evidence and tested teardown.

## License and notices

Preserve the upstream Apache-2.0 license text and required attributions, NOTICE content, third-party license records, and relevant upstream security/data disclosures. Update notices where Arena modifies or redistributes components. This file supplements, rather than replaces, LICENSE, NOTICE.md or third-party/ materials.

## Baseline proof

This file records the intended base SHA and known source-level constraints only. It does not claim that a fresh checkout/build, test suite, install, security review, or hosted deployment has been executed. AR2-000 owns actual baseline evidence and must link its report from spec/PROJECT-STATE.md.
