import type { CapsuleRuntimeState } from "./provider-port.js";

/**
 * AR2-004 slice 2 — capsule 生命周期状态机（显式、可测的迁移表）。
 * 状态面来自 provider-port.ts 的 CapsuleRuntimeState：
 *   PROVISIONING → ENVIRONMENT_READY → TEARDOWN_REQUESTED → TERMINATED
 *
 * 冻结语义（CAPSULE_FAIL_CLOSED_RULE / ES2.0 §3）：
 * - 没有 manifest + isolation assurance 就没有 ENVIRONMENT_READY
 *   （校验在供给入口失败关闭，PROVISIONING 永远到不了 READY）；
 * - 没有 TEARDOWN_REQUESTED 就没有 TERMINATED（capsule 不可跳过拆除）；
 * - TERMINATED 是终态（无出边）。
 */
export const CAPSULE_LIFECYCLE_TRANSITIONS: Readonly<
  Record<CapsuleRuntimeState, readonly CapsuleRuntimeState[]>
> = {
  PROVISIONING: ["ENVIRONMENT_READY"],
  ENVIRONMENT_READY: ["TEARDOWN_REQUESTED"],
  TEARDOWN_REQUESTED: ["TERMINATED"],
  TERMINATED: [],
};

/** 迁移合法性判定（唯一入口；provider 内部所有状态推进都经此函数）。 */
export function capsuleLifecycleAllows(
  from: CapsuleRuntimeState,
  to: CapsuleRuntimeState,
): boolean {
  return CAPSULE_LIFECYCLE_TRANSITIONS[from].includes(to);
}

/** 终态判定（终态 capsule 的一切操作都必须失败关闭）。 */
export function capsuleLifecycleIsTerminal(state: CapsuleRuntimeState): boolean {
  return CAPSULE_LIFECYCLE_TRANSITIONS[state].length === 0;
}
