/**
 * arena-matching 模块清单：AR2-008 专家能力/资质/冲突匹配与路由。
 * 依赖声明与 architecture-policy.yaml 保持一致；对外只暴露 contract.ts。
 */
export const arenaMatchingModule = {
  id: "arena-matching",
  requires: ["arena-contracts"],
  provides: [
    "expert-profile-records",
    "capability-demand-compilation",
    "conflict-of-interest-screening",
    "explainable-expert-matching",
    "next-eligible-expert-routing",
    "attempt-budget-guardrails",
  ],
  publicEntrypoints: ["contract.ts"],
} as const;
