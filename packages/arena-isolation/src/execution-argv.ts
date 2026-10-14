import { statSync } from "node:fs";
import { join } from "node:path";
import type { ProcfsStrategy } from "./capability.js";

/**
 * AR2-019 — typed bwrap/prlimit argv construction.
 *
 * SECURITY CONTRACT: argv arrays only — the spawn layer never concatenates a
 * shell string, so no untrusted value can smuggle additional flags or
 * metacharacters. Every path crossing the sandbox boundary is validated
 * (absolute, no "..", not inside a reserved root) BEFORE it reaches bwrap.
 */

export interface InputMount {
  /** Host-side source (must be inside the capsule's tenant workspace). */
  host_path: string;
  /** Sandbox-side destination (must be under the scratch/tmp/run tmpfs). */
  sandbox_path: string;
}

export interface ResourceCeilings {
  /** RLIMIT_CPU (seconds) — kernel-enforced CPU time. */
  cpu_seconds: number;
  /** RLIMIT_AS (bytes) — address-space ceiling. */
  as_bytes: number;
  /** RLIMIT_FSIZE (bytes) — per-file write ceiling. */
  fsize_bytes: number;
  /** RLIMIT_NPROC — 生效上限在用户命名空间切换之后由沙箱内 prlimit
   * 包装器施加（child-side，issue #64）；父侧 prlimit 前缀绝不携带
   * --nproc。数值为 clamp(环境内核级 uid 计数 + 进程预算, floor,
   * hard_ceiling)——见 nproc-ceiling.ts。 */
  nproc: number;
  /** RLIMIT_NOFILE — open file ceiling. */
  nofile: number;
}

export interface SandboxSpec {
  bwrapPath: string;
  /** Host /usr bound read-only as the sandbox runtime tree. */
  hostUsrPath: string;
  hostname: string;
  scratchPath: string;
  scratchSizeBytes: number;
  inputMounts: readonly InputMount[];
  childEnv: Readonly<Record<string, string>>;
  /** Resolved command argv; argv[0] is a sandbox-visible path or token. */
  command: readonly string[];
  procfsStrategy: ProcfsStrategy;
  seccompFilter: Buffer | null;
  ceilings: ResourceCeilings;
  bwrapMajor: number | null;
  bwrapMinor: number | null;
  /** Child fd number receiving the bwrap info JSON. */
  infoFd: number;
  /** Child fd number carrying the seccomp filter (null = no filter). */
  seccompFd: number | null;
  /** issue #64 child-side nproc 姿态：非 null 时，命令被沙箱内的
   * prlimit 包装器包裹（--nproc=<ceiling> 在用户命名空间切换之后
   * 生效）。path 为沙箱内可见的包装器路径（宿主 /usr 只读绑定使
   * /usr/bin/prlimit 与宿主同文件）。null = 包装器不可用（不施加
   * nproc，姿态证据如实记录原因）。 */
  nprocWrapper: { sandboxPath: string; ceiling: number } | null;
}

/** Sandbox roots the provider itself mounts — user paths may not collide. */
export const RESERVED_SANDBOX_ROOTS = [
  "/usr",
  "/bin",
  "/sbin",
  "/lib",
  "/lib64",
  "/proc",
  "/dev",
  "/tmp",
  "/run",
  "/etc",
  "/sys",
  "/var",
  "/root",
  "/home",
] as const;

/** Writable tmpfs roots where input mounts may land. */
export const WRITABLE_SANDBOX_ROOTS = ["/tmp", "/run"] as const;

export function isAbsoluteSafePath(p: string): boolean {
  return (
    p.startsWith("/") &&
    !p.includes("\0") &&
    p.split("/").every((segment) => segment !== ".." && !segment.includes("/")) &&
    !p.startsWith("//")
  );
}

/** Scratch/mount destinations must not sit inside a reserved sandbox root. */
export function isReservedPath(p: string): boolean {
  return RESERVED_SANDBOX_ROOTS.some((root) => p === root || p.startsWith(`${root}/`));
}

export function isUnderWritableRoot(p: string, scratchPath: string): boolean {
  const roots = [...WRITABLE_SANDBOX_ROOTS, scratchPath];
  return roots.some((root) => p === root || p.startsWith(`${root}/`));
}

function versionAtLeast(spec: SandboxSpec, major: number, minor: number): boolean {
  if (spec.bwrapMajor === null || spec.bwrapMinor === null) {
    return false;
  }
  return spec.bwrapMajor > major || (spec.bwrapMajor === major && spec.bwrapMinor >= minor);
}

/**
 * prlimit(1) 父侧前缀：对自身设置 rlimit 后 exec bwrap。
 *
 * issue #64 修复（方向 2）：这里【绝不】携带 --nproc——在内核级
 * （uid 全局）进程记账的共享宿主机上，环境计数超过上限会让 bwrap
 * 自身的 clone() 以 EAGAIN 失败（"Creating new namespace failed"），
 * 整个沙箱不可用。RLIMIT_NPROC 改由沙箱内的 prlimit 包装器在用户
 * 命名空间切换之后施加（见 buildBwrapArgs 的 nprocWrapper 段与
 * nproc-ceiling.ts 的环境感知上限计算）。
 */
export function buildPrlimitArgs(ceilings: ResourceCeilings): string[] {
  return [
    `--cpu=${Math.max(1, Math.floor(ceilings.cpu_seconds))}`,
    `--as=${Math.max(1, ceilings.as_bytes)}`,
    `--fsize=${Math.max(1, ceilings.fsize_bytes)}`,
    `--nofile=${Math.max(8, ceilings.nofile)}`,
    "--",
  ];
}

