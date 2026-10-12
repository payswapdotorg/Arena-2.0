import { computeCanonicalDigest } from "@arena/acquisition";
import type { ActorRef, EvidenceRecord } from "./primitives.js";
import type { GateResult } from "./scraper-build.js";
import {
  checkScraperDefinition,
  computeScraperDefinitionDigest,
  domainMatches,
  seedWithinScope,
  type ScraperDefinition,
} from "./scraper-definition.js";

/**
 * AR2-017 — Factory gate functions (issue #33; spec §4).
 *
 * Pure, typed gate results for every lifecycle transition. Gates never mutate
 * state: the ScraperFactory service applies a gate result to the build record
 * (with actor + timestamp + evidence), keeping single-writer discipline.
 */

/** Licenses acceptable for runtime dependencies (fail closed on anything else). */
export const APPROVED_DEPENDENCY_LICENSES: ReadonlySet<string> = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "CC0-1.0",
  "Python-2.0",
]);

/** Roles allowed to operate each gate (separation of duties). */
export type GateName =
  | "STATIC_VALIDATION"
  | "DEPENDENCY_SOURCE_LICENSE_REVIEW"
  | "BUILD"
  | "FIXTURE_RUN"
  | "SOURCE_POLICY_BUDGET_CHECK"
  | "RELEASE_APPROVAL";

export const GATE_ROLES: Record<GateName, readonly ActorRef["role"][]> = {
  STATIC_VALIDATION: ["AUTHOR", "OPERATOR"],
  DEPENDENCY_SOURCE_LICENSE_REVIEW: ["REVIEWER", "OPERATOR"],
  BUILD: ["AUTHOR", "OPERATOR"],
  FIXTURE_RUN: ["AUTHOR", "OPERATOR"],
  SOURCE_POLICY_BUDGET_CHECK: ["AUTHOR", "REVIEWER", "OPERATOR"],
  RELEASE_APPROVAL: ["RELEASER"],
};

export function actorAllowed(gate: GateName, actor: ActorRef): boolean {
  return GATE_ROLES[gate].includes(actor.role);
}

function evidence(kind: EvidenceRecord["kind"], detail: string, idSeed: string): EvidenceRecord {
  return {
    evidence_id: `evd_${computeCanonicalDigest({ seed: idSeed, detail: kind }).slice(0, 24)}`,
    kind,
    digest: computeCanonicalDigest({ gate: kind, detail }),
    summary: detail.slice(0, 2000),
  };
}

/**
 * Static validation: zod schema validation + source-scope sanity (scheme
 * allowlist http/https, domain allowlist shape, port allowlist 80/443 +
 * explicit extras) + output-schema-reference check (spec §4).
 */
export function runStaticValidationGate(definition: unknown): GateResult {
  const check = checkScraperDefinition(definition);
  if (!check.ok) {
    const first = check.issues[0] ?? { field: "(root)", rule: "payload failed schema validation" };
    return {
      ok: false,
      code: "SCRP_BUILD_GATE_REJECTED",
      detail: `static validation failed at ${first.field}: ${first.rule}`,
    };
  }
  const def = check.definition;
  const issues = [];
  for (const seed of def.seeds) {
    const issue = seedWithinScope(seed, def);
    if (issue) issues.push(issue);
  }
  if (def.output_schema.schema_id === "" ) issues.push({ field: "output_schema", rule: "output schema reference is required" });
  if (def.source_scope.ports.length === 0) issues.push({ field: "source_scope.ports", rule: "port allowlist must not be empty" });
  if (issues.length > 0) {
    return {
      ok: false,
      code: "SCRP_BUILD_GATE_REJECTED",
      detail: issues
        .map((issue) => `${issue.field}: ${issue.rule}`)
        .slice(0, 8)
        .join("; "),
    };
  }
  const digest = computeScraperDefinitionDigest(def);
  return {
    ok: true,
    evidence: evidence("VALIDATION_REPORT", `static validation passed; definition digest ${digest}`, digest),
    detail: `definition ${def.definition_id} passed static validation (scope, schemes, ports, output schema)`,
  };
}

/**
 * Dependency/source/license review: rights posture must be PERMITTED or
 * RESTRICTED with recorded evidence (UNKNOWN/PROHIBITED fail closed); every
 * dependency license must be in the approved set (unknown licenses fail
 * closed); the build source must carry a digest.
 */
export function runDependencySourceLicenseReviewGate(def: ScraperDefinition): GateResult {
  const posture = def.rights_profile.source_rights_posture;
  if (posture === "UNKNOWN" || posture === "PROHIBITED") {
    return {
      ok: false,
      code: "SCRP_LICENSE_REVIEW_REJECTED",
      detail: `source rights posture ${posture} fails the license review (fail closed)`,
    };
  }
  if (posture === "RESTRICTED" && def.rights_profile.rights_evidence.length === 0) {
    return {
      ok: false,
      code: "SCRP_BUILD_GATE_REJECTED",
      detail: "RESTRICTED posture requires recorded rights evidence",
    };
  }
  for (const dependency of def.dependency_lock) {
    if (!APPROVED_DEPENDENCY_LICENSES.has(dependency.license)) {
      return {
        ok: false,
        code: "SCRP_LICENSE_REVIEW_REJECTED",
        detail: `dependency ${dependency.name}@${dependency.version} carries unapproved license ${dependency.license}`,
      };
    }
  }
  if (def.build_source.source_digest.length !== 64) {
    return {
      ok: false,
      code: "SCRP_BUILD_GATE_REJECTED",
      detail: "build source digest must be a sha256 hex digest",
    };
  }
  return {
    ok: true,
    evidence: evidence(
      "REVIEW_DECISION",
      `rights posture ${posture}; ${def.dependency_lock.length} dependency license(s) approved`,
      computeScraperDefinitionDigest(def),
    ),
    detail: "dependency/source/license review passed",
  };
}

