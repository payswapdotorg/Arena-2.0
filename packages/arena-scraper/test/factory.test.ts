import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVED_DEPENDENCY_LICENSES,
  ScraperFactory,
  buildLifecycleAllows,
  buildStateIsTerminal,
  computeBuildDigest,
  generateBuildPlan,
  runDependencySourceLicenseReviewGate,
  runFixtureGate,
  runSourcePolicyBudgetGate,
  runStaticValidationGate,
  scrpError,
  scrpHttpStatusFor,
  type ScraperDefinition,
} from "../src/contract.js";
import {
  ACTOR_AUTHOR,
  ACTOR_OPERATOR,
  ACTOR_RELEASER,
  ACTOR_REVIEWER,
  TENANT_ALPHA,
  TENANT_BETA,
  productionDefinition,
} from "./fixtures.js";

/**
 * AR2-017 验收（issue #33）：Scraper Factory 生命周期 ——
 * draft→release 全 happy path；每个 gate 的拒绝路径落入正确的终态并带
 * reason codes；actor 授权；状态机不可跳跃/复活；版本不可变（幂等重放）。
 */

function newFactory(fixtureRunner?: { run: () => Promise<{ passed: boolean; summary: string }> }) {
  return new ScraperFactory({
    nowIso: () => "2026-10-12T00:00:00Z",
    fixtureRunner: fixtureRunner ?? { run: async () => ({ passed: true, summary: "fixture crawl over local fixtures passed" }) },
  });
}

async function releaseHappyDefinition(factory: ScraperFactory) {
  const start = factory.startBuild(TENANT_ALPHA, ACTOR_AUTHOR, productionDefinition());
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
    assert.equal(result.ok, true, `gate ${gate} failed: ${result.ok ? "" : result.detail}`);
  }
  const release = await factory.release(buildId, TENANT_ALPHA, ACTOR_RELEASER, "1.0.0");
  assert.equal(release.ok, true, release.ok ? "" : release.detail);
  return { buildId, release };
}

test("factory: the full happy path reaches RELEASED with evidence at every transition", async () => {
  const factory = newFactory();
  const { buildId, release } = await releaseHappyDefinition(factory);
  const build = factory.findBuild(buildId, TENANT_ALPHA);
  assert.ok(build !== null);
  assert.equal(build.state, "RELEASED");
  assert.equal(build.transitions.length, 7);
  for (const transition of build.transitions) {
    assert.ok(transition.evidence.digest.match(/^[a-f0-9]{64}$/));
    assert.ok(transition.at >= "2026-10-12T00:00:00Z");
  }
  assert.ok(release.ok);
  if (release.ok) {
    assert.equal(release.version.version, "1.0.0");
    assert.equal(release.version.tenant_id, TENANT_ALPHA);
    assert.equal(release.version.definition_digest, build.build_digest ? release.version.definition_digest : "");
    assert.ok(release.version.release_evidence.length >= 1);
    const definition = factory.findDefinitionOfVersion(release.version.version_id, TENANT_ALPHA);
    assert.ok(definition !== null);
    assert.equal(definition.definition_id, "sdf_00000001");
  }
});

test("factory: static validation failure lands in REJECTED_STATIC with a reason code", async () => {
  const factory = newFactory();
  const bad = productionDefinition({ seeds: ["https://evil.example.com/x"] });
  const start = factory.startBuild(TENANT_ALPHA, ACTOR_AUTHOR, bad);
  assert.equal(start.ok, true);
  const buildId = start.ok ? start.build.build_id : "";
  const result = await factory.runGate(buildId, TENANT_ALPHA, ACTOR_AUTHOR, "STATIC_VALIDATION");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "SCRP_BUILD_GATE_REJECTED");
  const build = factory.findBuild(buildId, TENANT_ALPHA);
  assert.ok(build !== null);
  assert.equal(build.state, "REJECTED_STATIC");
  assert.ok(build.rejection_reason !== null);
  assert.ok(build.rejection_reason!.detail.includes("seeds"));
  assert.equal(buildLifecycleAllows(build.state, "STATIC_VALIDATED"), false);
  assert.equal(buildStateIsTerminal(build.state), true);
});

