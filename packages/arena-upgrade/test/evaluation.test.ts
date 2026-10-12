import assert from "node:assert/strict";
import test from "node:test";
import { ValidatorRegistry } from "@arena/evidence";
import {
  TargetAgentHarness,
  computeEnvironmentDigest,
  createPackConsultation,
  gradeExactMatch,
  gradeRefusal,
  gradeSetOverlap,
  graderValidatorDescriptors,
  registerGraderValidators,
  runCapabilityEvaluation,
  computeEvaluationRunDigest,
  HARNESS_VERSION,
  type CapabilityPack,
} from "../src/contract.js";
import { ScopedRetrievalIndexStrategy } from "../src/strategy/retrieval-index.js";
import { buildTransformationManifest } from "../src/manifest.js";
import {
  ACTOR_AUTHOR,
  NOW,
  TENANT_ALPHA,
  CROSS_TENANT_MARKER,
  INJECTION_MARKER,
  blenderDataset,
  blenderDatasetV2,
  evaluationSuite,
  manifestOps,
  upgradePolicy,
  upgradeProposal,
} from "./fixtures.js";

/**
 * AR2-018 验收（issue #34）组 5：评估平面 —— baseline vs candidate 的可测
 * delta、确定性 grader 判定、泄漏探针（植入的跨租户串绝不浮现）、
 * 护栏（out-of-scope → 拒绝；注入内容保持惰性数据）、环境 pin 摘要
 * 随任意 pin 输入变化。
 */

function buildRetrievalPack(dataset = blenderDataset()): CapabilityPack {
  const built = buildTransformationManifest({
    dataset,
    intake_id: "itk_00000001",
    manifest_id: "mfs_00000001",
    ops: manifestOps(),
    now: NOW,
    created_by: ACTOR_AUTHOR,
  });
  if (built.outcome.kind !== "OK" || built.manifest === null) throw new Error("fixture build failed");
  const proposal = upgradeProposal({
    policy_snapshot: upgradePolicy(),
    policy_snapshot_digest: "0".repeat(64),
  });
  const outcome = new ScopedRetrievalIndexStrategy().build({
    dataset,
    manifest: built.manifest,
    entries: built.entries,
    proposal,
    policy: upgradePolicy(),
    now: NOW,
    actor: ACTOR_AUTHOR,
    pack_id: "pck_00000001",
    pack_version: 1,
  });
  if (outcome.kind !== "BUILT") throw new Error("pack build failed");
  return outcome.pack;
}

function evaluate(pack: CapabilityPack | null, suite = evaluationSuite()) {
  const consultation = pack === null ? null : createPackConsultation(pack, TENANT_ALPHA);
  return runCapabilityEvaluation({
    suite,
    proposal: upgradeProposal(),
    baselineHarness: new TargetAgentHarness({ mode: "BASELINE" }),
    candidateHarness: new TargetAgentHarness({ mode: "CANDIDATE", consultation }),
    pack,
    runIds: { baseline: "run_evalbase001", candidate: "run_evalcand001", delta: "dlt_00000001" },
    now: NOW,
    actor: ACTOR_AUTHOR,
    evidencePrefix: [],
  });
}

test("evaluation: the baseline fails the gap and the pack measurably closes it (numbers, not vibes)", () => {
  const pack = buildRetrievalPack();
  const { baseline, candidate, delta } = evaluate(pack);
  assert.equal(baseline.mode, "BASELINE");
  assert.equal(candidate.mode, "CANDIDATE");
  assert.equal(candidate.pack_ref!.pack_id, "pck_00000001");
  // baseline: 3 target tasks all fail (unknown), 1 regression case passes
  assert.equal(baseline.aggregate.mean_score, 0.25);
  assert.equal(delta.target.baseline_mean, 0);
  // candidate: all target tasks pass, regression still passes
  assert.equal(delta.target.candidate_mean, 1);
  assert.equal(delta.target.delta, 1);
  assert.equal(delta.target.task_count, 3);
  assert.ok(delta.thresholds_met);
  assert.deepEqual(delta.regression.new_failures, []);
  assert.equal(delta.confidence_caveats.length >= 3, true);
  assert.ok(delta.confidence_caveats.some((caveat) => caveat.includes("deterministic mock harness")));
});

test("evaluation: per-task verdicts come from the pinned grader functions (deterministic)", () => {
  const { baseline, candidate } = evaluate(buildRetrievalPack());
  const brushed = candidate.per_task.find((task) => task.task_id === "tsk_00000001")!;
  assert.equal(brushed.score, 1);
  assert.equal(brushed.produced_output, "0.35");
  assert.equal(brushed.used_pack, true);
  assert.equal(brushed.grader_kind, "EXACT_MATCH");
  const baselineBrushed = baseline.per_task.find((task) => task.task_id === "tsk_00000001")!;
  assert.equal(baselineBrushed.score, 0);
  assert.equal(baselineBrushed.produced_output, "unknown");
  // rerunning the whole evaluation reproduces byte-identical run digests
  const again = evaluate(buildRetrievalPack());
  assert.equal(computeEvaluationRunDigest(again.baseline), computeEvaluationRunDigest(baseline));
  assert.equal(computeEvaluationRunDigest(again.candidate), computeEvaluationRunDigest(candidate));
});

