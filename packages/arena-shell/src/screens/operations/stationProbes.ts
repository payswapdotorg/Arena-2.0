/**
 * UIA-003 — 运维/治理：真实站点探针（node 侧组合根专用）。
 *
 * 冻结纪律：
 * - 探针检测 **真实发生**（本站点此刻的能力测度），再经 @arena/ops 公开
 *   契约的 staticProbe 包装 —— 状态来自实测，绝不手填；
 * - persistence 探针 = node:sqlite 可解析性（arena-persistence 引擎的
 *   sqlite_reference_engine 能力类 —— ADR-0001 参考引擎）；
 * - capsule_provider 探针 = bwrap 检测（镜像 arena-isolation 的
 *   resolveBwrap 法：钉定路径优先，否则 PATH 可执行扫描；缺失即
 *   DOWN —— 类型化不可用，绝不静默当作可用）；
 * - 本模块 **不得** 被屏/registration/presenters 静态引入（node:fs +
 *   node:sqlite 动态导入是 node 专属；浏览器组合根注入探针列表本身）。
 */
import { accessSync, constants } from "node:fs";
import { staticProbe, type DependencyProbe, type ProbeStatus } from "@arena/ops";

function executableOrNull(candidate: string): string | null {
  try {
    accessSync(candidate, constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

function scanPathFor(name: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(":").filter(Boolean)) {
    const resolved = executableOrNull(`${dir}/${name}`);
    if (resolved !== null) return resolved;
  }
  return null;
}

/** node:sqlite 可解析性探针（sqlite_reference_engine 能力类）。 */
export async function detectNodeSqlite(): Promise<{ status: ProbeStatus; detail: string }> {
  try {
    await import("node:sqlite");
    return {
      status: "UP",
      detail: "node:sqlite resolvable — the arena-persistence sqlite_reference_engine class",
    };
  } catch (error) {
    return {
      status: "DOWN",
      detail: `node:sqlite unavailable (${String(error)}) — the sqlite_reference_engine class cannot run at this station`,
    };
  }
}

/** bwrap 检测探针（镜像 arena-isolation resolveBwrap 法：钉定路径 → PATH 扫描）。 */
export function detectBwrap(): { status: ProbeStatus; detail: string } {
  const pinned = process.env.ARENA_ISOLATION_BWRAP_PATH;
  const resolved = pinned !== undefined ? executableOrNull(pinned) : scanPathFor("bwrap");
  if (resolved === null) {
    return {
      status: "DOWN",
      detail:
        "bwrap not detected (pinned path absent and no executable on PATH — mirroring " +
        "arena-isolation's resolveBwrap law): the typed isolation capability is unavailable, so " +
        "capsule workspaces cannot run at this station (untrusted execution is disabled per the " +
        "recorded posture regardless)",
    };
  }
  return {
    status: "UP",
    detail: `bwrap detected at ${resolved} (pinned-path-else-PATH executable scan, mirroring arena-isolation's resolveBwrap law)`,
  };
}

/** 真实站点探针清单（实测状态 → staticProbe 包装）。 */
export async function stationProbes(): Promise<readonly DependencyProbe[]> {
  const sqlite = await detectNodeSqlite();
  const bwrap = detectBwrap();
  return [
    staticProbe("station-persistence-node-sqlite", "persistence", sqlite.status, sqlite.detail),
    staticProbe("station-isolation-bwrap", "capsule_provider", bwrap.status, bwrap.detail),
  ];
}
