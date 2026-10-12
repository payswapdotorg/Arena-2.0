import assert from "node:assert/strict";
import test from "node:test";
import { SyntheticLocalProvider, type ProvisionOutcome } from "@arena/capsule";
import type { TenantContext } from "@arena/contracts";
import {
  ScraperFactory,
  ScraperRunService,
  SYNTHETIC_CAPSULE_DISCLOSURE,
  type CapsuleProviderPort,
  type ScraperDefinition,
  type StartRunCommand,
} from "../src/contract.js";
import {
  ACTOR_AUTHOR,
  ACTOR_RELEASER,
  ACTOR_REVIEWER,
  MockResolver,
  TENANT_ALPHA,
  fixtureDefinition,
  fixtureEndpoint,
  productionDefinition,
  realNowIso,
  realNowMs,
  realSleep,
  tenantContext,
} from "./fixtures.js";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";

/**
 * AR2-017 验收（issue #33）：execution plane ——
 * run 记录创建（幂等键控）→ lease → capsule manifest → CapsuleProvider 执行
 * → budget 下爬取 → 隔离/归一/去重/校验 → DatasetArtifact → 终态事件。
 * 模糊结局（超时中途）→ UNKNOWN + operation identity；取消协作式 + 硬限。
 */

async function releasedFixtureFactory(
  server: FixtureServer,
  definition: ScraperDefinition,
): Promise<{ factory: ScraperFactory; versionId: string; definitionId: string }> {
  const factory = new ScraperFactory({
    nowIso: realNowIso,
    fixtureRunner: { run: async () => ({ passed: true, summary: "fixture crawl over local fixtures passed" }) },
  });
  const start = factory.startBuild(TENANT_ALPHA, ACTOR_AUTHOR, definition);
  assert.equal(start.ok, true);
  const buildId = start.ok ? start.build.build_id : "";
  for (const [gate, actor] of [
    ["STATIC_VALIDATION", ACTOR_AUTHOR],
    ["DEPENDENCY_SOURCE_LICENSE_REVIEW", ACTOR_REVIEWER],
    ["BUILD", ACTOR_AUTHOR],
    ["FIXTURE_RUN", ACTOR_AUTHOR],
    ["SOURCE_POLICY_BUDGET_CHECK", ACTOR_REVIEWER],
  ] as const) {
    const result = await factory.runGate(buildId, TENANT_ALPHA, actor, gate);
    assert.equal(result.ok, true, gate);
  }
  const release = await factory.release(buildId, TENANT_ALPHA, ACTOR_RELEASER, "1.0.0");
  assert.equal(release.ok, true);
  return {
    factory,
    versionId: release.ok ? release.version.version_id : "",
    definitionId: definition.definition_id,
  };
}

