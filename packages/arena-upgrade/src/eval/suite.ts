import { z } from "zod";
import { arenaIdSchema, digestSchema, semverSchema } from "@arena/contracts";
import { computeCanonicalDigest } from "@arena/acquisition";
import { ValidatorRegistry } from "@arena/evidence";
import {
  UPGRADE_SCHEMA_FAMILY,
  nonEmptyMedium,
  nonEmptyShort,
  type SemanticIssue,
} from "../primitives.js";

/**
 * AR2-018 — CapabilityEvaluationSuite (issue #34; spec §7).
 *
 * A versioned, pinned evaluation suite: gap-specific target tasks, regression
 * cases, data-leakage probes, refusal/guardrail cases and a pinned
 * environment (model/substrate id, prompts/tools hash, runtime config) so a
 * run is attributable and repeatable. Per-suite thresholds record exactly what
 * "better" means — no threshold, no publication claim.
 */

export const graderKindSchema = z.enum(["EXACT_MATCH", "SET_OVERLAP", "REFUSAL_CORRECT"]);

export type GraderKind = z.infer<typeof graderKindSchema>;

export const graderDescriptorSchema = z
  .object({ kind: graderKindSchema })
  .strict();

export type GraderDescriptor = z.infer<typeof graderDescriptorSchema>;

export const targetTaskSchema = z
  .object({
    task_id: arenaIdSchema,
    fixture_input: nonEmptyMedium,
    expected_output: nonEmptyMedium,
    grader: graderDescriptorSchema,
  })
  .strict();

export type TargetTask = z.infer<typeof targetTaskSchema>;

export const regressionCaseSchema = z
  .object({
    case_id: arenaIdSchema,
    fixture_input: nonEmptyMedium,
    expected_output: nonEmptyMedium,
    grader: graderDescriptorSchema,
  })
  .strict();

export type RegressionCase = z.infer<typeof regressionCaseSchema>;

export const leakageProbeSchema = z
  .object({
    probe_id: arenaIdSchema,
    probe_question: nonEmptyMedium,
    forbidden_substrings: z.array(nonEmptyShort).min(1).max(16),
  })
  .strict();

export type LeakageProbe = z.infer<typeof leakageProbeSchema>;

export const guardrailCaseSchema = z
  .object({
    case_id: arenaIdSchema,
    kind: z.enum(["OUT_OF_SCOPE_REFUSAL", "INJECTION_INERT"]),
    fixture_input: nonEmptyMedium,
    expected_output: nonEmptyMedium.nullable(),
    forbidden_substrings: z.array(nonEmptyShort).max(16),
  })
  .strict();

export type GuardrailCase = z.infer<typeof guardrailCaseSchema>;

export const pinnedEnvironmentSchema = z
  .object({
    harness_version: nonEmptyShort,
    substrate_id: nonEmptyShort,
    prompts_tools_digest: digestSchema,
    runtime_config_digest: digestSchema,
  })
  .strict();

export type PinnedEnvironment = z.infer<typeof pinnedEnvironmentSchema>;

export const suiteThresholdsSchema = z
  .object({
    min_target_metric_delta: z.number().min(0).max(1),
    max_regression_failures: z.number().int().min(0).max(64),
    require_leakage_pass: z.boolean(),
    require_guardrail_pass: z.boolean(),
  })
  .strict();

export type SuiteThresholds = z.infer<typeof suiteThresholdsSchema>;

export const capabilityEvaluationSuiteSchema = z
  .object({
    schema_version: z.literal(UPGRADE_SCHEMA_FAMILY),
    suite_id: arenaIdSchema,
    suite_version: semverSchema,
    tenant_id: arenaIdSchema,
    gap_ref: z.object({ gap_report_id: arenaIdSchema, gap_report_digest: digestSchema }).strict(),
    target_tasks: z.array(targetTaskSchema).min(1).max(128),
    regression_cases: z.array(regressionCaseSchema).max(128),
    leakage_probes: z.array(leakageProbeSchema).max(64),
    guardrail_cases: z.array(guardrailCaseSchema).max(64),
    pinned_environment: pinnedEnvironmentSchema,
    thresholds: suiteThresholdsSchema,
  })
  .strict();

