import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateReadiness,
  staticProbe,
  QuotaLedger,
  computeQueueLag,
  auditNoHiddenPaidFallback,
} from "../src/contract.js";

/**
 * AR2-013 — 就绪聚合 + 配额/滞后/回退审计（issue #15 验收）：
 * 依赖故障可见且 fail-closed（任何非 UP → not ready）；
 * 配额耗尽类型化拒绝（绝不静默降级）；队列滞后分级可见；
 * 未声明/未披露的付费回退 = 类型化违规。
 */

test("provider outage is visible and fails readiness closed", async () => {
  const allUp = await aggregateReadiness({
    probes: [
      staticProbe("persistence", "persistence", "UP"),
      staticProbe("queue", "queue", "UP"),
      staticProbe("capsule", "capsule_provider", "UP"),
    ],
  });
  assert.equal(allUp.ready, true);
  if (allUp.ready) assert.equal(allUp.dependencies.length, 3);

  const outage = await aggregateReadiness({
    probes: [
      staticProbe("persistence", "persistence", "UP"),
      staticProbe(
        "capsule",
        "capsule_provider",
        "DOWN",
        "provider unreachable: connection refused",
      ),
      staticProbe("payments", "payment_provider", "DEGRADED", "submit latency above SLO"),
    ],
  });
  assert.equal(outage.ready, false);
  if (!outage.ready) {
    assert.equal(outage.fail_closed, true);
    assert.equal(outage.not_up.length, 2);
    // 可见性：每个非 UP 依赖都带 detail。
    const capsule = outage.not_up.find((report) => report.kind === "capsule_provider");
    assert.ok(capsule !== undefined);
    assert.match(capsule.detail, /unreachable/);
  }
});

test("quota exhaustion is a typed fail-closed rejection — never silent degradation", () => {
  const ledger = new QuotaLedger([
    { counter: "in_flight_commands", limit: 2 },
    { counter: "submissions_per_round", limit: 2 },
  ]);
  assert.deepEqual(ledger.reserve("tnt_00000001", "in_flight_commands"), {
    kind: "RESERVED",
    remaining: 1,
  });
  assert.deepEqual(ledger.reserve("tnt_00000001", "in_flight_commands"), {
    kind: "RESERVED",
    remaining: 0,
  });
  const exhausted = ledger.reserve("tnt_00000001", "in_flight_commands");
  assert.equal(exhausted.kind, "QUOTA_EXHAUSTED");
  if (exhausted.kind === "QUOTA_EXHAUSTED") {
    assert.equal(exhausted.fail_closed, true);
    assert.equal(exhausted.limit, 2);
    assert.equal(exhausted.counter, "in_flight_commands");
  }
  // 释放后可再预留（配对审计）。
  ledger.release("tnt_00000001", "in_flight_commands");
  assert.equal(ledger.reserve("tnt_00000001", "in_flight_commands").kind, "RESERVED");
  // 租户隔离：另一租户不受耗尽影响。
  assert.equal(ledger.reserve("tnt_00000002", "in_flight_commands").kind, "RESERVED");
});

test("queue lag is a visible, graded gauge over outbox stats", () => {
  const now = "2026-10-11T10:00:00Z";
  const ok = computeQueueLag({ due_count: 3, oldest_due_at: "2026-10-11T09:59:40Z" }, now);
  assert.equal(ok.level, "OK");
  assert.equal(ok.oldest_age_seconds, 20);
  const lagging = computeQueueLag({ due_count: 5, oldest_due_at: "2026-10-11T09:58:00Z" }, now);
  assert.equal(lagging.level, "LAGGING");
  assert.equal(lagging.oldest_age_seconds, 120);
  const severe = computeQueueLag({ due_count: 9, oldest_due_at: "2026-10-11T09:45:00Z" }, now);
  assert.equal(severe.level, "SEVERE");
  assert.equal(severe.oldest_age_seconds, 900);
  const empty = computeQueueLag({ due_count: 0, oldest_due_at: null }, now);
  assert.equal(empty.level, "OK");
  assert.equal(empty.oldest_age_seconds, null);
});

test("no-hidden-paid-fallback audit flags undeclared and undisclosed paid fallbacks", () => {
  const clean = auditNoHiddenPaidFallback([
    { component_id: "arena-api", fallback: "none", disclosure: null },
    {
      component_id: "arena-capsule",
      fallback: "explicit_free",
      disclosure: "synthetic local provider",
    },
    {
      component_id: "arena-payment",
      fallback: "explicit_paid",
      disclosure:
        "test-mode provider only; production swap is commercial-gated with budget approval",
    },
  ]);
  assert.equal(clean.kind, "CLEAN");
  if (clean.kind === "CLEAN") assert.equal(clean.checked, 3);

  const violations = auditNoHiddenPaidFallback([
    { component_id: "arena-api", fallback: "undeclared", disclosure: null },
    { component_id: "arena-secret-upgrade", fallback: "explicit_paid", disclosure: null },
  ]);
  assert.equal(violations.kind, "VIOLATIONS");
  if (violations.kind === "VIOLATIONS") {
    assert.equal(violations.violations.length, 2);
    assert.ok(
      violations.violations.some(
        (v) => v.component_id === "arena-api" && /explicitly declared/.test(v.rule),
      ),
    );
    assert.ok(
      violations.violations.some(
        (v) => v.component_id === "arena-secret-upgrade" && /explicit disclosure/.test(v.rule),
      ),
    );
  }
});
