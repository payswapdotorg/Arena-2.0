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
  /** RLIMIT_NPROC — process count ceiling. */
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

/** prlimit(1) prefix: applies rlimits to itself then execs bwrap. */
export function buildPrlimitArgs(ceilings: ResourceCeilings): string[] {
  return [
    `--cpu=${Math.max(1, Math.floor(ceilings.cpu_seconds))}`,
    `--as=${Math.max(1, ceilings.as_bytes)}`,
    `--fsize=${Math.max(1, ceilings.fsize_bytes)}`,
    `--nproc=${Math.max(1, ceilings.nproc)}`,
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
