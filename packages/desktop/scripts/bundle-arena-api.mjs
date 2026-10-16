#!/usr/bin/env node
/**
 * DIST-001（issue #84）—— 打包 @arena/api 为随包本地 station 的单文件入口。
 *
 * 产物：`out/arena-api/arena-api.cjs`（CJS，零运行时依赖 —— @arena/* 与 zod 全部内联；
 * node 内置模块 external）。electron-builder 把它作为 extraResources 落到安装包
 * `resources/arena-api/arena-api.cjs`（asar 之外 —— ELECTRON_RUN_AS_NODE 的纯 Node
 * 进程没有 asar 支持），桌面主进程用 `ELECTRON_RUN_AS_NODE=1 <electron> arena-api.cjs`
 * 拉起（node:sqlite 已在 Electron 41 的内嵌 Node 上验证可用，实验性告警披露）。
 *
 * 入口契约（与 packages/arena-api/src/main.ts 一致）：
 *   ARENA_API_PORT  监听端口（默认 3901）
 *   ARENA_DB_PATH   SQLite 数据库文件（默认 arena-reference.db —— station 会指到 userData）
 *   身份默认 demo 注册表（DEMO-ONLY 披露）；随包 station 不设置 ARENA_AUTH_MODE。
 */

import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const workspaceRoot = resolve(desktopRoot, "../..");
const arenaApiEntry = resolve(workspaceRoot, "packages/arena-api/src/main.ts");
const outDir = resolve(desktopRoot, "out/arena-api");
const outFile = join(outDir, "arena-api.cjs");

async function main() {
  const esbuild = require("esbuild");
  await mkdir(outDir, { recursive: true });
  const result = await esbuild.build({
    entryPoints: [arenaApiEntry],
    outfile: outFile,
    bundle: true,
    platform: "node",
    format: "cjs",
    // Electron 41 内嵌 Node（22.x）为目标运行时。
    target: ["node22"],
    sourcemap: false,
    logLevel: "info",
    metafile: true,
  });
  const inputs = Object.keys(result.metafile.inputs).length;
  process.stdout.write(
    `[bundle-arena-api] ${outFile} (${inputs} source modules inlined)\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`[bundle-arena-api] failed: ${error?.stack ?? error}\n`);
  process.exit(1);
});
