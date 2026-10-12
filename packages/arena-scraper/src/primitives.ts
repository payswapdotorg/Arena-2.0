import { z } from "zod";
import { arenaIdSchema } from "@arena/contracts";

/**
 * AR2-017 — SCRP1.0 family local primitives (issue #33).
 *
 * Version-family decision (mirrors AR2-016): SCRP1.0 is a NEW versioned
 * contract family. The frozen CF1.0 corpus (@arena/contracts) and the ACQ1.0
 * family (@arena/acquisition) are NEVER edited or re-exported-modified from
 * here; the families link only through immutable correlation/causation IDs and
 * reuse of each other's PUBLIC exports (arenaIdSchema, sourceRightsPostureSchema,
 * canonicalJsonStringify/computeCanonicalDigest). Anything not public is
 * re-declared locally, shape-identical, exactly like arena-acquisition did
 * against arena-contracts.
 */

/** SCRP1.0 — the versioned schema family id for the scraper plane (AR2-017). */
export const SCRAPER_SCHEMA_FAMILY = "SCRP1.0" as const;

/** Non-empty short text (names, codes). */
export const nonEmptyShort = z.string().min(1).max(200);

/** Non-empty medium text (descriptions, rationale). */
export const nonEmptyMedium = z.string().min(1).max(2000);

/** Free-form bounded text (may be empty; summaries, notes). */
export const boundedText = z.string().max(2000);

/** TCP/UDP port (1..65535). */
export const portSchema = z.number().int().min(1).max(65535);

/** Milliseconds (>= 0). */
export const nonNegativeMs = z.number().int().min(0);

/**
 * Schema reference (local shape-identical copy — the ACQ1.0 primitive is not
 * part of @arena/acquisition's public contract surface).
 */
export const schemaReferenceSchema = z
  .object({
    schema_id: arenaIdSchema,
    schema_version: nonEmptyShort,
  })
  .strict();

export type SchemaReference = z.infer<typeof schemaReferenceSchema>;

/** Domain allowlist entry: exact host ("example.org") or leftmost-wildcard ("*.example.org"). */
export const domainAllowEntrySchema = z
  .string()
  .regex(
    /^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
    "domain entry must be a lowercase hostname, optionally with a leading *. wildcard label",
  )
  .max(253);

export type DomainAllowEntry = z.infer<typeof domainAllowEntrySchema>;

/** Hostname form accepted for connector approval checks (no scheme, no path). */
export const hostnameSchema = z
  .string()
  .regex(/^[a-z0-9.-]+$/i, "hostname must be dns-form without scheme/path")
  .max(253);

/** Actor reference (authorized transitions carry an actor + role). */
export const actorRefSchema = z
  .object({
    actor_id: arenaIdSchema,
    role: z.enum(["AUTHOR", "REVIEWER", "RELEASER", "OPERATOR"]),
  })
  .strict();

export type ActorRef = z.infer<typeof actorRefSchema>;

/** Evidence record attached to every factory/run transition. */
export const evidenceRecordSchema = z
  .object({
    evidence_id: arenaIdSchema,
    kind: z.enum([
      "VALIDATION_REPORT",
      "REVIEW_DECISION",
      "BUILD_PLAN",
      "FIXTURE_RUN_REPORT",
      "POLICY_CHECK_REPORT",
      "RELEASE_APPROVAL",
      "RUN_EVENT",
    ]),
    digest: z.string().regex(/^[a-f0-9]{64}$/, "evidence digest must be lowercase sha256 hex"),
    summary: boundedText,
  })
  .strict();

export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>;

/** Cross-field semantic issue (house style: field + rule). */
export interface SemanticIssue {
  field: string;
  rule: string;
}

/** URL shape used by definitions/seeds (http/https only; details validated by the egress guard). */
export const seedUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => value.startsWith("http://") || value.startsWith("https://"), {
    message: "seed URLs must be http(s)",
  });

/** Deterministic semver comparison (local counterpart of the ACQ1.0 helper). */
export function compareSemver(a: string, b: string): number {
  const strip = (v: string) => v.split("-")[0] ?? v;
  const pa = strip(a)
    .split(".")
    .map((n) => Number.parseInt(n, 10));
  const pb = strip(b)
    .split(".")
    .map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.localeCompare(b);
}

/** The pinned Crawlee substrate version this runtime is built against. */
export const CRAWLEE_PINNED_VERSION = "3.18.2" as const;

/** Method/version recorded in dataset provenance. */
export const SCRAPER_ENGINE_VERSION = "SCRP-ENGINE1.0" as const;
