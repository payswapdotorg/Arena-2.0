import { z } from "zod";
import { arenaIdSchema, isoTimestampSchema } from "@arena/contracts";
import { computeCanonicalDigest } from "@arena/acquisition";
import {
  UPGRADE_SCHEMA_FAMILY,
  actorRefSchema,
  boundedText,
  nonEmptyMedium,
  nonEmptyShort,
  type ActorRef,
} from "../primitives.js";
import type { CapabilityUpgradeProposal } from "../proposal.js";
import type { CapabilityPack } from "../pack.js";
import {
  graderKindSchema,
  gradeExactMatch,
  gradeRefusal,
  gradeSetOverlap,
  computeSuiteDigest,
  type CapabilityEvaluationSuite,
  type GraderKind,
} from "./suite.js";
import type { TargetAgentHarness, EnvironmentPin } from "./harness.js";
import { computeEnvironmentDigest } from "./harness.js";
import type { EvidenceChainRecord } from "../evidence.js";

/**
 * AR2-018 — EvaluationRun + BeforeAfterDelta + service (issue #34; spec §7).
 *
 * A pinned, recorded evaluation execution: baseline (pre-upgrade agent)
 * result, candidate (post-upgrade) result, per-task and aggregate metrics,
 * leakage/guardrail outcomes, deterministic grader verdicts, environment
 * digests and the computed delta with confidence caveats. NO hand-waving:
 * every metric is a number produced by a grader function.
 */

export const evaluationTaskResultSchema = z
  .object({
    task_id: arenaIdSchema,
    kind: z.enum(["TARGET", "REGRESSION", "LEAKAGE_PROBE", "GUARDRAIL"]),
    fixture_input: nonEmptyMedium,
    expected_output: boundedText.nullable(),
    grader_kind: graderKindSchema.nullable(),
    produced_output: boundedText,
    score: z.number().min(0).max(1),
    metrics: z.record(z.string(), z.number()),
    used_pack: z.boolean(),
  })
  .strict();

export type EvaluationTaskResult = z.infer<typeof evaluationTaskResultSchema>;

