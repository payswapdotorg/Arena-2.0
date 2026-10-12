import assert from "node:assert/strict";
import test from "node:test";
import { SyntheticLocalProvider } from "@arena/capsule";
import {
  ScraperFactory,
  ScraperRunService,
  type ScraperDefinition,
  type StartRunCommand,
} from "../src/contract.js";
import {
  ACTOR_AUTHOR,
  ACTOR_RELEASER,
  ACTOR_REVIEWER,
  MockResolver,
  TENANT_ALPHA,
  TENANT_BETA,
  fixtureDefinition,
  fixtureEndpoint,
  realNowIso,
  realNowMs,
  realSleep,
  tenantContext,
} from "./fixtures.js";
import { startFixtureServer } from "./fixture-server.js";

/**
 * AR2-017 验收（issue #33）：租户隔离 —— 跨租户对 definitions/runs/datasets/
 * credentials 的读取与执行 fail-closed 且与不存在不可区分（404 形状，
 * 无存在性预言机），镜像 arena-acquisition 的隔离测试约定。
 */

async function twoTenantWorld(server: { port: number }) {
  const alphaDefinition = fixtureDefinition(server.port, [`http://127.0.0.1:${server.port}/guide`]);
  const factory = new ScraperFactory({
    nowIso: realNowIso,
    fixtureRunner: { run: async () => ({ passed: true, summary: "ok" }) },
  });
  const start = factory.startBuild(TENANT_ALPHA, ACTOR_AUTHOR, alphaDefinition);
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
  const versionId = release.ok ? release.version.version_id : "";

  // A BETA tenant builds and releases its own definition in the same factory.
  const betaDefinition = fixtureDefinition(server.port, [`http://127.0.0.1:${server.port}/beta`]);
  const betaStart = factory.startBuild(TENANT_BETA, ACTOR_AUTHOR, { ...betaDefinition, tenant_id: TENANT_BETA, definition_id: "sdf_00000009" } as ScraperDefinition);
  assert.equal(betaStart.ok, true);
  const betaBuildId = betaStart.ok ? betaStart.build.build_id : "";
  for (const [gate, actor] of [
    ["STATIC_VALIDATION", ACTOR_AUTHOR],
    ["DEPENDENCY_SOURCE_LICENSE_REVIEW", ACTOR_REVIEWER],
    ["BUILD", ACTOR_AUTHOR],
    ["FIXTURE_RUN", ACTOR_AUTHOR],
    ["SOURCE_POLICY_BUDGET_CHECK", ACTOR_REVIEWER],
  ] as const) {
    const result = await factory.runGate(betaBuildId, TENANT_BETA, actor, gate);
    assert.equal(result.ok, true, gate);
  }
  const betaRelease = await factory.release(betaBuildId, TENANT_BETA, ACTOR_RELEASER, "9.0.0");
  assert.equal(betaRelease.ok, true);
  const betaVersionId = betaRelease.ok ? betaRelease.version.version_id : "";

  const service = new ScraperRunService({
    provider: new SyntheticLocalProvider({ now: () => new Date(realNowMs()) }),
    factory,
    resolver: new MockResolver(),
    nowMs: realNowMs,
    nowIso: realNowIso,
    sleep: realSleep,
  });
  return { factory, service, versionId, betaVersionId };
}

