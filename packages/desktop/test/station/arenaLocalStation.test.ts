import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import {
  ARENA_STATION_DISABLE_ENV,
  createDefaultArenaStationDependencies,
  shouldStartArenaLocalStation,
  startArenaLocalStation,
  trimBakedArenaApiUrl,
} from "../../src/main/arenaLocalStation.js";

/**
 * DIST-001（issue #84）—— 随包本地 test-mode arena station：
 * 1) 决策法则（打包态/禁用开关/烘焙 baseUrl 探针）；
 * 2) trimBakedArenaApiUrl 法则；
 * 3) REAL 集成：esbuild 现场打包 @arena/api → 以 ELECTRON_RUN_AS_NODE（electron 存在时）
 *    或 plain node 拉起 station → /healthz 200 → stop() 优雅退出。
 * 站点进程是 @arena/api 的真实产物（demo auth、loopback、SQLite 落在临时数据目录）。
 */

const require = createRequire(import.meta.url);
const desktopRoot = resolve(import.meta.dirname, "../..");

test("决策法则：打包态 + 未禁用 + 无烘焙 baseUrl → 启动", () => {
  assert.equal(
    shouldStartArenaLocalStation({}, { isPackaged: true, bakedArenaApiUrl: undefined }),
    true,
  );
});

test("决策法则：开发态（未打包）永不启动", () => {
  assert.equal(
    shouldStartArenaLocalStation({}, { isPackaged: false, bakedArenaApiUrl: undefined }),
    false,
  );
});

test("决策法则：ARENA_DESKTOP_LOCAL_STATION=0 显式关闭", () => {
  assert.equal(
    shouldStartArenaLocalStation(
      { [ARENA_STATION_DISABLE_ENV]: "0" },
      { isPackaged: true, bakedArenaApiUrl: undefined },
    ),
    false,
  );
  assert.equal(
    shouldStartArenaLocalStation(
      { [ARENA_STATION_DISABLE_ENV]: " 0 " },
      { isPackaged: true, bakedArenaApiUrl: undefined },
    ),
    false,
  );
});

test("决策法则：烘焙 baseUrl（运营方拓扑）→ 不启动", () => {
  assert.equal(
    shouldStartArenaLocalStation(
      {},
      { isPackaged: true, bakedArenaApiUrl: "https://ops.example.com" },
    ),
    false,
  );
});

test("trimBakedArenaApiUrl：空白/尾斜杠法则与渲染侧同构", () => {
  assert.equal(trimBakedArenaApiUrl(undefined), undefined);
  assert.equal(trimBakedArenaApiUrl(""), undefined);
  assert.equal(trimBakedArenaApiUrl("   "), undefined);
  assert.equal(trimBakedArenaApiUrl("https://ops.example.com/"), "https://ops.example.com");
  assert.equal(trimBakedArenaApiUrl("  http://x  "), "http://x");
  assert.equal(trimBakedArenaApiUrl("///"), undefined);
});

test("REAL station：bundle → spawn（ELECTRON_RUN_AS_NODE 优先）→ healthz 200 → 优雅 stop", { timeout: 120_000 }, async () => {
  const esbuild = require("esbuild");
  const tempDir = await mkdtemp(join(tmpdir(), "arena-station-test-"));
  const bundlePath = join(tempDir, "arena-api.cjs");
  try {
    await esbuild.build({
      entryPoints: [resolve(desktopRoot, "../arena-api/src/main.ts")],
      outfile: bundlePath,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: ["node22"],
      sourcemap: false,
      logLevel: "silent",
    });
    // 打包态真实运行时：优先 Electron 内嵌 Node（ELECTRON_RUN_AS_NODE —— 安装包内的
    // 实际拉起方式）；无 electron 二进制的环境（如最小 CI 镜像）退回 plain node。
    const electronCandidate = resolve(
      desktopRoot,
      "node_modules/electron/dist/electron",
    );
    const execPath = existsSync(electronCandidate) ? electronCandidate : process.execPath;

    const deps = createDefaultArenaStationDependencies();
    const station = await startArenaLocalStation(
      { execPath, bundlePath, dataDir: tempDir },
      deps,
    );
    assert.ok(station, "station should become healthy");

    // /healthz 真实 200（startArenaLocalStation 内部已等待健康；这里独立复核）。
    const healthz = await fetch(`${station.baseUrl}/healthz`);
    assert.equal(healthz.status, 200);
    const body = (await healthz.json()) as { status: string };
    assert.equal(body.status, "ok");

    // demo auth 的 /readyz 也应 ready（DEMO-ONLY 披露姿态）。
    const readyz = await fetch(`${station.baseUrl}/readyz`);
    assert.equal(readyz.status, 200);

    await station.stop();
    // stop 后端口不可再达（优雅退出收口）。
    await assert.rejects(() => fetch(`${station.baseUrl}/healthz`));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("REAL station：bundle 缺失 → null（诚实回退，不抛异常）", { timeout: 30_000 }, async () => {
  const deps = createDefaultArenaStationDependencies();
  const station = await startArenaLocalStation(
    { execPath: process.execPath, bundlePath: undefined, dataDir: tmpdir() },
    deps,
  );
  assert.equal(station, null);
});
