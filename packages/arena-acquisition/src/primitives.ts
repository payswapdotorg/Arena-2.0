import { z } from "zod";
import { arenaIdSchema } from "@arena/contracts";

/**
 * AR2-016 — ACQ1.0 family local primitives.
 *
 * The frozen CF1.0 public surface (packages/arena-contracts/src/contract.ts) does
 * not export its short/medium text schemas, so — exactly like arena-matching
 * (AR2-008) — this package declares local, shape-identical versions instead of
 * deep-importing module internals. Frozen primitives that ARE public
 * (arenaIdSchema, isoTimestampSchema, digestSchema, semverSchema,
 * riskTierSchema, privacyProfileSchema, ...) are imported from @arena/contracts.
 */

/** ACQ1.0 — the versioned schema family id for capability acquisition (ACR-0002). */
export const ACQUISITION_SCHEMA_FAMILY = "ACQ1.0" as const;

/** Non-empty short text (names, codes). */
export const nonEmptyShort = z.string().min(1).max(200);

/** Non-empty medium text (descriptions, rationale). */
export const nonEmptyMedium = z.string().min(1).max(2000);

/** Region code (provider availability / data-residency declarations). */
export const regionCodeSchema = z
  .string()
  .regex(/^[A-Z]{2,8}$/, "region code must match ^[A-Z]{2,8}$");

/**
 * Delivery/use kinds for acquired data (spec §7 preferred order; FINE_TUNING is
 * never the default and is separately policy-gated).
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

/** Schema reference (shape aligned with CF1.0 result_schema references). */
export const schemaReferenceSchema = z
  .object({
    schema_id: arenaIdSchema,
    schema_version: nonEmptyShort,
  })
  .strict();

export type SchemaReference = z.infer<typeof schemaReferenceSchema>;

/**
 * Capability level vocabulary — aligned with AR2-008 CAPABILITY_LEVEL_ORDER
 * (local copy: this module only requires arena-contracts, per its manifest).
 */
export const CAPABILITY_LEVEL_ORDER = [
  "junior",
  "mid",
  "senior",
  "principal",
  "distinguished",
] as const;

/** Level satisfies minimum; unknown level words fail closed (exact match only). */
export function capabilityLevelSatisfies(level: string, minimum: string): boolean {
  const order = CAPABILITY_LEVEL_ORDER as readonly string[];
  const li = order.indexOf(level);
  const mi = order.indexOf(minimum);
  if (li === -1 || mi === -1) return level === minimum;
  return li >= mi;
}

/** Risk tier order (CF1.0 riskTierSchema vocabulary). */
export const RISK_TIER_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

/** Request risk tier is within the provider's declared appetite. */
export function riskTierWithin(requestTier: string, maxAllowedTier: string): boolean {
  const order = RISK_TIER_ORDER as readonly string[];
  const ri = order.indexOf(requestTier);
  const pi = order.indexOf(maxAllowedTier);
  if (ri === -1 || pi === -1) return false;
  return ri <= pi;
}

/** Deterministic semver comparison: >0 when a>b, <0 when a<b, 0 when equal. */
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

/** Cross-field semantic issue (house style: field + rule). */
export interface SemanticIssue {
  field: string;
  rule: string;
}
