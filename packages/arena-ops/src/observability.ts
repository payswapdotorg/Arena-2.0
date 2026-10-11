import { createHash } from "node:crypto";
import type { EventEnvelope } from "@arena/contracts";

/**
 * AR2-013 — 结构化隐私安全日志 + 冻结枚举标签指标 + 关联追踪（issue #15）。
 *
 * 冻结纪律：
 * - 日志/指标永不携带明文租户 id / principal id / payload 内容：
 *   租户范围只以 pseudonym（sha256 前 12 位）出现；
 * - 指标标签只允许冻结枚举（杜绝自由标签 → 基数爆炸与信息泄漏）；
 * - 关联追踪：request_id / correlation_id / causation_id 链 +
 *   支付操作引用 —— 从请求到结果/支付的可审计一条线。
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type OpsEventName =
  | "ops_probe_checked"
  | "ops_readiness_aggregated"
  | "ops_quota_exhausted"
  | "ops_queue_lag_reported"
  | "ops_dead_letter_flagged"
  | "ops_drift_detected"
  | "ops_recovery_recorded"
  | "ops_retention_swept";

export interface StructuredLogRecord {
  timestamp: string;
  level: LogLevel;
  event: OpsEventName;
  correlation_id: string | null;
  request_id: string | null;
  /** 租户范围只出现 pseudonym（绝不出现明文租户 id）。 */
  tenant_pseudonym: string | null;
  message: string;
}

/** 隐私安全 pseudonym：sha256 前 12 位（日志/指标专用）。 */
export function pseudonymize(tenantId: string): string {
  return createHash("sha256").update(`tenant:${tenantId}`).digest("hex").slice(0, 12);
}

export interface LogEmitter {
  emit(record: StructuredLogRecord): void;
}

/** 结构化日志发射器（隐私安全 —— 消息字段约定不含 payload 内容）。 */
export function createLogEmitter(sink: (line: string) => void = () => {}): LogEmitter {
  return {
    emit(record) {
      sink(JSON.stringify(record));
    },
  };
}

export type MetricName =
  | "ops_readiness"
  | "ops_queue_lag_seconds"
  | "ops_due_messages"
  | "ops_dead_letters"
  | "ops_drift_entries"
  | "ops_quota_rejections";

export type MetricLabelKey = "probe_kind" | "lag_level" | "quota_counter" | "probe_status";

export const METRIC_LABEL_ENUMS: Readonly<Record<MetricLabelKey, readonly string[]>> = {
  probe_kind: ["persistence", "queue", "jobs", "capsule_provider", "payment_provider"],
  lag_level: ["OK", "LAGGING", "SEVERE"],
  quota_counter: ["in_flight_commands", "submissions_per_round", "reviews_per_candidate"],
  probe_status: ["UP", "DEGRADED", "DOWN"],
};

export interface MetricSample {
  name: MetricName;
  labels: Partial<Record<MetricLabelKey, string>>;
  value: number;
  timestamp: string;
}

/** 冻结枚举标签指标注册处（自由标签 → 类型化拒绝）。 */
export class MetricsRegistry {
  private readonly samples: MetricSample[] = [];

  record(
    name: MetricName,
    value: number,
    labels: Partial<Record<MetricLabelKey, string>> = {},
    now: string = new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  ): void {
    for (const [key, labelValue] of Object.entries(labels) as Array<[MetricLabelKey, string]>) {
      const allowed = METRIC_LABEL_ENUMS[key];
      if (allowed === undefined || !allowed.includes(labelValue)) {
        throw new Error(
          `metric label ${key}=${labelValue} is not in the frozen enum (privacy/cardinality guard)`,
        );
      }
    }
    this.samples.push({ name, labels, value, timestamp: now });
  }

  snapshot(): readonly MetricSample[] {
    return [...this.samples];
  }
}

export interface PaymentReferenceLink {
  correlation_id: string;
  payment_operation_id: string;
  settled: boolean;
}

export interface CorrelationTrace {
  correlation_id: string;
  request_id: string | null;
  /** 因果链展开的事件序列（occurred_at 升序）。 */
  events: ReadonlyArray<{ event_id: string; event_type: string; causation_id: string | null }>;
  payment_operations: readonly PaymentReferenceLink[];
}

/**
 * 关联追踪组装：EventEnvelope 的 correlation/request/causation 链 +
 * 支付操作引用 → 从请求到结果/支付的一条可审计线。
 */
export function assembleCorrelationTrace(input: {
  events: readonly EventEnvelope[];
  payment_references: readonly PaymentReferenceLink[];
}): readonly CorrelationTrace[] {
  const byCorrelation = new Map<string, CorrelationTrace>();
  for (const event of input.events) {
    let trace = byCorrelation.get(event.correlation_id);
    if (trace === undefined) {
      trace = {
        correlation_id: event.correlation_id,
        request_id: event.request_id,
        events: [],
        payment_operations: [],
      };
      byCorrelation.set(event.correlation_id, trace);
    }
    if (trace.request_id === null && event.request_id !== null) {
      trace.request_id = event.request_id;
    }
  }
  for (const event of [...input.events].sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : 1))) {
    const trace = byCorrelation.get(event.correlation_id);
    if (trace !== undefined) {
      trace.events = [
        ...trace.events,
        {
          event_id: event.event_id,
          event_type: event.event_type,
          causation_id: event.causation_id,
        },
      ];
    }
  }
  for (const reference of input.payment_references) {
    const trace = byCorrelation.get(reference.correlation_id);
    if (trace !== undefined) {
      trace.payment_operations = [...trace.payment_operations, reference];
    }
  }
  return [...byCorrelation.values()];
}

export const OBSERVABILITY_DISCLOSURE =
  "Structured logs and metrics are privacy-safe: tenant scope appears only as a sha256 pseudonym, " +
  "metric labels come from frozen enums, payload content is never logged; correlation traces join " +
  "the event causation chain with payment operation references from request to settlement";
