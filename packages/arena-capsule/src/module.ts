/**
 * arena-capsule 模块清单：AR2-004 capsule 契约与隔离适配器缝隙。
 * CapsuleProvider port（引擎中立）+ 失败关闭的 manifest 校验 + 租户绑定 +
 * 短时效 scoped credential 语义 + 合成本地 provider（slice 2，非生产）+
 * 显式生命周期状态机。上游 ZCode agent runtime 不是租户边界
 * （冻结规则 UPSTREAM_RUNTIME_NOT_A_BOUNDARY_RULE）——不可信专家执行
 * 必须经由本缝隙。依赖声明与 architecture-policy.yaml 保持一致；
 * 对外只暴露 contract.ts。
 */
export const arenaCapsuleModule = {
  id: "arena-capsule",
  requires: ["arena-contracts"],
  provides: [
    "capsule-provider-port",
    "capsule-manifest-fail-closed-validation",
    "capsule-tenant-binding",
    "capsule-scoped-credentials",
    "capsule-synthetic-local-provider",
    "capsule-lifecycle-state-machine",
  ],
  publicEntrypoints: ["contract.ts"],
} as const;
