import type { ReactNode } from "react";

/**
 * AR2-021 — live-region announcer（无障碍修复）。
 *
 * gate 报告 grg_00000013 的缺口：异步状态跃迁（submitting → submitted、
 * adjudication pending → resolved）对屏幕阅读器不可闻。此组件提供持久
 * 的 role="status"（隐式 aria-live="polite"）区域：区域始终挂载，
 * 内容变化时由读屏器播报——新插入节点不播报的陷阱被规避。
 *
 * 纯展示（无副作用）：消息文本由调用方（宿主组合层）驱动。
 */
export function LiveAnnouncer(props: { message: string }): ReactNode {
  return (
    <p className="arena-live-announcer" role="status" data-announcement={props.message}>
      {props.message}
    </p>
  );
}
