import { DomainError, type EscalationRecord } from "./create-escalation.js";
import type { ArenaRuntime } from "./runtime.js";

/**
 * 查询路径（ES2.0 §2 的 8 个查询中本 WO 覆盖的核心四个）：
 * GetEscalation / ListEscalations / GetTimeline / GetAttempt。
 * 对象级租户 scope 强制执行：跨租户读取与不存在不可区分（失败关闭）。
 *
 * AR2-005 slice 2：对象读取走冻结端口 aggregates.loadAggregate（async，
 * 引擎无关）；列表走 listAggregates 的引擎侧租户过滤（runtime.ts 披露的
 * 实现内部扩展）—— 应用侧 requireTenantScope 仍是权威判定。
 */

export function requireTenantScope(
  record: EscalationRecord | null,
  tenant_id: string,
): EscalationRecord {
  if (record === null || record.tenant_id !== tenant_id) {
    throw new DomainError(
      "ARENA_ESCALATION_NOT_FOUND",
      404,
      "escalation not visible in tenant scope",
    );
  }
  return record;
}

export async function getEscalation(
  runtime: ArenaRuntime,
  escalation_id: string,
  tenant_id: string,
): Promise<EscalationRecord> {
  const stored = await runtime.aggregates.loadAggregate("escalation", escalation_id);
  return requireTenantScope((stored?.record as EscalationRecord | undefined) ?? null, tenant_id);
}

export function listEscalations(
  runtime: ArenaRuntime,
  tenant_id: string,
): Array<{ escalation_id: string; status: string; updated_at: string }> {
  return runtime.listAggregates("escalation", tenant_id).map((row) => {
    const record = row.record as EscalationRecord;
    return {
      escalation_id: record.escalation_id,
      status: record.status,
      updated_at: record.updated_at,
    };
  });
}

export async function getTimeline(
  runtime: ArenaRuntime,
  escalation_id: string,
  tenant_id: string,
): Promise<EscalationRecord["timeline"]> {
  return (await getEscalation(runtime, escalation_id, tenant_id)).timeline;
}

export async function getAttempt(
  runtime: ArenaRuntime,
  attempt_id: string,
  tenant_id: string,
): Promise<unknown> {
  const stored = await runtime.aggregates.loadAggregate("attempt", attempt_id);
  const record = (stored?.record as { tenant_id?: string } | undefined) ?? null;
  if (record === null || record.tenant_id !== tenant_id) {
    throw new DomainError("ARENA_ATTEMPT_NOT_FOUND", 404, "attempt not visible in tenant scope");
  }
  return stored?.record;
}
