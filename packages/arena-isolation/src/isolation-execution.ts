import type { ChildProcess } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { CapsuleManifest } from "@arena/contracts";
import type { CapsuleRef } from "@arena/capsule";
import type { IsolationEnvironmentReport } from "./capability.js";
import {
  buildBwrapArgs,
  buildPrlimitArgs,
  hostnameForCapsule,
  isAbsoluteSafePath,
  isReservedPath,
  isUnderWritableRoot,
  resolveCommandToken,
  type InputMount,
  type ResourceCeilings,
  type SandboxSpec,
} from "./execution-argv.js";
import {
  buildNprocPosture,
  computeNprocCeiling,
  resolveNprocWrapper,
  NPROC_MARGIN,
} from "./nproc-ceiling.js";
import { buildSeccompDenylistFilter, currentSandboxArch } from "./seccomp.js";
import { runIsolatedCommand, type SandboxIsolationEvidence } from "./spawn-layer.js";

/**
 * AR2-019 — the provider's execution surface: request validation (fail
 * closed), typed outcome mapping, and the manifest→ceiling translation.
 */

export interface IsolationExecutionProfile {
  /** RLIMIT_NPROC ceiling (the frozen manifest has no process field). */
  max_processes?: number;
  max_open_files?: number;
  /** Per-execution wall-clock ceiling; default = remaining session time. */
  wall_clock_ceiling_ms?: number;
}

export interface IsolationExecutionRequest {
  action_id: CapsuleManifest["permitted_actions"][number]["action_id"];
  /** argv array only — command[0] must appear in the action's allowlist. */
  command: readonly string[];
  /** Host→sandbox mounts; host paths must live in THIS capsule's workspace. */
  input_mounts?: readonly InputMount[];
  /** Default /workspace. tmpfs-only writable scratch. */
  scratch_path?: string;
  /** Explicit environment allowlist; the host environment NEVER passes through. */
  env?: Readonly<Record<string, string>>;
  profile?: IsolationExecutionProfile;
}

export type IsolationExecutionOutcome =
  | {
      kind: "EXECUTED_SANDBOXED";
      exit_code: number | null;
      signal: string | null;
      stdout: string;
      stderr: string;
      duration_ms: number;
      evidence: SandboxIsolationEvidence;
    }
  | {
      kind: "SYSCALL_FILTER_KILLED";
      signal: "SIGSYS";
      stdout: string;
      stderr: string;
      duration_ms: number;
      evidence: SandboxIsolationEvidence;
    }
  | { kind: "EXEC_TIMEOUT"; timeout_ms: number; partial_stdout: string }
  | { kind: "ISOLATION_NOT_SUPPORTED"; environment: IsolationEnvironmentReport }
  | { kind: "ISOLATION_SETUP_FAILED"; stage: string; detail: string; stderr: string }
  | { kind: "EGRESS_GRANT_NOT_SUPPORTED"; requested_hosts: readonly string[] }
  | {
      kind: "COMMAND_NOT_ALLOWLISTED";
      action_id: IsolationExecutionRequest["action_id"];
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
      code:
        | "ARENA_TENANT_MISMATCH"
        | "ARENA_CAPSULE_UNAVAILABLE"
        | "ARENA_INPUT_MOUNT_OUT_OF_SCOPE"
        | "ARENA_ISOLATION_REQUEST_INVALID";
      detail: string;
    };

export interface ExecutionSessionView {
  manifest: CapsuleManifest;
  ref: CapsuleRef;
  sessionDir: string;
  workspaceRoot: string;
  environment: IsolationEnvironmentReport;
  expiresAtMs: number;
  now: () => Date;
  hostUsrPath: string;
  registerChild: (child: ChildProcess) => void;
  unregisterChild: (child: ChildProcess) => void;
}

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_SCRATCH = "/workspace";
const DEFAULT_MAX_OPEN_FILES = 256;

