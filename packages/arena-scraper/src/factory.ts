import { computeCanonicalDigest } from "@arena/acquisition";
import type { ActorRef, EvidenceRecord } from "./primitives.js";
import {
  buildLifecycleAllows,
  buildStateIsTerminal,
  type BuildState,
  type BuildTransition,
  type GateResult,
  type ScraperBuild,
} from "./scraper-build.js";
import {
  computeScraperDefinitionDigest,
  scraperDefinitionSchema,
  type ScraperDefinition,
  type ScraperVersion,
} from "./scraper-definition.js";
import { classifyShapeIssues } from "./errors.js";
import {
  actorAllowed,
  computeBuildDigest,
  generateBuildPlan,
  runBuildGate,
  runDependencySourceLicenseReviewGate,
  runFixtureGate,
  runSourcePolicyBudgetGate,
  runStaticValidationGate,
  type FixtureRunReport,
  type GateName,
} from "./build-gates.js";
import type { ScrpErrorCode } from "./errors.js";

/**
 * AR2-017 — ScraperFactory service (issue #33; spec §4).
 *
 * Takes a ScraperDefinition (draft) through the full lifecycle:
 * draft -> static validation -> dependency/source/license review -> build ->
 * isolated test-fixture run -> source-policy and budget checks -> reviewed
 * release. Typed gate results at every transition; authorized actor,
 * timestamp and evidence on each; rejections are terminal with reason codes
 * (fail closed). Stores are in-memory (AR2-017 has no persistence WO) and
 * tenant-fenced with no existence oracle.
 */

export interface FixtureRunner {
  run(def: ScraperDefinition, buildPlan: string): Promise<FixtureRunReport>;
}

export interface ScraperFactoryConfig {
  nowIso: () => string;
  idFactory?: () => string;
  fixtureRunner?: FixtureRunner;
}

export type FactoryCommandResult =
  | { ok: true; build: ScraperBuild; replayed: boolean }
  | { ok: false; code: ScrpErrorCode; detail: string };

export type ReleaseResult =
  | { ok: true; version: ScraperVersion; replayed: boolean }
  | { ok: false; code: ScrpErrorCode; detail: string };

interface StoredBuild {
  build: ScraperBuild;
  definition: ScraperDefinition;
}

export class ScraperFactory {
  private readonly config: ScraperFactoryConfig;
  private readonly builds = new Map<string, StoredBuild>();
  private readonly versionsByDefinition = new Map<string, Map<string, ScraperVersion>>();
  private readonly versionsById = new Map<string, ScraperVersion>();
  /** Definition snapshot per released version (runs pin version + definition). */
  private readonly definitionOfVersion = new Map<string, ScraperDefinition>();
  private idCounter = 0;

  constructor(config: ScraperFactoryConfig) {
    this.config = config;
  }

  private nextId(prefix: string): string {
    if (this.config.idFactory) return this.config.idFactory();
    this.idCounter += 1;
    return `${prefix}_${String(this.idCounter).padStart(12, "0")}`;
  }

