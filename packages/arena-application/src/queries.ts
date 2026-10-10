import { DomainError, type EscalationRecord } from "./create-escalation.js";
import type { InMemoryRuntime } from "./inmemory-runtime.js";

/**
 * 查询路径（ES2.0 §2 的 8 个查询中本 WO 覆盖的核心四个）：
 * GetEscalation / ListEscalations / GetTimeline / GetAttempt。
 * 对象级租户 scope 强制执行：跨租户读取与不存在不可区分（失败关闭）。
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

export function getEscalation(
  runtime: InMemoryRuntime,
  escalation_id: string,
  tenant_id: string,
): EscalationRecord {
  const stored = runtime.readAggregate("escalation", escalation_id);
  return requireTenantScope((stored?.record as EscalationRecord | undefined) ?? null, tenant_id);
}

export function listEscalations(
  runtime: InMemoryRuntime,
  tenant_id: string,
): Array<{ escalation_id: string; status: string; updated_at: string }> {
  const out: Array<{ escalation_id: string; status: string; updated_at: string }> = [];
  for (const row of runtime.listAggregates("escalation")) {
    const record = row.record as EscalationRecord;
    if (record.tenant_id === tenant_id) {
      out.push({
        escalation_id: record.escalation_id,
        status: record.status,
        updated_at: record.updated_at,
      });
    }
  }
  return out;
}

export function getTimeline(
  runtime: InMemoryRuntime,
  escalation_id: string,
  tenant_id: string,
): EscalationRecord["timeline"] {
  return getEscalation(runtime, escalation_id, tenant_id).timeline;
}

export function getAttempt(
  runtime: InMemoryRuntime,
  attempt_id: string,
  tenant_id: string,
): unknown {
  const stored = runtime.readAggregate("attempt", attempt_id);
  const record = (stored?.record as { tenant_id?: string } | undefined) ?? null;
  if (record === null || record.tenant_id !== tenant_id) {
    throw new DomainError("ARENA_ATTEMPT_NOT_FOUND", 404, "attempt not visible in tenant scope");
  }
  return stored?.record;
}