export async function runIsolationExecution(
  session: ExecutionSessionView,
  request: IsolationExecutionRequest,
  tools: { bwrapPath: string | null; prlimitPath: string | null },
): Promise<IsolationExecutionOutcome> {
  const nowMs = session.now().getTime();
  const elapsedSeconds = Math.floor((nowMs - (session.expiresAtMs - session.manifest.resource_policy.max_duration_seconds * 1000)) / 1000);
  if (nowMs >= session.expiresAtMs) {
    return {
      kind: "SESSION_DURATION_EXCEEDED",
      max_duration_seconds: session.manifest.resource_policy.max_duration_seconds,
      elapsed_seconds: Math.max(0, elapsedSeconds),
    };
  }
  const action = session.manifest.permitted_actions.find((a) => a.action_id === request.action_id);
  const attempted = request.command[0] ?? "";
  if (action === undefined || request.command.length === 0 || !action.command_allowlist.includes(attempted)) {
    return {
      kind: "COMMAND_NOT_ALLOWLISTED",
      action_id: request.action_id,
      attempted_command: request.command.join(" ") || "(empty)",
      allowlist: action?.command_allowlist ?? [],
    };
  }
  // Egress fail-closed: an empty netns denies ALL egress; a manifest that
  // grants hosts would need a proxy layer this runtime honestly lacks.
  if (session.manifest.egress_policy.allowed_hosts.length > 0) {
    return {
      kind: "EGRESS_GRANT_NOT_SUPPORTED",
      requested_hosts: session.manifest.egress_policy.allowed_hosts,
    };
  }
  if (tools.bwrapPath === null) {
    return { kind: "ISOLATION_NOT_SUPPORTED", environment: session.environment };
  }
  const scratchPath = request.scratch_path ?? DEFAULT_SCRATCH;
  const invalidRequest = (detail: string): IsolationExecutionOutcome => ({
    kind: "REFUSED",
    code: "ARENA_ISOLATION_REQUEST_INVALID",
    detail,
  });
  if (!isAbsoluteSafePath(scratchPath) || isReservedPath(scratchPath)) {
    return invalidRequest(`scratch_path invalid or reserved: ${scratchPath}`);
  }
  if (request.env !== undefined) {
    for (const key of Object.keys(request.env)) {
      if (!ENV_KEY_PATTERN.test(key)) {
        return invalidRequest(`env key invalid: ${key}`);
      }
    }
  }
  // issue #64：max_processes 现在直接进入环境感知 ceiling 的算术，
  // 非法值（非正整数）必须类型化拒绝而非被静默夹取成看似合法的上限
  // （fail-closed 姿态；旧实现会把它夹成 1）。
  if (
    request.profile?.max_processes !== undefined &&
    (!Number.isSafeInteger(request.profile.max_processes) || request.profile.max_processes < 1)
  ) {
    return invalidRequest(`profile.max_processes must be a positive integer: ${String(request.profile.max_processes)}`);
  }
  const commandResolution = resolveCommandToken(attempted, scratchPath);
  if (commandResolution.invalid !== undefined) {
    return invalidRequest(commandResolution.invalid);
  }
  const mountsOutcome = validateInputMounts(session, request.input_mounts ?? [], scratchPath);
  if (mountsOutcome !== null) {
    return mountsOutcome;
  }
  const ceilings = ceilingsFor(
    session.manifest,
    request.profile,
    session.expiresAtMs - nowMs,
    session.environment.ambient_uid_process_count,
  );
  // issue #64（方向 2）：child-side nproc 包装器——环境感知上限在
  // 用户命名空间切换之后施加；父侧前缀不带 --nproc（buildPrlimitArgs）。
  const nprocWrapper = resolveNprocWrapper(session.hostUsrPath, ceilings.nproc);
  const nprocPosture = buildNprocPosture(
    nprocWrapper,
    ceilings.nproc,
    session.environment,
    request.profile?.max_processes ?? NPROC_MARGIN,
  );
  const timeoutMs = Math.max(
    1,
    Math.min(
      request.profile?.wall_clock_ceiling_ms ?? Number.MAX_SAFE_INTEGER,
      session.expiresAtMs - nowMs,
    ),
  );

  const sandboxArch = currentSandboxArch();
  const seccompFilter =
    session.environment.seccomp_filter_supported === true && sandboxArch !== null
      ? buildSeccompDenylistFilter(sandboxArch)
      : null;

  const spec: SandboxSpec = {
    bwrapPath: tools.bwrapPath,
    hostUsrPath: session.hostUsrPath,
    hostname: hostnameForCapsule(session.ref.capsule_id),
    scratchPath,
    scratchSizeBytes: ceilings.fsize_bytes,
    inputMounts: request.input_mounts ?? [],
    childEnv: {
      PATH: "/usr/bin:/bin",
      HOME: scratchPath,
      TMPDIR: "/tmp",
      ...request.env,
    },
    command: request.command,
    procfsStrategy: session.environment.procfs_strategy,
    seccompFilter,
    ceilings,
    bwrapMajor: session.environment.bwrap.major,
    bwrapMinor: session.environment.bwrap.minor,
    infoFd: 3,
    seccompFd: seccompFilter !== null ? 4 : null,
    nprocWrapper,
  };

  const bwrapArgs = buildBwrapArgs(spec);
  const prlimitArgs = tools.prlimitPath !== null ? buildPrlimitArgs(ceilings) : [];

  let spawnedChild: ChildProcess | null = null;
  const result = await runIsolatedCommand({
    prlimitPath: tools.prlimitPath,
    prlimitArgs,
    bwrapPath: tools.bwrapPath,
    bwrapArgs,
    ceilings,
    timeoutMs,
    seccompFilter,
    procfsStrategy: session.environment.procfs_strategy,
    nprocPosture,
    onSpawn: (child) => {
      spawnedChild = child;
      session.registerChild(child);
    },
  });
  if (spawnedChild !== null) {
    session.unregisterChild(spawnedChild);
  }
  if (result.setup_error !== null) {
    return {
      kind: "ISOLATION_SETUP_FAILED",
      stage: result.setup_error.stage,
      detail: result.setup_error.detail,
      stderr: result.stderr,
    };
  }
  if (result.timed_out) {
    return { kind: "EXEC_TIMEOUT", timeout_ms: timeoutMs, partial_stdout: result.stdout };
  }
  // bwrap's supervisor propagates sandbox signal deaths as bash-compatible
  // exit codes (128+signum); 159 = SIGSYS from the seccomp denylist.
  const SIGSYS = "SIGSYS";
  const sigsysKilled =
    result.signal === SIGSYS ||
    (seccompFilter !== null && result.exit_code !== null && result.exit_code === 159);
  if (sigsysKilled) {
    return {
      kind: "SYSCALL_FILTER_KILLED",
      signal: SIGSYS,
      stdout: result.stdout,
      stderr: result.stderr,
      duration_ms: result.duration_ms,
      evidence: result.evidence,
    };
  }
  return {
    kind: "EXECUTED_SANDBOXED",
    exit_code: result.exit_code,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    duration_ms: result.duration_ms,
    evidence: result.evidence,
  };
}

