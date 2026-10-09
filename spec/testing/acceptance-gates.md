# Acceptance Gates

These gates are required for feature completion; the production launch gate is stricter. Test names and command paths should be added when implementation locations are verified. No blank or not-applicable row may be assumed passed.

## G0 — Fork baseline and supply chain
- Record upstream base SHA, OS/runtime/package manager, exact commands, results and known pre-existing failures.
- Perform fresh clone install and clean build/test on Linux; schedule macOS/Windows install proof before cross-platform release claims.
- Review dependency licenses, upstream notices, secrets, build scripts, plugins, MCP startup and execution modes.
- Preserve the upstream Apache-2.0 license and NOTICE disclosures; update notices for copied/changed dependencies as required.
- Pin a reproducible toolchain and identify every build/runtime asset downloaded dynamically.

## G1 — Contracts, architecture and governance
- Validate request/result/event schemas at runtime.
- State machines reject invalid transitions and preserve immutable history.
- Dependency direction has no cycles; public exports only; no deep imports.
- Work orders have owner, scope fence, dependencies, evidence plan and unique IDs.
- Any architecture change has an approved ACR and contract/migration/test impact plan.

## G2 — Security and tenant boundaries
- API and worker enforce tenant-scoped object access; guessing another tenant's ID fails closed.
- Authn and authz are distinct; role/lens and expert qualification never authorize an operation by themselves.
- Capsule filesystem, process, tool and network boundaries are tested at the actual OS/runtime isolation layer.
- Secrets are scoped, short-lived, redacted and unavailable to generic logs/reviews.
- Prompt injection and malicious repository/file/web content cannot bypass runtime policy.
- Webhooks reject invalid signatures, stale timestamps, replays and duplicated events.
- Artifact downloads use scoped authorization; path traversal, confused deputy, SSRF and cross-tenant storage access are tested.
- Retention/deletion and access audits match the stated policy.

## G3 — Durability, idempotency and resilience
- Duplicate same-key/same-payload commands replay the stored outcome.
- Same-key/different-payload requests return a typed conflict.
- Concurrent admission from at least two API processes creates one logical accepted task.
- Kill API/worker after transaction commit and before side effect; recover without lost work.
- Kill during/after external side effect; reconcile by operation ID before retry.
- Test stale leases, lease fencing, two workers claiming one job, provider outage, timeout, backoff, dead-letter and recovery.
- DB migration from empty database; interrupted migration recovery or explicitly documented migration protocol; backup restore test.
- No critical correctness depends only on process memory or Redis.

## G4 — Application-level proof and payments
- P0 baseline fails and post-intervention validator passes; the accepted proof is cryptographically/authentically task-bound and payout becomes eligible once.
- A failed or inconclusive validator never automatically pays; routing attempts remain within budget.
- P1 repeated/aggregate evaluation follows configured sample size and thresholds.
- Caller-supplied proof booleans alone are rejected; stale, forged, replayed and cross-tenant evidence rejected.
- Concurrent duplicate payment commands produce one ledger operation and one provider operation.
- Provider timeout is reconciled before retry.
- Payment eligibility, provider acceptance and actual settlement are distinct states.
- Live-money operations are unavailable without production configuration and approved release gate.

## G5 — Arena adjudication and Expert Arena
- P2 requires the predeclared rubric, minimum independent reviewer quorum and all hard-stop checks.
- P3 waits for its field evidence/observation gate.
- Self-evaluation is criterion-level and can reference evidence; never counts as independent review.
- Conflicts of interest exclude evaluators; missing quorum triggers replacement/escalation rather than approval.
- Disagreement thresholds trigger an independent adjudicator.
- Score dimensions and rubric version are retained; popularity does not override proof.
- Revision/appeal is versioned; candidates and prior evidence cannot be overwritten.
- Reviewer calibration, collusion/brigading detection, retaliation controls and explanations are tested.

## G6 — Product end-to-end
- A generic external client calls a real local or deployed API, creates an escalation, observes status, and receives a schema-valid result.
- At least one expert can accept, work in a bounded environment, submit evidence and see validation.
- P0 software example: known compile/test failure before intervention, patch intervention, trusted rerun passes, result returns and payout simulator releases once.
- A second eligible expert can attempt after first failure without exceeding budget or losing attribution.
- P2 example cannot pay from self-rating alone and requires independent review/adjudication.
- Requester, expert, reviewer, developer and operations flows have responsive, keyboard-accessible E2E coverage.
- Demo mode is visibly labelled and cannot be confused with customer/provider state.

## G7 — Observability, cost, capacity and operations
- Capacity and quota exhaustion are visible and fail closed; no hidden paid fallback.
- Health/readiness endpoints distinguish API health, dependency health and queue lag.
- Logs/metrics/events include correlation and reason codes but no secrets or prohibited payloads.
- Retention and capsule cleanup have drift detection and a tested repair path.
- Operational runbooks exist for stuck jobs, replay, provider outage, data restore, suspected tenant leak, payment mismatch and capsule escape.
- Release evidence states which tests are automated, which paths were exercised live and which claims remain unproven.

## Evidence policy

A passing unit test proves only the tested unit. A mock proves a contract/test fixture. A live provider connectivity check does not prove the application uses that provider correctly. A cached build is not independent evidence of a fresh build. Record evidence class, exact SHA, command, environment, result, limitations and reviewer. High/critical unresolved findings block release unless an authorized release owner formally accepts them in writing where policy permits.