test("factory: a schema-invalid definition never even opens a build", () => {
  const factory = newFactory();
  const invalid = { ...productionDefinition(), source_scope: { schemes: ["ftp"], domains: ["x"], ports: [21] } };
  const start = factory.startBuild(TENANT_ALPHA, ACTOR_AUTHOR, invalid);
  assert.equal(start.ok, false);
  if (!start.ok) assert.equal(start.code, "SCRP_VALIDATION_FAILED");
});

test("factory: license review failure (UNKNOWN posture) lands in REJECTED_REVIEW", async () => {
  const factory = newFactory();
  const start = factory.startBuild(TENANT_ALPHA, ACTOR_AUTHOR, productionDefinition({
    rights_profile: {
      source_rights_posture: "UNKNOWN",
      license_assessment: "unknown rights posture must fail closed",
      rights_evidence: [],
    },
  }));
  assert.equal(start.ok, true);
  const buildId = start.ok ? start.build.build_id : "";
  const staticOk = await factory.runGate(buildId, TENANT_ALPHA, ACTOR_AUTHOR, "STATIC_VALIDATION");
  assert.equal(staticOk.ok, true);
  const review = await factory.runGate(buildId, TENANT_ALPHA, ACTOR_REVIEWER, "DEPENDENCY_SOURCE_LICENSE_REVIEW");
  assert.equal(review.ok, false);
  if (!review.ok) assert.equal(review.code, "SCRP_LICENSE_REVIEW_REJECTED");
  const build = factory.findBuild(buildId, TENANT_ALPHA);
  assert.equal(build?.state, "REJECTED_REVIEW");
});

test("factory: a copyleft dependency license fails the review gate", () => {
  const result = runDependencySourceLicenseReviewGate(productionDefinition({
    dependency_lock: [
      { name: "evil-crawler", version: "1.0.0", license: "GPL-3.0", integrity: "sha512-x" },
    ],
  }) as ScraperDefinition);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "SCRP_LICENSE_REVIEW_REJECTED");
  assert.ok(APPROVED_DEPENDENCY_LICENSES.has("MIT"));
});

test("factory: budget check failure lands in REJECTED_POLICY", async () => {
  const factory = newFactory();
  const start = factory.startBuild(TENANT_ALPHA, ACTOR_AUTHOR, productionDefinition({
    resource_policy: { max_pages: 50, max_items: 200, max_bytes: 10, max_depth: 2, wall_time_seconds: 120 },
  }));
  assert.equal(start.ok, true);
  const buildId = start.ok ? start.build.build_id : "";
  for (const [gate, actor] of [
    ["STATIC_VALIDATION", ACTOR_AUTHOR],
    ["DEPENDENCY_SOURCE_LICENSE_REVIEW", ACTOR_REVIEWER],
    ["BUILD", ACTOR_AUTHOR],
    ["FIXTURE_RUN", ACTOR_AUTHOR],
  ] as const) {
    const result = await factory.runGate(buildId, TENANT_ALPHA, actor, gate);
    assert.equal(result.ok, true);
  }
  const policyCheck = await factory.runGate(buildId, TENANT_ALPHA, ACTOR_REVIEWER, "SOURCE_POLICY_BUDGET_CHECK");
  assert.equal(policyCheck.ok, false);
  if (!policyCheck.ok) assert.equal(policyCheck.code, "SCRP_BUDGET_CHECK_FAILED");
  const build = factory.findBuild(buildId, TENANT_ALPHA);
  assert.equal(build?.state, "REJECTED_POLICY");
});

