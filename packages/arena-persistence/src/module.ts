/**
 * arena-persistence 模块清单：AR2-005 durable persistence（slice 1 — SQLite 参考引擎）。
 * 冻结端口（AggregateStore/Idempotency/Outbox/Job/Migration）的 node:sqlite 实现；
 * 事务性 outbox（saveAggregate 与事件同事务）、原子幂等预留、租约 + fencing。
 * 引擎中立：DDL 与引擎类型只出现在本包内（PORT_NEUTRALITY_RULE）。
 * 依赖声明与 architecture-policy.yaml 一致；对外只暴露 contract.ts。
 */
export const arenaPersistenceModule = {
  id: "arena-persistence",
  requires: ["arena-contracts"],
  provides: [
    "persistence-sqlite-runtime",
    "persistence-aggregate-store",
    "persistence-idempotency-store",
    "persistence-outbox-store",
    "persistence-job-store",
    "persistence-migrations",
  ],
  publicEntrypoints: ["contract.ts"],
} as const;
