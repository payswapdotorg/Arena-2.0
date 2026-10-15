/**
 * 导航模型（spec/ux/arena-native-ui.md §1.2，FROZEN 语义的纯逻辑层）：
 * 键序（roving tabindex 的 next/prev/home/end）、拒绝文案、URL 深链的
 * hash 读写。屏永不自行改路由 —— 一切经端口；本模块只服务 shell 自身
 * 的键盘与 URL wiring。
 */
import { ARENA_SCREEN_IDS, type ArenaNavigationRefusal, type ArenaScreenId } from "../contract.js";

/** 键序计算：在封闭词汇表上移动焦点（roving tabindex 语义）。 */
export function nextScreen(current: ArenaScreenId, delta: 1 | -1): ArenaScreenId {
  const i = ARENA_SCREEN_IDS.indexOf(current);
  const n = ARENA_SCREEN_IDS.length;
  return screenAt(i + delta);
}

export function screenAt(index: number): ArenaScreenId {
  const n = ARENA_SCREEN_IDS.length;
  return ARENA_SCREEN_IDS[((index % n) + n) % n] ?? ARENA_SCREEN_IDS[0];
}

export function firstScreen(): ArenaScreenId {
  return ARENA_SCREEN_IDS[0] ?? "requester";
}

export function lastScreen(): ArenaScreenId {
  return ARENA_SCREEN_IDS[ARENA_SCREEN_IDS.length - 1] ?? "requester";
}

/** 拒绝文案（逐字展示 —— 屏与 shell 共用的唯一渲染源）。 */
export function refusalText(refusal: ArenaNavigationRefusal): string {
  if (refusal.kind === "unregistered_screen") {
    return `Navigation refused — screen "${refusal.screenId}" is not registered in this shell.`;
  }
  return `Navigation refused — ${refusal.reason}.`;
}

/** 深链 hash：#/<screenId>。未知值返回 null（shell 显示诚实拒绝而非猜测）。 */
export function screenFromHash(hash: string): ArenaScreenId | null {
  const m = /^#\/([a-z-]+)$/.exec(hash.trim());
  if (!m) return null;
  const candidate = m[1] ?? "";
  return (ARENA_SCREEN_IDS as readonly string[]).includes(candidate)
    ? (candidate as ArenaScreenId)
    : null;
}

export function hashForScreen(screen: ArenaScreenId): string {
  return `#/${screen}`;
}
