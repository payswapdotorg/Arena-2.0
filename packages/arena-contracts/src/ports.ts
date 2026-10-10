import type { ArenaDigest, ArenaId, ArenaTimestamp } from "./common.js";
import type { EventEnvelope } from "./envelope/event-envelope.js";
import type { IdempotencyRecord } from "./idempotency.js";

/**
 * A14 — 持久化/幂等/outbox PORT 定义（仅接口，引擎中立，无实现）。
 *
 * 冻结决策（AR2-001 问题 3）：本文件不允许出现任何引擎类型
 * （禁止任何数据库/缓存/ORM/驱动引擎类型与连接串）。
 * 引擎选择属于 AR2-005 的实现空间（embedded Postgres 是候选先例，
 * 需要其自身 ADR 与证据）。这里冻结的是语义：
 * - 关键写走数据库事务；副作用走事务性 outbox（architecture-lock 第 19 条）；
 * - 乐观并发：版本冲突返回 ARENA_CONCURRENT_WRITE_CONFLICT；
 * - 幂等键预留是原子操作：同键同摘要重放、同键异摘要类型化冲突；
 * - job/lease 带租约与 fencing，两 worker 抢一个 job 只能成功一个；
 * - 迁移从空库可重放，中断恢复协议由实现方文档化（G3）。
 */

export const PORT_NEUTRALITY_RULE =
  "ports define role interfaces over domain types only; engine selection, schema DDL and driver " +
  "types live behind the adapter in AR2-005 and never leak into domain/application contracts";

export interface AggregateRef {
  aggregate_type: "escalation" | "attempt" | "payment" | "learning";
  aggregate_id: ArenaId;
  expected_version: number;
}

export interface SaveAggregateInput {
  ref: AggregateRef;
  /** 引擎无关的持久化负载（领域已序列化的权威状态）。 */
  record: unknown;
  /** 与状态变更同事务投递的事件（transactional outbox）。 */
  events: EventEnvelope[];
  recorded_at: ArenaTimestamp;
}

export interface AggregateRecord {
  aggregate_type: AggregateRef["aggregate_type"];
  aggregate_id: ArenaId;
  version: number;
  record: unknown;
  recorded_at: ArenaTimestamp;
}

export interface AggregateStorePort {
  /** 乐观并发保存：expected_version 不匹配时抛出/返回并发冲突语义。 */
  saveAggregate(input: SaveAggregateInput): Promise<{ new_version: number }>;
  loadAggregate(
    aggregate_type: AggregateRef["aggregate_type"],
    aggregate_id: ArenaId,
  ): Promise<AggregateRecord | null>;
}

export interface ReserveIdempotencyInput {
  idempotency_key: string;
  request_digest: ArenaDigest;
  command: string;
  tenant_id: ArenaId;
}

export type ReserveIdempotencyOutcome =
  | { kind: "RESERVED" }
  | { kind: "REPLAY"; record: IdempotencyRecord }
  | { kind: "CONFLICT"; record: IdempotencyRecord };

export interface CompleteIdempotencyInput {
  idempotency_key: string;
  response_digest: ArenaDigest;
  completed_at: ArenaTimestamp;
}

export interface IdempotencyPort {
  /** 原子预留：并发同键只有一个 RESERVED。 */
  reserve(input: ReserveIdempotencyInput): Promise<ReserveIdempotencyOutcome>;
  complete(input: CompleteIdempotencyInput): Promise<void>;
  load(idempotency_key: string, tenant_id: ArenaId): Promise<IdempotencyRecord | null>;
}

export interface OutboxMessage {
  outbox_id: ArenaId;
  event: EventEnvelope;
  delivery_identity: string;
  attempts: number;
  next_attempt_at: ArenaTimestamp;
}

export interface OutboxPort {
  /** 在状态事务内入队（与 saveAggregate 同一事务）。 */
  enqueue(events: EventEnvelope[]): Promise<void>;
  /** worker 侧：取到期未投递消息。 */
  fetchDue(limit: number, now: ArenaTimestamp): Promise<OutboxMessage[]>;
  markDispatched(outbox_id: ArenaId, delivered_at: ArenaTimestamp): Promise<void>;
  markFailed(outbox_id: ArenaId, next_attempt_at: ArenaTimestamp): Promise<void>;
}

export interface JobHandle {
  job_id: ArenaId;
  job_type: string;
  payload: unknown;
}

export interface ClaimJobOutcome {
  claimed: JobHandle[];
  lease_expires_at: ArenaTimestamp;
}

export interface JobPort {
  schedule(job_type: string, payload: unknown, run_at: ArenaTimestamp): Promise<ArenaId>;
  /** 租约 + fencing：两个 worker 只有一个成功；租约过期可被回收。 */
  claim(
    job_type: string,
    limit: number,
    lease_seconds: number,
    worker_id: ArenaId,
  ): Promise<ClaimJobOutcome>;
  heartbeat(job_ids: ArenaId[], worker_id: ArenaId): Promise<void>;
  complete(job_id: ArenaId, worker_id: ArenaId): Promise<void>;
  deadLetter(job_id: ArenaId, reason: string): Promise<void>;
}

export interface MigrationPort {
  /** 从空库可重放；中断恢复协议由实现方文档化。 */
  applyMigrations(): Promise<{ applied: string[] }>;
  currentVersion(): Promise<string>;
}
