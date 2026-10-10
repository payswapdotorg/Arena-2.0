# ADR-0001 — SQLite as the reference durable engine for AR2-005

- Status: ACCEPTED (AR2-005 slice 1, 2026-10-10)
- Scope: `packages/arena-persistence` engine selection behind the frozen AR2-001 ports

## Context

AR2-001 froze engine-neutral persistence ports (`AggregateStorePort`, `IdempotencyPort`,
`OutboxPort`, `JobPort`, `MigrationPort`) with the explicit decision that engine
selection, schema DDL and driver types live behind the adapter in AR2-005 and never
leak into domain/application contracts (`PORT_NEUTRALITY_RULE`). The freeze notes
single out embedded Postgres as a candidate precedent that would need its own ADR
and evidence.

AR2-005 requires a durable engine that can demonstrate, with real persistence
semantics: atomic idempotency admission, transactional outbox, job leases with
fencing, crash-after-commit recovery, and migration-from-empty replay.

## Decision

Implement the reference durable engine on **`node:sqlite`** (Node's built-in
SQLite binding, zero external dependencies):

- ACID file database with WAL journaling and `synchronous = FULL`
- Multiple `DatabaseSync` connections over one file stand in for multiple API
  processes / workers — write transactions serialize through
  `BEGIN IMMEDIATE` + `busy_timeout`
- Every acceptance scenario of AR2-005 is exercised on real committed state,
  not process memory

## Consequences

1. **Port neutrality preserved.** All DDL lives in `src/migrations.ts`; engine
   types never appear in domain/application code. The ports remain the only
   contract surface.
2. **Single-instance honesty.** SQLite is the reference engine for development,
   tests and single-instance deployments. Multi-instance production (multiple
   API processes against one database) is where embedded Postgres remains the
   leading candidate — that choice requires its own ADR with restart,
   concurrency, outage and recovery evidence per the AR2-005 brief.
3. **Idempotency semantics tightened to the frozen port comment.** The AR2-002
   in-memory demo returned `RESERVED` for a same-digest key that was already
   `IN_PROGRESS`; the durable implementation returns `REPLAY` with the
   in-progress record, per the frozen port comment "concurrent same key: only
   one RESERVED". The second API process never re-executes the command.
   Callers must inspect `record.status` (`IN_PROGRESS` vs `COMPLETED`) on the
   REPLAY path.
4. **Adapter-level error names.** `ARENA_CONCURRENT_WRITE_CONFLICT` (aggregate
   optimistic concurrency) and `ARENA_JOB_FENCED_OUT` (stale worker writes) are
   thrown as adapter-level errors. The public error catalog (CF1.0) is frozen
   and unchanged; promoting these names into the catalog is a TL-coordinated
   contract change if ever needed.
5. **Crash-after-commit recovery protocol (G3).** WAL + FULL synchronous means
   a committed transaction survives process death. Recovery for outbox and jobs
   is: on restart, `fetchDue(now)` re-delivers undispatched messages and
   `claim()` re-acquires jobs whose leases have expired; fencing tokens make
   stale-worker writes harmless. Migration replay converges from empty or
   partially-migrated databases because each migration is a single transaction
   (DDL + version row).

## Alternatives considered

- **better-sqlite3** — native module adds a build dependency (node-gyp /
  electron-rebuild); `node:sqlite` gives the same semantics with zero deps.
- **embedded Postgres now** — deferring to a dedicated ADR per the freeze note;
  the port surface would not change, only this adapter's internals.
- **In-memory continuation** — rejected: AR2-005 exists precisely to remove the
  non-durable runtime's disclosed limitation.
