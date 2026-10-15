/**
 * 产品标题管理（spec/ux/arena-native-ui.md §2.1）：shell 是 document.title
 * 的唯一写入者；标题一律 ARENA_PRODUCT_NAME 起头。恢复语义：卸载时还原
 * 进入前标题（挂接期不漂移到 ZCode 字样）。
 */
import { ARENA_PRODUCT_NAME, type ArenaScreenId } from "../contract.js";

const SCREEN_TITLES: Record<ArenaScreenId, string> = {
  requester: "Requester cockpit",
  expert: "Expert workbench",
  reviewer: "Review & adjudication",
  developer: "Developer portal",
  operations: "Operations",
};

export function screenTitle(screen: ArenaScreenId): string {
  return `${ARENA_PRODUCT_NAME} — ${SCREEN_TITLES[screen]}`;
}

export function appTitle(): string {
  return ARENA_PRODUCT_NAME;
}

/** 设置当前屏标题；返回恢复函数（测试与挂接卸载用）。 */
export function applyDocumentTitle(screen: ArenaScreenId | null): () => void {
  const previous = typeof document !== "undefined" ? document.title : "";
  if (typeof document !== "undefined") {
    document.title = screen === null ? appTitle() : screenTitle(screen);
  }
  return () => {
    if (typeof document !== "undefined") {
      document.title = previous;
    }
  };
}

/** 语言无关标题词表（i18n 安全：屏名保持英文产品词，zh 环境同样可读）。 */
export const SCREEN_TITLE_VOCABULARY: Readonly<Record<ArenaScreenId, string>> = SCREEN_TITLES;
