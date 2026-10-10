import type { CapsuleManifest } from "@arena/contracts";

/** 冻结 id 类型经公开面派生（common.ts 的 ArenaId 类型未在 contract.ts 导出）。 */
type ArenaId = CapsuleManifest["tenant_id"];

/**
 * 租户绑定（AR2-004 验收场景 3）：为 tenant/escalation/attempt A 供给的
 * capsule 拒绝任何引用 B 的操作——失败关闭，类型化拒绝。
 * 纯函数 + 注册表形态：provider 实现复用同一判定，保证合成 provider
 * 与未来生产 provider 的绑定语义一致。
 */

export interface CapsuleBinding {
  capsule_id: ArenaId;
  tenant_id: ArenaId;
  escalation_id: ArenaId;
  attempt_id: ArenaId;
}

export type BindingCheck =
  | { kind: "BOUND"; binding: CapsuleBinding }
  | {
      kind: "REFUSED";
      code: "ARENA_TENANT_MISMATCH" | "ARENA_CAPSULE_UNAVAILABLE";
      detail: string;
    };

/** 绑定不可区分性：跨租户访问与"capsule 不存在"同样返回 CAPSULE_UNAVAILABLE。 */
export function checkCapsuleBinding(
  requested: CapsuleBinding,
  actual: CapsuleBinding | null,
): BindingCheck {
  if (actual === null) {
    return {
      kind: "REFUSED",
      code: "ARENA_CAPSULE_UNAVAILABLE",
      detail: "capsule not visible in tenant scope",
    };
  }
  if (actual.tenant_id !== requested.tenant_id) {
    return {
      kind: "REFUSED",
      code: "ARENA_CAPSULE_UNAVAILABLE",
      detail: "capsule not visible in tenant scope",
    };
  }
  if (
    actual.capsule_id !== requested.capsule_id ||
    actual.escalation_id !== requested.escalation_id ||
    actual.attempt_id !== requested.attempt_id
  ) {
    return {
      kind: "REFUSED",
      code: "ARENA_TENANT_MISMATCH",
      detail: "capsule binding mismatch (escalation/attempt)",
    };
  }
  return { kind: "BOUND", binding: actual };
}

/** 从 manifest 派生绑定（manifest 本身携带全部绑定字段）。 */
export function bindingOfManifest(manifest: CapsuleManifest): CapsuleBinding {
  return {
    capsule_id: manifest.capsule_id,
    tenant_id: manifest.tenant_id,
    escalation_id: manifest.escalation_id,
    attempt_id: manifest.attempt_id,
  };
}

/** 进程内绑定注册表（合成 provider 与测试用；生产 provider 自行持久化）。 */
export class CapsuleBindingRegistry {
  private readonly bindings = new Map<ArenaId, CapsuleBinding>();

  register(binding: CapsuleBinding): void {
    this.bindings.set(binding.capsule_id, binding);
  }

  release(capsule_id: ArenaId): void {
    this.bindings.delete(capsule_id);
  }

  check(requested: CapsuleBinding): BindingCheck {
    return checkCapsuleBinding(requested, this.bindings.get(requested.capsule_id) ?? null);
  }
}
