import { z } from "zod";
import {
  arenaIdSchema,
  digestSchema,
  isoTimestampSchema,
  retentionProfileSchema,
  semverSchema,
} from "@arena/contracts";
import { sourceRightsPostureSchema } from "@arena/acquisition";
import { computeCanonicalDigest } from "@arena/acquisition";
import {
  SCRAPER_SCHEMA_FAMILY,
  actorRefSchema,
  boundedText,
  domainAllowEntrySchema,
  evidenceRecordSchema,
  nonEmptyMedium,
  nonEmptyShort,
  portSchema,
  schemaReferenceSchema,
  seedUrlSchema,
  type SemanticIssue,
} from "./primitives.js";
import { classifyShapeIssues, type ScrpErrorCode } from "./errors.js";

/**
 * AR2-017 — ScraperDefinition / ScraperVersion (issue #33; spec §2/§4).
 *
 * A definition is a DECLARATIVE acquisition brief: bounded source/domain scope,
 * approved acquisition method, inputs, output schema reference, build source
 * and digest, runtime requirements, resource/egress rules, dependency lock,
 * rights/safety profile, robots/rate policy and retention class.
 *
 * Safety posture is structural: the bypass fields are z.literal(false), so a
 * definition that declares CAPTCHA/paywall/login/access-control bypass, stealth
 * fingerprint evasion or proxy-rotation-to-evade does not parse at all.
 */

export const httpSchemeSchema = z.enum(["http", "https"]);

/** Approved acquisition methods (the vocabulary IS the policy surface). */
export const acquisitionMethodSchema = z.enum(["HTTP_CRAWL", "API_CONNECTOR"]);

export const sourceScopeSchema = z
  .object({
    schemes: z.array(httpSchemeSchema).min(1).max(2),
    domains: z.array(domainAllowEntrySchema).min(1).max(64),
    /** 80/443 always permitted; extras must be declared explicitly. */
    ports: z.array(portSchema).min(1).max(16),
  })
  .strict();

export const sourceSafetyProfileSchema = z
  .object({
    authentication_bypass: z.literal(false),
    captcha_bypass: z.literal(false),
    paywall_bypass: z.literal(false),
    access_control_bypass: z.literal(false),
    stealth_fingerprint_evasion: z.literal(false),
    proxy_rotation_evasion: z.literal(false),
    /** Default-deny login-walled/private-data sources (policy gate rejects true). */
    source_requires_authentication: z.boolean(),
    private_data_sources: z.literal(false),
    notes: boundedText.nullable(),
  })
  .strict();

export const rightsProfileSchema = z
  .object({
    source_rights_posture: sourceRightsPostureSchema,
    license_assessment: nonEmptyMedium,
    rights_evidence: z.array(nonEmptyMedium).max(16),
  })
  .strict();

export const robotsPolicySchema = z
  .object({
    respect_robots: z.literal(true),
    user_agent: nonEmptyShort,
    crawl_delay_ms: z.number().int().min(0),
    per_domain_request_limit: z.number().int().min(1).max(100000),
  })
  .strict();

export const resourcePolicySchema = z
  .object({
    max_pages: z.number().int().min(1).max(100000),
    max_items: z.number().int().min(1).max(1000000),
    max_bytes: z.number().int().min(1),
    max_depth: z.number().int().min(1).max(16),
    wall_time_seconds: z.number().int().min(1).max(86400),
  })
  .strict();

export const runtimeRequirementsSchema = z
  .object({
    engine: z.literal("crawlee-basic-http"),
    runtime: z.literal("node24"),
    crawlee_version: nonEmptyShort,
    max_concurrency: z.number().int().min(1).max(8),
  })
  .strict();

export const dependencyLockEntrySchema = z
  .object({
    name: nonEmptyShort,
    version: nonEmptyShort,
    license: nonEmptyShort,
    integrity: nonEmptyShort,
  })
  .strict();

export const buildSourceSchema = z
  .object({
    origin: z.enum(["LLM_GENERATED", "HUMAN_AUTHORED"]),
    generator_ref: nonEmptyMedium,
    source_digest: digestSchema,
  })
  .strict();

export const definitionInputSchema = z
  .object({
    name: nonEmptyShort,
    required: z.boolean(),
    schema_ref: schemaReferenceSchema,
  })
  .strict();

export const scraperDefinitionSchema = z
  .object({
    schema_version: z.literal(SCRAPER_SCHEMA_FAMILY),
    definition_id: arenaIdSchema,
    tenant_id: arenaIdSchema,
    name: nonEmptyShort,
    description: nonEmptyMedium,
    source_scope: sourceScopeSchema,
    acquisition_method: acquisitionMethodSchema,
    inputs: z.array(definitionInputSchema).max(32),
    seeds: z.array(seedUrlSchema).min(1).max(64),
    output_schema: schemaReferenceSchema,
    build_source: buildSourceSchema,
    runtime_requirements: runtimeRequirementsSchema,
    dependency_lock: z.array(dependencyLockEntrySchema).max(64),
    resource_policy: resourcePolicySchema,
    safety_profile: sourceSafetyProfileSchema,
    rights_profile: rightsProfileSchema,
    robots_policy: robotsPolicySchema,
    retention_class: retentionProfileSchema,
  })
  .strict();

export type ScraperDefinition = z.infer<typeof scraperDefinitionSchema>;

