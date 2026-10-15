import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import type { DependencyProbe, ProbeStatus } from "@arena/ops";
import {
  STATION_PROBE_ENDPOINT_PATH,
  remoteStationProbes,
} from "../../src/screens/operations/remoteStationProbes.js";

/**
 * UIA-004 — 远端站点探针验收（真实本地 node:http 服务 + global fetch）。
 *
 * 覆盖七法：
 * 1. 两行 UP → 逐字透传（status + detail 绝不重解释）；
 * 2. DOWN 行 → 逐字映射为 DOWN（fail-closed：远端非 UP 绝不安抚为 UP）；
 * 3. 端点不可达 → 类型化 DOWN（detail 命名端点 URL）；
 * 4. 非 200 → 类型化 DOWN（detail 含状态码）；
 * 5. JSON 不可解析 → 类型化 DOWN；
 * 6. 行缺失 → 类型化 DOWN；
 * 7. 未知状态值 → 类型化 DOWN（仅 UP/DEGRADED/DOWN 可透传）。
 *
 * 被测模块自身保持浏览器安全（global fetch + JSON，零 node 导入 ——
 * 测试在 node/tsx 下运行故可用 node:http 搭真实传输）。
 */

interface StationServer {
  base: string;
  close(): Promise<void>;
}

async function startStation(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<StationServer> {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

function serveBody(body: string, status = 200) {
  return (_request: IncomingMessage, response: ServerResponse) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(body);
  };
}

function stationPayload(rows: object[]): string {
  return JSON.stringify({
    ready: rows.every((row) => (row as { status: string }).status === "UP"),
    dependencies: rows,
    process: "arena-api",
    pid: 4242,
  });
}

function probeById(probes: readonly DependencyProbe[], id: string): DependencyProbe {
  const found = probes.find((probe) => probe.id === id);
  assert.notEqual(found, undefined, `probe ${id} must exist`);
  return found;
}

async function outcomeOf(probe: DependencyProbe): Promise<{ status: ProbeStatus; detail: string }> {
  const outcome = await probe.check();
  return typeof outcome === "string" ? { status: outcome, detail: "" } : outcome;
}

const SQLITE_DETAIL =
  "node:sqlite resolvable — the arena-persistence sqlite_reference_engine class";
const BWRAP_UP_DETAIL =
  "bwrap detected at /usr/bin/bwrap (pinned-path-else-PATH executable scan, mirroring arena-isolation's resolveBwrap law)";
const BWRAP_DOWN_DETAIL =
  "bwrap not detected (pinned path absent and no executable on PATH — mirroring arena-isolation's resolveBwrap law)";
const CHECKED_AT = "2026-10-15T09:00:00Z";

test("endpoint path export is the station probe route", () => {
  assert.equal(STATION_PROBE_ENDPOINT_PATH, "/v1/ops/station-probes");
});

test("case 1: both rows UP pass through verbatim", async () => {
  const server = await startStation(
    serveBody(
      stationPayload([
        {
          id: "station-persistence-node-sqlite",
          kind: "persistence",
          status: "UP",
          detail: SQLITE_DETAIL,
          checked_at: CHECKED_AT,
        },
        {
          id: "station-isolation-bwrap",
          kind: "capsule_provider",
          status: "UP",
          detail: BWRAP_UP_DETAIL,
          checked_at: CHECKED_AT,
        },
      ]),
    ),
  );
  try {
    const probes = remoteStationProbes(server.base);
    assert.equal(probes.length, 2);
    assert.equal(probeById(probes, "station-persistence-node-sqlite").kind, "persistence");
    assert.equal(probeById(probes, "station-isolation-bwrap").kind, "capsule_provider");

    const sqlite = await outcomeOf(probeById(probes, "station-persistence-node-sqlite"));
    assert.equal(sqlite.status, "UP");
    assert.equal(sqlite.detail, SQLITE_DETAIL);

    const bwrap = await outcomeOf(probeById(probes, "station-isolation-bwrap"));
    assert.equal(bwrap.status, "UP");
    assert.equal(bwrap.detail, BWRAP_UP_DETAIL);
  } finally {
    await server.close();
  }
});

test("case 2: a DOWN row maps DOWN verbatim (fail-closed, never appeased to UP)", async () => {
  const server = await startStation(
    serveBody(
      stationPayload([
        {
          id: "station-persistence-node-sqlite",
          kind: "persistence",
          status: "UP",
          detail: SQLITE_DETAIL,
          checked_at: CHECKED_AT,
        },
        {
          id: "station-isolation-bwrap",
          kind: "capsule_provider",
          status: "DOWN",
          detail: BWRAP_DOWN_DETAIL,
          checked_at: CHECKED_AT,
        },
      ]),
    ),
  );
  try {
    const probes = remoteStationProbes(server.base);
    const sqlite = await outcomeOf(probeById(probes, "station-persistence-node-sqlite"));
    assert.equal(sqlite.status, "UP");
    assert.equal(sqlite.detail, SQLITE_DETAIL);

    const bwrap = await outcomeOf(probeById(probes, "station-isolation-bwrap"));
    assert.equal(bwrap.status, "DOWN");
    assert.equal(bwrap.detail, BWRAP_DOWN_DETAIL);
  } finally {
    await server.close();
  }
});

test("case 3: unreachable endpoint is typed DOWN naming the endpoint URL", async () => {
  const server = await startStation(serveBody(stationPayload([])));
  const base = server.base;
  await server.close();
  const probes = remoteStationProbes(base);
  for (const probe of probes) {
    const outcome = await outcomeOf(probe);
    assert.equal(outcome.status, "DOWN");
    assert.ok(outcome.detail.includes(`${base}${STATION_PROBE_ENDPOINT_PATH}`));
    assert.ok(outcome.detail.includes("unreachable"));
  }
});

test("case 4: non-200 response is typed DOWN with the status code", async () => {
  const server = await startStation(serveBody(stationPayload([]), 500));
  try {
    const probes = remoteStationProbes(server.base);
    for (const probe of probes) {
      const outcome = await outcomeOf(probe);
      assert.equal(outcome.status, "DOWN");
      assert.ok(outcome.detail.includes("500"));
      assert.ok(outcome.detail.includes("non-200"));
    }
  } finally {
    await server.close();
  }
});

test("case 5: unparseable JSON body is typed DOWN", async () => {
  const server = await startStation(serveBody('{"dependencies": [not json'));
  try {
    const probes = remoteStationProbes(server.base);
    for (const probe of probes) {
      const outcome = await outcomeOf(probe);
      assert.equal(outcome.status, "DOWN");
      assert.ok(outcome.detail.includes("unparseable JSON"));
    }
  } finally {
    await server.close();
  }
});

test("case 6: response missing the row id is typed DOWN", async () => {
  const server = await startStation(
    serveBody(
      stationPayload([
        {
          id: "some-other-probe",
          kind: "persistence",
          status: "UP",
          detail: "unrelated row",
          checked_at: CHECKED_AT,
        },
      ]),
    ),
  );
  try {
    const probes = remoteStationProbes(server.base);
    for (const probe of probes) {
      const outcome = await outcomeOf(probe);
      assert.equal(outcome.status, "DOWN");
      assert.ok(outcome.detail.includes("row missing"));
    }
  } finally {
    await server.close();
  }
});

test("case 7: unexpected status value is typed DOWN (only UP/DEGRADED/DOWN pass)", async () => {
  const server = await startStation(
    serveBody(
      stationPayload([
        {
          id: "station-persistence-node-sqlite",
          kind: "persistence",
          status: "OK",
          detail: "a status vocabulary the contract does not define",
          checked_at: CHECKED_AT,
        },
        {
          id: "station-isolation-bwrap",
          kind: "capsule_provider",
          status: "DEGRADED",
          detail: "a legitimate degraded detail passes through verbatim",
          checked_at: CHECKED_AT,
        },
      ]),
    ),
  );
  try {
    const probes = remoteStationProbes(server.base);
    const sqlite = await outcomeOf(probeById(probes, "station-persistence-node-sqlite"));
    assert.equal(sqlite.status, "DOWN");
    assert.ok(sqlite.detail.includes("unexpected status"));
    assert.ok(sqlite.detail.includes("OK"));

    const bwrap = await outcomeOf(probeById(probes, "station-isolation-bwrap"));
    assert.equal(bwrap.status, "DEGRADED");
    assert.equal(bwrap.detail, "a legitimate degraded detail passes through verbatim");
  } finally {
    await server.close();
  }
});
