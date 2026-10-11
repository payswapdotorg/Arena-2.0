import { z } from "zod";
import { arenaIdSchema, isoTimestampSchema } from "@arena/contracts";

/** 本包 schema 用的局部文本约束（contracts 内部件不导出 —— 只定义结构边界）。 */
export const nonEmptyShort = z.string().min(1).max(120);
export const nonEmptyMedium = z.string().min(1).max(2000);

/**
 * AR2-014 — 权利授予（issue #16；architecture-lock 学习门）。
 *
 * 冻结纪律（fail-closed）：
 * - 复用需要显式 RightsGrant：无授予 → 无复用（客户制品默认私有，
 *   「客户数据保持私有，除非显式授予更广泛复用」是结构默认值）；
 * - 授予带 scope（制品范围）、purpose、期限与 provenance 条款；
 * - 撤销立即生效：撤销后任何新的复用判定都必须失败。
 */

export const rightsScopeSchema = z.enum([
  "single_tenant_reuse",
  "aggregated_anonymous",
  "marketplace_publication",
]);

export const rightsGrantSchema = z
  .object({
    grant_id: arenaIdSchema,
    tenant_id: arenaIdSchema,
    /** 被授予权利的源制品（证据/数据集/尝试产出）。 */
    artifact_ids: z.array(arenaIdSchema).min(1).max(64),
    scope: rightsScopeSchema,
    purpose: nonEmptyMedium,
    granted_at: isoTimestampSchema,
    expires_at: isoTimestampSchema.nullable(),
    revoked_at: isoTimestampSchema.nullable(),
    provenance_terms: nonEmptyMedium,
  })
  .strict();

export type RightsScope = z.infer<typeof rightsScopeSchema>;
export type RightsGrant = z.infer<typeof rightsGrantSchema>;

export type RightsEvaluation =
  | { kind: "RIGHTS_GRANTED"; grant: RightsGrant }
  | {
      kind: "RIGHTS_MISSING";
      reason:
        | "no_grant"
        | "artifact_not_covered"
        | "grant_expired"
        | "grant_revoked"
        | "scope_mismatch";
      fail_closed: true;
    };

export class RightsGrantRegistry {
  private readonly grants = new Map<string, RightsGrant>();

  recordGrant(
    input: unknown,
  ):
    | { kind: "RECORDED"; grant: RightsGrant }
    | { kind: "REJECTED"; issues: ReadonlyArray<{ field: string; rule: string }> } {
    const parsed = rightsGrantSchema.safeParse(input);
    if (!parsed.success) {
      return {
        kind: "REJECTED",
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
          rule: issue.message,
        })),
      };
    }
    this.grants.set(parsed.data.grant_id, parsed.data);
    return { kind: "RECORDED", grant: parsed.data };
  }

  revoke(grantId: string, revokedAt: string): boolean {
    const grant = this.grants.get(grantId);
    if (grant === undefined || grant.revoked_at !== null) return false;
    grant.revoked_at = revokedAt;
    return true;
  }

  /** 复用判定（fail-closed：任何缺失都挡下复用）。 */
  evaluateReuseRight(input: {
    tenant_id: string;
    artifact_id: string;
    scope: RightsScope;
    now: string;
  }): RightsEvaluation {
    for (const grant of this.grants.values()) {
      if (grant.tenant_id !== input.tenant_id) continue;
      if (!grant.artifact_ids.includes(input.artifact_id)) continue;
      if (grant.revoked_at !== null) continue;
      if (grant.expires_at !== null && grant.expires_at < input.now) continue;
      if (grant.scope !== input.scope) continue;
      return { kind: "RIGHTS_GRANTED", grant };
    }
    const hasAnyGrant = [...this.grants.values()].some(
      (grant) =>
        grant.tenant_id === input.tenant_id && grant.artifact_ids.includes(input.artifact_id),
    );
    if (hasAnyGrant) {
      // 有授予但不匹配当前请求：区分过期/撤销/范围不符。
      for (const grant of this.grants.values()) {
        if (grant.tenant_id !== input.tenant_id || !grant.artifact_ids.includes(input.artifact_id))
          continue;
        if (grant.revoked_at !== null)
          return { kind: "RIGHTS_MISSING", reason: "grant_revoked", fail_closed: true };
        if (grant.expires_at !== null && grant.expires_at < input.now) {
          return { kind: "RIGHTS_MISSING", reason: "grant_expired", fail_closed: true };
        }
        return { kind: "RIGHTS_MISSING", reason: "scope_mismatch", fail_closed: true };
      }
    }
    return { kind: "RIGHTS_MISSING", reason: "no_grant", fail_closed: true };
  }

  grantsSnapshot(): readonly RightsGrant[] {
    return [...this.grants.values()].map((grant) => ({ ...grant }));
  }
}

export const RIGHTS_DISCLOSURE =
  "Reuse requires an explicit RightsGrant covering the artifact, scope and window; revocation is " +
  "immediate; customer artifacts are private by default — every missing-grant path is a typed " +
  "fail-closed rejection, never a silent default-open";
