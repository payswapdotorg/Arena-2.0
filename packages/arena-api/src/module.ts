/**
 * arena-api 模块清单：AR2-002 API 边缘切片 + AR2-022 身份适配器 seam。
 * node:http 监听器 + IDN1.0 身份适配器网关（demo 注册表 DEMO-ONLY；
 * OIDC/JWKS 生产参考实现经组合根注入；租户上下文仅从服务端派生，
 * 绝不信 body）+ 类型化错误映射（ARENA_* 目录）。命令只经
 * arena-application 执行器进入 arena-contracts 冻结状态机。
 * 依赖声明与 architecture-policy.yaml 保持一致；对外只暴露 contract.ts。
 */
export const arenaApiModule = {
  id: "arena-api",
  requires: ["arena-contracts", "arena-application", "arena-persistence", "arena-identity"],
  provides: ["arena-http-edge", "arena-auth-adapter-seam", "arena-error-mapping"],
  publicEntrypoints: ["contract.ts"],
} as const;
