import assert from "node:assert/strict";
import test from "node:test";
import { eventEnvelopeSchema, type EventEnvelope } from "@arena/contracts";
import {
  pseudonymize,
  MetricsRegistry,
  assembleCorrelationTrace,
  createLogEmitter,
} from "../src/contract.js";
import { evaluateRetention } from "../src/contract.js";

/**
 * AR2-013 — 隐私安全可观测性 + 关联追踪 + 保留策略（issue #15 验收）：
 * 日志/指标无明文租户 id（pseudonym）；指标标签冻结枚举（自由标签拒绝）；
 * correlation/request/causation 链 + 支付引用 = 请求到支付的可审计一条线；
 * 保留窗口类型化决策 + 清扫漂移可见；ops 零删除权。
 */

function event(input: {
  event_id: string;
  correlation_id: string;
  request_id: string | null;
  causation_id: string | null;
  event_type: string;
  occurred_at: string;
}): EventEnvelope {
  return eventEnvelopeSchema.parse({
    event_id: input.event_id,
    schema_version: "ES2.0-EV1",
    tenant_id: "tnt_00000001",
    aggregate: { type: "escalation", id: "esc_00000001", version: 1 },
    event_type: input.event_type,
    occurred_at: input.occurred_at,
    recorded_at: input.occurred_at,
    actor: { type: "requester", id: "usr_00000001" },
    correlation_id: input.correlation_id,
    causation_id: input.causation_id,
    request_id: input.request_id,
    policy_version: "PVP1.0",
    payload: { schema_id: "sch_00000001", redaction_class: "tenant" },
    immutable: true,
    correction: null,
  });
}

test("correlation IDs allow a trace from request to result/payment", () => {
  const events = [
    event({
      event_id: "evt_00000001",
      correlation_id: "cor_00000001",
      request_id: "req_00000001",
      causation_id: null,
      event_type: "EscalationCreated",
      occurred_at: "2026-10-11T10:00:01Z",
    }),
    event({
      event_id: "evt_00000002",
      correlation_id: "cor_00000001",
      request_id: "req_00000001",
      causation_id: "evt_00000001",
      event_type: "AttemptStarted",
      occurred_at: "2026-10-11T10:05:00Z",
    }),
    event({
      event_id: "evt_00000003",
      correlation_id: "cor_00000001",
      request_id: "req_00000001",
      causation_id: "evt_00000002",
      event_type: "EscalationAccepted",
      occurred_at: "2026-10-11T11:00:00Z",
    }),
    event({
      event_id: "evt_00000004",
      correlation_id: "cor_00000002",
      request_id: "req_00000002",
      causation_id: null,
      event_type: "EscalationCreated",
      occurred_at: "2026-10-11T10:30:00Z",
    }),
  ];
  const traces = assembleCorrelationTrace({
    events,
    payment_references: [
      { correlation_id: "cor_00000001", payment_operation_id: "pay_op_00000001", settled: true },
    ],
  });
  assert.equal(traces.length, 2);
  const first = traces.find((trace) => trace.correlation_id === "cor_00000001");
  assert.ok(first !== undefined);
  assert.equal(first.request_id, "req_00000001");
  assert.equal(first.events.length, 3);
  // 事件按 occurred_at 升序、因果链完整。
  assert.deepEqual(
    first.events.map((entry) => entry.event_type),
    ["EscalationCreated", "AttemptStarted", "EscalationAccepted"],
  );
  assert.equal(first.events[1]?.causation_id, "evt_00000001");
  // 支付引用挂在同一 correlation 上（请求 → 事件 → 支付一条线）。
  assert.equal(first.payment_operations.length, 1);
  assert.equal(first.payment_operations[0]?.payment_operation_id, "pay_op_00000001");
  assert.equal(first.payment_operations[0]?.settled, true);
  // 无支付引用的 correlation：可审计的「缺口」（不静默编造）。
  const second = traces.find((trace) => trace.correlation_id === "cor_00000002");
  assert.ok(second !== undefined);
  assert.equal(second.payment_operations.length, 0);
});

