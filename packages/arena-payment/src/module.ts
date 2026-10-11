/**
 * arena-payment 模块清单：AR2-010 测试模式支付台账与结果挂钩放款。
 * 依赖声明与 architecture-policy.yaml 保持一致；对外只暴露 contract.ts。
 */
export const arenaPaymentModule = {
  id: "arena-payment",
  requires: ["arena-contracts", "arena-evidence"],
  provides: [
    "append-only-payment-ledger",
    "payment-operation-id-uniqueness",
    "evidence-gate-eligibility",
    "payout-gate-evaluation",
    "frozen-machine-payment-flow",
    "test-mode-provider-simulator",
  ],
  publicEntrypoints: ["contract.ts"],
} as const;
