/**
 * arena-api 模块清单：AR2-002 API 边缘切片。
 * node:http 监听器 + DEMO auth adapter（租户上下文仅从服务端派生，绝不信 body）
 * + 类型化错误映射（ARENA_* 目录）。命令只经 arena-application 执行器进入
 * arena-contracts 冻结状态机。依赖声明与 architecture-policy.yaml 保持一致；
 * 对外只暴露 contract.ts。
 */
export const arenaApiModule = {
  id: "arena-api",
  requires: ["arena-contracts", "arena-application"],
  provides: ["arena-http-edge", "arena-auth-adapter-demo", "arena-error-mapping"],
  publicEntrypoints: ["contract.ts"],
} as const;
