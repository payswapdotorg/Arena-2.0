import assert from "node:assert/strict";
import test from "node:test";
import * as http from "node:http";
import { ARENA_DEFAULT_SCREEN, ARENA_SCREEN_IDS, type ArenaScreenHost } from "@arena/shell";
import {
  DEMO_ATTEMPT_DIVERGENT,
  DEMO_ATTEMPT_INCONCLUSIVE,
  DEMO_ATTEMPT_OPEN,
  DEMO_ATTEMPT_SUBMITTED,
  DEMO_EXPERT_PRINCIPAL,
  DEMO_PRINCIPAL_TOKENS,
  DEMO_RESULT,
  DEMO_RESULT_DIVERGENT,
} from "@arena/workbench";
import {
  buildArenaDesktopComposition,
  type ArenaDesktopComposition,
} from "../../src/renderer/src/arenaDesktopMount.js";

/**
 * UIA-002 —— 组合根构造（镜像 web 组合根的桌面形态；node 侧 REAL 构造）。
 *
 * 诚实披露（观察手法）：
 * - `registration.render(host)` 返回 React 元素，其 props 携带真实控制器
 *   实例 —— 与 ArenaShell 真实挂接路径同一构造物；测试经它驱动控制器的
 *   公有方法（loadQueue / selectEscalation / loadAuditTrail）。
 * - principal 是控制器闭包的 TS-private 字段；`runtimePrincipal` 做运行时
 *   读取以断言组合根实际装配的主体（真实构造物的运行时内省，不 mock、
 *   不替换任何组件）。
 * - baseUrl 未配置 = 诚实未配置姿态：绑定指向不可达哨兵（端口 0），
 *   类型化失败逐字上屏 —— requester/operations（demo 注册表凭据主体）
 *   渲染 TRANSPORT_ERROR；reviewer（demo 投影主体，无凭据条目）渲染
 *   UNAUTHENTICATED。不伪造服务器、无 mock 成功。
 * - 配置 baseUrl 的用例起一个真实的本地 node:http 服务（真 HTTP、真
 *   fetch —— 非假服务器），端到端验证绑定地址与 demo 注册表凭据。
 */

const host: ArenaScreenHost = {
  port: {
    navigate: () => ({ kind: "navigated", screen: ARENA_DEFAULT_SCREEN }),
    activeScreen: () => ARENA_DEFAULT_SCREEN,
  },
  lens: "requester",
};

function realController(
  composition: ArenaDesktopComposition,
  screen: (typeof ARENA_SCREEN_IDS)[number],
) {
  const registration = composition.registry.lookup(screen);
  assert.ok(registration, `screen "${screen}" must be registered`);
  const node = registration.render(host) as { props?: { controller?: unknown } };
  assert.ok(node && typeof node === "object" && "props" in node, "render() yields a React element");
  const controller = node.props?.controller;
  assert.ok(
    controller && typeof controller === "object",
    "element props carry the real controller",
  );
  return controller;
}

/** 运行时内省：读控制器闭包内的 principal（TS-private，运行时可见）。 */
function runtimePrincipal(controller: unknown): unknown {
  return (controller as { principal?: unknown }).principal;
}

interface DrivableRequester {
  selectEscalation(escalation_id: string): Promise<void>;
  snapshot(): { timeline: { kind: string; message?: string } };
}

interface DrivableExpert {
  loadQueue(): Promise<void>;
  snapshot(): { queue: { kind: string; data?: readonly { attempt_id: string; demo: boolean }[] } };
}

interface DrivableReviewer {
  loadQueue(): Promise<void>;
  loadAuditTrailFor(escalation_id: string): Promise<void>;
  snapshot(): {
    queue: { kind: string; data?: readonly { result_id: string; demo: boolean }[] };
    auditTrail: { kind: string; message?: string };
  };
}

interface DrivableOperations {
  loadAuditTrail(escalation_id: string): Promise<void>;
  snapshot(): { auditTrail: { kind: string; message?: string } };
}

