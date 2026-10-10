/**
 * arena-contracts 模块清单：AR2-001 冻结的 Arena 域/公共契约与状态机。
 * 依赖声明与 architecture-policy.yaml 保持一致；对外只暴露 contract.ts。
 */
export const arenaContractsModule = {
  id: "arena-contracts",
  requires: [],
  provides: [
    "arena-domain-contracts",
    "arena-state-machines",
    "arena-error-catalog",
    "arena-persistence-ports",
  ],
  publicEntrypoints: ["contract.ts"],
} as const;
