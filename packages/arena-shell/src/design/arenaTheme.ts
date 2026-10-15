/**
 * UIA-005 — Arena 明暗主题激活（issue #78；spec/ux/arena-native-ui.md §2.2）。
 *
 * 承接的约束（全部记录在案）：
 *   - 冻结令牌组：浅色回退组 `:root[data-arena-theme="light"]`（arena-tokens.css，
 *     FROZEN --arena-* 命名空间）。本模块把 data-arena-theme 属性真正落到根元素
 *     上 —— 浅色组由此激活；深色是 :root 的记录值（默认态，无需属性）。
 *   - 宿主主题词表：web/desktop 启动块在 documentElement 上维护
 *     dark / theme-zai-light / theme-zai-dark 三个 class（packages/web/src/main.tsx
 *     的 classList.toggle 三连 —— 继承 DESIGN.md 的明暗 + Zai 变体法；桌面端
 *     同一词表）。解析优先级：dark → theme-zai-light → theme-zai-dark →
 *     系统偏好回退（prefers-color-scheme: dark）。
 *   - 注入约束（node-testable）：本模块零直接 DOM 全局 —— 无 document /
 *     MutationObserver / matchMedia 引用。documentElement、系统偏好探针与
 *     class 属性观察器全部由组合根注入；node 测试用可变 stub 注入即可覆盖
 *     全部分支。浏览器组合根的接线配方（TL 集成时执行）：
 *
 *       const root = document.documentElement;
 *       const systemDark = () =>
 *         window.matchMedia("(prefers-color-scheme: dark)").matches;
 *       const mutationObserver = new MutationObserver(() => {
 *         applyArenaTheme(
 *           root,
 *           resolveArenaTheme({ classList: root.classList, systemDark: systemDark() }),
 *         );
 *       });
 *       observeArenaTheme({
 *         target: root,
 *         systemDark,
 *         observe: (target, options) => {
 *           mutationObserver.observe(target as Element, options);
 *           return mutationObserver;
 *         },
 *       });
 *
 *     工厂职责 = 立即（resolve + apply）+ 以 { attributes: true,
 *     attributeFilter: ["class"] } 注册 + 返回 disconnect；宿主 class 变更的
 *     重解析/重落属性由组合根回调用本模块导出的纯函数组合完成（模块自身
 *     绝不构造 MutationObserver —— 组合根拥有其生命周期）。
 *   - 披露：本模块加入 design 树（arena-tokens.css / tokens.ts 的邻居）；
 *     公开面扩展（package.json exports / architecture-policy
 *     publicEntrypoints）发生在 TL 集成时（manifests 与 policy 是 TL 所有）。
 */

/** Arena 主题（对应 arena-tokens.css 的 :root 记录值组与浅色回退组）。 */
export type ArenaTheme = "light" | "dark";

/**
 * 从宿主主题 class + 系统偏好解析 Arena 主题（纯函数、全定义）。
 *
 * 优先级（与 web/desktop 启动块的语义一致）：
 *   1. `dark`（宿主已解析为深色 —— Zai 变体之外的通用深色态）
 *   2. `theme-zai-light`（Zai 浅色变体）
 *   3. `theme-zai-dark`（Zai 深色变体）
 *   4. 系统偏好（systemDark ? "dark" : "light"）
 */
export function resolveArenaTheme(input: {
  classList: { contains(token: string): boolean };
  systemDark: boolean;
}): ArenaTheme {
  if (input.classList.contains("dark")) {
    return "dark";
  }
  if (input.classList.contains("theme-zai-light")) {
    return "light";
  }
  if (input.classList.contains("theme-zai-dark")) {
    return "dark";
  }
  return input.systemDark ? "dark" : "light";
}

/**
 * 落主题属性：target.setAttribute("data-arena-theme", theme)。
 * 浏览器组合根传 document.documentElement（激活 arena-tokens.css 的浅色组）。
 */
export function applyArenaTheme(
  target: { setAttribute(name: string, value: string): void },
  theme: ArenaTheme,
): void {
  target.setAttribute("data-arena-theme", theme);
}

/** 观察句柄（转发到注入的观察器的 disconnect）。 */
export interface ArenaThemeObserver {
  disconnect(): void;
}

/**
 * 主题观察工厂：立即 resolve + apply，然后以 { attributes: true,
 * attributeFilter: ["class"] } 调 deps.observe 注册 class 属性观察器，返回
 * { disconnect }。浏览器组合根的 deps.observe 即 `new MutationObserver(cb)`
 * 的 observe 包装（见模块 docblock 的接线配方）；变更回调的重解析/重落属性
 * 用本模块导出的 resolveArenaTheme / applyArenaTheme 组合。
 */
export function observeArenaTheme(deps: {
  target: { setAttribute(name: string, value: string): void; classList: { contains(token: string): boolean } };
  systemDark(): boolean;
  observe(target: unknown, options: { attributes: boolean; attributeFilter: readonly string[] }): {
    disconnect(): void;
  };
}): ArenaThemeObserver {
  applyArenaTheme(
    deps.target,
    resolveArenaTheme({ classList: deps.target.classList, systemDark: deps.systemDark() }),
  );
  const observer = deps.observe(deps.target, { attributes: true, attributeFilter: ["class"] });
  return { disconnect: (): void => observer.disconnect() };
}
