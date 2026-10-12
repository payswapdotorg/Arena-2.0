import { spawn } from "node:child_process";
import { accessSync, closeSync, constants, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { arch, platform, release } from "node:os";
import { buildSeccompDenylistFilter, currentSandboxArch } from "./seccomp.js";

/**
 * AR2-019 — isolation capability probes.
 *
 * Every claim the provider later makes about OS-level isolation is grounded in
 * a probe that RAN in this environment (never inferred from a version string
 * alone). The report is an inspectable evidence object: the release-gate
 * owner re-runs it in strict mode on the gate station.
 */

export type ProcfsStrategy = "fresh-proc" | "masked-proc" | "unavailable" | "unprobed";
export type IsolationCapability = "FULL_ISOLATION" | "PARTIAL_ISOLATION" | "NOT_SUPPORTED";

export interface BwrapToolReport {
  path: string | null;
  version: string | null;
  /** Parsed major.minor (null when unparsable) — gates version-bound flags. */
  major: number | null;
  minor: number | null;
}

/** Inspectable environment report (recorded into conformance evidence). */
export interface IsolationEnvironmentReport {
  probed_at: string;
  platform: string;
  arch: string;
  kernel_release: string;
  max_user_namespaces: number | null;
  unprivileged_userns_clone: boolean | null;
  /** True only when an unprivileged bwrap exec probe actually succeeded. */
  userns_empirically_available: boolean | null;
  bwrap: BwrapToolReport;
  /** fresh-proc = pidns-scoped procfs mounted; masked-proc = /proc masked by
   * an empty tmpfs (host PIDs invisible either way; see README). */
  procfs_strategy: ProcfsStrategy;
  seccomp_filter_supported: boolean | null;
  prlimit_path: string | null;
  capability: IsolationCapability;
  limitations: string[];
  /** Trimmed stderr samples from failed probes (raw evidence, bounded). */
  probe_stderr_samples: string[];
}

export interface ProbeOptions {
  /** Explicit bwrap path override (tests use this to fake absence). */
  bwrapPath?: string;
  /** Explicit prlimit path override. */
  prlimitPath?: string;
}

/** Search PATH for an executable file (no `which` dependency). */
function findExecutable(name: string, explicitPath?: string): string | null {
  const candidates = explicitPath
    ? [explicitPath]
    : (process.env.PATH ?? "").split(":").filter(Boolean).map((dir) => `${dir}/${name}`);
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

interface CaptureResult {
  ok: boolean;
  exitCode: number | null;
  stderr: string;
  stdout: string;
}

/** argv-array spawn with captured streams; integer stdio entries pass fds. */
function runCapture(
  file: string,
  args: string[],
  stdio: Array<"ignore" | "pipe" | number> = ["ignore", "pipe", "pipe"],
  timeoutMs = 10_000,
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { stdio, timeout: timeoutMs });
    } catch (error) {
      resolve({ ok: false, exitCode: null, stderr: String(error), stdout: "" });
      return;
    }
    let stderr = "";
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({ ok: false, exitCode: null, stderr: stderr + String(error), stdout });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, exitCode: code, stderr, stdout });
    });
  });
}

function parseVersion(raw: string): { version: string | null; major: number | null; minor: number | null } {
  const match = raw.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (match === null) {
    return { version: raw.trim() || null, major: null, minor: null };
  }
  return { version: raw.trim(), major: Number(match[1]), minor: Number(match[2]) };
}

function readSysctlInt(path: string): number | null {
  try {
    return Number(readFileSync(path, "utf8").trim());
  } catch {
    return null;
  }
}

function readSysctlBool(path: string): boolean | null {
  const value = readSysctlInt(path);
  return value === null ? null : value !== 0;
}

/** Minimal sandbox argv used by the probes (same rootfs contract as the
 * real execution path — see execution-argv.ts). */
function probeArgs(procMode: "fresh" | "masked", extra: string[]): string[] {
  const procArgs = procMode === "fresh" ? ["--proc", "/proc"] : ["--tmpfs", "/proc"];
  return [
    "--tmpfs",
    "/",
    "--ro-bind",
    "/usr",
    "/usr",
    // merged-usr symlink set — dynamic binaries resolve their ELF interpreter
    // through /lib64 (and libs through /lib); omitting these yields ENOENT.
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
    "--unshare-user",
    "--uid",
    "0",
    "--gid",
    "0",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--unshare-net",
    "--die-with-parent",
    ...procArgs,
    ...extra,
    "/bin/true",
  ];
}

/** Stage the seccomp filter in a temp file and open it as a readable fd
 * the child receives via an integer stdio entry. */