function runCommand(versionId: string, server: FixtureServer, overrides: Partial<StartRunCommand> = {}): StartRunCommand {
  return {
    request_id: "req_00000001",
    provider_id: "prv_00000001",
    scraper_version_id: versionId,
    idempotency_key: "scrp-run-key-1",
    correlation_id: "cor_00000001",
    causation_id: null,
    deadline: new Date(Date.now() + 60_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    quotas: { max_pages: 10, max_items: 100, max_bytes: 1_000_000, wall_time_seconds: 30, max_cost_usd: 5 },
    fixture_endpoints: [fixtureEndpoint(server.port)],
    ...overrides,
  };
}

async function makeService(
  server: FixtureServer,
  options: {
    provider?: CapsuleProviderPort;
    definition?: ScraperDefinition;
    nowMs?: () => number;
    maxQuarantinedRecords?: number;
  } = {},
): Promise<{ service: ScraperRunService; factory: ScraperFactory; versionId: string }> {
  const definition = options.definition ?? fixtureDefinition(server.port, [`http://127.0.0.1:${server.port}/guide`]);
  const { factory, versionId } = await releasedFixtureFactory(server, definition);
  const service = new ScraperRunService({
    provider: options.provider ?? new SyntheticLocalProvider({ now: () => new Date(realNowMs()) }),
    factory,
    resolver: new MockResolver(),
    nowMs: options.nowMs ?? realNowMs,
    nowIso: realNowIso,
    sleep: realSleep,
    maxQuarantinedRecords: options.maxQuarantinedRecords,
  });
  return { service, factory, versionId };
}

test("run service: happy path executes through the capsule and emits a provenance-complete dataset", async () => {
  const server = await startFixtureServer({
    pages: { "/guide": "<html><body>Blender procedural material guide</body></html>" },
  });
  try {
    const { service, versionId } = await makeService(server);
    const started = service.startRun(tenantContext(TENANT_ALPHA), runCommand(versionId, server));
    assert.equal(started.ok, true);
    assert.equal(started.replayed, false);
    assert.equal(started.ok && started.run.status, "PENDING");
    const runId = started.ok ? started.run.run_id : "";
    const outcome = await service.executeRun(TENANT_ALPHA, runId);
    assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.detail);
    const run = service.runs.find(runId, TENANT_ALPHA);
    assert.ok(run !== null);
    assert.equal(run.status, "COMPLETED");
    assert.equal(run.terminal_reason, "COMPLETED");
    assert.equal(run.attempt_counter, 1);
    assert.ok(run.lease === null, "lease released at terminal");
    const eventKinds = run.events.map((event) => event.kind);
    for (const expected of [
      "RUN_CREATED",
      "LEASE_ACQUIRED",
      "CAPSULE_PROVISIONED",
      "CRAWL_STARTED",
      "PAGE_FETCHED",
      "DATASET_EMITTED",
      "LEASE_RELEASED",
      "RUN_TERMINATED",
    ]) {
      assert.ok(eventKinds.includes(expected), `missing event ${expected}`);
    }
    const dataset = service.datasets.find(run.output_dataset_id!, TENANT_ALPHA);
    assert.ok(dataset !== null);
    assert.equal(dataset.items.length, 1);
    const item = dataset.items[0]!;
    assert.ok(item.source_url.endsWith("/guide"));
    assert.equal(item.method, "HTTP_CRAWL");
    assert.equal(dataset.provenance.crawlee_version, "3.18.2");
    assert.equal(dataset.provenance.engine, "SCRP-ENGINE1.0");
    assert.ok(dataset.provenance.definition_digest.match(/^[a-f0-9]{64}$/));
    assert.ok(SYNTHETIC_CAPSULE_DISCLOSURE.includes("no OS-isolation claim"));
  } finally {
    await server.close();
  }
});

test("run service: idempotency — same key+digest replays, different digest conflicts", async () => {
  const server = await startFixtureServer({ pages: { "/guide": "<html>g</html>" } });
  try {
    const { service, versionId } = await makeService(server);
    const command = runCommand(versionId, server);
    const first = service.startRun(tenantContext(TENANT_ALPHA), command);
    assert.equal(first.ok, true);
    const replay = service.startRun(tenantContext(TENANT_ALPHA), command);
    assert.equal(replay.ok, true);
    assert.equal(replay.replayed, true);
    assert.equal(replay.ok && replay.run.run_id, first.ok ? first.run.run_id : "");
    const conflict = service.startRun(tenantContext(TENANT_ALPHA), {
      ...command,
      request_id: "req_00000002",
    });
    assert.equal(conflict.ok, false);
    if (!conflict.ok) assert.equal(conflict.code, "SCRP_IDEMPOTENCY_DIGEST_MISMATCH");
    const runId = first.ok ? first.run.run_id : "";
    const run = service.runs.find(runId, TENANT_ALPHA);
    assert.ok(run !== null);
    assert.ok(run.events.some((event) => event.kind === "IDEMPOTENCY_REPLAY"));
  } finally {
    await server.close();
  }
});

test("run service: a run deadline exceeded mid-crawl lands in UNKNOWN with operation identity", async () => {
  const server = await startFixtureServer({
    slowPaths: { "/guide": 400 },
    pages: { "/guide": "<html>slow</html>" },
  });
  try {
    const { service, versionId } = await makeService(server);
    const command = runCommand(versionId, server, {
      deadline: new Date(Date.now() + 150).toISOString().replace(/\.\d{3}Z$/, "Z"),
    });
    const started = service.startRun(tenantContext(TENANT_ALPHA), command);
    const runId = started.ok ? started.run.run_id : "";
    const outcome = await service.executeRun(TENANT_ALPHA, runId);
    assert.equal(outcome.ok, true, "UNKNOWN is a valid terminal, not a service error");
    const run = service.runs.find(runId, TENANT_ALPHA);
    assert.equal(run?.status, "UNKNOWN");
    assert.equal(run?.terminal_reason, "SCRP_RUN_DEADLINE_EXCEEDED");
    assert.ok(run?.operation_identity !== null, "operation identity persisted");
    assert.ok(run?.operation_identity!.includes(runId));
  } finally {
    await server.close();
  }
});

