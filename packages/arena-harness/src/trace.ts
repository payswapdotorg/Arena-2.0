import type { EventEnvelope } from "@arena/contracts";
import { assembleCorrelationTrace, type CorrelationTrace } from "@arena/ops";

/**
 * AR2-012 — 稳定 ID 追踪（issue #14 验收：result/evidence/attempt/payment/
 * webhooks 经稳定 ID 全链可追）。
 *
 * 组合 @arena/ops 的 assembleCorrelationTrace（同一实现，不第二套）：
 * 事件因果链（correlation/request/causation）+ 支付操作引用 → 一条线。
 */

export interface StableIdTraceInput {
  events: readonly EventEnvelope[];
  payment_references: ReadonlyArray<{
    correlation_id: string;
    payment_operation_id: string;
    settled: boolean;
  }>;
}

export interface StableIdTraceReport {
  traces: readonly CorrelationTrace[];
  /** 全部事件的稳定身份（event_id 唯一 —— 不可变历史）。 */
  event_ids: readonly string[];
  /** 事件聚合身份（escalation/attempt 稳定 ID 集合）。 */
  aggregate_ids: readonly string[];
  /** 支付操作稳定 ID（唯一 —— 恰好一次放款的材料）。 */
  payment_operation_ids: readonly string[];
  webhooks_can_trace: boolean;
}

/** 组装并校验稳定 ID 追踪材料（断言由测试消费）。 */
export function buildStableIdTrace(input: StableIdTraceInput): StableIdTraceReport {
  const traces = assembleCorrelationTrace({
    events: input.events,
    payment_references: input.payment_references,
  });
  const eventIds = input.events.map((event) => event.event_id);
  const aggregateIds = [
    ...new Set(input.events.map((event) => `${event.aggregate.type}:${event.aggregate.id}`)),
  ];
  const paymentOperationIds = input.payment_references.map(
    (reference) => reference.payment_operation_id,
  );
  const webhooksCanTrace =
    new Set(eventIds).size === eventIds.length &&
    input.events.every((event) => event.event_id.length > 0 && event.correlation_id.length > 0);
  return {
    traces,
    event_ids: eventIds,
    aggregate_ids: aggregateIds,
    payment_operation_ids: paymentOperationIds,
    webhooks_can_trace: webhooksCanTrace,
  };
}