/** Full bwrap argv for the sandboxed command (order is load-bearing). */
export function buildBwrapArgs(spec: SandboxSpec): string[] {
  const args: string[] = [
    // Minimal root: empty tmpfs root, read-only host /usr as the runtime tree.
    "--tmpfs",
    "/",
    "--ro-bind",
    spec.hostUsrPath,
    "/usr",
    "--symlink",
    "usr/bin",
    "/bin",
    "--symlink",
    "usr/sbin",
    "/sbin",
    "--symlink",
    "usr/lib",
    "/lib",
    "--symlink",
    "usr/lib64",
    "/lib64",
    // PID-namespace /proc: fresh pidns-scoped procfs, or masked tmpfs.
    ...(spec.procfsStrategy === "fresh-proc" ? ["--proc", "/proc"] : ["--tmpfs", "/proc"]),
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--tmpfs",
    "/run",
    // Declared scratch: the ONLY general-purpose writable area, size-capped.
    "--size",
    String(Math.max(1, spec.scratchSizeBytes)),
    "--tmpfs",
    spec.scratchPath,
    "--chmod",
    "0700",
    spec.scratchPath,
  ];
  for (const mount of spec.inputMounts) {
    const parent = parentDir(mount.sandbox_path);
    if (parent !== "/" && parent !== spec.scratchPath) {
      args.push("--dir", parent);
    }
    args.push("--ro-bind", mount.host_path, mount.sandbox_path);
  }
  args.push(
    // Namespaces: unprivileged user (uid 0 mapped to the invoking uid), mount,
    // PID, IPC, UTS and an empty (deny-by-default egress) network namespace.
    "--unshare-user",
    "--uid",
    "0",
    "--gid",
    "0",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--unshare-net",
  );
  if (versionAtLeast(spec, 0, 12) && spec.procfsStrategy === "fresh-proc") {
    // 0.12+: forbid creating further user namespaces inside the sandbox.
    // Requires a real procfs (bwrap writes the userns-scoped sysctl); with a
    // masked /proc the extra is skipped rather than breaking the sandbox.
    args.push("--disable-userns");
  }
  args.push(
    "--hostname",
    spec.hostname,
    "--chdir",
    spec.scratchPath,
    "--die-with-parent",
    "--new-session",
    // Secret hygiene: NO host environment passes through; only the explicit
    // allowlist below is set inside the sandbox.
    "--clearenv",
  );
  for (const [key, value] of Object.entries(spec.childEnv)) {
    args.push("--setenv", key, value);
  }
  if (spec.infoFd >= 0) {
    args.push("--info-fd", String(spec.infoFd));
  }
  if (spec.seccompFilter !== null && spec.seccompFd !== null) {
    args.push("--seccomp", String(spec.seccompFd));
  }
  args.push("--");
  // issue #64（方向 2）：RLIMIT_NPROC 在用户命名空间切换之后施加——
  // bwrap 先完成自己的 namespace 设置并 exec 该包装器，包装器对自身
  // setrlimit(NPROC) 后 exec 真实命令。父侧前缀（buildPrlimitArgs）
  // 不携带 --nproc，环境 uid 计数不再卡死 bwrap 自身的 clone()。
  // argv 数组拼接（无 shell），完整链路进入 evidence.bwrap_argv 审计。
  // 注意：prlimit(1) 的资源选项只接受 `--nproc=<value>` 等号形式——
  // 空格分离形式会把 value 当作要 exec 的命令（实证：
  // "prlimit: failed to execute <value>"），父侧前缀同理使用等号形式。
  if (spec.nprocWrapper !== null) {
    args.push(
      spec.nprocWrapper.sandboxPath,
      `--nproc=${Math.max(1, spec.nprocWrapper.ceiling)}`,
      "--",
    );
  }
  args.push(...spec.command);
  return args;
}

function parentDir(p: string): string {
  const idx = p.lastIndexOf("/");
  if (idx <= 0) {
    return "/";
  }
  return p.slice(0, idx);
}

/** Namespace-local hostname for a capsule (`--hostname` value). */
export function hostnameForCapsule(capsuleId: string): string {
  const sanitized = capsuleId.replace(/[^a-zA-Z0-9-]/g, "-").replace(/^-+/, "").slice(0, 40);
  return `arena-${sanitized.length > 0 ? sanitized : "capsule"}`;
}

/**
 * Command-token resolution inside the sandbox runtime tree: bare names must
 * resolve through the host /usr (the read-only runtime bind); path tokens
 * must be absolute-safe and confined to the runtime/scratch roots. Returns
 * an `invalid` message fail-closed — never a silent fallback.
 */
export function resolveCommandToken(
  token: string,
  scratchPath: string,
): { invalid?: string } {
  if (token.includes("/")) {
    if (!isAbsoluteSafePath(token)) {
      return { invalid: `command path unsafe: ${token}` };
    }
    const allowed = ["/usr", "/bin", "/sbin", scratchPath, "/tmp", "/run"];
    if (!allowed.some((root) => token === root || token.startsWith(`${root}/`))) {
      return { invalid: `command path outside sandbox runtime/scratch: ${token}` };
    }
    return {};
  }
  try {
    statSync(join("/usr/bin", token));
    return {};
  } catch {
    return { invalid: `command not resolvable inside sandbox: ${token}` };
  }
}
