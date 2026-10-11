import { z } from "zod";
import { retentionProfileSchema } from "@arena/contracts";

/** 冻结保留策略枚举（从 contracts schema 派生 —— 不第二套语义）。 */
export type RetentionPolicy = z.infer<typeof retentionProfileSchema>;

/**
 * AR2-013 — 声明式保留策略 + 清扫决策（issue #15）。
 *
 * 冻结纪律：
 * - 保留窗口按 retention_profile（STANDARD/EXTENDED/SHORT/COMPLIANCE）
 *   声明式展开（天数表冻结；改动走版本化策略变更）；
 * - 决策类型化：RETAINED（窗口内）/ ELIGIBLE_FOR_DELETION（窗口外）/
 *   CLEANUP_DRIFT（已到期待清但被标记保留 —— 可见漂移）；
 * - ops 只产出决策 —— 实际删除由持久层/合规流程执行（本包零删除权）。
 */

export const RETENTION_DAY_TABLE: Readonly<
  Record<
    RetentionPolicy,
    {
      escalation_days: number;
      evidence_days: number;
      payment_days: number;
    }
  >
> = {
  STANDARD: { escalation_days: 90, evidence_days: 90, payment_days: 365 },
  EXTENDED: { escalation_days: 365, evidence_days: 365, payment_days: 730 },
  SHORT: { escalation_days: 7, evidence_days: 30, payment_days: 365 },
  COMPLIANCE: { escalation_days: 2555, evidence_days: 2555, payment_days: 2555 },
};

export type RetentionRecordKind = "escalation" | "evidence" | "payment";

export interface RetentionCandidate {
  record_id: string;
  kind: RetentionRecordKind;
  retention_profile: RetentionPolicy;
  last_updated_at: string;
  /** 显式保留标记（如诉讼冻结 —— 漂移检测用）。 */
  hold: boolean;
}

export type RetentionDecision =
  | { kind: "RETAINED"; record_id: string; days_remaining: number }
  | { kind: "ELIGIBLE_FOR_DELETION"; record_id: string; overdue_days: number }
  | { kind: "CLEANUP_DRIFT"; record_id: string; overdue_days: number; reason: "hold_after_window" };

export interface RetentionSweepReport {
  decisions: readonly RetentionDecision[];
  eligible: number;
  drift: number;
  /** 结构字面量：ops 产决策，不执行删除。 */
  deletions_performed: 0;
}

/** 保留策略求值（纯函数；now 为 ISO 时间戳）。 */
export function evaluateRetention(input: {
  candidates: readonly RetentionCandidate[];
  now: string;
}): RetentionSweepReport {
  const decisions = input.candidates.map((candidate): RetentionDecision => {
    const windows = RETENTION_DAY_TABLE[candidate.retention_profile];
    const days = windows[`${candidate.kind}_days` as const];
    const ageDays = Math.floor(
      (Date.parse(input.now) - Date.parse(candidate.last_updated_at)) / 86_400_000,
    );
    const remaining = days - ageDays;
    if (remaining > 0) {
      return { kind: "RETAINED", record_id: candidate.record_id, days_remaining: remaining };
    }
    if (candidate.hold) {
      return {
        kind: "CLEANUP_DRIFT",
        record_id: candidate.record_id,
        overdue_days: -remaining,
        reason: "hold_after_window",
      };
    }
    return {
      kind: "ELIGIBLE_FOR_DELETION",
      record_id: candidate.record_id,
      overdue_days: -remaining,
    };
  });
  return {
    decisions,
    eligible: decisions.filter((decision) => decision.kind === "ELIGIBLE_FOR_DELETION").length,
    drift: decisions.filter((decision) => decision.kind === "CLEANUP_DRIFT").length,
    deletions_performed: 0,
  };
}

export const RETENTION_DISCLOSURE =
  "Retention windows are a frozen declarative table per retention_profile; the evaluator only " +
  "produces typed decisions (RETAINED / ELIGIBLE_FOR_DELETION / CLEANUP_DRIFT) — this package " +
  "holds zero deletion authority; actual purges run in the persistence/compliance layer";
