/**
 * Arena wordmark —— 产品身份标识（spec/ux/arena-native-ui.md §2.1）。
 *
 * 约束：纯内联 SVG（零外部资产、零新依赖）；克制表达 —— 几何字标 +
 * 品牌点缀，不做营销式大图形；可缩放到导航轨尺寸与空态大尺寸；
 * aria 由使用者按语境提供（导航品牌位 = 链接语义，空态 = 展示语义）。
 * 用户可见面零 ZCode 品牌。
 */
import { ARENA_PRODUCT_NAME } from "../contract.js";

export interface ArenaWordmarkProps {
  /** 高度（px）——宽度按字标比例自适应。 */
  size?: number;
  /** 无障碍标签；缺省读出产品名。 */
  label?: string;
  /** 单色模式（状态条/紧凑位）。 */
  monochrome?: boolean;
}

export function ArenaWordmark({
  size = 20,
  label = ARENA_PRODUCT_NAME,
  monochrome = false,
}: ArenaWordmarkProps) {
  const brand = monochrome ? "currentColor" : "var(--arena-color-brand, #3f6df4)";
  const fg = monochrome ? "currentColor" : "var(--arena-text-primary, currentColor)";
  return (
    <svg
      className="arena-wordmark"
      width={(size * 21) / 10}
      height={size}
      viewBox="0 0 210 100"
      role="img"
      aria-label={label}
      data-arena-wordmark=""
    >
      {/* 品牌符号：三层递进的 A（能力升级的阶梯语义） */}
      <g aria-hidden="true">
        <path
          d="M8 92 L34 20 L60 92 M16 68 L52 68"
          fill="none"
          stroke={brand}
          strokeWidth={10}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M8 92 L34 20 L60 92"
          fill="none"
          stroke={brand}
          strokeWidth={10}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.35}
          transform="translate(0 -6)"
        />
      </g>
      {/* 字标：ARENA */}
      <text
        x="78"
        y="64"
        fill={fg}
        fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
        fontSize="52"
        fontWeight={640}
        letterSpacing="2"
        aria-hidden="true"
      >
        {ARENA_PRODUCT_NAME.toUpperCase()}
      </text>
    </svg>
  );
}