function commandFor(versionId: string, port: number, key = "iso-key-1"): StartRunCommand {
  return {
    request_id: "req_00000001",
    provider_id: "prv_00000001",
    scraper_version_id: versionId,
    idempotency_key: key,
    correlation_id: "cor_00000001",
    causation_id: null,
    deadline: new Date(Date.now() + 60_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    quotas: { max_pages: 5, max_items: 50, max_bytes: 500_000, wall_time_seconds: 30, max_cost_usd: 1 },
    fixture_endpoints: [fixtureEndpoint(port)],
  };
}

test("isolation: a definition of another tenant is invisible (404-shaped, no oracle)", async () => {
  const server = await startFixtureServer({ pages: { "/guide": "<html>g</html>", "/beta": "<html>b</html>" } });
  try {
    const { factory, versionId, betaVersionId } = await twoTenantWorld(server);
    // Cross-tenant and missing are indistinguishable for every read surface.
    assert.equal(factory.findVersion(versionId, TENANT_BETA), null);
    assert.equal(factory.findVersion("scv_99999999", TENANT_BETA), null);
    assert.equal(factory.findVersionByTag("sdf_00000002", "1.0.0", TENANT_BETA), null);
    assert.equal(factory.findDefinitionOfVersion(versionId, TENANT_BETA), null);
    // Each tenant sees its OWN version and definition.
    assert.ok(factory.findVersion(versionId, TENANT_ALPHA) !== null);
    assert.ok(factory.findVersion(betaVersionId, TENANT_BETA) !== null);
    assert.ok(factory.findDefinitionOfVersion(betaVersionId, TENANT_BETA) !== null);
    assert.equal(factory.findDefinitionOfVersion(betaVersionId, TENANT_ALPHA), null);
  } finally {
    await server.close();
  }
});

test("isolation: another tenant cannot start or execute runs against a foreign version", async () => {
  const server = await startFixtureServer({ pages: { "/guide": "<html>g</html>" } });
  try {
    const { service, versionId } = await twoTenantWorld(server);
    const crossStart = service.startRun(tenantContext(TENANT_BETA), commandFor(versionId, server.port));
    assert.equal(crossStart.ok, false);
    if (!crossStart.ok) assert.equal(crossStart.code, "SCRP_VERSION_NOT_FOUND");
    const ghostStart = service.startRun(tenantContext(TENANT_BETA), commandFor("scv_99999999", server.port));
    assert.equal(ghostStart.ok, false);
    if (!ghostStart.ok) assert.equal(ghostStart.code, "SCRP_VERSION_NOT_FOUND");
    // Identical shape for cross-tenant vs ghost.
    assert.deepEqual(
      JSON.stringify(crossStart).replace(versionId, "X"),
      JSON.stringify(ghostStart).replace("scv_99999999", "X"),
    );
  } finally {
    await server.close();
  }
});

test("isolation: run and dataset reads are tenant-fenced and oracle-free", async () => {
  const server = await startFixtureServer({ pages: { "/guide": "<html>g</html>" } });
  try {
    const { service, versionId } = await twoTenantWorld(server);
    const started = service.startRun(tenantContext(TENANT_ALPHA), commandFor(versionId, server.port));
    assert.equal(started.ok, true);
    const runId = started.ok ? started.run.run_id : "";
    const outcome = await service.executeRun(TENANT_ALPHA, runId);
    assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.detail);
    const run = service.runs.find(runId, TENANT_ALPHA);
    assert.ok(run !== null);
    const datasetId = run.output_dataset_id;
    // Cross-tenant reads fail closed with the same shape as missing.
    assert.equal(service.runs.find(runId, TENANT_BETA), null);
    assert.equal(service.runs.find("run_99999999", TENANT_ALPHA), null);
    assert.equal(service.datasets.find(datasetId!, TENANT_BETA), null);
    assert.equal(service.datasets.find("dst_99999999", TENANT_ALPHA), null);
    assert.equal(service.datasets.findByRun(runId, TENANT_BETA), null);
    // Cross-tenant execution/cancel attempts are also NOT_FOUND-shaped.
    const execute = await service.executeRun(TENANT_BETA, runId);
    assert.equal(execute.ok, false);
    if (!execute.ok) assert.equal(execute.code, "SCRP_NOT_FOUND");
    const cancel = service.cancelRun(TENANT_BETA, runId);
    assert.equal(cancel.ok, false);
    if (!cancel.ok) assert.equal(cancel.code, "SCRP_NOT_FOUND");
    // The run record itself never leaks the other tenant's ids.
    assert.equal(JSON.stringify(run).includes(TENANT_BETA), false);
  } finally {
    await server.close();
  }
});

test("isolation: idempotency keys are scoped per tenant (no cross-tenant replay)", async () => {
  const server = await startFixtureServer({ pages: { "/guide": "<html>g</html>" } });
  try {
    const { service, versionId, betaVersionId } = await twoTenantWorld(server);
    const alpha = service.startRun(tenantContext(TENANT_ALPHA), commandFor(versionId, server.port, "shared-key"));
    assert.equal(alpha.ok, true);
    const beta = service.startRun(tenantContext(TENANT_BETA), commandFor(betaVersionId, server.port, "shared-key"));
    assert.equal(beta.ok, true, "same key under a different tenant is a different run");
    if (alpha.ok && beta.ok) assert.notEqual(beta.run.run_id, alpha.run.run_id);
  } finally {
    await server.close();
  }
});

test("isolation: another tenant's definition ids do not unlock the factory gates", async () => {
  const server = await startFixtureServer({ pages: {} });
  try {
    const { factory } = await twoTenantWorld(server);
    const internal = factory as unknown as {
      builds: Map<string, { build: { build_id: string; tenant_id: string } }>;
    };
    const alphaEntry = [...internal.builds.values()].find((entry) => entry.build.tenant_id === TENANT_ALPHA);
    assert.ok(alphaEntry !== undefined);
    const alphaBuildId = Object.keys(Object.fromEntries(internal.builds)).find(
      (key) => internal.builds.get(key) === alphaEntry,
    );
    assert.ok(alphaBuildId !== undefined);
    const result = await factory.runGate(alphaBuildId, TENANT_BETA, ACTOR_AUTHOR, "STATIC_VALIDATION");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SCRP_NOT_FOUND");
  } finally {
    await server.close();
  }
});
