/**
 * AR2-013 — 配额台账 + 队列滞后 + 无隐藏付费回退审计（issue #15）。
 *
 * 冻结纪律：
 * - 配额耗尽 → 类型化 QUOTA_EXHAUSTED（fail-closed：调用方必须拒绝，
 *   绝不静默降级 —— 「额度不足还继续跑」不存在）；
 * - 队列滞后 = 可见指标（到期条数 + 最老到期年龄 + 分级）；
 * - no-hidden-paid-fallback：每个组件必须显式声明回退策略；
 *   未声明 / 静默付费回退 = 类型化违规（审计永不静默通过）。
 */

export type QuotaCounter = "in_flight_commands" | "submissions_per_round" | "reviews_per_candidate";

export type QuotaOutcome =
  | { kind: "RESERVED"; remaining: number }
  | {
      kind: "QUOTA_EXHAUSTED";
      counter: QuotaCounter;
      limit: number;
      requested: number;
      fail_closed: true;
    };

export interface QuotaLimit {
  counter: QuotaCounter;
  limit: number;
}

/** 租户配额台账（内存参考实现 —— 可见、可审计）。 */
export class QuotaLedger {
  private readonly usage = new Map<string, number>();

  constructor(private readonly limits: readonly QuotaLimit[]) {}

  reserve(tenant_id: string, counter: QuotaCounter, amount = 1): QuotaOutcome {
    const limit = this.limits.find((candidate) => candidate.counter === counter)?.limit ?? 0;
    const key = `${tenant_id}:${counter}`;
    const current = this.usage.get(key) ?? 0;
    if (current + amount > limit) {
      return { kind: "QUOTA_EXHAUSTED", counter, limit, requested: amount, fail_closed: true };
    }
    this.usage.set(key, current + amount);
    return { kind: "RESERVED", remaining: limit - current - amount };
  }

  release(tenant_id: string, counter: QuotaCounter, amount = 1): void {
    const key = `${tenant_id}:${counter}`;
    const current = this.usage.get(key) ?? 0;
    this.usage.set(key, Math.max(current - amount, 0));
  }

  usageOf(tenant_id: string, counter: QuotaCounter): number {
    return this.usage.get(`${tenant_id}:${counter}`) ?? 0;
  }
}

export interface QueueStats {
  due_count: number;
  /** 最老到期消息的入队/到期时间（无到期消息为 null）。 */
  oldest_due_at: string | null;
}

export type QueueLagLevel = "OK" | "LAGGING" | "SEVERE";

export interface QueueLagReport {
  due_count: number;
  oldest_age_seconds: number | null;
  level: QueueLagLevel;
}

/** 队列滞后（可见性）：due 条数 + 最老年龄 → 分级。 */
export function computeQueueLag(stats: QueueStats, now: string): QueueLagReport {
  if (stats.due_count === 0 || stats.oldest_due_at === null) {
    return { due_count: stats.due_count, oldest_age_seconds: null, level: "OK" };
  }
  const ageSeconds = Math.max(
    0,
    Math.floor((Date.parse(now) - Date.parse(stats.oldest_due_at)) / 1000),
  );
  const level: QueueLagLevel = ageSeconds >= 600 ? "SEVERE" : ageSeconds >= 60 ? "LAGGING" : "OK";
  return { due_count: stats.due_count, oldest_age_seconds: ageSeconds, level };
}

export type DeclaredFallback = "none" | "explicit_free" | "explicit_paid";

export interface FallbackDeclaration {
  component_id: string;
  fallback: DeclaredFallback | "undeclared";
  /** declared 时的披露（paid 回退必须显式披露理由与预算来源）。 */
  disclosure: string | null;
}

export type FallbackAuditOutcome =
  | { kind: "CLEAN"; checked: number }
  | {
      kind: "VIOLATIONS";
      violations: ReadonlyArray<{ component_id: string; rule: string }>;
      checked: number;
    };

/**
 * no-hidden-paid-fallback 审计：
 * - undeclared → 违规（组件必须声明回退策略）；
 * - explicit_paid 无披露 → 违规（付费回退必须可见 + 有预算理由）。
 */
export function auditNoHiddenPaidFallback(
  declarations: readonly FallbackDeclaration[],
): FallbackAuditOutcome {
  const violations: Array<{ component_id: string; rule: string }> = [];
  for (const declaration of declarations) {
    if (declaration.fallback === "undeclared") {
      violations.push({
        component_id: declaration.component_id,
        rule: "fallback policy must be explicitly declared (undeclared fallback is forbidden)",
      });
    } else if (
      declaration.fallback === "explicit_paid" &&
      (declaration.disclosure === null || declaration.disclosure.length === 0)
    ) {
      violations.push({
        component_id: declaration.component_id,
        rule: "paid fallback requires an explicit disclosure with budget rationale",
      });
    }
  }
  if (violations.length === 0) return { kind: "CLEAN", checked: declarations.length };
  return { kind: "VIOLATIONS", violations, checked: declarations.length };
}

export const CAPACITY_DISCLOSURE =
  "Quota exhaustion is a typed fail-closed rejection (never silent degradation); queue lag is a " +
  "visible gauge over outbox stats; every component must declare its fallback policy — undeclared " +
  "or undisclosed paid fallbacks are audit violations";
