import type { CapsuleManifest } from "@arena/contracts";

/** 冻结 id 类型经公开面派生（common.ts 的 ArenaId 类型未在 contract.ts 导出）。 */
type ArenaId = CapsuleManifest["tenant_id"];

/**
 * 合成本地 provider 的强制披露（AR2-004 验收场景 6）：
 * 名字、日志、README 处处可见；不做任何系统隔离声明；
 * productionEnabled 默认 false 且没有任何代码路径翻转它。
 * （合成 provider 实体在 slice 2 落地；本常量先冻结披露文案。）
 */
export const CAPSULE_SYNTHETIC_PROVIDER_DISCLOSURE =
  "SYNTHETIC LOCAL PROVIDER — NON-PRODUCTION: process/workspace-based simulation, " +
  "makes NO system-isolation claim; its results are NON-EVIDENCE for production " +
  "approval; the production provider stays disabled until a system-level isolation " +
  "conformance suite passes (CAPSULE_FAIL_CLOSED_RULE)";

/**
 * CapsuleProvider PORT（AR2-004 验收场景 1）—— 仅接口，引擎中立。
 * 冻结规则与 @arena/contracts ports.ts 的 PORT_NEUTRALITY_RULE 同源：
 * 本文件不允许出现任何 provider 引擎类型（Docker/Firecracker/进程/线程…）。
 * 具体实现（合成本地 provider / 生产 provider）属于后续 slice 与 WO，
 * 且生产 provider 在系统级隔离一致性套件通过前保持禁用。
 *
 * 生命周期（ES2.0 §3）：provision → ENVIRONMENT_READY → 心跳 →
 * 工件传输（pull_only / push_scoped）→ 已验证拆除（verified teardown）。
 * 关键不变量：没有 manifest + isolation assurance 就没有 ENVIRONMENT_READY
 * （CAPSULE_FAIL_CLOSED_RULE）；拆除必须吊销并验证吊销全部凭证。
 */

/** capsule 运行时状态（本缝隙的状态面；不是冻结四状态机之一）。 */
export type CapsuleRuntimeState =
  | "PROVISIONING"
  | "ENVIRONMENT_READY"
  | "TEARDOWN_REQUESTED"
  | "TERMINATED";

/** 唯一定位一个 capsule 并携带其租户/聚合绑定（所有操作都校验）。 */
export interface CapsuleRef {
  capsule_id: ArenaId;
  tenant_id: ArenaId;
  escalation_id: ArenaId;
  attempt_id: ArenaId;
}

export interface CapsuleSnapshot {
  ref: CapsuleRef;
  state: CapsuleRuntimeState;
  /** isolation assurance 已被 provider 记录（ENVIRONMENT_READY 的前置）。 */
  assurance_recorded: boolean;
  provisioned_at: string;
  last_heartbeat_at: string | null;
}

export type ProvisionOutcome =
  | { kind: "PROVISIONED"; snapshot: CapsuleSnapshot }
  | {
      kind: "REJECTED";
      code: "ARENA_CAPSULE_MANIFEST_INVALID";
      issues: Array<{ field: string; rule: string }>;
    }
  | { kind: "PROVISION_FAILED"; reason: string };

export type HeartbeatOutcome =
  | { kind: "BEAT"; snapshot: CapsuleSnapshot }
  | {
      kind: "REFUSED";
      code: "ARENA_TENANT_MISMATCH" | "ARENA_CAPSULE_UNAVAILABLE";
      detail: string;
    };

export interface ArtifactTransferRequest {
  direction: "pull_only" | "push_scoped";
  artifact_id: ArenaId;
  content_digest: string;
  size_bytes: number;
}

export type TransferOutcome =
  | { kind: "TRANSFERRED"; artifact_id: ArenaId; size_bytes: number }
  | {
      kind: "REFUSED";
      code:
        | "ARENA_TENANT_MISMATCH"
        | "ARENA_CAPSULE_UNAVAILABLE"
        | "ARENA_CAPSULE_MANIFEST_INVALID";
      detail: string;
    }
  | { kind: "OVERSIZE"; max_artifact_bytes: number; size_bytes: number };

export type TeardownOutcome =
  | { kind: "TORN_DOWN"; revoked_credentials: ArenaId[]; verified: true }
  | {
      kind: "TEARDOWN_FAILED";
      code: "ARENA_CAPSULE_TEARDOWN_FAILED";
      detail: string;
      unrevoked: ArenaId[];
    }
  | {
      kind: "REFUSED";
      code: "ARENA_TENANT_MISMATCH" | "ARENA_CAPSULE_UNAVAILABLE";
      detail: string;
    };

/** 引擎中立的 provider 角色接口（镜像 @arena/contracts ports.ts 风格）。 */
export interface CapsuleProviderPort {
  /** 失败关闭：manifest 先经 checkCapsuleManifest，非法/超范围直接 REJECTED。 */
  provision(manifest: CapsuleManifest): Promise<ProvisionOutcome>;
  heartbeat(ref: CapsuleRef): Promise<HeartbeatOutcome>;
  transferArtifact(ref: CapsuleRef, request: ArtifactTransferRequest): Promise<TransferOutcome>;
  /** 已验证拆除：吊销全部 scoped credentials 并验证吊销结果。 */
  teardown(ref: CapsuleRef): Promise<TeardownOutcome>;
}
