/**
 * arena-release-gate 模块清单：AR2-015 集成安全、韧性、可访问性与发布门
 * （issue #17；spec/testing/acceptance-gates.md —— 最后一个核心 WO）。
 *
 * 只新增集成测试/证据/发布门文件（write fence）：typed 门注册表（四态
 * 分类 + 证据记录 + owner 授权 + 阻断规则）+ 对抗剖面（跨租户 ID 猜测
 * 扫描、伪造/过期/重放 webhook、prompt-injection 即数据、capsule 租户
 * 拒绝矩阵 —— 全部对真实表面执行）+ 分类门报告。依赖声明与
 * architecture-policy.yaml 一致；对外只暴露 contract.ts。
 */
export const arenaReleaseGateModule = {
  id: "arena-release-gate",
  requires: ["arena-contracts", "arena-capsule", "arena-sdk", "arena-evidence"],
  provides: [
    "typed-gate-registry",
    "release-decision-blocking-rules",
    "cross-tenant-adversarial-profile",
    "webhook-signature-adversarial-profile",
    "prompt-injection-as-data-profile",
    "capsule-tenant-refusal-profile",
    "classified-gate-report",
  ],
  publicEntrypoints: ["contract.ts"],
} as const;
