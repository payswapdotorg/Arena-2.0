import type { AggregateStorePort, IdempotencyPort, OutboxPort } from "@arena/contracts";

/**
 * AR2-005 slice 2 — 应用层运行时结构接口（ArenaRuntime）。
 *
 * 用例/查询层只依赖此结构：冻结端口（aggregates / idempotency / outbox）
 * + 两个披露为实现内部（非端口契约）的扩展：
 * - idempotency.storeResponse / readResponse：REPLAY 重放的完整响应体存取；
 * - listAggregates：查询路径的类型（+可选租户）枚举 —— durable 实现做引擎侧
 *   租户过滤（slice 1 inmemory-runtime 注释的既定设计）。
 *
 * 两个运行时均结构满足本接口：
 * - createInMemoryRuntime（@arena/application）：AR2-002 的 NON-DURABLE 实现，
 *   AR2-005 之后降级为披露的测试夹具；
 * - createSqliteRuntime（@arena/persistence）：node:sqlite 参考引擎
 *   （ADR-0001），AR2-005 起为默认组装。
 */

export interface StoredAggregateRow {
  aggregate_type: string;
  aggregate_id: string;
  version: number;
  record: unknown;
  tenant_id: string;
  recorded_at: string;
}

export interface IdempotencyResponseStore {
  /** 实现内部（非端口契约）：幂等完成时写回完整响应体，供 REPLAY 路径重放。 */
  storeResponse(tenant_id: string, idempotency_key: string, response: unknown): void;
  /** 实现内部（非端口契约）：读取已完成的幂等响应（重放路径；IN_PROGRESS 时为 null）。 */
  readResponse(tenant_id: string, idempotency_key: string): unknown;
}

export interface ArenaRuntime {
  aggregates: AggregateStorePort;
  idempotency: IdempotencyPort & IdempotencyResponseStore;
  outbox: OutboxPort;
  /**
   * 实现内部（非端口契约）：按类型枚举聚合记录；提供 tenant_id 时在
   * 引擎侧过滤（跨租户行不出现在结果中 —— 查询路径失败关闭的第一道防线，
   * 应用侧 requireTenantScope 仍是权威判定）。
   */
  listAggregates(aggregate_type: string, tenant_id?: string): StoredAggregateRow[];
}

export const IN_MEMORY_RUNTIME_FIXTURE_DISCLOSURE =
  "NON-DURABLE in-process runtime: retained as a disclosed test fixture after AR2-005; " +
  "the default composition is the durable engine behind the same frozen port shapes";