test("metrics accept only frozen-enum labels (privacy/cardinality guard)", () => {
  const registry = new MetricsRegistry();
  registry.record("ops_queue_lag_seconds", 120, { lag_level: "LAGGING" });
  registry.record("ops_dead_letters", 1);
  assert.equal(registry.snapshot().length, 2);
  assert.throws(() => {
    registry.record("ops_dead_letters", 1, { lag_level: "TERRIBLE" as never });
  }, /frozen enum/);
  assert.throws(() => {
    registry.record("ops_dead_letters", 1, { probe_kind: "definitely-not-a-probe" as never });
  }, /frozen enum/);
});

test("pseudonymization never exposes plaintext tenant ids in logs/metrics", () => {
  const pseudonym = pseudonymize("tnt_00000001");
  assert.match(pseudonym, /^[a-f0-9]{12}$/);
  assert.notEqual(pseudonym, "tnt_00000001");
  assert.equal(pseudonym, pseudonymize("tnt_00000001"));
  assert.notEqual(pseudonym, pseudonymize("tnt_00000002"));

  const lines: string[] = [];
  const emitter = createLogEmitter((line) => lines.push(line));
  emitter.emit({
    timestamp: "2026-10-11T12:00:00Z",
    level: "warn",
    event: "ops_quota_exhausted",
    correlation_id: "cor_00000001",
    request_id: "req_00000001",
    tenant_pseudonym: pseudonym,
    message: "quota exhausted for counter in_flight_commands (typed rejection)",
  });
  const serialized = lines.join("\n");
  assert.ok(serialized.includes("ops_quota_exhausted"));
  assert.ok(!serialized.includes("tnt_00000001"), "plaintext tenant id must never appear");
});

test("retention windows produce typed decisions; ops performs zero deletions", () => {
  const now = "2026-10-11T12:00:00Z";
  const report = evaluateRetention({
    now,
    candidates: [
      {
        record_id: "esc_00000001",
        kind: "escalation",
        retention_profile: "STANDARD",
        last_updated_at: "2026-10-10T12:00:00Z",
        hold: false,
      },
      {
        record_id: "esc_00000002",
        kind: "escalation",
        retention_profile: "SHORT",
        last_updated_at: "2026-09-01T00:00:00Z",
        hold: false,
      },
      {
        record_id: "evd_00000001",
        kind: "evidence",
        retention_profile: "SHORT",
        last_updated_at: "2026-09-01T00:00:00Z",
        hold: true,
      },
      {
        record_id: "led_00000001",
        kind: "payment",
        retention_profile: "STANDARD",
        last_updated_at: "2026-10-01T00:00:00Z",
        hold: false,
      },
    ],
  });
  assert.equal(report.deletions_performed, 0);
  const byId = new Map(report.decisions.map((decision) => [decision.record_id, decision.kind]));
  assert.equal(byId.get("esc_00000001"), "RETAINED"); // 90 天窗口内
  assert.equal(byId.get("esc_00000002"), "ELIGIBLE_FOR_DELETION"); // SHORT 7 天窗口外
  assert.equal(byId.get("evd_00000001"), "CLEANUP_DRIFT"); // 窗口外但被 hold —— 可见漂移
  assert.equal(byId.get("led_00000001"), "RETAINED"); // 支付 365 天窗口内
  assert.equal(report.eligible, 1);
  assert.equal(report.drift, 1);

  // COMPLIANCE 长窗口。
  const compliance = evaluateRetention({
    now,
    candidates: [
      {
        record_id: "esc_00000003",
        kind: "escalation",
        retention_profile: "COMPLIANCE",
        last_updated_at: "2026-10-10T12:00:00Z",
        hold: false,
      },
    ],
  });
  assert.equal(compliance.decisions[0]?.kind, "RETAINED");
});
