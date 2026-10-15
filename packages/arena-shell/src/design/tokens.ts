/**
 * 设计令牌目录（arena-tokens.css 的 TS 镜像）。
 *
 * 令牌法（spec/ux/arena-native-ui.md §2.2）：所有 Arena 视觉身份令牌一律
 * --arena-* 前缀；本目录是测试可断言的规范名册 —— CSS 与 TS 镜像必须
 * 一致（tokens.test.ts 校验双向覆盖：CSS 里每个 --arena-* 在目录里，
 * 目录里每个名字在 CSS 里）。语义分组是 FROZEN 的（增删令牌走 TL）；
 * 值的调整不破坏覆盖性。
 */
export const ARENA_TOKEN_GROUPS = [
  "brand",
  "surface",
  "text",
  "border",
  "status",
  "evidence",
  "focus",
  "spacing",
  "radius",
  "motion",
] as const;

export type ArenaTokenGroup = (typeof ARENA_TOKEN_GROUPS)[number];

export interface ArenaTokenEntry {
  /** CSS 自定义属性名（不含前导 --）。 */
  name: string;
  group: ArenaTokenGroup;
  /** 令牌用途（简短中文说明，供评审与文档使用）。 */
  purpose: string;
}

const CATALOG: readonly ArenaTokenEntry[] = [
  { name: "arena-color-brand", group: "brand", purpose: "品牌主色（点缀用，禁整面填充）" },
  { name: "arena-color-brand-strong", group: "brand", purpose: "品牌强调色（hover/按压）" },
  { name: "arena-color-brand-soft", group: "brand", purpose: "品牌柔和底（浅衬底）" },
  { name: "arena-color-on-brand", group: "brand", purpose: "品牌面上的文本色" },
  { name: "arena-surface-app", group: "surface", purpose: "应用底面（跟随宿主主题）" },
  { name: "arena-surface-panel", group: "surface", purpose: "面板面" },
  { name: "arena-surface-raised", group: "surface", purpose: "凸起面（卡片/浮层）" },
  { name: "arena-surface-hover", group: "surface", purpose: "悬停面（品牌混合 12%）" },
  { name: "arena-text-primary", group: "text", purpose: "主文本" },
  { name: "arena-text-secondary", group: "text", purpose: "次级文本" },
  { name: "arena-text-muted", group: "text", purpose: "弱化文本（元信息）" },
  { name: "arena-text-on-soft", group: "text", purpose: "柔和底上的文本" },
  { name: "arena-border-subtle", group: "border", purpose: "弱边界" },
  { name: "arena-border-strong", group: "border", purpose: "强边界" },
  { name: "arena-color-status-pass", group: "status", purpose: "状态：通过（逐字词表）" },
  { name: "arena-color-status-denied", group: "status", purpose: "状态：拒绝（逐字词表）" },
  { name: "arena-color-status-blocked", group: "status", purpose: "状态：阻塞（逐字词表）" },
  { name: "arena-color-status-pending", group: "status", purpose: "状态：等待（逐字词表）" },
  { name: "arena-color-status-info", group: "status", purpose: "状态：信息" },
  { name: "arena-evidence-demo", group: "evidence", purpose: "证据等级 DEMO（逐字）" },
  { name: "arena-evidence-fixture", group: "evidence", purpose: "证据等级 FIXTURE（逐字）" },
  { name: "arena-evidence-real", group: "evidence", purpose: "证据等级 REAL（逐字）" },
  { name: "arena-focus-ring-color", group: "focus", purpose: "焦点环颜色（画在包装层）" },
  { name: "arena-focus-ring-width", group: "focus", purpose: "焦点环宽度" },
  { name: "arena-focus-ring-offset", group: "focus", purpose: "焦点环偏移" },
  { name: "arena-focus-surface", group: "focus", purpose: "焦点面（背景表达）" },
  { name: "arena-space-1", group: "spacing", purpose: "间距 4px 档" },
  { name: "arena-space-2", group: "spacing", purpose: "间距 8px 档" },
  { name: "arena-space-3", group: "spacing", purpose: "间距 12px 档" },
  { name: "arena-space-4", group: "spacing", purpose: "间距 16px 档" },
  { name: "arena-space-5", group: "spacing", purpose: "间距 24px 档" },
  { name: "arena-space-6", group: "spacing", purpose: "间距 32px 档" },
  { name: "arena-radius-sm", group: "radius", purpose: "圆角小" },
  { name: "arena-radius-md", group: "radius", purpose: "圆角中" },
  { name: "arena-radius-lg", group: "radius", purpose: "圆角大" },
  { name: "arena-motion-fast", group: "motion", purpose: "快动效（120ms）" },
  { name: "arena-motion-base", group: "motion", purpose: "基准动效（180ms）" },
  { name: "arena-motion-ease", group: "motion", purpose: "动效缓动曲线" },
];

/** 全部令牌名（含 -- 前缀的 CSS 形式由 cssName() 派生）。 */
export const ARENA_TOKEN_NAMES: readonly string[] = CATALOG.map((e) => e.name);

export function cssName(token: string): string {
  return "--" + token;
}

/** 按组检索（测试与工具用）。 */
export function tokensByGroup(group: ArenaTokenGroup): readonly ArenaTokenEntry[] {
  return CATALOG.filter((e) => e.group === group);
}

/** 证据等级 → 令牌名（屏渲染时使用，逐字流转）。 */
export const EVIDENCE_GRADE_TOKENS: Record<string, string> = {
  DEMO: cssName("arena-evidence-demo"),
  FIXTURE: cssName("arena-evidence-fixture"),
  REAL: cssName("arena-evidence-real"),
};
