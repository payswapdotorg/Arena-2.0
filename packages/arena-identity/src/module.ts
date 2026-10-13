/**
 * arena-identity 模块清单：AR2-022 生产身份适配器切片。
 * IDN1.0 版本化契约族 + OIDC/JWKS 参考实现 + demo 适配器（DEMO-ONLY）。
 * packages/arena-contracts 冻结面只读引用，零修改。对外只暴露 contract.ts。
 */
export const arenaIdentityModule = {
  id: "arena-identity",
  requires: ["arena-contracts"],
  provides: [
    "arena-identity-adapter-seam",
    "arena-identity-oidc-reference",
    "arena-identity-demo-registry",
  ],
  publicEntrypoints: ["contract.ts"],
} as const;
