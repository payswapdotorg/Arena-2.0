/**
 * arena-shell 模块清单：UIA-001 Wave 0 冻结层（spec/ux/arena-native-ui.md）。
 * 产品外壳：导航端口（类型化拒绝）、屏登记表、Arena 身份/令牌、
 * 诚实姿态条。屏本体由 Worker B/C 的 screens/ 子树登记提供；
 * web/desktop 挂接是 TL 集成提交的 wiring。依赖声明与
 * architecture-policy.yaml 一致；对外只暴露 contract.ts。
 */
export const arenaShellModule = {
  id: "arena-shell",
  requires: ["arena-contracts", "arena-workbench"],
  provides: [
    "shell-navigation-port",
    "shell-screen-registry",
    "shell-product-identity",
    "shell-design-tokens",
    "shell-release-posture",
  ],
  publicEntrypoints: ["contract.ts"],
} as const;