test("run service: cooperative cancellation mid-crawl terminates CANCELLED", async () => {
  const server = await startFixtureServer({
    slowPaths: { "/guide": 250, "/second": 250 },
    pages: { "/guide": "<html>first</html>", "/second": "<html>second</html>" },
  });
  try {
    const { service, versionId } = await makeService(server, {
      definition: fixtureDefinition(server.port, [
        `http://127.0.0.1:${server.port}/guide`,
        `http://127.0.0.1:${server.port}/second`,
      ]),
    });
    const started = service.startRun(tenantContext(TENANT_ALPHA), runCommand(versionId, server));
    const runId = started.ok ? started.run.run_id : "";
    const executing = service.executeRun(TENANT_ALPHA, runId);
    // Wait until the crawl actually started (CRAWL_STARTED event persisted).
    for (
      let i = 0;
      i < 100 && !service.runs.find(runId, TENANT_ALPHA)?.events.some((event) => event.kind === "CRAWL_STARTED");
      i += 1
    ) {
      await realSleep(10);
    }
    const cancel = service.cancelRun(TENANT_ALPHA, runId);
    assert.equal(cancel.ok, true);
    const outcome = await executing;
    assert.equal(outcome.ok, true, "cancellation reaching a terminal state is a valid outcome");
    const run = service.runs.find(runId, TENANT_ALPHA);
    assert.equal(run?.status, "CANCELLED");
    assert.equal(run?.terminal_reason, "SCRP_RUN_CANCELLED");
    assert.ok(run?.events.some((event) => event.kind === "CANCEL_REQUESTED"));
  } finally {
    await server.close();
  }
});

test("run service: quarantine overflow fails the run closed", async () => {
  const server = await startFixtureServer({
    pages: { "/guide": "\u0000\u0001\u0002\u0003\u0004\u0005\u0006" },
    headers: { "/guide": { "content-type": "application/octet-stream" } },
  });
  try {
    const { service, versionId } = await makeService(server, {
      definition: fixtureDefinition(server.port, [`http://127.0.0.1:${server.port}/guide`]),
      maxQuarantinedRecords: 0,
    });
    const started = service.startRun(tenantContext(TENANT_ALPHA), runCommand(versionId, server));
    const runId = started.ok ? started.run.run_id : "";
    const outcome = await service.executeRun(TENANT_ALPHA, runId);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "SCRP_QUARANTINE_EXCESS");
    const run = service.runs.find(runId, TENANT_ALPHA);
    assert.equal(run?.status, "FAILED");
    assert.equal(run?.terminal_reason, "SCRP_QUARANTINE_EXCESS");
  } finally {
    await server.close();
  }
});

test("run service: capsule provisioning failure fails the run closed", async () => {
  const server = await startFixtureServer({ pages: { "/guide": "<html>g</html>" } });
  try {
    const failingProvider: CapsuleProviderPort = {
      provision: async () => ({ kind: "PROVISION_FAILED", reason: "isolation suite rejected" }) as ProvisionOutcome,
      heartbeat: async () => ({ kind: "REFUSED", code: "ARENA_CAPSULE_UNAVAILABLE", detail: "no capsule" }),
      transferArtifact: async () => ({ kind: "REFUSED", code: "ARENA_CAPSULE_UNAVAILABLE", detail: "no capsule" }),
      teardown: async () => ({ kind: "REFUSED", code: "ARENA_CAPSULE_UNAVAILABLE", detail: "no capsule" }),
    };
    const { service, versionId } = await makeService(server, { provider: failingProvider });
    const started = service.startRun(tenantContext(TENANT_ALPHA), runCommand(versionId, server));
    const runId = started.ok ? started.run.run_id : "";
    const outcome = await service.executeRun(TENANT_ALPHA, runId);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "SCRP_CAPSULE_PROVISION_FAILED");
    assert.equal(service.runs.find(runId, TENANT_ALPHA)?.status, "FAILED");
    assert.equal(service.runs.find(runId, TENANT_ALPHA)?.output_dataset_id, null);
  } finally {
    await server.close();
  }
});