test("五屏登记齐全（冻结词表顺序 + 导航标签）", () => {
  const composition = buildArenaDesktopComposition({ baseUrl: undefined });
  assert.deepEqual(composition.registry.registeredScreens(), [...ARENA_SCREEN_IDS]);
  assert.equal(composition.registry.lookup("requester")?.title, "Requests");
  assert.equal(composition.registry.lookup("expert")?.title, "Expert work");
  assert.equal(composition.registry.lookup("reviewer")?.title, "Review");
  assert.equal(composition.registry.lookup("developer")?.title, "Developer");
  assert.equal(composition.registry.lookup("operations")?.title, "Operations");
});

test("principal 装配：requester/operations = demo 注册表主体；expert/reviewer = DEMO_EXPERT_PRINCIPAL", () => {
  const composition = buildArenaDesktopComposition({ baseUrl: undefined });
  const requesterAlpha = DEMO_PRINCIPAL_TOKENS[0]?.principal;
  assert.ok(requesterAlpha, "demo principal registry must expose the requester-alpha entry");
  assert.deepEqual(runtimePrincipal(realController(composition, "requester")), requesterAlpha);
  assert.deepEqual(runtimePrincipal(realController(composition, "operations")), requesterAlpha);
  assert.deepEqual(runtimePrincipal(realController(composition, "expert")), DEMO_EXPERT_PRINCIPAL);
  assert.deepEqual(
    runtimePrincipal(realController(composition, "reviewer")),
    DEMO_EXPERT_PRINCIPAL,
  );
});

test("mock 适配器携带 demo 标注（真实 MockArenaClient 行为：种子租户隔离 + demo=true）", async () => {
  const composition = buildArenaDesktopComposition({ baseUrl: undefined });

  const expert = realController(composition, "expert") as unknown as DrivableExpert;
  await expert.loadQueue();
  const queue = expert.snapshot().queue;
  assert.equal(queue.kind, "ready");
  assert.deepEqual(
    queue.data?.map((row) => row.attempt_id),
    [
      DEMO_ATTEMPT_OPEN.attempt_id,
      DEMO_ATTEMPT_SUBMITTED.attempt_id,
      DEMO_ATTEMPT_INCONCLUSIVE.attempt_id,
      DEMO_ATTEMPT_DIVERGENT.attempt_id,
    ],
  );
  assert.ok(
    queue.data?.every((row) => row.demo === true),
    "every seeded attempt row is demo-tagged",
  );

  const reviewer = realController(composition, "reviewer") as unknown as DrivableReviewer;
  await reviewer.loadQueue();
  const reviewable = reviewer.snapshot().queue;
  assert.equal(reviewable.kind, "ready");
  assert.deepEqual(
    reviewable.data?.map((row) => row.result_id),
    [DEMO_RESULT.result_id, DEMO_RESULT_DIVERGENT.result_id],
  );
  assert.ok(
    reviewable.data?.every((row) => row.demo === true),
    "every reviewable result is demo-tagged",
  );
});

