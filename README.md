# Arena 2.0

**Human-expert escalation infrastructure for AI applications.**

Status: architecture approved; implementation has not yet been verified. This repository is the sole source of truth for Arena 2.0.

Arena lets an AI application ask for human expertise when its agent reaches a capability boundary. Arena compiles the need into explicit acceptance criteria, finds an eligible expert, provides a bounded environment, captures work and evidence, verifies the result using the right proof standard, returns a machine-readable result, and unlocks payment only when the agreed proof policy is satisfied. Reusable learning is a separate, rights-gated path.

## First documents to read

1. [Project state](spec/PROJECT-STATE.md) — actual status, known risks and current frontier.
2. [Tech Lead final handoff](docs/TL-FINAL-HANDOFF.md) — self-contained implementation instructions.
3. [Architecture lock](spec/architecture-lock.md) — binding security, authority and product rules.
4. [System architecture](docs/architecture/ARENA-2.0-SYSTEM-ARCHITECTURE.md) — modules, state ownership and data flow.
5. [Escalation lifecycle contract](spec/contracts/escalation-lifecycle.md) — commands, events, state transitions and result envelope.
6. [Proof and payment policy](spec/verification/proof-and-payment-policy.md) — application-verifiable outcomes versus Arena-adjudicated outcomes.
7. [Expert Arena](spec/expert-arena/expert-arena.md) — self-evaluation, independent reviews, rubric and adjudication.
8. [Implementation work orders](spec/work-orders/implementation-plan.md), [dependency graph](spec/work-orders/dependency-graph.md), [ownership map](spec/ownership/ownership-map.md).
9. [Acceptance gates](spec/testing/acceptance-gates.md) and [ZCode foundation note](docs/upstream/ZCODE-BASELINE.md).

## Architecture at a glance

- Reuse the ZCode desktop/web shell, shared UI, RPC and Agent CLI/runtime foundation where appropriate.
- Keep the Arena domain, external API, tenant authority, durable lifecycle, evidence and payment policy independent from ZCode internals.
- Start as a modular monolith with separately runnable API, worker and isolated capsule host.
- Persist accepted work, idempotency, outbox events, jobs, evidence references and financial operations durably.
- Treat application-level proof as authoritative only for the exact acceptance criteria it demonstrates.
- For work without demonstrable application-level proof, Arena owns the burden of proof through qualified independent review and adjudication.
- Support expert self-evaluation as a first-class versioned artifact. It is never an independent vote or sole payment trigger.
- Keep customer production authority outside Arena; expert capsules may propose changes but do not directly mutate the customer's live system.

## Upstream foundation and security note

This repository was forked from [zai-org/ZCode](https://github.com/zai-org/ZCode) at commit [29628c9acdb81b703bbd4080c207a0e7ce5e276e](https://github.com/payswapdotorg/arena-2.0/commit/29628c9acdb81b703bbd4080c207a0e7ce5e276e). Preserve upstream licensing, dependency notices and relevant security disclosures. Upstream NOTICE.md states that its shared Agent execution adapter does not provide default OS-level sandboxing. Do not treat a ZCode workspace or Git worktree as a secure multi-tenant capsule. See the [foundation note](docs/upstream/ZCODE-BASELINE.md).

## Local baseline

Use the exact Node and pnpm versions in mise.toml. From a fresh clone:

~~~bash
pnpm bootstrap
pnpm typecheck
pnpm lint
pnpm fmt:check
pnpm architecture:check -- --changed
~~~

Run relevant package tests and end-to-end tests as discovered from actual package scripts; do not assume every test suite has one root command. Record the exact SHA, environment, commands and results in the baseline evidence. A build/test result on the inherited ZCode shell is not proof that Arena features have been implemented.

Typical upstream UI development entry points include pnpm dev:web and pnpm dev:desktop. Until the Arena vertical slice is accepted, these start the inherited workbench foundation, not a production-ready Arena service.

## Contribution rules

- One work order = one issue = one branch = one pull request.
- Maximum three concurrent workers; contract freeze and disjoint write fences are mandatory.
- TL owns root manifests, lockfiles, canonical contracts, shared migrations coordination and acceptance reconciliation.
- Update specs before behavior. Add behavior, security, failure, and E2E tests with each change.
- Do not claim completion without committed test/evidence results and a fresh-main integration check.
- Conversation history is not a source of truth. If a decision is missing, first search this repository. Only genuinely new blocking ambiguity requires owner escalation.

## License

See LICENSE, NOTICE.md and third-party materials inherited from ZCode. Retain and update required attribution and notices.
