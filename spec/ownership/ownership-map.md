# Arena 2.0 Ownership Map

Version: OWN1.0
TL owns this file and the right to assign workers. Replace role labels with live GitHub identities in the active dispatch record before each wave.

## Global serialized surfaces — TL only

- Root package.json, pnpm-workspace.yaml, pnpm-lock.yaml, mise.toml and common compiler/linter configs.
- Shared contract exports and generated schema/type registries until the contract freeze; later changes require a TL-coordinated contract PR.
- Migration ordering, shared database schema integration, test fixtures used by multiple lanes and environment-variable inventories.
- CI workflows, branch protection, release tags, version/release decisions and main branch merges unless delegated explicitly.
- spec/PROJECT-STATE.md, dependency graph, ownership map and final gate classification at integration.
- Cross-cutting files edited by multiple work orders: the TL serializes changes to avoid lost updates.

## Wave 1 fixed lanes

Worker 1 / AR2-002:
- Arena-specific API transport, route handlers, request/response validation adapter, auth-context adapter, application use-case adapter and API tests.
- No changes to root manifests, canonical domain contract, DB migrations, capsule provider, or UI.

Worker 2 / AR2-003:
- Arena requester/expert/reviewer UI routes and components, Arena UI client/hooks, UI E2E tests, isolated CSS/design assets.
- May use frozen mock client during parallel work.
- No API/domain/persistence state writes, no permissions implemented only in UI, and no root manifest.

Worker 3 / AR2-004:
- Capsule interfaces, environment manifest, provider adapters, conformance/security tests, capsule-specific documentation.
- No arbitrary host execution exposure, no public API route implementation, no payout state machine, no root manifest.

## Wave 2 ownership extensions

Worker 1 / AR2-005:
- Database migrations, durable repositories, transaction/outbox/job adapters and persistence/resilience tests. Coordinate any required dependency or root manifest change with TL; do not rewrite API routes without agreement.

Worker 2 / AR2-006:
- UI API integration, status/evidence screens, self-evaluation/review/appeal and UX tests. Does not own API schema or server authorization.

Worker 3 / AR2-007:
- Evidence envelope, validator registry/orchestration, proof-decision engine and tests. Does not own payment state or modify capsule isolation assumptions; coordinate through the capsule port.

## Subsequent assignments

Matching/qualification, Expert Arena, payment ledger, SDK/MCP/webhooks, operations and learning have explicit work orders. TL assigns each only when dependencies are ready and freezes path ownership in the GitHub issue. A worker may change lanes between waves; old fences remain per PR/WO, not as permanent exclusive ownership over unrelated future work.

## Shared integration rules

- One writer for every durable state field and one application command path.
- UI calls public typed client/hooks; it does not import repositories or adapter internals.
- API/MCP/webhooks call the same use cases and authorization boundary.
- Capsule host owns actual isolation and runtime lifecycle; domain stores metadata and policy decisions.
- Verification owns proof decisions; payments consume a durable decision and never infer correctness.
- Requester apps own application of accepted output to the live world.
- Worker changes outside path fences are rejected or explicitly re-dispatched as a new work order.