  /** Register a draft definition and open its build record in DRAFT. */
  startBuild(tenantId: string, actor: ActorRef, definitionInput: unknown): FactoryCommandResult {
    // Draft intake is SCHEMA-only: semantic/source-scope sanity is the STATIC
    // VALIDATION gate's job, so scope violations land in REJECTED_STATIC with
    // a typed reason (the full trust-boundary check stays checkScraperDefinition).
    const parsed = scraperDefinitionSchema.safeParse(definitionInput);
    if (!parsed.success) {
      return {
        ok: false,
        code: classifyShapeIssues(parsed.error.issues),
        detail: parsed.error.issues
          .map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.code}${issue.message ? ` — ${issue.message}` : ""}`)
          .slice(0, 8)
          .join("; "),
      };
    }
    const definition = parsed.data;
    if (definition.tenant_id !== tenantId) {
      return { ok: false, code: "SCRP_TENANT_MISMATCH", detail: "definition tenant does not match the calling tenant" };
    }
    const buildPlan = generateBuildPlan(definition);
    const build: ScraperBuild = {
      schema_version: "SCRP1.0",
      build_id: this.nextId("bld"),
      definition_id: definition.definition_id,
      tenant_id: tenantId,
      state: "DRAFT",
      created_at: this.config.nowIso(),
      transitions: [
        {
          from: "DRAFT",
          to: "DRAFT",
          gate: "STATIC_VALIDATION",
          actor,
          at: this.config.nowIso(),
          evidence: {
            evidence_id: this.nextId("evd"),
            kind: "VALIDATION_REPORT",
            digest: computeScraperDefinitionDigest(definition),
            summary: "draft registered (no gate has run yet)",
          },
          rejection: null,
        },
      ],
      build_digest: computeBuildDigest(definition, buildPlan),
      build_plan: buildPlan,
      rejection_reason: null,
    };
    this.builds.set(build.build_id, { build, definition });
    return { ok: true, build, replayed: false };
  }

  /** Run one lifecycle gate and apply its result (single writer: this method). */
  async runGate(buildId: string, tenantId: string, actor: ActorRef, gate: GateName): Promise<FactoryCommandResult> {
    const stored = this.builds.get(buildId);
    if (stored === undefined || stored.build.tenant_id !== tenantId) {
      return { ok: false, code: "SCRP_NOT_FOUND", detail: "build not visible in tenant scope" };
    }
    if (!actorAllowed(gate, actor)) {
      return { ok: false, code: "SCRP_ACTOR_NOT_AUTHORIZED", detail: `actor role ${actor.role} is not authorized for gate ${gate}` };
    }
    const { build, definition } = stored;
    const target = expectedTargetState(build.state, gate);
    if (target === null) {
      return { ok: false, code: "SCRP_BUILD_STATE_INVALID", detail: `gate ${gate} is not reachable from state ${build.state}` };
    }
    const gateResult = await this.evaluateGate(gate, build, definition);
    const nextState = gateResult.ok ? target : rejectionStateFor(gate);
    const transition = this.transition(build, gate, actor, gateResult, nextState);
    stored.build = {
      ...build,
      state: nextState,
      transitions: [...build.transitions, transition],
      rejection_reason: gateResult.ok ? null : { code: gateResult.code, detail: gateResult.detail },
    };
    if (!gateResult.ok) {
      return { ok: false, code: gateResult.code, detail: gateResult.detail };
    }
    return { ok: true, build: stored.build, replayed: false };
  }

  /** Reviewed release: create the immutable ScraperVersion (idempotent by digests). */
  async release(
    buildId: string,
    tenantId: string,
    actor: ActorRef,
    versionTag: string,
  ): Promise<ReleaseResult> {
    const stored = this.builds.get(buildId);
    if (stored === undefined || stored.build.tenant_id !== tenantId) {
      return { ok: false, code: "SCRP_NOT_FOUND", detail: "build not visible in tenant scope" };
    }
    const { build, definition } = stored;
    const definitionDigest = computeScraperDefinitionDigest(definition);
    // Immutability first: the same (definition, version) is a replay or a typed
    // conflict — decided by digests, independent of the current build state.
    const existing = this.versionsByDefinition.get(definition.definition_id)?.get(versionTag);
    if (existing !== undefined) {
      if (existing.definition_digest === definitionDigest && existing.build_digest === build.build_digest) {
        return { ok: true, version: existing, replayed: true };
      }
      return {
        ok: false,
        code: "SCRP_VERSION_IMMUTABLE",
        detail: `version ${versionTag} of ${definition.definition_id} already exists with different digests`,
      };
    }
    if (!actorAllowed("RELEASE_APPROVAL", actor)) {
      return {
        ok: false,
        code: "SCRP_ACTOR_NOT_AUTHORIZED",
        detail: `actor role ${actor.role} is not authorized for gate RELEASE_APPROVAL`,
      };
    }
    if (build.state !== "POLICY_CHECKED") {
      return {
        ok: false,
        code: "SCRP_BUILD_STATE_INVALID",
        detail: `release requires the POLICY_CHECKED state, build is ${build.state}`,
      };
    }
    const gateResult: GateResult = {
      ok: true,
      evidence: releaseEvidence(definition),
      detail: "release approved by an authorized RELEASER",
    };
    const transition = this.transition(build, "RELEASE_APPROVAL", actor, gateResult, "RELEASED");
    stored.build = {
      ...build,
      state: "RELEASED",
      transitions: [...build.transitions, transition],
    };
    const version: ScraperVersion = {
      schema_version: "SCRP1.0",
      version_id: this.nextId("scv"),
      definition_id: definition.definition_id,
      tenant_id: tenantId,
      version: versionTag,
      definition_digest: definitionDigest,
      build_digest: build.build_digest,
      dependency_lock_digest: computeCanonicalDigest(definition.dependency_lock),
      released_at: this.config.nowIso(),
      released_by: actor,
      release_evidence: stored.build.transitions
        .filter((t) => t.evidence !== null)
        .slice(-8)
        .map((t) => t.evidence),
    };
    let byDefinition = this.versionsByDefinition.get(definition.definition_id);
    if (byDefinition === undefined) {
      byDefinition = new Map();
      this.versionsByDefinition.set(definition.definition_id, byDefinition);
    }
    byDefinition.set(versionTag, version);
    this.versionsById.set(version.version_id, version);
    this.definitionOfVersion.set(version.version_id, definition);
    return { ok: true, version, replayed: false };
  }

  /** Tenant-scoped reads (cross-tenant and missing are indistinguishable). */
  findBuild(buildId: string, tenantId: string): ScraperBuild | null {
    const stored = this.builds.get(buildId);
    if (stored === undefined || stored.build.tenant_id !== tenantId) return null;
    return stored.build;
  }

  findDefinitionOfBuild(buildId: string, tenantId: string): ScraperDefinition | null {
    const stored = this.builds.get(buildId);
    if (stored === undefined || stored.build.tenant_id !== tenantId) return null;
    return stored.definition;
  }

  findVersion(versionId: string, tenantId: string): ScraperVersion | null {
    const version = this.versionsById.get(versionId);
    if (version === undefined || version.tenant_id !== tenantId) return null;
    return version;
  }

  findVersionByTag(definitionId: string, versionTag: string, tenantId: string): ScraperVersion | null {
    const version = this.versionsByDefinition.get(definitionId)?.get(versionTag) ?? null;
    if (version === null || version.tenant_id !== tenantId) return null;
    return version;
  }

  /** Definition snapshot pinned to a released version (tenant-fenced). */
  findDefinitionOfVersion(versionId: string, tenantId: string): ScraperDefinition | null {
    const version = this.versionsById.get(versionId);
    if (version === undefined || version.tenant_id !== tenantId) return null;
    return this.definitionOfVersion.get(versionId) ?? null;
  }

  private async evaluateGate(gate: GateName, build: ScraperBuild, definition: ScraperDefinition): Promise<GateResult> {
    switch (gate) {
      case "STATIC_VALIDATION":
        return runStaticValidationGate(definition);
      case "DEPENDENCY_SOURCE_LICENSE_REVIEW":
        return runDependencySourceLicenseReviewGate(definition);
      case "BUILD":
        return runBuildGate(definition, build.build_digest);
      case "FIXTURE_RUN": {
        const runner = this.config.fixtureRunner;
        if (runner === undefined) return runFixtureGate(definition, null);
        const report = await runner.run(definition, build.build_plan);
        return runFixtureGate(definition, report);
      }
      case "SOURCE_POLICY_BUDGET_CHECK":
        return runSourcePolicyBudgetGate(definition);
      case "RELEASE_APPROVAL":
        return {
          ok: true,
          evidence: releaseEvidence(definition),
          detail: "release approved by an authorized RELEASER",
        };
    }
  }

  private transition(
    build: ScraperBuild,
    gate: GateName,
    actor: ActorRef,
    gateResult: GateResult,
    nextState: BuildState,
  ): BuildTransition {
    const evidence: EvidenceRecord = gateResult.ok
      ? gateResult.evidence
      : {
          evidence_id: this.nextId("evd"),
          kind: "POLICY_CHECK_REPORT",
          digest: computeCanonicalDigest({ gate, detail: gateResult.detail }),
          summary: `gate ${gate} rejected: ${gateResult.detail}`.slice(0, 2000),
        };
    return {
      from: build.state,
      to: nextState,
      gate,
      actor,
      at: this.config.nowIso(),
      evidence,
      rejection: gateResult.ok ? null : { code: gateResult.code, detail: gateResult.detail },
    };
  }
}

function expectedTargetState(from: BuildState, gate: GateName): BuildState | null {
  const pairs: Record<GateName, [BuildState, BuildState]> = {
    STATIC_VALIDATION: ["DRAFT", "STATIC_VALIDATED"],
    DEPENDENCY_SOURCE_LICENSE_REVIEW: ["STATIC_VALIDATED", "REVIEWED"],
    BUILD: ["REVIEWED", "BUILT"],
    FIXTURE_RUN: ["BUILT", "FIXTURE_TESTED"],
    SOURCE_POLICY_BUDGET_CHECK: ["FIXTURE_TESTED", "POLICY_CHECKED"],
    RELEASE_APPROVAL: ["POLICY_CHECKED", "RELEASED"],
  };
  const pair = pairs[gate];
  if (pair === undefined) return null;
  const [requiredFrom, target] = pair;
  return buildLifecycleAllows(from, target) && from === requiredFrom ? target : null;
}

function rejectionStateFor(gate: GateName): BuildState {
  switch (gate) {
    case "STATIC_VALIDATION":
      return "REJECTED_STATIC";
    case "DEPENDENCY_SOURCE_LICENSE_REVIEW":
      return "REJECTED_REVIEW";
    case "BUILD":
      return "REJECTED_BUILD";
    case "FIXTURE_RUN":
      return "REJECTED_FIXTURE";
    case "SOURCE_POLICY_BUDGET_CHECK":
      return "REJECTED_POLICY";
    case "RELEASE_APPROVAL":
      return "POLICY_CHECKED"; // release approval failure is not a build rejection
  }
}

function releaseEvidence(definition: ScraperDefinition): EvidenceRecord {
  return {
    evidence_id: `evd_${computeCanonicalDigest({ release: definition.definition_id }).slice(0, 24)}`,
    kind: "RELEASE_APPROVAL",
    digest: computeScraperDefinitionDigest(definition),
    summary: `release approval for definition ${definition.definition_id}`,
  };
}

export { buildStateIsTerminal };