test("baseUrl 未配置 → 诚实未配置姿态：类型化失败逐字上屏（无 mock 成功）", async () => {
  const composition = buildArenaDesktopComposition({ baseUrl: undefined });

  // requester/operations 主体 = demo 注册表的 requester-alpha（有凭据映射）：
  // 凭据解析成功后走到传输层，对不可达哨兵逐字渲染 TRANSPORT_ERROR。
  // UNAUTHENTICATED 在这两条路径上会意味着主体装配错误 —— 同时排除。
  const requester = realController(composition, "requester") as unknown as DrivableRequester;
  await requester.selectEscalation("esc_00000001");
  const timeline = requester.snapshot().timeline;
  assert.equal(timeline.kind, "error");
  assert.match(timeline.message ?? "", /^TRANSPORT_ERROR — /);
  assert.doesNotMatch(timeline.message ?? "", /UNAUTHENTICATED/);

  const operations = realController(composition, "operations") as unknown as DrivableOperations;
  await operations.loadAuditTrail("esc_00000001");
  const operationsTrail = operations.snapshot().auditTrail;
  assert.equal(operationsTrail.kind, "error");
  assert.match(operationsTrail.message ?? "", /^TRANSPORT_ERROR — /);
  assert.doesNotMatch(operationsTrail.message ?? "", /UNAUTHENTICATED/);

  // reviewer 的命令/审计通道绑定 DEMO_EXPERT_PRINCIPAL（demo 标注投影的
  // 种子租户主体 —— 与 web 组合根同一装配）。该主体在 demo 令牌注册表中
  // 没有条目（诚实分层：demo 投影主体 ≠ 凭据主体），类型化失败是
  // UNAUTHENTICATED 而非传输错误 —— 与 web 端同一诚实姿态，逐字断言。
  const reviewer = realController(composition, "reviewer") as unknown as DrivableReviewer;
  await reviewer.loadAuditTrailFor("esc_00000001");
  const reviewerTrail = reviewer.snapshot().auditTrail;
  assert.equal(reviewerTrail.kind, "error");
  assert.equal(reviewerTrail.message, "UNAUTHENTICATED — the server rejected the credentials");
});