test("factory: a login-walled source fails the source-policy gate", () => {
  const result = runSourcePolicyBudgetGate(productionDefinition({
    safety_profile: { ...productionDefinition().safety_profile, source_requires_authentication: true },
  }) as ScraperDefinition);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "SCRP_SOURCE_POLICY_REJECTED");
});

test("factory: a missing fixture runner fails the fixture gate closed", () => {
  const result = runFixtureGate(productionDefinition() as ScraperDefinition, null);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.detail.includes("fail closed"));
  const failing = runFixtureGate(productionDefinition() as ScraperDefinition, { passed: false, summary: "fixture crawl crashed" });
  assert.equal(failing.ok, false);
});

test("factory: gates are role-fenced (actor authorization)", async () => {
  const factory = newFactory();
  const start = factory.startBuild(TENANT_ALPHA, ACTOR_AUTHOR, productionDefinition());
  assert.equal(start.ok, true);
  const buildId = start.ok ? start.build.build_id : "";
  const wrongActor = await factory.runGate(buildId, TENANT_ALPHA, ACTOR_REVIEWER, "STATIC_VALIDATION");
  assert.equal(wrongActor.ok, false);
  if (!wrongActor.ok) assert.equal(wrongActor.code, "SCRP_ACTOR_NOT_AUTHORIZED");
  const build = factory.findBuild(buildId, TENANT_ALPHA);
  assert.equal(build?.state, "DRAFT", "an unauthorized actor cannot move the build");

  const releaseDenied = await factory.release(buildId, TENANT_ALPHA, ACTOR_AUTHOR, "1.0.0");
  assert.equal(releaseDenied.ok, false);
  if (!releaseDenied.ok) assert.equal(releaseDenied.code, "SCRP_ACTOR_NOT_AUTHORIZED");
});

test("factory: transitions cannot skip states and terminal states are terminal", async () => {
  const factory = newFactory();
  const start = factory.startBuild(TENANT_ALPHA, ACTOR_AUTHOR, productionDefinition());
  const buildId = start.ok ? start.build.build_id : "";
  const skip = await factory.runGate(buildId, TENANT_ALPHA, ACTOR_AUTHOR, "BUILD");
  assert.equal(skip.ok, false);
  if (!skip.ok) assert.equal(skip.code, "SCRP_BUILD_STATE_INVALID");
  const staticOk = await factory.runGate(buildId, TENANT_ALPHA, ACTOR_AUTHOR, "STATIC_VALIDATION");
  assert.equal(staticOk.ok, true);
  const repeat = await factory.runGate(buildId, TENANT_ALPHA, ACTOR_AUTHOR, "STATIC_VALIDATION");
  assert.equal(repeat.ok, false);
  if (!repeat.ok) assert.equal(repeat.code, "SCRP_BUILD_STATE_INVALID");
});

test("factory: released versions are immutable (digest mismatch is a typed conflict; identical is a replay)", async () => {
  const factory = newFactory();
  const { buildId, release } = await releaseHappyDefinition(factory);
  assert.ok(release.ok);
  const versionId = release.ok ? release.version.version_id : "";

  const start2 = factory.startBuild(TENANT_ALPHA, ACTOR_AUTHOR, productionDefinition({
    description: "changed behavior requires a NEW version, never an in-place edit",
  }));
  assert.equal(start2.ok, true);
  const build2 = start2.ok ? start2.build.build_id : "";
  for (const [gate, actor] of [
    ["STATIC_VALIDATION", ACTOR_AUTHOR],
    ["DEPENDENCY_SOURCE_LICENSE_REVIEW", ACTOR_REVIEWER],
    ["BUILD", ACTOR_AUTHOR],
    ["FIXTURE_RUN", ACTOR_AUTHOR],
    ["SOURCE_POLICY_BUDGET_CHECK", ACTOR_REVIEWER],
  ] as const) {
    const result = await factory.runGate(build2, TENANT_ALPHA, actor, gate);
    assert.equal(result.ok, true);
  }
  const conflicting = await factory.release(build2, TENANT_ALPHA, ACTOR_RELEASER, "1.0.0");
  assert.equal(conflicting.ok, false);
  if (!conflicting.ok) assert.equal(conflicting.code, "SCRP_VERSION_IMMUTABLE");

  // Re-releasing the SAME build+version is an idempotent replay.
  const replay = await factory.release(buildId, TENANT_ALPHA, ACTOR_RELEASER, "1.0.0");
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.replayed, true);
  assert.equal(factory.findVersion(versionId, TENANT_ALPHA)?.version, "1.0.0");
});

