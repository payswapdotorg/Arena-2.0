/**
 * arena-acquisition 模块清单：AR2-016 能力缺口采集契约（ACQ1.0）与确定性
 * provider 路由（issue #32；spec/capability-acquisition + ACR-0002）。
 * 依赖声明与 architecture-policy.yaml 的依赖纪律一致（仅 arena-contracts）；
 * 对外只暴露 contract.ts。
 */
export const arenaAcquisitionModule = {
  id: "arena-acquisition",
  requires: ["arena-contracts"],
  provides: [
    "acquisition-contracts",
    "provider-registry",
    "capability-router",
    "route-decision-audit",
  ],
  publicEntrypoints: ["contract.ts"],
} as const;