test("配置 baseUrl → 绑定端到端指向该地址（真实本地 HTTP 探针，非假服务器）", async () => {
  const observed: { method: string; url: string; authorization: string | null }[] = [];
  const server = http.createServer((request, response) => {
    observed.push({
      method: request.method ?? "",
      url: request.url ?? "",
      authorization: request.headers.authorization ?? null,
    });
    response.statusCode = 404;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        code: "ARENA_ESCALATION_NOT_FOUND",
        message: "no such escalation (real local HTTP probe)",
        correlation_id: "corr_desktop_probe_1",
        request_id: null,
        details: null,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : null;
  assert.ok(port, "probe server must be listening on an ephemeral port");
  try {
    const composition = buildArenaDesktopComposition({ baseUrl: `http://127.0.0.1:${port}` });
    const requester = realController(composition, "requester") as unknown as DrivableRequester;
    await requester.selectEscalation("esc_probe_0001");

    // 请求真的到达了配置的地址（timeline + result 两个投影通道），
    // 且按 demo 注册表主体解析出 requester-alpha 的 Bearer 凭据。
    assert.equal(observed.length, 2);
    assert.deepEqual(observed.map((entry) => `${entry.method} ${entry.url}`).sort(), [
      "GET /v1/escalations/esc_probe_0001/result",
      "GET /v1/escalations/esc_probe_0001/timeline",
    ]);
    for (const entry of observed) {
      assert.equal(entry.authorization, "Bearer demo-token-requester-alpha");
    }

    // 服务端 typed 信封逐字进入视图（legible failures）。
    const timeline = requester.snapshot().timeline;
    assert.equal(timeline.kind, "error");
    assert.match(
      timeline.message ?? "",
      /^ARENA_ESCALATION_NOT_FOUND: no such escalation \(real local HTTP probe\)$/,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("applyTitle 遵守 identity law（Arena 屏标题 + 恢复语义）", () => {
  const composition = buildArenaDesktopComposition({ baseUrl: undefined });
  const documentStub = { title: "previous title" };
  const globals = globalThis as { document?: unknown };
  const hadDocument = "document" in globals;
  const original = globals.document;
  globals.document = documentStub;
  try {
    const restore = composition.applyTitle();
    assert.equal(documentStub.title, "Arena — Requester cockpit");
    restore();
    assert.equal(documentStub.title, "previous title");
  } finally {
    if (hadDocument) {
      globals.document = original;
    } else {
      delete globals.document;
    }
  }
});

/**
 * UIA-004 TL 集成 —— 组合根注入远端站点探针（REAL 端到端）：
 * 组合 → operationsRegistration(probes) → runReadiness() → check() fetch
 * → /v1/ops/station-probes 行映射 → aggregateReadiness 聚合。
 * 未配置 baseUrl（哨兵端口 0）→ fetch 立即失败 → 类型化 DOWN fail-closed
 * —— 绝不伪造 ready、也绝不静默 unwired 冒充已测。
 */
test("UIA-004：探针注入 + 真实本地 HTTP 端点行映射（fail-closed 聚合）", async () => {
  const stationRows = {
    ready: false,
    fail_closed: true,
    dependencies: [
      {
        id: "station-persistence-node-sqlite",
        kind: "persistence",
        status: "UP",
        detail: "node:sqlite resolvable — the arena-persistence sqlite_reference_engine class",
        checked_at: "2026-10-16T00:00:00Z",
      },
      {
        id: "station-isolation-bwrap",
        kind: "capsule_provider",
        status: "DOWN",
        detail: "bwrap not detected (fixture row — real measurement lives server-side)",
        checked_at: "2026-10-16T00:00:00Z",
      },
    ],
    not_up: [
      {
        id: "station-isolation-bwrap",
        kind: "capsule_provider",
        status: "DOWN",
        detail: "bwrap not detected (fixture row — real measurement lives server-side)",
        checked_at: "2026-10-16T00:00:00Z",
      },
    ],
  };
  const hits: string[] = [];
  const server = http.createServer((request, response) => {
    hits.push(request.url ?? "");
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(stationRows));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : null;
  assert.ok(port, "station probe server must be listening on an ephemeral port");
  try {
    const composition = buildArenaDesktopComposition({ baseUrl: `http://127.0.0.1:${port}` });
    const operations = realController(composition, "operations") as unknown as {
      runReadiness(): Promise<void>;
      snapshot(): { readiness: { kind: string; report?: unknown } };
    };
    await operations.runReadiness();
    // check() 逐探针实测（两行各一次 fetch —— per-dependency 可见性法）。
    assert.deepEqual(hits, ["/v1/ops/station-probes", "/v1/ops/station-probes"]);
    const readiness = operations.snapshot().readiness;
    assert.equal(readiness.kind, "ready");
    const report = readiness.report as {
      ready: boolean;
      fail_closed?: boolean;
      dependencies: { id: string; status: string; detail: string }[];
      not_up?: { id: string }[];
    };
    // 行逐字透传 + fail-closed 聚合（bwrap DOWN ⇒ not ready）。
    assert.equal(report.ready, false);
    assert.equal(report.fail_closed, true);
    assert.deepEqual(
      report.dependencies.map((row) => `${row.id}:${row.status}`),
      ["station-persistence-node-sqlite:UP", "station-isolation-bwrap:DOWN"],
    );
    assert.match(
      report.dependencies[0].detail,
      /sqlite_reference_engine class$/,
    );
    assert.deepEqual(report.not_up?.map((row) => row.id), ["station-isolation-bwrap"]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("UIA-004：未配置 baseUrl（诚实哨兵）→ 探针类型化 DOWN fail-closed，绝不伪造 ready", async () => {
  const composition = buildArenaDesktopComposition({ baseUrl: undefined });
  const operations = realController(composition, "operations") as unknown as {
    runReadiness(): Promise<void>;
    snapshot(): { readiness: { kind: string; report?: unknown } };
  };
  await operations.runReadiness();
  const readiness = operations.snapshot().readiness;
  assert.equal(readiness.kind, "ready");
  const report = readiness.report as {
    ready: boolean;
    fail_closed?: boolean;
    dependencies: { id: string; status: string; detail: string }[];
  };
  assert.equal(report.ready, false);
  assert.equal(report.fail_closed, true);
  for (const row of report.dependencies) {
    assert.equal(row.status, "DOWN");
    assert.match(row.detail, /station probe endpoint unreachable: http:\/\/127\.0\.0\.1:0\//);
  }
});
