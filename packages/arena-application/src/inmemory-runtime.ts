import type {
  AggregateStorePort,
  EventEnvelope,
  IdempotencyPort,
  OutboxPort,
} from "@arena/contracts";

/**
 * @arena/application — 用例层（AR2-002 TL-direct 执行的第一个切片）。
 *
 * createInMemoryRuntime：进程内端口实现，**NON-DURABLE**（仅本 WO 的本地
 * 监听器与测试使用；AR2-005 以真实引擎实现同一端口替换之）。
 * 事务性 outbox 语义在进程内以「同一次 saveAggregate 调用内入队」模拟。
 */

interface StoredAggregate {
  aggregate_type: "escalation" | "attempt" | "payment" | "learning";
  aggregate_id: string;
  version: number;
  record: unknown;
  tenant_id: string;
  recorded_at: string;
}

interface StoredIdempotency {
  tenant_id: string;
  idempotency_key: string;
  request_digest: string;
  status: "IN_PROGRESS" | "COMPLETED";
  response_digest: string | null;
  completed_at: string | null;
  response: unknown;
}

export interface InMemoryRuntime {
  aggregates: AggregateStorePort;
  idempotency: IdempotencyPort;
  outbox: OutboxPort;
  /** 测试/诊断钩子：读取存储的聚合。 */
  readAggregate(aggregate_type: string, aggregate_id: string): StoredAggregate | null;
  /** 测试/诊断钩子：outbox 中未投递的事件。 */
  pendingEvents(): EventEnvelope[];
  /** 实现内部（非端口契约）：幂等完成时写回完整响应体，供 REPLAY 路径重放。 */
  storeResponse(tenant_id: string, idempotency_key: string, response: unknown): void;
  /** 测试/诊断钩子：读取已完成的幂等响应（重放路径）。 */
  readIdempotentResponse(tenant_id: string, idempotency_key: string): unknown;
  /** 实现内部（非端口契约）：按类型枚举聚合记录（durable 实现在引擎侧做租户过滤查询）。 */
  listAggregates(aggregate_type: string): StoredAggregate[];
}

export function createInMemoryRuntime(
  now: () => string = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
): InMemoryRuntime {
  const aggregateTable = new Map<string, StoredAggregate>();
  const idempotencyTable = new Map<string, StoredIdempotency>();
  const outboxQueue: Array<{ outbox_id: string; event: EventEnvelope; delivered: boolean }> = [];

  const aggregates: AggregateStorePort = {
    async saveAggregate(input) {
      const key = `${input.ref.aggregate_type}/${input.ref.aggregate_id}`;
      const existing = aggregateTable.get(key);
      if (existing !== undefined && existing.version !== input.ref.expected_version) {
        throw new Error("ARENA_CONCURRENT_WRITE_CONFLICT");
      }
      const newVersion = input.ref.expected_version + 1;
      aggregateTable.set(key, {
        aggregate_type: input.ref.aggregate_type,
        aggregate_id: input.ref.aggregate_id,
        version: newVersion,
        record: input.record,
        tenant_id: (input.record as { tenant_id?: string }).tenant_id ?? "",
        recorded_at: input.recorded_at,
      });
      for (const event of input.events) {
        outboxQueue.push({
          outbox_id: `obx_${outboxQueue.length + 1}_${event.event_id}`,
          event,
          delivered: false,
        });
      }
      return { new_version: newVersion };
    },
    async loadAggregate(aggregate_type, aggregate_id) {
      const row = aggregateTable.get(`${aggregate_type}/${aggregate_id}`);
      if (row === undefined) return null;
      return {
        aggregate_type: row.aggregate_type,
        aggregate_id: row.aggregate_id,
        version: row.version,
        record: row.record,
        recorded_at: row.recorded_at,
      };
    },
  };

  const idempotency: IdempotencyPort = {
    async reserve(input) {
      const key = `${input.tenant_id}:${input.idempotency_key}`;
      const existing = idempotencyTable.get(key);
      if (existing === undefined) {
        idempotencyTable.set(key, {
          tenant_id: input.tenant_id,
          idempotency_key: input.idempotency_key,
          request_digest: input.request_digest,
          status: "IN_PROGRESS",
          response_digest: null,
          completed_at: null,
          response: null,
        });
        return { kind: "RESERVED" };
      }
      if (existing.request_digest !== input.request_digest) {
        return { kind: "CONFLICT", record: publicRecord(existing) };
      }
      if (existing.status === "COMPLETED") {
        return { kind: "REPLAY", record: publicRecord(existing) };
      }
      return { kind: "RESERVED" };
    },
    async complete(input) {
      // 进程内简化：按键完成（跨租户同键的竞态在 DEMO 场景不出现；durable 实现按
      // reserve 的事务上下文限定作用域 —— 端口契约不携带 tenant 是刻意的）。
      for (const row of idempotencyTable.values()) {
        if (row.idempotency_key === input.idempotency_key && row.status === "IN_PROGRESS") {
          row.status = "COMPLETED";
          row.response_digest = input.response_digest;
          row.completed_at = input.completed_at;
        }
      }
    },
    async load(idempotency_key, tenant_id) {
      const row = idempotencyTable.get(`${tenant_id}:${idempotency_key}`);
      return row === undefined ? null : publicRecord(row);
    },
  };

  const outbox: OutboxPort = {
    async enqueue(events) {
      for (const event of events) {
        outboxQueue.push({
          outbox_id: `obx_${outboxQueue.length + 1}_${event.event_id}`,
          event,
          delivered: false,
        });
      }
    },
    async fetchDue(limit) {
      return outboxQueue
        .filter((message) => !message.delivered)
        .slice(0, limit)
        .map((message) => ({
          outbox_id: message.outbox_id,
          event: message.event,
          delivery_identity: `delivery:${message.outbox_id}`,
          attempts: 0,
          next_attempt_at: now(),
        }));
    },
    async markDispatched(outbox_id) {
      const row = outboxQueue.find((message) => message.outbox_id === outbox_id);
      if (row !== undefined) row.delivered = true;
    },
    async markFailed() {
      // 进程内演示实现：失败消息保留在队列中等待重试
    },
  };

  return {
    aggregates,
    idempotency,
    outbox,
    readAggregate: (type, id) => aggregateTable.get(`${type}/${id}`) ?? null,
    pendingEvents: () =>
      outboxQueue.filter((message) => !message.delivered).map((message) => message.event),
    storeResponse: (tenant_id, idempotency_key, response) => {
      const row = idempotencyTable.get(`${tenant_id}:${idempotency_key}`);
      if (row !== undefined && row.status === "COMPLETED") row.response = response;
    },
    readIdempotentResponse: (tenant_id, idempotency_key) =>
      idempotencyTable.get(`${tenant_id}:${idempotency_key}`)?.response ?? null,
    listAggregates: (aggregate_type) =>
      [...aggregateTable.values()].filter((row) => row.aggregate_type === aggregate_type),
  };

  function publicRecord(row: StoredIdempotency) {
    return {
      idempotency_key: row.idempotency_key,
      request_digest: row.request_digest,
      status: row.status,
      response_digest: row.response_digest,
      completed_at: row.completed_at,
    };
  }
}

export const IN_MEMORY_RUNTIME_DISCLOSURE =
  "NON-DURABLE in-process runtime for AR2-002 only: process memory is not a source of truth; " +
  "AR2-005 replaces these port implementations with a durable engine behind the same frozen interfaces";
