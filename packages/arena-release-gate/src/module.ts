/**
 * arena-release-gate 模块清单：AR2-015 集成安全、韧性、可访问性与发布门
 * （issue #17；spec/testing/acceptance-gates.md —— 最后一个核心 WO）
 * + AR2-023 发布决策仪器（issue #55；spec/work-orders/release-plan.md ——
 * WO3.0 收尾件：门重算 + 版本化决策记录 + 修订链）。
 *
 * AR2-015 只新增集成测试/证据/发布门文件（write fence）：typed 门注册表
 * （四态分类 + 证据记录 + owner 授权 + 阻断规则）+ 对抗剖面（跨租户 ID 猜测
 * 扫描、伪造/过期/重放 webhook、prompt-injection 即数据、capsule 租户
 * 拒绝矩阵 —— 全部对真实表面执行）+ 分类门报告。AR2-023 追加决策仪器：
 * 证据集/门重算（确定性、纯函数、fail-closed）、RDR1.0 决策记录
 * （范围 allow-list + 证据清单精确 SHA + 残余风险处置 + 签署块 + 复审条件）
 * 与修订链校验。依赖声明与 architecture-policy.yaml 一致；对外只暴露
 * contract.ts。本模块是「仪器」不是「授权」—— 任何授权都走
 * docs/evidence/release/AR2-023-authorization-workflow-*.md 的记录流程。
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
    "gate-recomputation",
    "release-decision-record",
    "decision-amendment-chain",
  ],
  publicEntrypoints: ["contract.ts"],
} as const;