test("factory: build digest covers definition + generated plan + dependency lock", () => {
  const definition = productionDefinition() as ScraperDefinition;
  const plan = generateBuildPlan(definition);
  const digest = computeBuildDigest(definition, plan);
  assert.match(digest, /^[a-f0-9]{64}$/);
  const changed = productionDefinition({ description: "different" }) as ScraperDefinition;
  assert.notEqual(computeBuildDigest(changed, generateBuildPlan(changed)), digest);
  assert.ok(plan.includes("arena-scraper-build-plan"));
  assert.ok(plan.includes("never trusted"));
});

test("factory: static validation gate checks output-schema presence and port allowlist", () => {
  const missing = runStaticValidationGate(productionDefinition({ output_schema: { schema_id: "", schema_version: "" } }));
  assert.equal(missing.ok, false);
  const emptyPorts = runStaticValidationGate(productionDefinition({ source_scope: { schemes: ["https"], domains: ["docs.example.org"], ports: [] } }));
  assert.equal(emptyPorts.ok, false);
  const ok = runStaticValidationGate(productionDefinition());
  assert.equal(ok.ok, true);
});

test("factory: cross-tenant build reads are indistinguishable from missing", async () => {
  const factory = newFactory();
  const start = factory.startBuild(TENANT_ALPHA, ACTOR_AUTHOR, productionDefinition());
  const buildId = start.ok ? start.build.build_id : "";
  assert.equal(factory.findBuild(buildId, TENANT_BETA), null);
  assert.equal(factory.findBuild("bld_99999999", TENANT_ALPHA), null);
  const crossGate = await factory.runGate(buildId, TENANT_BETA, ACTOR_AUTHOR, "STATIC_VALIDATION");
  assert.equal(crossGate.ok, false);
  if (!crossGate.ok) assert.equal(crossGate.code, "SCRP_NOT_FOUND");
});

test("factory: operator role may operate operational gates but not release", async () => {
  const factory = newFactory();
  const start = factory.startBuild(TENANT_ALPHA, ACTOR_OPERATOR, productionDefinition());
  assert.equal(start.ok, true);
  const buildId = start.ok ? start.build.build_id : "";
  const staticOk = await factory.runGate(buildId, TENANT_ALPHA, ACTOR_OPERATOR, "STATIC_VALIDATION");
  assert.equal(staticOk.ok, true);
  const releaseAttempt = await factory.release(buildId, TENANT_ALPHA, ACTOR_OPERATOR, "1.0.0");
  assert.equal(releaseAttempt.ok, false);
  if (!releaseAttempt.ok) assert.equal(releaseAttempt.code, "SCRP_ACTOR_NOT_AUTHORIZED");
});

test("factory: error envelope helpers map codes to catalog entries", () => {
  assert.equal(scrpHttpStatusFor("SCRP_EGRESS_DENIED"), 403);
  assert.equal(scrpHttpStatusFor("SCRP_NOT_FOUND"), 404);
  const envelope = scrpError("SCRP_VERSION_IMMUTABLE", "version conflict", "cor_00000001");
  assert.equal(envelope.code, "SCRP_VERSION_IMMUTABLE");
  assert.equal(envelope.correlation_id, "cor_00000001");
});