/** Manifest resource_policy → rlimit ceilings (documented mapping).
 *
 * issue #64：nproc 是环境感知上限 clamp(内核级 uid 计数 + 预算,
 * floor, hard_ceiling)（computeNprocCeiling）——uid 全局记账的内核上
 * 平坦 128 会让共享宿主机（内核计数 170-199）上的工作负载连第一个
 * fork 都失败；环境计数不可读（null）时回退 clamp(budget) 并如实记录。 */
function ceilingsFor(
  manifest: CapsuleManifest,
  profile: IsolationExecutionProfile | undefined,
  remainingSessionMs: number,
  ambientUidProcessCount: number | null,
): ResourceCeilings {
  const wallSeconds = Math.max(
    1,
    Math.ceil(
      Math.min(profile?.wall_clock_ceiling_ms ?? Number.MAX_SAFE_INTEGER, remainingSessionMs) / 1000,
    ),
  );
  const nprocBudget = profile?.max_processes ?? NPROC_MARGIN;
  return {
    cpu_seconds: Math.max(1, Math.ceil(manifest.resource_policy.cpu_limit * wallSeconds)),
    as_bytes: manifest.resource_policy.memory_limit_mb * 1024 * 1024,
    fsize_bytes: manifest.resource_policy.disk_limit_mb * 1024 * 1024,
    nproc: computeNprocCeiling(ambientUidProcessCount, nprocBudget).computed_ceiling,
    nofile: profile?.max_open_files ?? DEFAULT_MAX_OPEN_FILES,
  };
}

function validateInputMounts(
  session: ExecutionSessionView,
  mounts: readonly InputMount[],
  scratchPath: string,
): IsolationExecutionOutcome | null {
  for (const mount of mounts) {
    if (!isAbsoluteSafePath(mount.host_path)) {
      return {
        kind: "REFUSED",
        code: "ARENA_ISOLATION_REQUEST_INVALID",
        detail: `input mount host_path invalid: ${mount.host_path}`,
      };
    }
    if (!isAbsoluteSafePath(mount.sandbox_path) || isReservedPath(mount.sandbox_path)) {
      return {
        kind: "REFUSED",
        code: "ARENA_ISOLATION_REQUEST_INVALID",
        detail: `input mount sandbox_path invalid or reserved: ${mount.sandbox_path}`,
      };
    }
    if (!isUnderWritableRoot(mount.sandbox_path, scratchPath)) {
      return {
        kind: "REFUSED",
        code: "ARENA_ISOLATION_REQUEST_INVALID",
        detail: `input mount destination must be under the scratch tmpfs, /tmp or /run: ${mount.sandbox_path}`,
      };
    }
    let real: string;
    try {
      statSync(mount.host_path);
      real = realpathSync(mount.host_path);
    } catch {
      return {
        kind: "REFUSED",
        code: "ARENA_ISOLATION_REQUEST_INVALID",
        detail: `input mount host_path missing: ${mount.host_path}`,
      };
    }
    const sessionReal = realpathSync(session.sessionDir);
    if (real === sessionReal || real.startsWith(`${sessionReal}/`)) {
      continue;
    }
    // Fail closed with the AR2-004 binding semantics: a path under a DIFFERENT
    // tenant's workspace root is a typed tenant mismatch; anything else
    // outside this capsule's directory is out of scope.
    const workspaceReal = realpathSync(session.workspaceRoot);
    const relative = path.relative(workspaceReal, real);
    const firstSegment = relative.split(path.sep)[0] ?? "";
    if (
      !relative.startsWith("..") &&
      firstSegment.startsWith("tenant-") &&
      firstSegment !== `tenant-${session.ref.tenant_id}`
    ) {
      return {
        kind: "REFUSED",
        code: "ARENA_TENANT_MISMATCH",
        detail: "input mount belongs to another tenant's workspace",
      };
    }
    return {
      kind: "REFUSED",
      code: "ARENA_INPUT_MOUNT_OUT_OF_SCOPE",
      detail: "input mount outside this capsule's tenant-scoped workspace",
    };
  }
  return null;
}
