import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { AddressInfo } from "node:net";
import { createInMemoryRuntime } from "@arena/application";
import { createArenaServer } from "../src/contract.js";

/**
 * UIA-004 — /v1/ops/station-probes 端点验收（真实 HTTP 监听器上的实测）：
 * - health-class：无认证可达（与 /healthz /readyz 同级）；
 * - 逐依赖可见：dependencies 恰好两行（persistence = node:sqlite 可解析性、
 *   capsule_provider = bwrap 检测），字段全量类型化；
 * - persistence 行在本 node 环境为 UP（真实 node:sqlite）；bwrap 行按
 *   **本站点实测** 断言诚实姿态（UP/DEGRADED/DOWN 之一 + 非空 detail，
 *   绝不断言 UP）；
 * - fail-closed 法：not ready ⇒ fail_closed === true 且 not_up 恰为非 UP 行；
 * - checked_at 为 aggregateReadiness now() 格式（ISO-8601，秒精度，Z 后缀）。
 * 运行时为披露的 in-memory 夹具 —— 端点测度的是站点本身，与组装无关。
 */

interface TestServer {
  base: string;
  close(): Promise<void>;
}

async function startServer(): Promise<TestServer> {
  const runtime = createInMemoryRuntime();
  const server = createArenaServer({ runtime });
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

interface StationProbeRow {
  id: unknown;
  kind: unknown;
  status: unknown;
  detail: unknown;
  checked_at: unknown;
}

const PROBE_STATUSES = ["UP", "DEGRADED", "DOWN"] as const;
const ISO_8601_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

async function fetchStationProbes(base: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${base}/v1/ops/station-probes`);
  return { status: response.status, body: await response.json() };
}

test("station probes endpoint: honest per-dependency measurement over real HTTP", async () => {
  const server = await startServer();
  try {
    const first = await fetchStationProbes(server.base);
    assert.equal(first.status, 200);
    assert.equal(typeof first.body, "object");
    assert.notEqual(first.body, null);
    const body = first.body as Record<string, unknown>;

    // health-class 投影（/readyz 形状先例）：process + pid。
    assert.equal(body.process, "arena-api");
    assert.equal(typeof body.pid, "number");
    assert.ok((body.pid as number) > 0);

    // 聚合就绪：ready 恒为布尔（fail-closed 聚合结果，绝不手填）。
    assert.equal(typeof body.ready, "boolean");

    // 逐依赖可见：恰好两行探针报告。
    assert.ok(Array.isArray(body.dependencies));
    const rows = body.dependencies as StationProbeRow[];
    assert.equal(rows.length, 2);

    const byId = new Map(rows.map((row) => [String(row.id), row]));
    assert.deepEqual([...byId.keys()].sort(), [
      "station-isolation-bwrap",
      "station-persistence-node-sqlite",
    ]);

    for (const row of rows) {
      assert.equal(typeof row.id, "string");
      assert.equal(typeof row.kind, "string");
      assert.equal(typeof row.status, "string");
      assert.equal(typeof row.detail, "string");
      assert.equal(typeof row.checked_at, "string");
      assert.ok((PROBE_STATUSES as readonly string[]).includes(row.status));
      assert.ok((row.detail as string).length > 0);
      assert.match(row.checked_at as string, ISO_8601_SECONDS);
    }

    const persistence = byId.get("station-persistence-node-sqlite");
    assert.notEqual(persistence, undefined, "persistence row must exist");
    const persistenceRow = persistence as StationProbeRow;
    assert.equal(persistenceRow.kind, "persistence");
    // 真实 node:sqlite 可解析性（本 node 环境实测为 UP）。
    assert.equal(persistenceRow.status, "UP");
    assert.equal(typeof persistenceRow.detail, "string");
    assert.match(persistenceRow.detail as string, /node:sqlite resolvable/);

    const isolation = byId.get("station-isolation-bwrap");
    assert.notEqual(isolation, undefined, "isolation row must exist");
    const isolationRow = isolation as StationProbeRow;
    assert.equal(isolationRow.kind, "capsule_provider");
    // bwrap 行按真实站点实测断言诚实姿态（此处不断言 UP —— 缺失即 DOWN）。
    assert.ok((PROBE_STATUSES as readonly string[]).includes(isolationRow.status));
    assert.equal(typeof isolationRow.detail, "string");
    assert.ok((isolationRow.detail as string).length > 0);

    // fail-closed 法：任何非 UP ⇒ not ready + fail_closed + not_up 恰为非 UP 行。
    const ready = body.ready as boolean;
    if (!ready) {
      assert.equal(body.fail_closed, true);
      assert.ok(Array.isArray(body.not_up));
      const notUp = body.not_up as StationProbeRow[];
      assert.equal(notUp.length, rows.filter((row) => row.status !== "UP").length);
      for (const row of notUp) {
        assert.notEqual(row.status, "UP");
      }
    } else {
      assert.equal(body.fail_closed, undefined);
    }

    // 每请求实测（无缓存）：第二次请求同样 200 且形状完整。
    const second = await fetchStationProbes(server.base);
    assert.equal(second.status, 200);
    const secondBody = second.body as Record<string, unknown>;
    assert.ok(Array.isArray(secondBody.dependencies));
    assert.equal((secondBody.dependencies as StationProbeRow[]).length, 2);
    assert.equal(typeof secondBody.ready, "boolean");
  } finally {
    await server.close();
  }
});

test("station probes endpoint is health-class: reachable without authentication", async () => {
  const server = await startServer();
  try {
    const response = await fetch(`${server.base}/v1/ops/station-probes`, {
      headers: { authorization: "" },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.process, "arena-api");
  } finally {
    await server.close();
  }
});
