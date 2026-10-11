/**
 * arena-sdk 模块清单：AR2-011 typed SDK、MCP 门面、签名 webhook 与通用集成。
 *
 * 只做适配层（write fence：SDK/MCP/webhook/example adapters；no alternate
 * domain logic）——一切生命周期语义都经真实 API URL（arena-api 边缘）进入
 * 冻结状态机；webhook 投递消费 AR2-005 冻结 OutboxPort（事务性 outbox，
 * 唯一投递身份 + 重试计划）。依赖声明与 architecture-policy.yaml 一致；
 * 对外只暴露 contract.ts。
 */
export const arenaSdkModule = {
  id: "arena-sdk",
  requires: ["arena-contracts"],
  provides: [
    "typed-sdk-client",
    "sdk-quickstart",
    "mcp-facade-stdio",
    "signed-webhook-delivery",
    "durable-webhook-retry",
    "webhook-receiver-verify-dedupe",
    "generic-integration-example",
  ],
  publicEntrypoints: ["contract.ts"],
} as const;
