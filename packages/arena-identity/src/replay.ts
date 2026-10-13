/**
 * IDN1.0 重放防线（AR2-022）。
 *
 * 诚实边界：边缘 jti 记忆是单实例内存防线 —— 多实例拓扑下完整重放
 * 防御属于 IdP/网关策略（refresh-token 轮换、检测/撤销）与部署层。
 * 因此默认策略是 "none"（披露），"jti_once" 是显式选择的单实例加固。
 * 记忆有界（容量上限 + 有效性到期清扫），防止无界内存增长。
 */

export type ReplayPolicy = "none" | "jti_once";

export interface ReplayGuardOptions {
  policy: ReplayPolicy;
  /** 最大记忆条目数（默认 10_000；超出淘汰最早过期项）。 */
  maxEntries?: number;
}

export interface ReplayGuard {
  /** 记录并判定：策略 none 恒接受；jti_once 在有效窗口内重复 ⇒ 拒绝。 */
  checkAndRecord(key: string, expiresAtEpochSeconds: number, nowEpochSeconds: number): boolean;
  /** 条目数（测试/运维投影）。 */
  size(): number;
}

interface ReplayEntry {
  key: string;
  expiresAt: number;
}

const DEFAULT_MAX_ENTRIES = 10_000;

export function createReplayGuard(options: ReplayGuardOptions): ReplayGuard {
  const policy = options.policy;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  let entries: ReplayEntry[] = [];

  function sweep(nowEpochSeconds: number): void {
    if (entries.length === 0) return;
    entries = entries.filter((entry) => entry.expiresAt > nowEpochSeconds);
  }

  return {
    checkAndRecord(key, expiresAt, nowEpochSeconds) {
      if (policy === "none") return true;
      sweep(nowEpochSeconds);
      const duplicate = entries.some((entry) => entry.key === key);
      if (duplicate) return false;
      if (entries.length >= maxEntries) {
        // 淘汰最早过期项（有界记忆的诚实取舍，文档披露）。
        let earliestIndex = 0;
        for (let index = 1; index < entries.length; index += 1) {
          if (
            (entries[index] as ReplayEntry).expiresAt <
            (entries[earliestIndex] as ReplayEntry).expiresAt
          ) {
            earliestIndex = index;
          }
        }
        entries.splice(earliestIndex, 1);
      }
      entries.push({ key, expiresAt });
      return true;
    },
    size() {
      return entries.length;
    },
  };
}
