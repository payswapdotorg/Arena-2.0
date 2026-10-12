import { z } from "zod";
import { arenaIdSchema } from "@arena/contracts";

/**
 * AR2-018 — UPG1.0 family local primitives (issue #34).
 *
 * Version-family decision (mirrors AR2-016/AR2-017): UPG1.0 is a NEW versioned
 * contract family for the evidence-to-capability plane. The frozen CF1.0 corpus
 * (@arena/contracts), ACQ1.0 (@arena/acquisition) and SCRP1.0 (@arena/scraper)
 * are NEVER edited or re-exported-modified from here; the families link only
 * through immutable correlation/causation IDs and reuse of each other's PUBLIC
 * exports (arenaIdSchema, canonicalJsonStringify/computeCanonicalDigest,
 * DatasetArtifact, RightsGrantRegistry, ValidatorRegistry, ...). Anything not
 * public is re-declared locally, shape-identical, exactly like arena-scraper
 * did against arena-acquisition.
 */

/** UPG1.0 — the versioned schema family id for the capability-upgrade plane. */
export const UPGRADE_SCHEMA_FAMILY = "UPG1.0" as const;

/** Non-empty short text (names, codes). */
export const nonEmptyShort = z.string().min(1).max(200);

/** Non-empty medium text (descriptions, rationale). */
export const nonEmptyMedium = z.string().min(1).max(2000);

/** Free-form bounded text (may be empty; summaries, notes). */
export const boundedText = z.string().max(2000);

/**
 * Delivery/use kinds — local shape-identical copy of the ACQ1.0 primitive
 * (not part of @arena/acquisition's public surface; spec §7 preferred order).
 */
export const useKindSchema = z.enum([
  "RETRIEVAL",
  "INDEX",
  "KNOWLEDGE_PACK",
  "TOOL_ADAPTER",
  "EXAMPLES_RULES",
  "FINE_TUNING",
]);

export type UseKind = z.infer<typeof useKindSchema>;

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

/**
 * Actor reference — local extension of the SCRP1.0 actor shape adding
 * CLIENT_AGENT (the adopting client agent identity in this plane).
 */
export const actorRefSchema = z
  .object({
    actor_id: arenaIdSchema,
    role: z.enum(["AUTHOR", "REVIEWER", "RELEASER", "OPERATOR", "CLIENT_AGENT"]),
  })
  .strict();

export type ActorRef = z.infer<typeof actorRefSchema>;

/** Cross-field semantic issue (house style: field + rule). */
export interface SemanticIssue {
  field: string;
  rule: string;
}

/** Family-separation rule (same discipline as SCRP1.0's, recorded on export). */
export const UPG_FAMILY_SEPARATION_RULE =
  "UPG1.0 is a separate versioned contract family: frozen CF1.0/ACQ1.0/SCRP1.0 schemas are never " +
  "edited, extended or re-exported-modified from @arena/upgrade; the families link only through " +
  "immutable correlation/causation IDs and reuse of public exports, and any shared-envelope change " +
  "requires a new ACR with an explicit migration plan";