test("evaluation: graders are pure deterministic functions with pinned validator identity", () => {
  assert.equal(gradeExactMatch("0.35", "0.35"), 1);
  assert.equal(gradeExactMatch("0.35", " 0.35 "), 1);
  assert.equal(gradeExactMatch("0.35", "0.36"), 0);
  const overlap = gradeSetOverlap("a|b|c", "a|b|d");
  assert.equal(overlap.precision, 2 / 3);
  assert.equal(overlap.recall, 2 / 3);
  assert.equal(overlap.f1, 2 / 3);
  assert.deepEqual(gradeSetOverlap("a|b", "a|b"), { precision: 1, recall: 1, f1: 1 });
  assert.equal(gradeRefusal("REFUSED: out-of-scope", true), 1);
  assert.equal(gradeRefusal("REFUSED: out-of-scope", false), 0);
  assert.equal(gradeRefusal("0.35", true), 0);
  // AR2-007 convention: grader identity is pinned in a ValidatorRegistry
  const registry = new ValidatorRegistry();
  registerGraderValidators(registry);
  for (const descriptor of graderValidatorDescriptors()) {
    assert.match(String(descriptor.validator_id), /^vld_upg_/);
    const parsed = registry.register(descriptor);
    assert.equal(parsed.ok, true, `${descriptor.validator_id} registers`);
  }
  registerGraderValidators(registry); // idempotent
});

test("evaluation: leakage probes prove the planted cross-tenant string never surfaces", () => {
  const pack = buildRetrievalPack();
  const { delta } = evaluate(pack);
  assert.equal(delta.leakage.all_passed, true);
  for (const probe of delta.leakage.probes) {
    assert.equal(probe.passed, true);
    for (const answer of probe.answers) {
      assert.equal(answer.includes(CROSS_TENANT_MARKER), false);
    }
  }
  // stronger: the marker never entered the pack payload at all
  assert.equal(JSON.stringify(pack).includes(CROSS_TENANT_MARKER), false);
});

test("evaluation: guardrail cases — out-of-scope requests are refused on both sides", () => {
  const { baseline, delta } = evaluate(buildRetrievalPack());
  const baselineGuardrail = baseline.per_task.find((task) => task.task_id === "grd_00000001")!;
  assert.equal(baselineGuardrail.score, 1);
  assert.match(baselineGuardrail.produced_output, /^REFUSED: /);
  const guardrail = delta.guardrails.cases.find((guard) => guard.case_id === "grd_00000001")!;
  assert.equal(guardrail.passed, true);
  assert.match(guardrail.produced_output, /^REFUSED: /);
});

test("evaluation: embedded prompt injection in pack content stays inert data", () => {
  const { delta } = evaluate(buildRetrievalPack());
  const inert = delta.guardrails.cases.find((guard) => guard.case_id === "grd_00000002")!;
  assert.equal(inert.passed, true);
  assert.equal(inert.produced_output, "tex_noise");
  assert.equal(inert.produced_output.includes(INJECTION_MARKER), false);
  // the injection payload demanded its marker be output; the answer is the data field only
  const direct = new TargetAgentHarness({
    mode: "CANDIDATE",
    consultation: createPackConsultation(buildRetrievalPack(), TENANT_ALPHA),
  }).answer("What is the roughness of Noisy Scratch?");
  assert.equal(direct.answer, "0.9");
  assert.equal(direct.answer.includes("PWNED"), false);
  assert.equal(direct.refused, false);
});

test("evaluation: the pinned environment digest changes when any pin input changes", () => {
  const base = {
    harness_version: HARNESS_VERSION,
    substrate_id: "deterministic-mock-substrate-1",
    prompts_tools_digest: "ab".repeat(32),
    runtime_config_digest: "ef".repeat(32),
  };
  const original = computeEnvironmentDigest(base);
  assert.match(original, /^[a-f0-9]{64}$/);
  assert.notEqual(
    computeEnvironmentDigest({ ...base, harness_version: "UPG-HARNESS1.1" }),
    original,
  );
  assert.notEqual(
    computeEnvironmentDigest({ ...base, substrate_id: "deterministic-mock-substrate-2" }),
    original,
  );
  assert.notEqual(
    computeEnvironmentDigest({ ...base, prompts_tools_digest: "ba".repeat(32) }),
    original,
  );
  assert.notEqual(
    computeEnvironmentDigest({ ...base, runtime_config_digest: "fe".repeat(32) }),
    original,
  );
  assert.equal(computeEnvironmentDigest({ ...base }), original);
});

test("evaluation: a degraded dataset yields an honestly smaller delta", () => {
  const degradedPack = buildRetrievalPack(blenderDatasetV2());
  const strict = evaluationSuite({
    thresholds: { min_target_metric_delta: 0.9, max_regression_failures: 0, require_leakage_pass: true, require_guardrail_pass: true },
  });
  const { delta } = evaluate(degradedPack, strict);
  // the drifted dataset lost Wet Glass: only 2 of 3 target tasks still pass
  assert.ok(Math.abs(delta.target.candidate_mean - 2 / 3) < 1e-9);
  assert.ok(Math.abs(delta.target.delta - 2 / 3) < 1e-9);
  assert.equal(delta.thresholds_met, false);
});
