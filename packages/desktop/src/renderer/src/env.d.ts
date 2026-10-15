/**
 * UIA-002（issue #71）—— renderer 类型程序的 CSS 模块声明（TL 集成 wiring）。
 *
 * 与 packages/web/src/env.d.ts 同一手法：renderer 现在直接 import
 * `@arena/shell/styles.css`（与既有 `@zcode/ui/styles.css` 同一类副作用导入）。
 * 本文件只补 CSS 模块声明 —— 该程序其余既有缺口（window.zcode 环境类型等
 * 125 个历史错误，从未进 CI typecheck 图）不在本工单范围，如实保持原样。
 */
declare module "*.css";
declare module "@zcode/ui/styles.css";
declare module "@arena/shell/styles.css";
