import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProcfsStrategy } from "./capability.js";
import type { ResourceCeilings } from "./execution-argv.js";

/**
 * AR2-019 — typed spawn layer for the isolation runtime.
 *
 * Runs `prlimit -- bwrap ... -- <command>` with argv arrays only (no shell),
 * captures stdout/stderr as bounded evidence records, enforces the wall-clock
 * ceiling by killing the sandbox's process group, and collects parent-side
 * namespace evidence: bwrap's own --info-fd report (sandbox pid + namespace
 * inode numbers) cross-checked against /proc/<pid>/ns/* and uid_map of the
 * live sandbox process.
 */

const IO_CAPTURE_LIMIT_BYTES = 65536;
const NS_KINDS = ["user", "pid", "mnt", "net", "uts", "ipc"] as const;
type NsKind = (typeof NS_KINDS)[number];

/** bwrap --info-fd JSON (keys as of bubblewrap 0.12; best-effort evidence). */
export interface BwrapInfoReport {
  sandbox_pid: number | null;
  namespaces: { ipc: number | null; mnt: number | null; net: number | null; pid: number | null; uts: number | null };
}

export interface SandboxIsolationEvidence {
  sandbox_pid: number | null;
  bwrap_info: BwrapInfoReport | null;
  /** Per-namespace: true = sandbox ns inode differs from the parent's. */
  namespace_divergence: { user: boolean | null; pid: boolean | null; mnt: boolean | null; net: boolean | null; uts: boolean | null; ipc: boolean | null };
  /** Parent-side /proc/<pid>/uid_map of the sandbox process (e.g. "0 1001 1"). */
  uid_map: string | null;
  seccomp_filter_installed: boolean;
  procfs_strategy: ProcfsStrategy;
  /** The exact bwrap argv that ran (audit: no shell interpolation). */
  bwrap_argv: readonly string[];
  prlimit_ceiling: ResourceCeilings | null;
}

export interface SandboxRunInput {
  prlimitPath: string | null;
  prlimitArgs: readonly string[];
  bwrapPath: string;
  bwrapArgs: readonly string[];
  ceilings: ResourceCeilings;
  timeoutMs: number;
  seccompFilter: Buffer | null;
  procfsStrategy: ProcfsStrategy;
  /** Called with the spawned process group leader before the run resolves
   * (teardown can kill a live sandbox through the session child set). */
  onSpawn?: (child: ChildProcess) => void;
}

export interface SandboxRunResult {
  exit_code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  duration_ms: number;
  timed_out: boolean;
  evidence: SandboxIsolationEvidence;
  /** Non-null when the spawn chain itself failed before the child ran. */
  setup_error: { stage: string; detail: string } | null;
}

function nsInode(link: string): number | null {
  const match = link.match(/\[(\d+)\]$/);
  return match === null ? null : Number(match[1]);
}

function readSelfNamespaces(): Record<NsKind, number | null> {
  const out = {} as Record<NsKind, number | null>;
  for (const kind of NS_KINDS) {
    try {
      out[kind] = nsInode(readlinkSync(`/proc/self/ns/${kind}`));
    } catch {
      out[kind] = null;
    }
  }
  return out;
}

function parseInfoJson(raw: string): BwrapInfoReport | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const num = (key: string): number | null => {
      const value = parsed[key];
      return typeof value === "number" ? value : null;
    };
    return {
      sandbox_pid: num("child-pid"),
      namespaces: {
        ipc: num("ipc-namespace"),
        mnt: num("mnt-namespace"),
        net: num("net-namespace"),
        pid: num("pid-namespace"),
        uts: num("uts-namespace"),
      },
    };
  } catch {
    return null;
  }
}

/** Sample the live sandbox process from the parent side (best effort). */
function sampleSandboxProcess(pid: number): { divergence: SandboxIsolationEvidence["namespace_divergence"]; uid_map: string | null } {
  const self = readSelfNamespaces();
  const divergence = {
    user: null as boolean | null,
    pid: null as boolean | null,
    mnt: null as boolean | null,
    net: null as boolean | null,
    uts: null as boolean | null,
    ipc: null as boolean | null,
  };
  let uidMap: string | null = null;
  try {
    for (const kind of NS_KINDS) {
      const ino = nsInode(readlinkSync(`/proc/${pid}/ns/${kind}`));
      divergence[kind] = ino === null || self[kind] === null ? null : ino !== self[kind];
    }
    uidMap = readFileSync(`/proc/${pid}/uid_map`, "utf8").trim();
  } catch {
    // Process exited before sampling — info-fd report remains as evidence.
  }
  return { divergence, uid_map: uidMap };
}

