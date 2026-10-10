# ADR-0001: Use ZCode as Arena's Workbench Foundation

Status: APPROVED by product owner on 2026-10-09
Decision owner: repository owner / TL
Base: zai-org/ZCode fork commit 29628c9acdb81b703bbd4080c207a0e7ce5e276e

## Context

Arena needs a cross-platform workbench and agent/task environment but must remain a generic escalation service consumable by unrelated AI applications. Rebuilding the desktop shell, React UI, RPC, CLI and agent-runtime foundation would create unnecessary duplication. The upstream repository includes execution features that have broad local permissions and explicitly disclaims default OS sandbox guarantees, so it cannot be treated as a ready-made secure multi-tenant expert execution plane.

## Decision

Reuse the upstream UI, desktop/web shells, service wiring, RPC, CLI and runtime only through explicit Arena integration seams. Implement an independent Arena domain/application layer and public API. Add a capsule provider abstraction and require real system-level isolation for untrusted work. Keep external application authority outside Arena.

The first implementation is a modular monolith with API, worker and capsule host runnable separately. Services split further only when an ADR proves a deployment/security/scaling reason.

## Consequences

Positive:

- Existing desktop/web and runtime foundation is reused.
- Third-party apps use stable Arena contracts without adopting ZCode internals.
- Security boundaries remain explicit and independently testable.
- One repository supports parallel work with local tests.

Negative / obligations:

- Upstream internal module boundaries must be inspected; paths in architecture docs are logical boundaries until verified against source.
- Upstream NOTICE/security/license material must be preserved.
- Sandbox is a new responsibility and cannot be hand-waved by a worktree or UI boundary.
- Existing ZCode features cannot be silently promoted to Arena guarantees.

## Alternatives rejected

1. Rebuild every client/runtime from scratch: unnecessary duplicate work.
2. Put Arena domain state directly into ZCode service internals: creates semantic coupling and weakens third-party API independence.
3. Start with microservices: adds distributed failure/ops burden before one vertical slice is proven.
4. Let experts work directly on customer production state: violates authority and isolation boundaries.
5. Trust application-supplied success booleans for payment: evidence can be forged, replayed or unrelated to the intervention.

## Revisit conditions

Reopen only through an ACR if ZCode boundaries prevent required isolation, licensing/maintenance changes the viability of reuse, a deployment constraint requires different topology, or load evidence justifies a module becoming a separate service. Preserve backward compatibility and recorded decisions during any migration.