test("run service: fenced retry after UNKNOWN increments the attempt counter; COMPLETED runs refuse retry", async () => {
  const server = await startFixtureServer({
    slowPaths: { "/guide": 300 },
    pages: { "/guide": "<html>slow</html>", "/quick": "<html>quick</html>" },
  });
  try {
    const { service, versionId } = await makeService(server);
    // Attempt 1: past-deadline run lands in UNKNOWN with operation identity.
    const unknown = service.startRun(tenantContext(TENANT_ALPHA), runCommand(versionId, server, {
      deadline: new Date(Date.now() + 120).toISOString().replace(/\.\d{3}Z$/, "Z"),
    }));
    const unknownRunId = unknown.ok ? unknown.run.run_id : "";
    await service.executeRun(TENANT_ALPHA, unknownRunId);
    assert.equal(service.runs.find(unknownRunId, TENANT_ALPHA)?.status, "UNKNOWN");
    const retry = await service.retryRun(TENANT_ALPHA, unknownRunId);
    assert.equal(retry.ok, true, retry.ok ? "" : retry.detail);
    const run = service.runs.find(unknownRunId, TENANT_ALPHA);
    assert.equal(run?.attempt_counter, 2);
    assert.ok(run?.events.some((event) => event.detail.includes("fenced retry")));
    // A COMPLETED run refuses retry with a typed state error.
    const done = service.startRun(tenantContext(TENANT_ALPHA), runCommand(versionId, server, {
      idempotency_key: "scrp-run-key-2",
      request_id: "req_00000002",
    }));
    const doneRunId = done.ok ? done.run.run_id : "";
    await service.executeRun(TENANT_ALPHA, doneRunId);
    assert.equal(service.runs.find(doneRunId, TENANT_ALPHA)?.status, "COMPLETED");
    const again = await service.retryRun(TENANT_ALPHA, doneRunId);
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.code, "SCRP_RUN_STATE_INVALID");
  } finally {
    await server.close();
  }
});

test("run service: unknown version ids fail closed and indistinguishably", async () => {
  const server = await startFixtureServer({ pages: { "/guide": "<html>g</html>" } });
  try {
    const { service } = await makeService(server);
    const ghost = service.startRun(tenantContext(TENANT_ALPHA), runCommand("scv_99999999", server));
    assert.equal(ghost.ok, false);
    if (!ghost.ok) assert.equal(ghost.code, "SCRP_VERSION_NOT_FOUND");
    const crossTenantVersion = service.startRun(tenantContext("tnt_00000002"), runCommand("scv_99999999", server));
    assert.equal(crossTenantVersion.ok, false);
    if (!crossTenantVersion.ok) assert.equal(crossTenantVersion.code, "SCRP_VERSION_NOT_FOUND");
  } finally {
    await server.close();
  }
});

test("run service: tenant context must be credential-derived", async () => {
  const server = await startFixtureServer({ pages: {} });
  try {
    const { service, versionId } = await makeService(server);
    const forged = service.startRun(
      { ...tenantContext(TENANT_ALPHA), derived_from: "asserted_by_caller" } as unknown as TenantContext,
      runCommand(versionId, server),
    );
    assert.equal(forged.ok, false);
    if (!forged.ok) assert.equal(forged.code, "SCRP_TENANT_CONTEXT_INVALID");
  } finally {
    await server.close();
  }
});

test("run service: executing a non-PENDING run is a typed state error", async () => {
  const server = await startFixtureServer({ pages: { "/guide": "<html>g</html>" } });
  try {
    const { service, versionId } = await makeService(server);
    const started = service.startRun(tenantContext(TENANT_ALPHA), runCommand(versionId, server));
    const runId = started.ok ? started.run.run_id : "";
    await service.executeRun(TENANT_ALPHA, runId);
    const twice = await service.executeRun(TENANT_ALPHA, runId);
    assert.equal(twice.ok, false);
    if (!twice.ok) assert.equal(twice.code, "SCRP_RUN_STATE_INVALID");
  } finally {
    await server.close();
  }
});

test("run service: a definition whose seeds are outside scope dies at the static gate, never reaching a run", async () => {
  const server = await startFixtureServer({ pages: {} });
  try {
    const factory = new ScraperFactory({
      nowIso: realNowIso,
      fixtureRunner: { run: async () => ({ passed: true, summary: "ok" }) },
    });
    const definition = fixtureDefinition(server.port, ["https://docs.example.org/out-of-scope"]);
    const start = factory.startBuild(TENANT_ALPHA, ACTOR_AUTHOR, definition);
    assert.equal(start.ok, true, "schema-valid drafts open a build");
    const buildId = start.ok ? start.build.build_id : "";
    const gate = await factory.runGate(buildId, TENANT_ALPHA, ACTOR_AUTHOR, "STATIC_VALIDATION");
    assert.equal(gate.ok, false, "scope violations die at the static gate");
    assert.equal(factory.findBuild(buildId, TENANT_ALPHA)?.state, "REJECTED_STATIC");
    const release = await factory.release(buildId, TENANT_ALPHA, ACTOR_RELEASER, "1.0.0");
    assert.equal(release.ok, false, "a rejected build can never release");
    if (!release.ok) assert.equal(release.code, "SCRP_BUILD_STATE_INVALID");
    const prod = await releasedFixtureFactory(server, productionDefinition());
    assert.ok(prod.versionId.length > 0);
  } finally {
    await server.close();
  }
});