export const evaluationRunSchema = z
  .object({
    schema_version: z.literal(UPGRADE_SCHEMA_FAMILY),
    run_id: arenaIdSchema,
    tenant_id: arenaIdSchema,
    suite_ref: z
      .object({ suite_id: arenaIdSchema, suite_version: nonEmptyShort, suite_digest: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict(),
    mode: z.enum(["BASELINE", "CANDIDATE"]),
    pack_ref: z
      .object({ pack_id: arenaIdSchema, version: z.number().int().positive(), content_digest: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .nullable(),
    environment_digest: z.string().regex(/^[a-f0-9]{64}$/),
    harness_version: nonEmptyShort,
    executed_at: isoTimestampSchema,
    executed_by: actorRefSchema,
    per_task: z.array(evaluationTaskResultSchema).max(512),
    aggregate: z.object({ task_count: z.number().int().min(0), mean_score: z.number().min(0).max(1) }).strict(),
    evidence: z.array(z.object({ stage: z.string(), ref_id: z.string(), content_digest: z.string(), recorded_at: z.string() }).strict()).max(32),
  })
  .strict();

export type EvaluationRun = z.infer<typeof evaluationRunSchema>;

export const beforeAfterDeltaSchema = z
  .object({
    schema_version: z.literal(UPGRADE_SCHEMA_FAMILY),
    delta_id: arenaIdSchema,
    tenant_id: arenaIdSchema,
    proposal_id: arenaIdSchema,
    baseline_run_ref: z.object({ run_id: arenaIdSchema, content_digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    candidate_run_ref: z.object({ run_id: arenaIdSchema, content_digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    target: z
      .object({
        task_count: z.number().int().min(0),
        baseline_mean: z.number().min(0).max(1),
        candidate_mean: z.number().min(0).max(1),
        delta: z.number().min(-1).max(1),
      })
      .strict(),
    regression: z
      .object({
        case_count: z.number().int().min(0),
        baseline_failures: z.number().int().min(0),
        candidate_failures: z.number().int().min(0),
        new_failures: z.array(arenaIdSchema).max(128),
      })
      .strict(),
    leakage: z
      .object({
        probes: z
          .array(z.object({ probe_id: arenaIdSchema, passed: z.boolean(), answers: z.array(boundedText).max(16) }).strict())
          .max(64),
        all_passed: z.boolean(),
      })
      .strict(),
    guardrails: z
      .object({
        cases: z
          .array(
            z
              .object({ case_id: arenaIdSchema, passed: z.boolean(), produced_output: boundedText })
              .strict(),
          )
          .max(64),
        all_passed: z.boolean(),
      })
      .strict(),
    thresholds: z
      .object({
        min_target_metric_delta: z.number().min(0).max(1),
        max_regression_failures: z.number().int().min(0).max(64),
        require_leakage_pass: z.boolean(),
        require_guardrail_pass: z.boolean(),
      })
      .strict(),
    thresholds_met: z.boolean(),
    confidence_caveats: z.array(nonEmptyShort).max(8),
  })
  .strict();

export type BeforeAfterDelta = z.infer<typeof beforeAfterDeltaSchema>;

export function computeEvaluationRunDigest(run: EvaluationRun): string {
  return computeCanonicalDigest(run);
}

function scoreWith(kind: GraderKind, expected: string, produced: string): { score: number; metrics: Record<string, number> } {
  switch (kind) {
    case "EXACT_MATCH": {
      const score = gradeExactMatch(expected, produced);
      return { score, metrics: { exact_match: score } };
    }
    case "SET_OVERLAP": {
      const { precision, recall, f1 } = gradeSetOverlap(expected, produced);
      return { score: f1, metrics: { precision, recall, f1 } };
    }
    case "REFUSAL_CORRECT": {
      const expectRefusal = expected.startsWith("REFUSED:");
      const score = gradeRefusal(produced, expectRefusal);
      return { score, metrics: { refusal_correct: score } };
    }
  }
}

function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface RunEvaluationInput {
  suite: CapabilityEvaluationSuite;
  proposal: CapabilityUpgradeProposal;
  baselineHarness: TargetAgentHarness;
  candidateHarness: TargetAgentHarness;
  pack: CapabilityPack | null;
  runIds: { baseline: string; candidate: string; delta: string };
  now: string;
  actor: ActorRef;
  evidencePrefix: readonly EvidenceChainRecord[];
}

/**
 * Run the suite against baseline and candidate harnesses with identical task
 * fixtures; compute per-task grader verdicts, aggregate metrics, the
 * before/after delta, leakage/guardrail outcomes and the evidence envelope.
 */
export function runCapabilityEvaluation(input: RunEvaluationInput): {
  baseline: EvaluationRun;
  candidate: EvaluationRun;
  delta: BeforeAfterDelta;
} {
  const { suite, baselineHarness, candidateHarness } = input;
  const runResults = (harness: TargetAgentHarness): EvaluationTaskResult[] => {
    const results: EvaluationTaskResult[] = [];
    for (const task of suite.target_tasks) {
      const answer = harness.answer(task.fixture_input);
      const graded = scoreWith(task.grader.kind, task.expected_output, answer.answer);
      results.push({
        task_id: task.task_id,
        kind: "TARGET",
        fixture_input: task.fixture_input,
        expected_output: task.expected_output,
        grader_kind: task.grader.kind,
        produced_output: answer.answer,
        score: graded.score,
        metrics: graded.metrics,
        used_pack: answer.used_pack,
      });
    }
    for (const task of suite.regression_cases) {
      const answer = harness.answer(task.fixture_input);
      const graded = scoreWith(task.grader.kind, task.expected_output, answer.answer);
      results.push({
        task_id: task.case_id,
        kind: "REGRESSION",
        fixture_input: task.fixture_input,
        expected_output: task.expected_output,
        grader_kind: task.grader.kind,
        produced_output: answer.answer,
        score: graded.score,
        metrics: graded.metrics,
        used_pack: answer.used_pack,
      });
    }
    for (const guardrail of suite.guardrail_cases) {
      const answer = harness.answer(guardrail.fixture_input);
      let passed: boolean;
      if (guardrail.kind === "OUT_OF_SCOPE_REFUSAL") {
        passed = gradeRefusal(answer.answer, true) === 1;
      } else {
        const expected = guardrail.expected_output ?? "";
        passed =
          gradeExactMatch(expected, answer.answer) === 1 &&
          guardrail.forbidden_substrings.every((needle) => !answer.answer.includes(needle));
      }
      results.push({
        task_id: guardrail.case_id,
        kind: "GUARDRAIL",
        fixture_input: guardrail.fixture_input,
        expected_output: guardrail.expected_output,
        grader_kind: null,
        produced_output: answer.answer,
        score: passed ? 1 : 0,
        metrics: { guardrail_passed: passed ? 1 : 0 },
        used_pack: answer.used_pack,
      });
    }
    return results;
  };

  const baselineTasks = runResults(baselineHarness);
  const candidateTasks = runResults(candidateHarness);

  const leakageOutcomes = suite.leakage_probes.map((probe) => {
    const answers = [candidateHarness.answer(probe.probe_question).answer];
    const passed = answers.every(
      (answer) => !probe.forbidden_substrings.some((needle) => answer.includes(needle)),
    );
    return { probe_id: probe.probe_id, passed, answers };
  });

  const environmentPin: EnvironmentPin = {
    harness_version: suite.pinned_environment.harness_version,
    substrate_id: suite.pinned_environment.substrate_id,
    prompts_tools_digest: suite.pinned_environment.prompts_tools_digest,
    runtime_config_digest: suite.pinned_environment.runtime_config_digest,
  };
  const environmentDigest = computeEnvironmentDigest(environmentPin);
  // Aggregate = mean over the scored capability tasks (TARGET + REGRESSION);
  // leakage and guardrail outcomes are gates, not capability scores.
  const scoredTasks = (tasks: EvaluationTaskResult[]) =>
    tasks.filter((task) => task.kind === "TARGET" || task.kind === "REGRESSION");
  const baselineRun: EvaluationRun = {
    schema_version: UPGRADE_SCHEMA_FAMILY,
    run_id: input.runIds.baseline,
    tenant_id: input.proposal.tenant_id,
    suite_ref: {
      suite_id: suite.suite_id,
      suite_version: suite.suite_version,
      suite_digest: computeSuiteDigest(suite),
    },
    mode: "BASELINE",
    pack_ref: null,
    environment_digest: environmentDigest,
    harness_version: suite.pinned_environment.harness_version,
    executed_at: input.now,
    executed_by: input.actor,
    per_task: baselineTasks,
    aggregate: {
      task_count: scoredTasks(baselineTasks).length,
      mean_score: meanOf(scoredTasks(baselineTasks).map((task) => task.score)),
    },
    evidence: input.evidencePrefix.map((record) => ({ ...record })),
  };
  const candidateRun: EvaluationRun = {
    ...baselineRun,
    run_id: input.runIds.candidate,
    mode: "CANDIDATE",
    pack_ref: input.pack === null ? null : {
      pack_id: input.pack.pack_id,
      version: input.pack.version,
      content_digest: input.pack.content_digest,
    },
    per_task: candidateTasks,
    aggregate: {
      task_count: scoredTasks(candidateTasks).length,
      mean_score: meanOf(scoredTasks(candidateTasks).map((task) => task.score)),
    },
  };

  const targetOf = (tasks: EvaluationTaskResult[]) => tasks.filter((task) => task.kind === "TARGET");
  const regressionOf = (tasks: EvaluationTaskResult[]) => tasks.filter((task) => task.kind === "REGRESSION");
  const guardrailOf = (tasks: EvaluationTaskResult[]) => tasks.filter((task) => task.kind === "GUARDRAIL");

  const baselineTargetMean = meanOf(targetOf(baselineTasks).map((task) => task.score));
  const candidateTargetMean = meanOf(targetOf(candidateTasks).map((task) => task.score));
  const newFailures = regressionOf(candidateTasks)
    .filter((candidateTask) => {
      const baselineTask = regressionOf(baselineTasks).find((task) => task.task_id === candidateTask.task_id);
      return candidateTask.score < 1 && baselineTask !== undefined && baselineTask.score === 1;
    })
    .map((task) => task.task_id);

  const guardrailCases = guardrailOf(candidateTasks).map((task) => ({
    case_id: task.task_id,
    passed: task.score === 1,
    produced_output: task.produced_output,
  }));
  const leakageAllPassed = leakageOutcomes.every((probe) => probe.passed);
  const guardrailsAllPassed = guardrailCases.every((guardrail) => guardrail.passed);

  const thresholdsMet =
    candidateTargetMean - baselineTargetMean >= suite.thresholds.min_target_metric_delta &&
    newFailures.length <= suite.thresholds.max_regression_failures &&
    (!suite.thresholds.require_leakage_pass || leakageAllPassed) &&
    (!suite.thresholds.require_guardrail_pass || guardrailsAllPassed);

  const delta: BeforeAfterDelta = {
    schema_version: UPGRADE_SCHEMA_FAMILY,
    delta_id: input.runIds.delta,
    tenant_id: input.proposal.tenant_id,
    proposal_id: input.proposal.proposal_id,
    baseline_run_ref: { run_id: baselineRun.run_id, content_digest: computeEvaluationRunDigest(baselineRun) },
    candidate_run_ref: { run_id: candidateRun.run_id, content_digest: computeEvaluationRunDigest(candidateRun) },
    target: {
      task_count: targetOf(candidateTasks).length,
      baseline_mean: baselineTargetMean,
      candidate_mean: candidateTargetMean,
      delta: candidateTargetMean - baselineTargetMean,
    },
    regression: {
      case_count: regressionOf(candidateTasks).length,
      baseline_failures: regressionOf(baselineTasks).filter((task) => task.score < 1).length,
      candidate_failures: regressionOf(candidateTasks).filter((task) => task.score < 1).length,
      new_failures: newFailures,
    },
    leakage: { probes: leakageOutcomes, all_passed: leakageAllPassed },
    guardrails: { cases: guardrailCases, all_passed: guardrailsAllPassed },
    thresholds: suite.thresholds,
    thresholds_met: thresholdsMet,
    confidence_caveats: [
      "deterministic mock harness: no live model evaluation is claimed",
      `claim scoped to the measured target tasks of suite ${suite.suite_id}@${suite.suite_version}`,
      "baseline and candidate ran identical fixtures under the same pinned environment",
    ],
  };
  return { baseline: baselineRun, candidate: candidateRun, delta };
}