function stageFilterFile(buffer: Buffer, index: number): { stdio: Array<"ignore" | "pipe" | number>; cleanup: () => void } | null {
  const path = join(tmpdir(), `arena-isolation-probe-${process.pid}-${Date.now()}.bpf`);
  try {
    writeFileSync(path, buffer, { mode: 0o600 });
    const fd = openSync(path, "r");
    // No holes in the stdio array: entries below `index` must be explicit.
    const stdio: Array<"ignore" | "pipe" | number> = [];
    for (let i = 0; i < index; i += 1) {
      stdio.push(i === 0 ? "ignore" : "pipe");
    }
    stdio[index] = fd;
    return {
      stdio,
      cleanup: () => {
        closeSync(fd);
        rmSync(path, { force: true });
      },
    };
  } catch {
    return null;
  }
}

export async function probeIsolationEnvironment(
  options: ProbeOptions = {},
): Promise<IsolationEnvironmentReport> {
  const notes: string[] = [];
  const stderrSamples: string[] = [];

  const bwrapPath = findExecutable(
    "bwrap",
    options.bwrapPath ?? process.env.ARENA_ISOLATION_BWRAP_PATH,
  );
  let bwrap: BwrapToolReport = { path: bwrapPath, version: null, major: null, minor: null };
  let usernsEmpirical: boolean | null = null;
  let procfsStrategy: ProcfsStrategy = "unprobed";
  let seccompSupported: boolean | null = null;

  if (bwrapPath === null) {
    notes.push("bwrap not found in PATH (or explicit path): OS-level isolation unavailable");
  } else if (platform() !== "linux") {
    notes.push(`platform ${platform()} is not linux: the bwrap runtime is linux-only`);
  } else {
    const versionRun = await runCapture(bwrapPath, ["--version"]);
    const parsed = parseVersion(versionRun.stdout || versionRun.stderr);
    bwrap = { ...parsed, path: bwrapPath };

    let strategy: ProcfsStrategy = "unavailable";
    const freshRun = await runCapture(bwrapPath, probeArgs("fresh", []));
    if (freshRun.ok) {
      strategy = "fresh-proc";
      usernsEmpirical = true;
    } else {
      stderrSamples.push(`fresh-proc: ${freshRun.stderr.trim().slice(0, 200)}`);
      const maskedRun = await runCapture(bwrapPath, probeArgs("masked", []));
      if (maskedRun.ok) {
        strategy = "masked-proc";
        usernsEmpirical = true;
        notes.push(
          "fresh procfs mount is denied in this environment (containerized kernel restriction); " +
            "falling back to /proc masked by an empty tmpfs — host PIDs stay invisible, " +
            "pid-namespace evidence is collected parent-side (see README: degrade policy)",
        );
      } else {
        stderrSamples.push(`masked-proc: ${maskedRun.stderr.trim().slice(0, 200)}`);
        usernsEmpirical = false;
        notes.push("unprivileged bwrap execution failed: user namespaces or kernel policy unavailable");
      }
    }
    procfsStrategy = strategy;

    if (strategy !== "unavailable") {
      const sandboxArch = currentSandboxArch();
      if (sandboxArch === null) {
        seccompSupported = false;
        notes.push(`arch ${arch()} has no syscall denylist table: seccomp filter layer disabled`);
      } else {
        const staged = stageFilterFile(buildSeccompDenylistFilter(sandboxArch), 4);
        if (staged === null) {
          seccompSupported = false;
          notes.push("could not stage seccomp filter file for the probe");
        } else {
          const run = await runCapture(
            bwrapPath,
            probeArgs(strategy === "fresh-proc" ? "fresh" : "masked", ["--seccomp", "4"]),
            staged.stdio,
          );
          seccompSupported = run.ok;
          if (!run.ok) {
            stderrSamples.push(`seccomp-probe: ${run.stderr.trim().slice(0, 200)}`);
            notes.push("bwrap could not install the seccomp filter (kernel or version limitation)");
          }
          staged.cleanup();
        }
      }
    }
  }

  const prlimitPath = findExecutable("prlimit", options.prlimitPath);
  if (prlimitPath === null) {
    notes.push("prlimit not found: rlimit ceilings unavailable (wall-clock enforcement only)");
  }

  let capability: IsolationCapability = "NOT_SUPPORTED";
  if (usernsEmpirical === true) {
    capability =
      seccompSupported === true && prlimitPath !== null ? "FULL_ISOLATION" : "PARTIAL_ISOLATION";
  }

  return {
    probed_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    platform: platform(),
    arch: arch(),
    kernel_release: release(),
    max_user_namespaces: readSysctlInt("/proc/sys/user/max_user_namespaces"),
    unprivileged_userns_clone: readSysctlBool("/proc/sys/kernel/unprivileged_userns_clone"),
    userns_empirically_available: usernsEmpirical,
    bwrap,
    procfs_strategy: procfsStrategy,
    seccomp_filter_supported: seccompSupported,
    prlimit_path: prlimitPath,
    capability,
    limitations: notes,
    probe_stderr_samples: stderrSamples,
  };
}
