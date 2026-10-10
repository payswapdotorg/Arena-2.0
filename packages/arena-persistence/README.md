# @arena/persistence

AR2-005 — durable persistence behind the frozen AR2-001 ports. This package
implements `AggregateStorePort`, `IdempotencyPort`, `OutboxPort`, `JobPort` and
`MigrationPort` over **`node:sqlite`** (Node's built-in SQLite binding — zero
external dependencies).

Engine decision, alternatives and the disclosed deviation from the AR2-002
in-memory demo (IN_PROGRESS same-digest reserve now returns `REPLAY`, per the
frozen port comment) are recorded in
[docs/adr-0001-sqlite-reference-engine.md](docs/adr-0001-sqlite-reference-engine.md).

## Surface

| Area        | Export                                | Semantics                                                                                                                                                                                                                                         |
| ----------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime     | `createSqliteRuntime`                 | opens the engine (WAL, `synchronous = FULL`, `busy_timeout`), applies migrations, assembles all five ports; `close()` shuts the engine down                                                                                                       |
| Aggregates  | `createAggregateStore`                | optimistic concurrency (`expected_version` mismatch → `ARENA_CONCURRENT_WRITE_CONFLICT`); **transactional outbox** — `saveAggregate` writes the aggregate row AND enqueues its events in one `BEGIN IMMEDIATE` transaction (architecture-lock 19) |
| Idempotency | `createIdempotencyStore`              | atomic reservation on `(tenant_id, idempotency_key)` primary key: no row → `RESERVED`; different digest → `CONFLICT`; same digest → `REPLAY` (record status `IN_PROGRESS` or `COMPLETED` — only one process ever executes)                        |
| Outbox      | `createOutboxStore`                   | `fetchDue` (due + undispatched, ordered), `markDispatched` (terminal), `markFailed` (attempts+1, caller-supplied backoff — messages are never lost)                                                                                               |
| Jobs        | `createJobStore`, `JobFencedOutError` | atomic claim under `BEGIN IMMEDIATE` (lease + monotonically increasing `fencing_token`); lease expiry allows reclaim; stale-worker `heartbeat`/`complete` throw `JobFencedOutError`; `deadLetter` is terminal; `run_at` respected                 |
| Migrations  | `createMigrationStore`, `MIGRATIONS`  | from-empty replay; each migration is a single transaction (DDL + version row) so interrupted applies converge on re-run; `currentVersion()` reports the head version                                                                              |
| Engine      | `openEngine`                          | thin `node:sqlite` wrapper: WAL/FULL pragmas, statement cache, `transaction()` helper — multiple connections over one file stand in for multiple API processes/workers                                                                            |

## Tests

- `test/durable.test.ts` — the AR2-005 acceptance scenarios: same key/same
  digest REPLAY; same key/different digest CONFLICT; concurrent admission from
  two API processes (two connections — only one `RESERVED`); crash-after-commit
  recovery (a new connection sees committed aggregates + undispatched outbox +
  in-progress reservations); migration-from-empty replay (idempotent, reopen
  safe); transactional outbox rows; backoff retry; response-body replay.
- `test/jobs.test.ts` — two workers race one job (exactly one claim succeeds);
  lease expiry → reclaim with fencing bump → stale worker fenced out on both
  `complete` and `heartbeat`; heartbeat extends active leases; `deadLetter`
  terminal with recorded reason; `run_at` gating.

## House notes

- Public surface is `src/contract.ts` only (architecture guard).
- No engine types, DDL or driver concepts leak into domain/application code
  (`PORT_NEUTRALITY_RULE`); everything engine-specific lives in this package.
- Multi-instance production (embedded Postgres candidate) remains open —
  requires its own ADR and evidence per the AR2-001 freeze note.
- `heartbeat` extends leases by a fixed 60s window (port signature carries no
  lease duration); document and revisit if the contract ever extends.
