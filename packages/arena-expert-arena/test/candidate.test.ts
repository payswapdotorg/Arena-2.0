import assert from "node:assert/strict";
import test from "node:test";
import { CandidateRegistry, structuredSelfEvaluationSchema } from "../src/contract.js";
import type { CandidatePackage } from "../src/contract.js";

/**
 * AR2-009 — 不可变候选版本 + 结构化自评（issue #11 验收）：
 * 自评完成并提交（criterion 级证据 + 局限）；修订保留旧版本；
 * 自评结构上携带 never_an_independent_vote（quorum 消费方按类型排除）；
 * 畸形包类型化拒绝；一轮内两名作者各自可提交（隔离、可归因）。
 */

function selfEvaluation(): unknown {
  return {
    claims: [
      {
        criterion_id: "cri_00000001",
        claim: "The fixture table comparison reproduces with zero mismatches",
        status: "met",
        evidence_refs: ["evd_00000001"],
        confidence: 0.9,
        rationale: "Re-ran the pinned comparison script; all 12 edge cases match",
      },
      {
        criterion_id: "cri_00000002",
        claim: "Root cause documented with a reproducer artifact",
        status: "partially_met",
        evidence_refs: ["evd_00000002"],
        confidence: 0.6,
        rationale: "Reproducer attached; narrative doc references it but lacks a stability note",
      },
    ],
    assumptions: ["Fixture data matches the production schema version"],
    limitations: ["No performance envelope measured beyond the pinned set"],
    known_failure_modes: ["Schema drift between fixture and production"],
    residual_risks: ["Edge cases outside the fixture set are uncharacterized"],
    validator_results: [
      {
        validator_id: "val_00000001",
        validator_version: "1.0.0",
        result: "pass: 12/12 fixture cases",
      },
    ],
    never_an_independent_vote: true,
  };
}

function candidatePackage(): unknown {
  return {
    solution_artifacts: [{ artifact_id: "art_00000001", digest: "ab".repeat(32) }],
    declared_assumptions: ["Fixture data matches the production schema version"],
    evidence_manifest: ["evd_00000001", "evd_00000002"],
    validation_instructions: "Run the pinned fixture comparison script on the candidate branch",
    limitations: ["No performance envelope measured beyond the pinned set"],
    self_evaluation: selfEvaluation(),
  };
}

test("author can complete and submit a self-evaluation with criterion-level evidence and limitations", () => {
  const registry = new CandidateRegistry(() => "2026-10-11T08:00:00Z");
  const outcome = registry.submitCandidate({
    round_id: "round_00000001",
    author_expert_id: "exp_00000001",
    candidate_package: candidatePackage(),
  });
  assert.equal(outcome.kind, "SUBMITTED");
  if (outcome.kind === "SUBMITTED") {
    assert.equal(outcome.record.revision, 1);
    assert.equal(outcome.record.author_expert_id, "exp_00000001");
    assert.equal(outcome.record.package.self_evaluation.claims.length, 2);
    assert.equal(outcome.record.package.self_evaluation.limitations.length, 1);
  }
});

test("self-evaluation schema requires the never_an_independent_vote literal (structural)", () => {
  const valid = structuredSelfEvaluationSchema.safeParse(selfEvaluation());
  assert.equal(valid.success, true);
  const withoutMarker = structuredSelfEvaluationSchema.safeParse({
    ...(selfEvaluation() as object),
    never_an_independent_vote: false,
  });
  assert.equal(withoutMarker.success, false);
});

test("revisions preserve prior candidate versions (immutable history)", () => {
  let clock = 0;
  const registry = new CandidateRegistry(() =>
    new Date(Date.parse("2026-10-11T08:00:00Z") + clock++ * 60_000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z"),
  );
  const first = registry.submitCandidate({
    round_id: "round_00000001",
    author_expert_id: "exp_00000001",
    candidate_package: candidatePackage(),
  });
  assert.equal(first.kind, "SUBMITTED");
  const revised = registry.submitCandidate({
    round_id: "round_00000001",
    author_expert_id: "exp_00000001",
    revises_candidate_id: "cand_round_00000001_exp_00000001",
    candidate_package: candidatePackage(),
  });
  assert.equal(revised.kind, "SUBMITTED");
  if (revised.kind === "SUBMITTED") assert.equal(revised.record.revision, 2);
  const versions = registry.versions("cand_round_00000001_exp_00000001");
  assert.equal(versions.length, 2);
  assert.equal(versions[0]?.revision, 1);
  assert.equal(versions[1]?.revision, 2);
  // 旧版本只读快照 —— 内容未被覆盖。
  assert.notEqual(versions[0]?.submitted_at, versions[1]?.submitted_at);
});

test("two eligible experts can submit isolated attributable solutions in one round", () => {
  const registry = new CandidateRegistry(() => "2026-10-11T08:00:00Z");
  const alpha = registry.submitCandidate({
    round_id: "round_00000002",
    author_expert_id: "exp_00000001",
    candidate_package: candidatePackage(),
  });
  const beta = registry.submitCandidate({
    round_id: "round_00000002",
    author_expert_id: "exp_00000002",
    candidate_package: candidatePackage(),
  });
  assert.equal(alpha.kind, "SUBMITTED");
  assert.equal(beta.kind, "SUBMITTED");
  assert.equal(registry.candidatesOfRound("round_00000002").length, 2);
  assert.equal(registry.allSelfEvaluationsMarkedNeverVote("round_00000002"), true);
});

test("malformed candidate packages are typed rejections (fail-closed)", () => {
  const registry = new CandidateRegistry(() => "2026-10-11T08:00:00Z");
  const noArtifacts = registry.submitCandidate({
    round_id: "round_00000003",
    author_expert_id: "exp_00000001",
    candidate_package: { ...candidatePackage(), solution_artifacts: [] },
  });
  assert.equal(noArtifacts.kind, "REJECTED");
  if (noArtifacts.kind === "REJECTED") {
    assert.ok(noArtifacts.issues.some((issue) => issue.field.startsWith("solution_artifacts")));
  }
  const emptyClaims = registry.submitCandidate({
    round_id: "round_00000003",
    author_expert_id: "exp_00000001",
    candidate_package: {
      ...(candidatePackage() as CandidatePackage),
      self_evaluation: { ...(selfEvaluation() as object), claims: [] },
    },
  });
  assert.equal(emptyClaims.kind, "REJECTED");
});

test("registry snapshots are read-only (no mutation entry points)", () => {
  const registry = new CandidateRegistry(() => "2026-10-11T08:00:00Z");
  registry.submitCandidate({
    round_id: "round_00000004",
    author_expert_id: "exp_00000001",
    candidate_package: candidatePackage(),
  });
  const versions = registry.versions("cand_round_00000004_exp_00000001");
  assert.equal(versions.length, 1);
  // 快照是拷贝：外部改动不影响登记处。
  (versions as unknown as unknown[]).pop();
  assert.equal(registry.versions("cand_round_00000004_exp_00000001").length, 1);
});
