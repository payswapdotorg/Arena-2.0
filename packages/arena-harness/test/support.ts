import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { createSqliteRuntime } from "@arena/persistence";
import type { SqliteRuntime } from "@arena/persistence";

/** 共享：真实 arena-api 子进程 + durable sqlite 消费端运行时。 */

const HERE = dirname(fileURLToPath(import.meta.url));
const HARNESS_PACKAGE = resolve(HERE, "..");
const REPO_ROOT = resolve(HARNESS_PACKAGE, "..", "..");
const TSX = resolve(REPO_ROOT, "node_modules", ".bin", "tsx");
const API_MAIN = resolve(REPO_ROOT, "packages", "arena-api", "src", "main.ts");

export function freePort(): Promise<number> {
  return new Promise((accept, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => accept(port));
    });
    probe.on("error", reject);
  });
}

export interface ApiProcess {
  baseUrl: string;
  port: number;
  child: ChildProcess;
  stop(): Promise<void>;
  killHard(): void;
}

export async function startRealApi(dbPath: string, port?: number): Promise<ApiProcess> {
  const chosenPort = port ?? (await freePort());
  const child: ChildProcess = spawn(TSX, [API_MAIN], {
    cwd: HARNESS_PACKAGE,
    env: { ...process.env, ARENA_API_PORT: String(chosenPort), ARENA_DB_PATH: dbPath },
    stdio: ["ignore", "pipe", "pipe"],
    // 进程组组长：SIGKILL 场景需整组击杀（tsx 包装器被杀后其 node 子进程
    // 会成为孤儿并继承 stdio 管道 —— 否则测试事件循环被拖住 150s）。
    detached: true,
  });
  let childOutput = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    childOutput += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    childOutput += chunk.toString("utf8");
  });
  const baseUrl = `http://127.0.0.1:${chosenPort}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`arena-api process exited early:\n${childOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/readyz`);
      if (response.ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`real arena-api process did not become ready within 30s:\n${childOutput}`);
    }
    await new Promise((sleep) => setTimeout(sleep, 150));
  }
  return {
    baseUrl,
    port: chosenPort,
    child,
    stop: () =>
      new Promise<void>((resolveStop) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolveStop();
          return;
        }
        child.kill("SIGTERM");
        child.once("exit", () => resolveStop());
        setTimeout(() => resolveStop(), 5000).unref?.();
      }),
    killHard: () => {
      // 整组 SIGKILL（tsx 包装器 + 其 node 子进程），再断开管道引用。
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
    },
  };
}

export interface ScenarioWorkspace {
  dir: string;
  dbPath: string;
  consumerRuntime: SqliteRuntime;
  cleanup(): void;
}

export function openWorkspace(prefix: string): ScenarioWorkspace {
  const dir = mkdtempSync(join(tmpdir(), `arena-harness-${prefix}-`));
  const dbPath = join(dir, "arena.db");
  const consumerRuntime = createSqliteRuntime({ path: dbPath, busyTimeoutMs: 8000 });
  return {
    dir,
    dbPath,
    consumerRuntime,
    cleanup: () => {
      consumerRuntime.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** 守卫事实包（DEMO 形态 —— 生产由服务端派生；与 API DEMO 披露一致）。 */
export const ASSIGNMENT_FACTS = {
  capability_matched: true,
  qualification_current: true,
  conflict_check_passed: true,
  privacy_authorized: true,
  budget_available: true,
  expert_available: true,
} as const;

export const ENVIRONMENT_FACTS = {
  capsule_manifest_recorded: true,
  isolation_assurance_recorded: true,
} as const;

export const CANDIDATE_FACTS = {
  candidate_version_immutable: true,
  artifact_manifest_present: true,
  acceptance_criteria_frozen: true,
  proof_policy_frozen: true,
} as const;

export const PROOF_FACTS = {
  proof_satisfied: true,
  criterion_conjunction_passed: true,
} as const;

export const nowIso = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
