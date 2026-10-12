import { z } from "zod";
import { arenaIdSchema, digestSchema, isoTimestampSchema } from "@arena/contracts";
import {
  SCRAPER_SCHEMA_FAMILY,
  actorRefSchema,
  evidenceRecordSchema,
  nonEmptyMedium,
  type SemanticIssue,
} from "./primitives.js";
import { classifyShapeIssues, type ScrpErrorCode } from "./errors.js";

/**
 * AR2-017 — ScraperBuild lifecycle record (issue #33; spec §4).
 *
 * draft -> static validation -> dependency/source/license review -> build ->
 * isolated test-fixture run -> source-policy and budget checks -> reviewed
 * release. Every transition carries an authorized actor, timestamp and
 * evidence record. Rejections are TERMINAL states with reason codes
 * (fail closed) — a rejected build is never partially released.
 */

export const buildStateSchema = z.enum([
  "DRAFT",
  "STATIC_VALIDATED",
  "REVIEWED",
  "BUILT",
  "FIXTURE_TESTED",
  "POLICY_CHECKED",
  "RELEASED",
  // terminal rejections (reason codes in the record)
  "REJECTED_STATIC",
  "REJECTED_REVIEW",
  "REJECTED_BUILD",
  "REJECTED_FIXTURE",
  "REJECTED_POLICY",
]);

export type BuildState = z.infer<typeof buildStateSchema>;

export const buildTransitionSchema = z
  .object({
    from: buildStateSchema,
    to: buildStateSchema,
    gate: z.enum([
      "STATIC_VALIDATION",
      "DEPENDENCY_SOURCE_LICENSE_REVIEW",
      "BUILD",
      "FIXTURE_RUN",
      "SOURCE_POLICY_BUDGET_CHECK",
      "RELEASE_APPROVAL",
    ]),
    actor: actorRefSchema,
    at: isoTimestampSchema,
    evidence: evidenceRecordSchema,
    /** Terminal rejection reason (typed SCRP code + detail). */
    rejection: z
      .object({ code: z.string().min(1).max(64), detail: nonEmptyMedium })
      .strict()
      .nullable(),
  })
  .strict();

export type BuildTransition = z.infer<typeof buildTransitionSchema>;

export const scraperBuildSchema = z
  .object({
    schema_version: z.literal(SCRAPER_SCHEMA_FAMILY),
    build_id: arenaIdSchema,
    definition_id: arenaIdSchema,
    tenant_id: arenaIdSchema,
    state: buildStateSchema,
    created_at: isoTimestampSchema,
    transitions: z.array(buildTransitionSchema).max(64),
    /** Digest covering definition + generated build plan + dependency lock. */
    build_digest: digestSchema,
    /** Generated scraper build artifact — DATA, never executed or trusted. */
    build_plan: z.string().min(1).max(65536),
    rejection_reason: z
      .object({ code: z.string().min(1).max(64), detail: nonEmptyMedium })
      .strict()
      .nullable(),
  })
  .strict();

export type ScraperBuild = z.infer<typeof scraperBuildSchema>;

export type ScraperBuildCheck =
  | { ok: true; build: ScraperBuild }
  | { ok: false; code: ScrpErrorCode; issues: SemanticIssue[] };

export function checkScraperBuild(input: unknown): ScraperBuildCheck {
  const parsed = scraperBuildSchema.safeParse(input);
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
  return { ok: true, build: parsed.data };
}

/** Legal forward edges (explicit state machine — no skipping, no resurrection). */
export const BUILD_LIFECYCLE_TRANSITIONS: ReadonlyArray<{ from: BuildState; to: BuildState; gate: BuildTransition["gate"] }> = [
  { from: "DRAFT", to: "STATIC_VALIDATED", gate: "STATIC_VALIDATION" },
  { from: "DRAFT", to: "REJECTED_STATIC", gate: "STATIC_VALIDATION" },
  { from: "STATIC_VALIDATED", to: "REVIEWED", gate: "DEPENDENCY_SOURCE_LICENSE_REVIEW" },
  { from: "STATIC_VALIDATED", to: "REJECTED_REVIEW", gate: "DEPENDENCY_SOURCE_LICENSE_REVIEW" },
  { from: "REVIEWED", to: "BUILT", gate: "BUILD" },
  { from: "REVIEWED", to: "REJECTED_BUILD", gate: "BUILD" },
  { from: "BUILT", to: "FIXTURE_TESTED", gate: "FIXTURE_RUN" },
  { from: "BUILT", to: "REJECTED_FIXTURE", gate: "FIXTURE_RUN" },
  { from: "FIXTURE_TESTED", to: "POLICY_CHECKED", gate: "SOURCE_POLICY_BUDGET_CHECK" },
  { from: "FIXTURE_TESTED", to: "REJECTED_POLICY", gate: "SOURCE_POLICY_BUDGET_CHECK" },
  { from: "POLICY_CHECKED", to: "RELEASED", gate: "RELEASE_APPROVAL" },
];

export function buildLifecycleAllows(from: BuildState, to: BuildState): boolean {
  return BUILD_LIFECYCLE_TRANSITIONS.some((edge) => edge.from === from && edge.to === to);
}

/** Rejection states are terminal: nothing leaves them. */
export function buildStateIsTerminal(state: BuildState): boolean {
  return (
    state === "RELEASED" ||
    state === "REJECTED_STATIC" ||
    state === "REJECTED_REVIEW" ||
    state === "REJECTED_BUILD" ||
    state === "REJECTED_FIXTURE" ||
    state === "REJECTED_POLICY"
  );
}

/** Typed gate result (factory emits one per attempted transition). */
export type GateResult =
  | { ok: true; evidence: z.infer<typeof evidenceRecordSchema>; detail: string }
  | { ok: false; code: ScrpErrorCode; detail: string };

/** Generated-code-is-data rule (spec §4: never trusted because an LLM generated it). */
export const GENERATED_CODE_IS_DATA_RULE =
  "generated scraper code/build plans are build ARTIFACTS and are never trusted or executed: " +
  "the runtime treats them as data pinned by digest, and execution happens only inside a " +
  "CapsuleProvider whose isolation suite has passed (synthetic provider = non-production)";

/** Fail-closed factory rule. */
export const BUILD_FAIL_CLOSED_RULE =
  "every factory gate either advances the build with evidence or terminates it in a REJECTED_* " +
  "state with typed reason codes; there is no path from a failed gate back into the lifecycle";
