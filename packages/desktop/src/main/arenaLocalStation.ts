/**
 * DIST-001（issue #84）—— 随包本地 test-mode arena station（纯编排模块，node 可测）。
 *
 * 收口 UIA-002 记录在案的前沿「桌面当前没有随包的 arena-api（部署拓扑是运营方
 * 记录在案的前沿）」：Arena 分发安装包随包携带 esbuild 单文件 @arena/api 参考服务
 * （`resources/arena-api/arena-api.cjs`，asar 之外），主进程以
 * `ELECTRON_RUN_AS_NODE=1 <electron> arena-api.cjs` 拉起（node:sqlite 已在
 * Electron 41 内嵌 Node 验证可用 —— 实验性告警披露），loopback 端口 + userData
 * 下的 SQLite 数据目录。渲染进程经 `arenaApiUrl` 窗口 query 收到站点 baseUrl。
 *
 * 诚实姿态（spec/ux/arena-native-ui.md §2.3）：station 启动失败/超时 → 返回 null，
 * 应用照常启动并落回「未配置哨兵」姿态（类型化 TRANSPORT_ERROR / DOWN rows 逐字
 * 上屏）—— 绝不伪造 ready，也绝不因 station 缺席阻塞主窗口。
 *
 * 安全姿态：demo auth（IDN1.0 demo registry，DEMO-ONLY 披露）；loopback-only
 * （127.0.0.1）；test-mode finance —— live-money 与 untrusted execution 保持禁用
 * （不触碰任何启用面）。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";

/** 环境开关：`ARENA_DESKTOP_LOCAL_STATION=0` 显式关闭（其余值/缺省 = 开启）。 */
export const ARENA_STATION_DISABLE_ENV = "ARENA_DESKTOP_LOCAL_STATION";

/**
 * 运行侧烘焙 baseUrl 探针：ARENA_DESKTOP_BAKED_API_URL（运营方随包构建时与渲染端
 * VITE_ARENA_API_URL 同步设置）非空 → station 不启动。渲染侧法则保持
 * 「烘焙 env 优先于 query 覆盖」—— 两层判定同向，不会互相拆台。
 */
export function trimBakedArenaApiUrl(value: string | undefined): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed === "") return undefined;
  const stripped = trimmed.replace(/\/+$/u, "");
  return stripped === "" ? undefined : stripped;
}

export interface ArenaStationDecisionInputs {
  isPackaged: boolean;
  /** 构建期烘焙的 VITE_ARENA_API_URL（有值 = 运营方拓扑，station 不启动）。 */
  bakedArenaApiUrl: string | undefined;
}

export interface ArenaStationDecisionEnv {
  [ARENA_STATION_DISABLE_ENV]?: string;
}

export function shouldStartArenaLocalStation(
  env: ArenaStationDecisionEnv,
  inputs: ArenaStationDecisionInputs,
): boolean {
  if (env[ARENA_STATION_DISABLE_ENV]?.trim() === "0") return false;
  if (!inputs.isPackaged) return false;
  if (inputs.bakedArenaApiUrl !== undefined) return false;
  return true;
}

export interface ArenaStationProcessHandle {
  readonly pid: number | undefined;
  onExit(listener: (code: number | null) => void): void;
  kill(signal?: "SIGTERM" | "SIGKILL"): void;
}

export interface ArenaLocalStation {
  readonly baseUrl: string;
  stop(): Promise<void>;
}

export interface ArenaStationSpawnSpec {
  execPath: string;
  bundlePath: string;
  port: number;
  dataDir: string;
}

export interface ArenaStationDependencies {
  pickFreePort(): Promise<number>;
  spawnStationProcess(spec: ArenaStationSpawnSpec): ArenaStationProcessHandle;
  waitForStationHealthy(baseUrl: string, timeoutMs: number): Promise<boolean>;
  now(): number;
  readonly healthTimeoutMs: number;
}

/** 组装真实依赖（child_process/net/http）。纯函数化注入使其可被测试替换。 */
export function createDefaultArenaStationDependencies(): ArenaStationDependencies {
  return {
    healthTimeoutMs: 30_000,
    now: () => Date.now(),
    async pickFreePort() {
      return await new Promise<number>((resolve, reject) => {
        const server = createServer();
        server.unref();
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          const port = typeof address === "object" && address ? address.port : 0;
          server.close(() => resolve(port));
        });
      });
    },
    spawnStationProcess(spec) {
      const child: ChildProcess = spawn(
        spec.execPath,
        [spec.bundlePath],
        {
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            ARENA_API_PORT: String(spec.port),
            ARENA_DB_PATH: `${spec.dataDir}/arena-station.db`,
          },
        },
      );
      // 站点日志走主进程 stderr（诊断面，不上屏）。
      child.stdout?.on("data", (chunk: Buffer) => {
        process.stdout.write(`[arena-station] ${chunk.toString("utf-8")}`);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        process.stderr.write(`[arena-station] ${chunk.toString("utf-8")}`);
      });
      return {
        pid: child.pid,
        onExit: (listener) => {
          child.once("exit", (code) => listener(code));
        },
        kill: (signal) => {
          child.kill(signal);
        },
      };
    },
    async waitForStationHealthy(baseUrl, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const healthy = await probeHealthz(baseUrl).catch(() => false);
        if (healthy) return true;
        if (Date.now() >= deadline) return false;
        await delay(250);
      }
    },
  };
}
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function probeHealthz(baseUrl: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const url = new URL("/healthz", baseUrl);
    const req = httpRequest(
      { host: url.hostname, port: url.port, path: url.pathname, method: "GET", timeout: 2_000 },
      (response) => {
        response.resume();
        resolve((response.statusCode ?? 0) === 200);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("healthz probe timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

export interface ArenaStationStartInputs {
  execPath: string;
  bundlePath: string | undefined;
  dataDir: string;
}

/**
 * 启动 station；bundle 缺失/健康超时 → null（调用方落回未配置哨兵姿态）。
 * 超时路径会尽力清理子进程（SIGTERM → SIGKILL 兜底）。
 */
export async function startArenaLocalStation(
  inputs: ArenaStationStartInputs,
  dependencies: ArenaStationDependencies,
  logger?: { warn(...args: unknown[]): void; info(...args: unknown[]): void },
): Promise<ArenaLocalStation | null> {
  if (inputs.bundlePath === undefined) {
    logger?.warn("[arena-station] bundle not found; falling back to unconfigured posture");
    return null;
  }
  const port = await dependencies.pickFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = dependencies.spawnStationProcess({
    execPath: inputs.execPath,
    bundlePath: inputs.bundlePath,
    port,
    dataDir: inputs.dataDir,
  });
  let exited = false;
  child.onExit(() => {
    exited = true;
  });
  const healthy = await dependencies.waitForStationHealthy(
    baseUrl,
    dependencies.healthTimeoutMs,
  );
  if (!healthy) {
    if (!exited) {
      child.kill("SIGTERM");
    }
    logger?.warn("[arena-station] health probe timed out; falling back to unconfigured posture");
    return null;
  }
  logger?.info(`[arena-station] local test-mode station ready at ${baseUrl}`);
  return {
    baseUrl,
    stop: async () => {
      if (exited) return;
      const exit = new Promise<void>((resolve) => {
        child.onExit(() => resolve());
      });
      child.kill("SIGTERM");
      await Promise.race([exit, delay(5_000)]);
      if (!exited) {
        child.kill("SIGKILL");
      }
    },
  };
}