export type ScraperDefinitionCheck =
  | { ok: true; definition: ScraperDefinition }
  | { ok: false; code: ScrpErrorCode; issues: SemanticIssue[] };

/** Trust-boundary entry check: strict schema + typed error precedence. */
export function checkScraperDefinition(input: unknown): ScraperDefinitionCheck {
  const parsed = scraperDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: classifyShapeIssues(parsed.error.issues),
      issues: parsed.error.issues.map((issue) => ({
        field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
        rule: `${issue.code}${issue.message ? ` — ${issue.message}` : ""}`,
      })),
    };
  }
  const issues = validateScraperDefinitionSemantics(parsed.data);
  if (issues.length > 0) {
    return { ok: false, code: "SCRP_VALIDATION_FAILED", issues };
  }
  return { ok: true, definition: parsed.data };
}

/** Semantic validation: seeds within scope, rights posture shape, output schema present. */
export function validateScraperDefinitionSemantics(def: ScraperDefinition): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  for (const seed of def.seeds) {
    const seedIssue = seedWithinScope(seed, def);
    if (seedIssue) issues.push(seedIssue);
  }
  if (def.safety_profile.source_requires_authentication) {
    issues.push({
      field: "safety_profile.source_requires_authentication",
      rule: "login-walled sources are default-deny — a source requiring authentication is rejected",
    });
  }
  if (def.rights_profile.source_rights_posture === "PROHIBITED") {
    issues.push({ field: "rights_profile.source_rights_posture", rule: "PROHIBITED posture cannot be released" });
  }
  if (def.runtime_requirements.crawlee_version !== "3.18.2") {
    issues.push({
      field: "runtime_requirements.crawlee_version",
      rule: "crawlee substrate must be the pinned version 3.18.2 (supply-chain lock)",
    });
  }
  if (def.output_schema.schema_version === "") {
    issues.push({ field: "output_schema.schema_version", rule: "output schema reference must be versioned" });
  }
  return issues;
}

/** Seed URL must fit the declared source scope (scheme + domain + port). */
export function seedWithinScope(seed: string, def: ScraperDefinition): SemanticIssue | null {
  try {
    const url = new URL(seed);
    const { hostname, port, protocol } = url;
    const scheme = protocol.replace(":", "");
    if (!def.source_scope.schemes.includes(scheme as "http" | "https")) {
      return { field: "seeds", rule: `seed ${seed} uses scheme ${scheme} outside the declared scope` };
    }
    if (!domainMatches(hostname, def.source_scope.domains)) {
      return { field: "seeds", rule: `seed ${seed} targets domain ${hostname} outside the declared scope` };
    }
    const portNumber = port === "" ? (scheme === "https" ? 443 : 80) : Number.parseInt(port, 10);
    if (!def.source_scope.ports.includes(portNumber)) {
      return { field: "seeds", rule: `seed ${seed} uses port ${portNumber} outside the declared scope` };
    }
    return null;
  } catch {
    return { field: "seeds", rule: `seed ${seed} is not a parsable absolute URL` };
  }
}

/** Exact host or leftmost-wildcard suffix match ("*.example.org"). */
export function domainMatches(hostname: string, allowed: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  for (const entry of allowed) {
    const rule = entry.toLowerCase();
    if (rule.startsWith("*.")) {
      const suffix = rule.slice(1); // ".example.org"
      if (host.endsWith(suffix) && !host.slice(0, -suffix.length).includes(".")) return true;
    } else if (host === rule) {
      return true;
    }
  }
  return false;
}

/** Canonical digest over the whole definition (immutability anchor). */
export function computeScraperDefinitionDigest(def: ScraperDefinition): string {
  return computeCanonicalDigest(def);
}

/**
 * ScraperVersion — an IMMUTABLE released version of a definition.
 * Version + digests are pinned per run; releasing the same (definition_id,
 * version) again with different digests is a typed immutability violation.
 */
export const scraperVersionSchema = z
  .object({
    schema_version: z.literal(SCRAPER_SCHEMA_FAMILY),
    version_id: arenaIdSchema,
    definition_id: arenaIdSchema,
    tenant_id: arenaIdSchema,
    version: semverSchema,
    definition_digest: digestSchema,
    build_digest: digestSchema,
    dependency_lock_digest: digestSchema,
    released_at: isoTimestampSchema,
    released_by: actorRefSchema,
    release_evidence: z.array(evidenceRecordSchema).min(1).max(32),
  })
  .strict();

export type ScraperVersion = z.infer<typeof scraperVersionSchema>;

export type ScraperVersionCheck =
  | { ok: true; version: ScraperVersion }
  | { ok: false; code: ScrpErrorCode; issues: SemanticIssue[] };

export function checkScraperVersion(input: unknown): ScraperVersionCheck {
  const parsed = scraperVersionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: classifyShapeIssues(parsed.error.issues),
      issues: parsed.error.issues.map((issue) => ({
        field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
        rule: `${issue.code}${issue.message ? ` — ${issue.message}` : ""}`,
      })),
    };
  }
  return { ok: true, version: parsed.data };
}

/** A reused scraper cannot silently change behavior when its version changes. */
export const SCRAPER_VERSION_IMMUTABILITY_RULE =
  "a released ScraperVersion is immutable: (definition_id, version) maps to fixed definition/build/dependency digests; " +
  "any behavioral change requires a new version record, and runs pin the exact version + digests they executed";
