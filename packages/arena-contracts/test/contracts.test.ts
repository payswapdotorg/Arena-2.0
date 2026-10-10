import assert from "node:assert/strict";
import test from "node:test";
import {
  ARENA_ERROR_CATALOG,
  CONTRACT_CORPUS_VERSION,
  CONTRACT_VERSION,
  EVENT_SCHEMA_VERSION,
  PROOF_POLICY_VERSION,
  arenaErrorEnvelopeSchema,
  arenaIdSchema,
  digestSchema,
  httpStatusFor,
  isoTimestampSchema,
  isIdempotentReplaySafe,
  isRetryable,
  proofPolicySnapshotSchema,
} from "../src/contract.js";

/**
 * A13/A12/冻结钉子 — 版本常量、兼容性机制、错误目录完整性与
 * 引擎中立端口卫生。
 */

test("frozen version constants are pinned", () => {
  assert.equal(CONTRACT_VERSION, "ES2.0");
  assert.equal(CONTRACT_CORPUS_VERSION, "CF1.0");
  assert.equal(PROOF_POLICY_VERSION, "PVP1.0");
  assert.equal(EVENT_SCHEMA_VERSION, "ES2.0-EV1");
});

test("A13 mechanics: contract_version is a literal gate (unknown versions rejected)", () => {
  const bad = proofPolicySnapshotSchema.safeParse({
    policy_version: "PVP2.0",
    content_digest: "ab".repeat(32),
    selected_class: "P0",
    selection_rationale: "x",
    per_criterion_classes: [],
    validators: [],
    rerun_policy: { minimum_reruns: 1, risk_exception: null },
    sample_policy: null,
    review_policy: null,
    observation_policy: null,
    payout_gate: {
      release_requires: "all_predicates_pass",
      caller_authenticity_verified: true,
      task_binding_verified: true,
      dispute_blocks_release: true,
    },
    retry_next_expert: {
      max_attempts: 1,
      max_aggregate_spend: 1,
      cooldown_policy: "x",
      failed_attempt_posture: "rollback",
      next_expert_baseline: "immutable_baseline_only",
    },
    timeout: "x",
    dispute_conditions: "x",
    budget_ceiling: 1,
  });
  assert.equal(bad.success, false, "unsupported policy_version must be rejected");
});

test("common primitives reject malformed values", () => {
  assert.equal(arenaIdSchema.safeParse("short").success, false);
  assert.equal(arenaIdSchema.safeParse("_leading_underscore").success, false);
  assert.equal(arenaIdSchema.safeParse("good_id_12345").success, true);
  assert.equal(digestSchema.safeParse("XYZ").success, false);
  assert.equal(digestSchema.safeParse("ab".repeat(32)).success, true);
  assert.equal(isoTimestampSchema.safeParse("2026-10-10 05:00:00").success, false);
  assert.equal(isoTimestampSchema.safeParse("2026-10-10T05:00:00Z").success, true);
});

test("A12: error catalog covers every code with consistent metadata", () => {
  for (const [code, entry] of Object.entries(ARENA_ERROR_CATALOG)) {
    assert.equal(typeof entry.http_status, "number");
    assert.ok(entry.http_status >= 200 && entry.http_status <= 599, `${code} http mapping`);
    assert.equal(typeof entry.retryable, "boolean");
    assert.equal(typeof entry.idempotent_replay_safe, "boolean");
    assert.ok(entry.description.length > 0);
    assert.equal(httpStatusFor(code as keyof typeof ARENA_ERROR_CATALOG), entry.http_status);
    assert.equal(isRetryable(code as keyof typeof ARENA_ERROR_CATALOG), entry.retryable);
    assert.equal(
      isIdempotentReplaySafe(code as keyof typeof ARENA_ERROR_CATALOG),
      entry.idempotent_replay_safe,
    );
  }
});

test("A12: replay and conflict carry distinct typed codes", () => {
  assert.equal(ARENA_ERROR_CATALOG.ARENA_IDEMPOTENCY_REPLAY.http_status, 200);
  assert.equal(ARENA_ERROR_CATALOG.ARENA_IDEMPOTENCY_DIGEST_MISMATCH.http_status, 409);
});

test("A12: error envelope is strict and carries correlation identity", () => {
  const ok = arenaErrorEnvelopeSchema.safeParse({
    code: "ARENA_INVALID_TRANSITION",
    message: "command not valid in the current state",
    correlation_id: "cor_00000001",
    request_id: "req_00000001",
    details: { from: "CLOSED" },
  });
  assert.equal(ok.success, true);
  const bad = arenaErrorEnvelopeSchema.safeParse({
    code: "ARENA_INVALID_TRANSITION",
    message: "x",
    correlation_id: "cor_00000001",
    request_id: null,
    details: null,
    stack: "hidden internals",
  });
  assert.equal(bad.success, false, "error envelope must stay strict");
});

test("A14: ports source contains no engine identifiers (engine neutrality)", async () => {
  const { readFile } = await import("node:fs/promises");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const source = await readFile(join(here, "..", "src", "ports.ts"), "utf8");
  const forbidden = [
    'from "pg"',
    "from 'pg'",
    "postgres",
    "drizzle",
    "knex",
    "prisma",
    "redis",
    "sqlite",
    "mysql",
    "connectionString",
    "connection_string",
    "CREATE TABLE",
    "SELECT ",
  ];
  for (const marker of forbidden) {
    assert.ok(
      !source.includes(marker),
      `ports.ts must not contain engine identifier '${marker}' (AR2-001 decision 3: engine-neutral ports)`,
    );
  }
});
