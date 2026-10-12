/**
 * arena-upgrade 模块清单：AR2-018 evidence-to-capability 打包、评估与受控
 * 发布平面（issue #34；spec/capability-acquisition §7 + ACR-0002）。
 * 依赖声明与 architecture-policy.yaml 的依赖纪律一致（root 接线归 TL）；
 * 对外只暴露 contract.ts。
 */
export const arenaUpgradeModule = {
  id: "arena-upgrade",
  requires: [
    "arena-contracts",
    "arena-acquisition",
    "arena-scraper",
    "arena-learning",
    "arena-evidence",
  ],
  provides: [
    "dataset-intake-validation",
    "transformation-manifest",
    "capability-upgrade-proposals",
    "capability-packs",
    "delivery-strategies",
    "capability-evaluation",
    "controlled-publication",
    "rollback-and-feedback",
  ],
  publicEntrypoints: ["contract.ts"],
} as const;
