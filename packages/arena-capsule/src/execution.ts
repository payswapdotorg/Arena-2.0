import type { CapsuleManifest } from "@arena/contracts";
import { CAPSULE_SYNTHETIC_PROVIDER_DISCLOSURE } from "./provider-port.js";

/**
 * AR2-004 slice 2 — 合成 provider 扩展类型面（不属于引擎中立的
 * CapsuleProviderPort —— port 只覆盖生命周期操作；命令执行与身份披露
 * 是具体 provider 的表面）。
 * 强制执行点：permitted_actions.command_allowlist 与
 * resource_policy.max_duration_seconds / artifact_transfer.max_artifact_bytes。
 */

/** 合成 provider 会话内执行命令的请求。 */
export interface CommandExecutionRequest {
  action_id: CapsuleManifest["permitted_actions"][number]["action_id"];
  command: readonly string[];
}

export type ExecuteOutcome =
  | {
      kind: "EXECUTED";
      exit_code: number | null;
      killed: boolean;
      stdout: string;
      stderr: string;
      duration_ms: number;
    }
  | { kind: "EXEC_TIMEOUT"; timeout_ms: number; partial_stdout: string }
  | {
      kind: "COMMAND_NOT_ALLOWLISTED";
      action_id: CommandExecutionRequest["action_id"];
      attempted_command: string;
      allowlist: readonly string[];
    }
  | {
      kind: "SESSION_DURATION_EXCEEDED";
      max_duration_seconds: number;
      elapsed_seconds: number;
    }
  | {
      kind: "REFUSED";
      code: "ARENA_TENANT_MISMATCH" | "ARENA_CAPSULE_UNAVAILABLE";
      detail: string;
    };

/** 生产旗标：字面量类型 false —— 类型系统层面禁止任何赋值翻转；
 * 没有任何代码路径读取环境变量/配置去改它。翻转的唯一途径是修改本行
 * 并通过 docs/conformance-suite-design.md 定义的系统级隔离一致性套件
 * （CAPSULE_FAIL_CLOSED_RULE）。 */
export const PRODUCTION_ENABLED: false = false;

/** provider 身份披露：名字、日志、README 处处可见的强制标签。 */
export interface CapsuleProviderIdentity {
  provider_id: string;
  name: string;
  disclosure: string;
  production_enabled: false;
  engine: "subprocess";
}

export const SYNTHETIC_PROVIDER_IDENTITY: CapsuleProviderIdentity = {
  provider_id: "prv_synthetic_local",
  name: "arena-capsule SYNTHETIC LOCAL PROVIDER (NON-PRODUCTION)",
  disclosure: CAPSULE_SYNTHETIC_PROVIDER_DISCLOSURE,
  production_enabled: PRODUCTION_ENABLED,
  engine: "subprocess",
};
