/**
 * UIA-004 — 远端站点探针（浏览器安全模块；issue #76）。
 *
 * 冻结纪律：
 * - 本模块 **可以** 被浏览器组合根静态引入（与 stationProbes.ts 相反 ——
 *   那个模块的 node:fs / node:sqlite 动态导入是 node 专属，浏览器组合根
 *   不得引入）：这里只用 global fetch + JSON，零 node 导入；
 * - 探针行逐字透传远端 /v1/ops/station-probes 响应（per-dependency
 *   可见性法 —— 状态与 detail 绝不重解释、绝不安抚）；一切传输/形状
 *   失败（不可达、非 200、JSON 不可解析、行缺失、状态值未知、行畸形）
 *   均类型化为 DOWN —— fail-closed：不可达 ≠ 未知 ≠ UP；
 * - 探针清单镜像 arena-api stationProbes.ts 的两行（persistence =
 *   node:sqlite 可解析性、capsule_provider = bwrap 检测 —— arena-api
 *   站点实测，本模块只透传，绝不手填状态）。
 */
import type { DependencyProbe, ProbeStatus } from "@arena/ops";

export const STATION_PROBE_ENDPOINT_PATH = "/v1/ops/station-probes";

interface StationProbeRow {
  id: unknown;
  status: unknown;
  detail: unknown;
}

function down(detail: string): { status: ProbeStatus; detail: string } {
  return { status: "DOWN", detail };
}

function asProbeStatus(value: unknown): ProbeStatus | null {
  return value === "UP" || value === "DEGRADED" || value === "DOWN" ? value : null;
}

async function fetchProbeRow(
  endpoint: string,
  id: string,
): Promise<{ status: ProbeStatus; detail: string }> {
  let response: Response;
  try {
    response = await fetch(endpoint);
  } catch (error) {
    return down(`station probe endpoint unreachable: ${endpoint} (${String(error)}) — fail-closed`);
  }
  if (response.status !== 200) {
    return down(
      `station probe endpoint responded ${response.status} (non-200) at ${endpoint} — fail-closed`,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return down(
      `station probe endpoint returned unparseable JSON at ${endpoint} (${String(error)}) — fail-closed`,
    );
  }
  const dependencies = (body as { dependencies?: unknown } | null)?.dependencies;
  if (!Array.isArray(dependencies)) {
    return down(
      `dependencies missing from the station probe endpoint response at ${endpoint} — fail-closed`,
    );
  }
  const row = (dependencies as StationProbeRow[]).find((candidate) => candidate.id === id);
  if (row === undefined) {
    return down(
      `row missing from the station probe endpoint response (id ${id}) at ${endpoint} — fail-closed`,
    );
  }
  const status = asProbeStatus(row.status);
  if (status === null) {
    return down(
      `unexpected status from the station probe endpoint: ${String(row.status)} (id ${id}) — fail-closed`,
    );
  }
  if (typeof row.detail !== "string") {
    return down(
      `row for ${id} from the station probe endpoint is malformed (detail absent) — fail-closed`,
    );
  }
  return { status, detail: row.detail };
}

/** 远端站点探针清单（arena-api /v1/ops/station-probes 的透传探针）。 */
export function remoteStationProbes(baseUrl: string): readonly DependencyProbe[] {
  const endpoint = `${baseUrl}${STATION_PROBE_ENDPOINT_PATH}`;
  return [
    {
      id: "station-persistence-node-sqlite",
      kind: "persistence",
      check: () => fetchProbeRow(endpoint, "station-persistence-node-sqlite"),
    },
    {
      id: "station-isolation-bwrap",
      kind: "capsule_provider",
      check: () => fetchProbeRow(endpoint, "station-isolation-bwrap"),
    },
  ];
}
