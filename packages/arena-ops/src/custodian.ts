import type { CapsuleProviderPort, CapsuleRef } from "@arena/capsule";

/**
 * AR2-013 — capsule 拆除漂移检测 + 孤儿回收（issue #15）。
 *
 * 冻结纪律：
 * - 漂移 = 拆除期限已过但 teardown 未验证（可见，绝不静默）；
 * - 回收 sweep 驱动真实 CapsuleProviderPort.teardown：
 *   TORN_DOWN(verified) → 回收完成（漂移清除）；
 *   TEARDOWN_FAILED → 漂移保留 + 可见失败（凭据未吊销清单）；
 *   REFUSED(CAPSULE_UNAVAILABLE) → 孤儿条目：escalate（可见）；
 * - 回收记录可审计（何时、哪个 capsule、结果、重试计数）。
 */

export interface CapsuleLedgerEntry {
  capsule_ref: CapsuleRef;
  tenant_id: string;
  provisioned_at: string;
  teardown_deadline_at: string;
  teardown_verified: boolean;
}

export type TeardownDriftEntry = {
  capsule_ref: CapsuleRef;
  tenant_id: string;
  deadline_at: string;
  overdue_seconds: number;
};

export type RecoveryRecord =
  | { kind: "RECOVERED"; capsule_ref: CapsuleRef; verified: true; recovered_at: string }
  | {
      kind: "TEARDOWN_FAILED_VISIBLE";
      capsule_ref: CapsuleRef;
      unrevoked_credentials: readonly string[];
      drift_retained: true;
    }
  | { kind: "ORPHAN_ESCALATED"; capsule_ref: CapsuleRef; detail: string; escalated: true };

export interface SweepReport {
  scanned: number;
  drift_detected: number;
  recoveries: readonly RecoveryRecord[];
  remaining_drift: number;
}

/** capsule 台账 + 看门人（内存参考实现 —— 驱动真实 provider 端口）。 */
export class CapsuleCustodian {
  private readonly entries: CapsuleLedgerEntry[] = [];

  register(entry: CapsuleLedgerEntry): void {
    this.entries.push({ ...entry });
  }

  /** 标记拆除已验证（provider 的 TORN_DOWN 结果由调用方/sweep 写回）。 */
  markTeardownVerified(capsuleId: string): void {
    const entry = this.entries.find((candidate) => candidate.capsule_ref.capsule_id === capsuleId);
    if (entry !== undefined) entry.teardown_verified = true;
  }

  /** 漂移检测：期限已过且未验证。 */
  detectTeardownDrift(now: string): readonly TeardownDriftEntry[] {
    return this.entries
      .filter((entry) => !entry.teardown_verified && entry.teardown_deadline_at < now)
      .map((entry) => ({
        capsule_ref: entry.capsule_ref,
        tenant_id: entry.tenant_id,
        deadline_at: entry.teardown_deadline_at,
        overdue_seconds: Math.max(
          0,
          Math.floor((Date.parse(now) - Date.parse(entry.teardown_deadline_at)) / 1000),
        ),
      }));
  }

  /** 回收 sweep：对全部漂移条目重新发起已验证拆除（真实 provider 端口）。 */
  async sweep(input: { now: string; provider: CapsuleProviderPort }): Promise<SweepReport> {
    const drift = this.detectTeardownDrift(input.now);
    const recoveries: RecoveryRecord[] = [];
    for (const entry of drift) {
      const outcome = await input.provider.teardown(entry.capsule_ref);
      if (outcome.kind === "TORN_DOWN") {
        this.markTeardownVerified(entry.capsule_ref.capsule_id);
        recoveries.push({
          kind: "RECOVERED",
          capsule_ref: entry.capsule_ref,
          verified: true,
          recovered_at: input.now,
        });
      } else if (outcome.kind === "TEARDOWN_FAILED") {
        recoveries.push({
          kind: "TEARDOWN_FAILED_VISIBLE",
          capsule_ref: entry.capsule_ref,
          unrevoked_credentials: outcome.unrevoked,
          drift_retained: true,
        });
      } else if (outcome.code === "ARENA_CAPSULE_UNAVAILABLE") {
        recoveries.push({
          kind: "ORPHAN_ESCALATED",
          capsule_ref: entry.capsule_ref,
          detail: outcome.detail,
          escalated: true,
        });
      } else {
        recoveries.push({
          kind: "ORPHAN_ESCALATED",
          capsule_ref: entry.capsule_ref,
          detail: `${outcome.code}: ${outcome.detail}`,
          escalated: true,
        });
      }
    }
    const remainingDrift = this.detectTeardownDrift(input.now).length;
    return {
      scanned: this.entries.length,
      drift_detected: drift.length,
      recoveries,
      remaining_drift: remainingDrift,
    };
  }

  entriesSnapshot(): readonly CapsuleLedgerEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }
}

export const CUSTODIAN_DISCLOSURE =
  "The custodian detects teardown drift (deadline passed without verified teardown) and sweeps " +
  "the REAL capsule provider port: verified teardowns recover, failed teardowns stay visible with " +
  "their unrevoked credential lists, and unavailable capsules escalate as orphans — no silent cleanup";