export async function runIsolatedCommand(input: SandboxRunInput): Promise<SandboxRunResult> {
  const startedWallMs = Date.now();
  const evidence: SandboxIsolationEvidence = {
    sandbox_pid: null,
    bwrap_info: null,
    namespace_divergence: {
      user: null,
      pid: null,
      mnt: null,
      net: null,
      uts: null,
      ipc: null,
    },
    uid_map: null,
    seccomp_filter_installed: input.seccompFilter !== null,
    procfs_strategy: input.procfsStrategy,
    bwrap_argv: input.bwrapArgs,
    prlimit_ceiling: input.prlimitPath === null ? null : input.ceilings,
  };

  // Stage the seccomp filter file and pass its fd as child fd 4.
  let filterFd: number | null = null;
  let filterPath: string | null = null;
  if (input.seccompFilter !== null) {
    filterPath = join(tmpdir(), `arena-isolation-filter-${process.pid}-${Date.now()}.bpf`);
    try {
      writeFileSync(filterPath, input.seccompFilter, { mode: 0o600 });
      filterFd = openSync(filterPath, "r");
    } catch (error) {
      return {
        exit_code: null,
        signal: null,
        stdout: "",
        stderr: "",
        duration_ms: 0,
        timed_out: false,
        evidence,
        setup_error: { stage: "stage-seccomp-filter", detail: String(error) },
      };
    }
  }

  const argv = input.prlimitPath !== null
    ? [input.prlimitPath, ...input.prlimitArgs, input.bwrapPath, ...input.bwrapArgs]
    : [input.bwrapPath, ...input.bwrapArgs];
  const stdio: Array<"ignore" | "pipe" | number> = ["ignore", "pipe", "pipe", "pipe"];
  if (filterFd !== null) {
    stdio[4] = filterFd;
  }

  let child: ChildProcess;
  try {
    child = spawn(argv[0] ?? "", argv.slice(1), {
      stdio,
      detached: true,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    });
  } catch (error) {
    closeStaged(filterFd, filterPath);
    return {
      exit_code: null,
      signal: null,
      stdout: "",
      stderr: "",
      duration_ms: 0,
      timed_out: false,
      evidence,
      setup_error: { stage: "spawn", detail: String(error) },
    };
  }
  input.onSpawn?.(child);

  return await new Promise<SandboxRunResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let infoRaw = "";
    let sampled = false;

    const capture = (current: string, chunk: Buffer): string =>
      (current + chunk.toString("utf8")).slice(0, IO_CAPTURE_LIMIT_BYTES);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = capture(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = capture(stderr, chunk);
    });
    const infoStream = child.stdio[3];
    let sampling: Promise<void> | null = null;
    let childExited = false;
    const beginSampling = (pid: number): void => {
      // bwrap writes the info JSON before its parent side writes the child's
      // uid_map — poll briefly until the mapping materializes.
      sampling = (async () => {
        for (let attempt = 0; attempt < 40 && !childExited; attempt += 1) {
          const { divergence, uid_map } = sampleSandboxProcess(pid);
          evidence.namespace_divergence = divergence;
          if (uid_map !== null && uid_map.trim().length > 0) {
            evidence.uid_map = uid_map;
          }
          const complete =
            evidence.uid_map !== null && divergence.user !== null;
          if (complete) {
            return;
          }
          await new Promise((wait) => setTimeout(wait, 15));
        }
      })();
    };
    if (infoStream !== null && typeof infoStream === "object" && "on" in infoStream) {
      (infoStream as import("node:stream").Readable).on("data", (chunk: Buffer) => {
        infoRaw += chunk.toString("utf8");
        if (!sampled) {
          const info = parseInfoJson(infoRaw);
          if (info !== null && info.sandbox_pid !== null) {
            sampled = true;
            evidence.bwrap_info = info;
            evidence.sandbox_pid = info.sandbox_pid;
            beginSampling(info.sandbox_pid);
          }
        }
      });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessGroup(child);
    }, input.timeoutMs);
    timer.unref?.();

    child.on("error", (error) => {
      clearTimeout(timer);
      closeStaged(filterFd, filterPath);
      resolve({
        exit_code: null,
        signal: null,
        stdout,
        stderr: `${stderr}${String(error)}`,
        duration_ms: Date.now() - startedWallMs,
        timed_out: false,
        evidence,
        setup_error: { stage: "spawn", detail: String(error) },
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      closeStaged(filterFd, filterPath);
      childExited = true;
      const finish = (): void => resolveRun(code, signal);
      if (sampling !== null) {
        void sampling.then(finish);
        return;
      }
      finish();
    });
    const resolveRun = (code: number | null, signal: string | null): void => {
      if (evidence.bwrap_info === null && infoRaw.trim().length > 0) {
        const info = parseInfoJson(infoRaw);
        if (info !== null) {
          evidence.bwrap_info = info;
          evidence.sandbox_pid = info.sandbox_pid;
        }
      }
      // Fallback: when /proc sampling missed the (short-lived) process, the
      // bwrap-reported namespace inodes still prove divergence vs the parent.
      const self = readSelfNamespaces();
      const info = evidence.bwrap_info;
      if (info !== null) {
        for (const kind of ["pid", "mnt", "net", "uts", "ipc"] as const) {
          if (evidence.namespace_divergence[kind] === null) {
            const reported = info.namespaces[kind];
            evidence.namespace_divergence[kind] =
              reported === null || self[kind] === null ? null : reported !== self[kind];
          }
        }
      }
      resolve({
        exit_code: timedOut ? null : code,
        signal,
        stdout,
        stderr,
        duration_ms: Date.now() - startedWallMs,
        timed_out: timedOut,
        evidence,
        setup_error: null,
      });
    };
  });
}

function killProcessGroup(child: ChildProcess): void {
  if (child.pid === undefined) {
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

function closeStaged(filterFd: number | null, filterPath: string | null): void {
  if (filterFd !== null) {
    try {
      closeSync(filterFd);
    } catch {
      // fd already closed with the child.
    }
  }
  if (filterPath !== null) {
    rmSync(filterPath, { force: true });
  }
}