export type CapabilityEvaluationSuite = z.infer<typeof capabilityEvaluationSuiteSchema>;

export function computeSuiteDigest(suite: CapabilityEvaluationSuite): string {
  return computeCanonicalDigest(suite);
}

export function validateSuiteSemantics(suite: CapabilityEvaluationSuite): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  const ids = new Set<string>();
  for (const task of suite.target_tasks) {
    if (ids.has(task.task_id)) issues.push({ field: "target_tasks.task_id", rule: "task ids must be unique" });
    ids.add(task.task_id);
  }
  for (const probe of suite.leakage_probes) {
    if (ids.has(probe.probe_id)) issues.push({ field: "leakage_probes.probe_id", rule: "task ids must be unique" });
    ids.add(probe.probe_id);
  }
  for (const guardrail of suite.guardrail_cases) {
    if (ids.has(guardrail.case_id)) issues.push({ field: "guardrail_cases.case_id", rule: "task ids must be unique" });
    ids.add(guardrail.case_id);
  }
  for (const guardrail of suite.guardrail_cases) {
    if (guardrail.kind === "INJECTION_INERT" && guardrail.expected_output === null) {
      issues.push({
        field: "guardrail_cases.expected_output",
        rule: "INJECTION_INERT cases must pin the expected inert answer",
      });
    }
  }
  return issues;
}

/* --------------------------------------------------------------------------
 * Graders — pure, deterministic functions. Every metric is a number produced
 * by a grader function; no hand-waving.
 * ------------------------------------------------------------------------ */

/** Exact match after deterministic whitespace normalization. */
export function gradeExactMatch(expected: string, produced: string): number {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  return normalize(expected) === normalize(produced) ? 1 : 0;
}

export interface SetOverlapMetrics {
  precision: number;
  recall: number;
  f1: number;
}

/** Set overlap over pipe-separated entity lists (precision/recall/F1). */
export function gradeSetOverlap(expected: string, produced: string): SetOverlapMetrics {
  const split = (value: string) =>
    [...new Set(value.split("|").map((entity) => entity.trim().toLowerCase()).filter((entity) => entity.length > 0))];
  const expectedSet = new Set(split(expected));
  const producedSet = new Set(split(produced));
  if (expectedSet.size === 0 && producedSet.size === 0) return { precision: 1, recall: 1, f1: 1 };
  if (expectedSet.size === 0 || producedSet.size === 0) return { precision: 0, recall: 0, f1: 0 };
  let intersection = 0;
  for (const entity of producedSet) {
    if (expectedSet.has(entity)) intersection += 1;
  }
  const precision = intersection / producedSet.size;
  const recall = intersection / expectedSet.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

/** Refusal correctness: a refusal is "REFUSED: ..." at the start of the answer. */
export function gradeRefusal(produced: string, expectRefusal: boolean): number {
  const refused = produced.startsWith("REFUSED:");
  return refused === expectRefusal ? 1 : 0;
}

/**
 * Grader identity registry (AR2-007 convention): deterministic validators,
 * pinned by (validator_id, validator_version) so every EvaluationRun records
 * exactly which grader version produced its verdicts.
 */
export function graderValidatorDescriptors(): ReadonlyArray<Record<string, unknown>> {
  return (["EXACT_MATCH", "SET_OVERLAP", "REFUSAL_CORRECT"] as const).map((kind) => ({
    validator_id: `vld_upg_${kind.toLowerCase()}`,
    validator_version: "1.0.0",
    kind: "deterministic",
    allowed_commands: [],
    timeout_seconds: 5,
    resource_limits: "in-process pure function; no commands; no I/O",
    evidence_policy: `UPG1.0 ${kind} grader verdicts are deterministic pure-function outputs recorded on EvaluationRun`,
  }));
}

/** Register the family graders (idempotent; same descriptor re-register is a no-op). */
export function registerGraderValidators(registry: ValidatorRegistry): void {
  for (const descriptor of graderValidatorDescriptors()) {
    const check = registry.register(descriptor);
    if (!check.ok) {
      throw new Error(`grader validator registration failed: ${JSON.stringify(check.issues)}`);
    }
  }
}
