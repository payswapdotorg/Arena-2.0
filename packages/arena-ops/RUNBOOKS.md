# @arena/ops — Operator Runbooks (AR2-013)

Operational procedures for the Arena reference runtime. Every procedure is
**visible-first, fail-closed**: the system never silently degrades, silently
pays, or silently drops state. Observability surfaces: aggregated readiness
(per-dependency probe reports), quota ledger, queue-lag gauge, dead-letter
view, capsule drift entries, retention sweep decisions.

## RB-1 — Provider outage response (fail closed)

1. **Detect**: `aggregateReadiness` reports a `capsule_provider` or
   `payment_provider` probe as `DEGRADED`/`DOWN` with detail. Readiness is
   `ready: false` — the edge refuses new work (fail-closed posture).
2. **Locate**: read the probe `detail` (typed codes, never a bare boolean) and
   the structured log line `ops_probe_checked` (correlation id present).
3. **Contain**: do NOT force-ready. Quota and state machines stay frozen; the
   outbox keeps retrying with backoff (messages are never lost).
4. **Recover**: fix/restart the provider, then verify the probe returns `UP`
   twice consecutively before accepting work again.
5. **Post-incident**: run RB-2 (queue lag) and RB-4 (capsule drift) sweeps.

## RB-2 — Queue lag & retry storm

1. **Detect**: `computeQueueLag` reports `LAGGING` (oldest due ≥ 60 s) or
   `SEVERE` (≥ 600 s); metric `ops_queue_lag_seconds` /
   `ops_due_messages`.
2. **Triage**: a retry storm shows a growing `attempts` distribution with a
   stable `due_count`; a genuine backlog shows growing `due_count` with small
   attempt counts.
3. **Act**: for storms, pause the failing subscriber (readiness fails closed
   upstream); for backlog, scale the dispatch worker rounds
   (`dispatchWebhookRound`-style round driving is safe and idempotent).

## RB-3 — Dead-letter drain

1. **Detect**: `identifyDeadLetters` flags messages with
   `attempts >= max_attempts` (default threshold 8). Metric
   `ops_dead_letters`.
2. **Inspect**: each entry carries `event_type` and `flagged_reason` —
   messages are **retained, never dropped** (outbox contract).
3. **Fix the subscriber** first (RB-1/RB-2 root cause), then re-drive
   dispatch rounds; successful deliveries mark the row dispatched and clear
   the dead-letter flag naturally.
4. **Explicit reconciliation**: only an explicit operator reconciliation may
   close a dead-lettered message (record the decision with rationale; the
   audit trail must show who/when/why).

## RB-4 — Capsule teardown drift & orphan recovery

1. **Detect**: `CapsuleCustodian.detectTeardownDrift` lists capsules whose
   teardown deadline passed without verified teardown, with overdue seconds.
2. **Sweep**: run `sweep(now, provider)` — it drives the REAL provider
   `teardown` port:
   - `TORN_DOWN` (verified) → recovered; drift clears;
   - `TEARDOWN_FAILED` → drift **stays visible** with the unrevoked
     credential list — escalate to the provider owner; do NOT re-provision
     on top of unrevoked credentials;
   - `ARENA_CAPSULE_UNAVAILABLE` → orphan: escalate (the record is retained
     for attribution; never silently garbage-collected).
3. **Verify**: re-run drift detection until zero; log
   `ops_recovery_recorded` per outcome.

## RB-5 — Quota exhaustion

1. **Detect**: callers receive typed `QUOTA_EXHAUSTED`
   (`{counter, limit, requested, fail_closed: true}`); metric
   `ops_quota_rejections` labeled by the frozen counter enum.
2. **Act**: exhaustion is a **rejection, not degradation** — never bypass by
   raising a system flag. Raise the tenant's quota limit deliberately
   (capacity change record), or wait for in-flight work to release.
3. **Audit**: quota usage is queryable per tenant/counter; releases must
   pair with reservations.

## RB-6 — No-hidden-paid-fallback audit

1. **Run**: `auditNoHiddenPaidFallback` over every component's declared
   fallback policy.
2. **Violations**: `undeclared` fallbacks and undisclosed `explicit_paid`
   fallbacks are audit violations — fix by declaring (or removing) the
   fallback with an explicit disclosure including budget rationale.
3. **Standing rule**: no component may silently fall back to a paid path; a
   paid fallback must be declared, disclosed and budgeted before deployment.

## RB-7 — Retention sweep

1. **Run**: `evaluateRetention` over escalation/evidence/payment candidates
   (each with its frozen `retention_profile`).
2. **Decisions**: `RETAINED` (window open) / `ELIGIBLE_FOR_DELETION`
   (window closed) / `CLEANUP_DRIFT` (window closed but a hold is present —
   visible drift).
3. **Act**: this package performs **zero deletions** — the persistence /
   compliance layer executes eligible deletions; `CLEANUP_DRIFT` entries
   require an explicit hold review (litigation/legal) before either release
   or purge. Record every override with rationale.

## RB-8 — Correlation trace review

1. **Assemble**: `assembleCorrelationTrace(events, payment_references)`
   joins the event causation chain (`correlation_id` / `request_id` /
   `causation_id`) with payment operation references.
2. **Review**: a complete trace runs request → events (ordered by
   `occurred_at`) → payment operations (with settlement state). Gaps (events
   without a payment reference on a paid outcome, or payment references
   without events) are investigation inputs — never silently ignored.
