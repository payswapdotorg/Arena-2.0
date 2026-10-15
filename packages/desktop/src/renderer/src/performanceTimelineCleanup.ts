const PERFORMANCE_TIMELINE_CLEANUP_INTERVAL_MS = 10_000;

// UIA-002（issue #71）：renderer 类型程序加 node 类型后（@arena/workbench 源码
// 需要），`ReturnType<typeof window.setInterval>` 会被 node 的全局 setInterval
// 签名劫持成 NodeJS.Timeout —— 显式写 number（DOM 面 window.setInterval 的
// 真实返回），语义不变。
let cleanupTimer: number | undefined;

export function startPerformanceTimelineCleanup(): void {
  if (!import.meta.env.DEV || cleanupTimer != null) {
    return;
  }

  // React 19.2 的 development build 会把组件渲染写入 Performance timeline。
  // 这些 PerformanceMeasure 由 window.performance 原生列表强引用，长时间开发会堆到 GB 级；
  // 这里定时清理只影响 DevTools 性能轨迹，不影响业务逻辑和生产包。
  cleanupTimer = window.setInterval(() => {
    window.performance.clearMeasures();
    window.performance.clearMarks();
  }, PERFORMANCE_TIMELINE_CLEANUP_INTERVAL_MS);
}