/**
 * Build gate: recompute the deterministic build plan and verify the digest
 * covers definition + generated build source + dependency lock (spec §4).
 */
export function runBuildGate(def: ScraperDefinition, expectedBuildDigest: string): GateResult {
  const plan = generateBuildPlan(def);
  const digest = computeBuildDigest(def, plan);
  if (digest !== expectedBuildDigest) {
    return {
      ok: false,
      code: "SCRP_BUILD_GATE_REJECTED",
      detail: "build digest mismatch: the recorded build no longer matches definition + plan + dependency lock",
    };
  }
  return {
    ok: true,
    evidence: evidence("BUILD_PLAN", `build plan regenerated; digest ${digest}`, digest),
    detail: "build plan verified against the pinned definition and dependency lock",
  };
}

/** Isolated test-fixture run report produced by the injected harness. */
export interface FixtureRunReport {
  passed: boolean;
  summary: string;
}

export function runFixtureGate(def: ScraperDefinition, report: FixtureRunReport | null): GateResult {
  if (report === null) {
    return {
      ok: false,
      code: "SCRP_BUILD_GATE_REJECTED",
      detail: "no isolated test-fixture runner is configured (fail closed)",
    };
  }
  if (!report.passed) {
    return {
      ok: false,
      code: "SCRP_BUILD_GATE_REJECTED",
      detail: `isolated test-fixture run failed: ${report.summary}`,
    };
  }
  return {
    ok: true,
    evidence: evidence("FIXTURE_RUN_REPORT", report.summary, computeScraperDefinitionDigest(def)),
    detail: "isolated test-fixture run passed",
  };
}

/**
 * Source-policy and budget checks: robots policy must respect robots with a
 * declared UA/delay/per-domain limit; resource policy must be self-consistent
 * (bytes cap plausibly covers the page budget; wall time bounded).
 */
export function runSourcePolicyBudgetGate(def: ScraperDefinition): GateResult {
  if (def.robots_policy.crawl_delay_ms < 0 || def.robots_policy.per_domain_request_limit < 1) {
    return {
      ok: false,
      code: "SCRP_SOURCE_POLICY_REJECTED",
      detail: "robots policy is not viable (crawl delay negative or per-domain limit missing)",
    };
  }
  if (def.resource_policy.max_bytes < def.resource_policy.max_pages) {
    return {
      ok: false,
      code: "SCRP_BUDGET_CHECK_FAILED",
      detail: "byte budget cannot plausibly cover the page budget",
    };
  }
  if (def.resource_policy.wall_time_seconds > 86400) {
    return {
      ok: false,
      code: "SCRP_BUDGET_CHECK_FAILED",
      detail: "wall time exceeds the 24h bound",
    };
  }
  if (def.safety_profile.source_requires_authentication) {
    return {
      ok: false,
      code: "SCRP_SOURCE_POLICY_REJECTED",
      detail: "login-walled source declared — default-deny (fail closed)",
    };
  }
  return {
    ok: true,
    evidence: evidence("POLICY_CHECK_REPORT", "source policy and budget checks passed", computeScraperDefinitionDigest(def)),
    detail: "source-policy and budget checks passed",
  };
}

/** Deterministic build-plan generation (a data artifact, never executed). */
export function generateBuildPlan(def: ScraperDefinition): string {
  return JSON.stringify({
    artifact_kind: "arena-scraper-build-plan",
    trusted: false,
    note: "generated scraper code is a BUILD ARTIFACT and is never trusted/executed (LLM origin)",
    definition_digest: computeScraperDefinitionDigest(def),
    seeds: def.seeds,
    source_scope: def.source_scope,
    acquisition_method: def.acquisition_method,
    inputs: def.inputs,
    output_schema: def.output_schema,
    runtime_requirements: def.runtime_requirements,
    dependency_lock: def.dependency_lock,
    resource_policy: def.resource_policy,
    robots_policy: def.robots_policy,
    retention_class: def.retention_class,
  });
}

/** Digest covering definition + generated build source + dependency lock. */
export function computeBuildDigest(def: ScraperDefinition, buildPlan: string): string {
  return computeCanonicalDigest({
    definition: computeScraperDefinitionDigest(def),
    build_plan: buildPlan,
    dependency_lock: def.dependency_lock,
  });
}

/** Scope sanity helper shared with tests: host against the domain allowlist. */
export function hostInScope(host: string, def: ScraperDefinition): boolean {
  return domainMatches(host, def.source_scope.domains);
}
