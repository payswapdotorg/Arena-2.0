/**
 * arena-harness 模块清单：AR2-012 集成纵向验收 harness（issue #14）。
 *
 * 只组合真实组件（write fence：integration harness, test apps and
 * evidence；绝不平行假实现）：真实 arena-api 进程（tsx main.ts、durable
 * sqlite、demo tokens）、AR2-007 evaluateProof、AR2-010 PaymentFlow +
 * InMemoryTestProvider + PaymentLedger、AR2-008 routeNextExpert、
 * AR2-009 Expert Arena 机器、AR2-011 SDK + 签名 webhook 投递/接收、
 * AR2-013 关联追踪。依赖声明与 architecture-policy.yaml 一致；
 * 对外只暴露 contract.ts。
 */
export const arenaHarnessModule = {
  id: "arena-harness",
  requires: [
    "arena-contracts",
    "arena-application",
    "arena-persistence",
    "arena-evidence",
    "arena-payment",
    "arena-matching",
    "arena-expert-arena",
    "arena-sdk",
    "arena-ops",
    "arena-capsule",
  ],
  provides: [
    "vertical-scenario-material",
    "stable-id-trace",
    "p0-vertical-acceptance",
    "next-expert-path-acceptance",
    "p2-independent-review-acceptance",
    "two-instance-recovery-acceptance",
  ],
  publicEntrypoints: ["contract.ts"],
} as const;
