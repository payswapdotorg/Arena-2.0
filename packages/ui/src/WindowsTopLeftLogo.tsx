import { cn } from "@/components/lib/utils.js";

/**
 * Windows 标题栏左上角产品标识（UIA-001 Lane A：Arena 品牌面）。
 *
 * 变更记录（2026-10-15，UIA-001A）：此前渲染 Zai logo（alt="ZCode"）；
 * 现渲染内联 Arena 字标 —— 用户可见面零 ZCode 品牌（spec/ux/
 * arena-native-ui.md §2.1）。内联 SVG 避免新增资产文件（保持 Lane A
 * 写栏仅含本文件）。几何与原布局完全保留（左侧工具组 1px 边框后的
 * 20px 图像位、left 17px / top 19px 的对齐注释继续成立）。
 */
export function WindowsTopLeftLogo({
  className,
  imageClassName,
}: {
  className?: string;
  imageClassName?: string;
}) {
  return (
    <div
      className={cn(
        // Workspace 的左侧工具组从 1px 面板边框之后开始，Settings 旧标题层却从窗口 0 点开始，
        // Workspace 的 logo 位于 28px 按钮内，图像相对按钮左沿还有 4px 居中留白；
        // Settings 直接渲染 20px 图像，不能拿按钮容器的 left 13px 当作图像坐标。
        // 计入 4px 外层留白、1px 边框和按钮内 4px 后，两处图像均为 left 17px / top 19px。
        "absolute left-1 top-1 mt-px ml-px z-20 flex h-12 items-center px-3 [app-region:drag]",
        className,
      )}
    >
      <svg
        viewBox="0 0 210 100"
        width="42"
        height="20"
        className={cn("pointer-events-none select-none", imageClassName)}
        role="img"
        aria-label="Arena"
        data-arena-wordmark=""
      >
        {/* 三层递进的 A（能力升级的阶梯语义）—— 与 @arena/shell 的
            ArenaWordmark 同构；此处为独立内联副本（包边界：ui 不依赖 arena-shell）。 */}
        <g aria-hidden="true">
          <path
            d="M8 92 L34 20 L60 92 M16 68 L52 68"
            fill="none"
            stroke="currentColor"
            strokeWidth={10}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M8 92 L34 20 L60 92"
            fill="none"
            stroke="currentColor"
            strokeWidth={10}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.35}
            transform="translate(0 -6)"
          />
        </g>
        <text
          x="78"
          y="64"
          fill="currentColor"
          fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
          fontSize="52"
          fontWeight={640}
          letterSpacing="2"
          aria-hidden="true"
        >
          ARENA
        </text>
      </svg>
    </div>
  );
}
