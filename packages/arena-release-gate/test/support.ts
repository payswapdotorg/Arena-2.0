import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

/** 共享：真实 arena-api 子进程（AR2-015 对抗剖面专用，fence 内实现）。 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");
const TSX = resolve(REPO_ROOT, "node_modules", ".bin", "tsx");
const API_MAIN = resolve(REPO_ROOT, "packages", "arena-api", "src", "main.ts");

export const ALPHA = { bearerToken: "demo-token-requester-alpha" } as const;
export const BETA = { bearerToken: "demo-token-requester-beta" } as const;

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
  dbPath: string;
  child: ChildProcess;
  stop(): Promise<void>;
}

export async function startRealApi(): Promise<ApiProcess> {
  const dir = mkdtempSync(join(tmpdir(), "arena-release-gate-"));
  const dbPath = join(dir, "arena.db");
  const chosenPort = await freePort();
  const child: ChildProcess = spawn(TSX, [API_MAIN], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, ARENA_API_PORT: String(chosenPort), ARENA_DB_PATH: dbPath },
    stdio: ["ignore", "pipe", "pipe"],
    // 进程组组长：整组击杀避免 tsx 包装器孤儿拖住测试事件循环（AR2-012 教训）。
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
    dbPath,
    child,
    stop: () =>
      new Promise<void>((resolveStop) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          rmSync(dir, { recursive: true, force: true });
          resolveStop();
          return;
        }
        child.kill("SIGTERM");
        child.once("exit", () => {
          rmSync(dir, { recursive: true, force: true });
          resolveStop();
        });
        setTimeout(() => {
          rmSync(dir, { recursive: true, force: true });
          resolveStop();
        }, 5000).unref?.();
      }),
  };
}

/** 原始 HTTP 探测（保留精确 status/body —— 不可区分性断言需要逐字节比较）。 */
export async function probe(
  baseUrl: string,
  path: string,
  init: { method?: string; token?: string | null; body?: unknown } = {},
): Promise<{ status: number; body: string; json: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (init.token !== undefined && init.token !== null) {
    headers.authorization = `Bearer ${init.token}`;
  }
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(body) as Record<string, unknown>;
  } catch {
    json = { raw: body };
  }
  return { status: response.status, body, json };
}
