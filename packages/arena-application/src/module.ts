/**
 * arena-application 模块清单：AR2-002 用例层切片。
 * create-escalation / command-executor / queries 驱动 arena-contracts 冻结的
 * 状态机与契约；运行时为 non-durable in-memory（AR2-008 durable store 落地前的
 * 明确临时形态）。依赖声明与 architecture-policy.yaml 保持一致；对外只暴露 contract.ts。
 */
export const arenaApplicationModule = {
  id: "arena-application",
  requires: ["arena-contracts"],
  provides: ["arena-use-cases", "arena-inmemory-runtime", "arena-tenant-scoped-queries"],
  publicEntrypoints: ["contract.ts"],
} as const;
