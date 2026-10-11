/**
 * arena-ops 模块清单：AR2-013 运维、容量、保留与可观测性（issue #15）。
 *
 * 只观察与组合（write fence: operations/observability/runbooks/tests）：
 * 探针/就绪聚合、配额台账（类型化耗尽）、队列滞后、死信视图（永不删
 * 除）、capsule 拆除漂移回收（驱动真实 provider 端口）、隐私安全结构
 * 日志 + 冻结枚举指标 + 关联追踪（请求 → 事件 → 支付引用）、声明式
 * 保留策略（零删除权）+ 运维 runbook。依赖声明与
 * architecture-policy.yaml 一致；对外只暴露 contract.ts。
 */
export const arenaOpsModule = {
  id: "arena-ops",
  requires: ["arena-contracts", "arena-capsule"],
  provides: [
    "ops-dependency-probes",
    "ops-aggregate-readiness-fail-closed",
    "ops-quota-ledger-typed-exhaustion",
    "ops-queue-lag-visibility",
    "ops-dead-letter-view-retained",
    "ops-capsule-teardown-drift-recovery",
    "ops-privacy-safe-logging",
    "ops-frozen-enum-metrics",
    "ops-correlation-trace",
    "ops-retention-policy-evaluator",
    "ops-runbooks",
  ],
  publicEntrypoints: ["contract.ts"],
} as const;
