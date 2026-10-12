import assert from "node:assert/strict";
import test from "node:test";
import { checkCapabilityGapReport, computeCanonicalDigest } from "@arena/acquisition";
import { RightsGrantRegistry } from "@arena/learning";
import {
  CapabilityPublicationFlow,
  TargetAgentHarness,
  UpgradeStore,
  createPackConsultation,
  runCapabilityEvaluation,
  isRecordableAsEvidence,
  ScopedRetrievalIndexStrategy,
  type CapabilityPack,
} from "../src/contract.js";
import { buildTransformationManifest, replayManifest, computeManifestDigest } from "../src/manifest.js";
import { validateDatasetIntake } from "../src/intake.js";
import { selectStrategy as select } from "../src/strategy/port.js";
import {
  ACTOR_AUTHOR,
  ACTOR_CLIENT,
  CLIENT,
  NOW,
  LATER,
  TENANT_ALPHA,
  blenderDataset,
  blenderDatasetV2,
  bodyVersion,
  evaluationSuite,
  gapReport,
  manifestOps,
  regressionDetectorSuite,
  rightsGrant,
  tenantContext,
  upgradePolicy,
  upgradeProposal,
} from "./fixtures.js";

/**
 * AR2-018 验收（issue #34）组 7：端到端集成验收 fixture（spec §10 条目 6–7）——
 * 种子缺口 → fixture 数据集 → 校验 manifest → retrieval-index pack →
 * before/after 可测提升 → 采纳不可变版本 → 后续回归触发 rollback，
 * 历史评估证据原样保留。单文件全流程、全确定性。
 */

test("endtoend: seeded gap → dataset → manifest → pack → measured delta → publish → adopt → regression → rollback", () => {
  /* 1. the seeded gap: reference-data lookups the baseline agent fails */
  const gap = gapReport();
  const gapCheck = checkCapabilityGapReport(gap);
  assert.equal(gapCheck.ok, true, "the gap report is a valid ACQ1.0 record");

  /* 2. the fixture dataset arrives (SCRP1.0 artifact) */
  const dataset = blenderDataset();
  const registry = new RightsGrantRegistry();
  registry.recordGrant(rightsGrant());
  const store = new UpgradeStore();
  const flow = new CapabilityPublicationFlow(store, registry);

  /* 3. intake: provenance, rights, integrity, policy, quality — all recorded */
  const intake = validateDatasetIntake({
    dataset,
    tenant_context: tenantContext(TENANT_ALPHA),
    rights_registry: registry,
    policy: {
      permitted_source_patterns: ["docs.example.org", "*.example.org", "internal.example.org"],
      privacy_profile: "TENANT",
      retention_profile: "STANDARD",
    },
    now: NOW,
    intake_id: "itk_00000001",
    correlation_id: "cor_00000042",
    recorded_by: ACTOR_AUTHOR,
  });
  assert.equal(intake.outcome, "ACCEPTED");
  assert.equal(intake.rights.state, "LINKED");

  /* 4. the validated dataset is transformed under an immutable, replayable manifest */
  const built = buildTransformationManifest({
    dataset,
    intake_id: intake.intake_id,
    manifest_id: "mfs_00000001",
    ops: manifestOps(),
    now: NOW,
    created_by: ACTOR_AUTHOR,
  });
  assert.equal(built.outcome.kind, "OK");
  const manifest = built.manifest!;
  const replay = replayManifest(dataset, manifest);
  assert.equal(replay.outcome.kind, "OK");

  /* 5. strategy selection records why (preferred order, first applicable) */
  const policy = upgradePolicy();
  const selection = select(
    {
      SCOPED_RETRIEVAL_INDEX: new ScopedRetrievalIndexStrategy(),
    },
    { entries: replay.entries, policy },
  );
  assert.equal(selection.strategy, "SCOPED_RETRIEVAL_INDEX");
  assert.equal(selection.reason_code, "first_applicable_preferred_order");

  /* 6. deterministic pack build */
  const proposal = upgradeProposal({
    delivery_strategy: selection,
    source: {
      dataset_id: dataset.dataset_id,
      intake_id: intake.intake_id,
      manifest_id: manifest.manifest_id,
      manifest_digest: computeManifestDigest(manifest),
      source_digest: computeCanonicalDigest(dataset),
    },
  });
  const built2 = new ScopedRetrievalIndexStrategy().build({
    dataset,
    manifest,
    entries: replay.entries,
    proposal,
    policy,
    now: NOW,
    actor: ACTOR_AUTHOR,
    pack_id: "pck_00000001",
    pack_version: 1,
  });
  assert.equal(built2.kind, "BUILT");
  const pack: CapabilityPack = (built2 as { kind: "BUILT"; pack: CapabilityPack }).pack;
  const rebuild = new ScopedRetrievalIndexStrategy().build({
    dataset,
    manifest,
    entries: replay.entries,
    proposal,
    policy,
    now: "2030-01-01T00:00:00Z",
    actor: ACTOR_AUTHOR,
    pack_id: "pck_00000001",
    pack_version: 1,
  });
  assert.equal((rebuild as { pack: CapabilityPack }).pack.content_digest, pack.content_digest);

  /* 7. before/after evaluation on the pinned suite — the only capability claim */
  const suite = evaluationSuite();
  const consultation = createPackConsultation(pack, TENANT_ALPHA);
  const evaluation = runCapabilityEvaluation({
    suite,
    proposal,
    baselineHarness: new TargetAgentHarness({ mode: "BASELINE" }),
    candidateHarness: new TargetAgentHarness({ mode: "CANDIDATE", consultation }),
    pack,
    runIds: { baseline: "run_evalbase001", candidate: "run_evalcand001", delta: "dlt_00000001" },
    now: NOW,
    actor: ACTOR_AUTHOR,
    evidencePrefix: [
      { stage: "SOURCE_CAPTURE", ref_id: dataset.dataset_id, content_digest: computeCanonicalDigest(dataset), recorded_at: NOW },
      { stage: "TRANSFORMATION", ref_id: manifest.manifest_id, content_digest: computeManifestDigest(manifest), recorded_at: NOW },
      { stage: "PACK_BUILD", ref_id: pack.pack_id, content_digest: pack.content_digest, recorded_at: NOW },
      { stage: "TARGET_CAPABILITY_VERSION", ref_id: bodyVersion().body_id, content_digest: proposal.target_capability.content_digest, recorded_at: NOW },
    ],
  });
  assert.equal(evaluation.delta.target.baseline_mean, 0);
  assert.equal(evaluation.delta.target.candidate_mean, 1);
  assert.equal(evaluation.delta.target.delta, 1);
  assert.equal(evaluation.delta.thresholds_met, true);
  assert.equal(evaluation.delta.leakage.all_passed, true);
  assert.equal(evaluation.delta.guardrails.all_passed, true);
  store.recordEvaluation(evaluation.baseline);
  store.recordEvaluation(evaluation.candidate);
  store.recordDelta(evaluation.delta);

  /* 8. publication: threshold gate + rights-at-publication → immutable version */
  const submitted = store.submitProposal(tenantContext(TENANT_ALPHA), proposal);
  assert.equal(submitted.kind, "RECORDED");
  const storedProposal = store.getProposal(tenantContext(TENANT_ALPHA), proposal.proposal_id)!;
  store.appendProposalEvent(tenantContext(TENANT_ALPHA), proposal.proposal_id, {
    event_id: "evt_evaluation1",
    to: "EVALUATED",
    reason_code: "evaluation_completed",
    actor: ACTOR_AUTHOR,
    at: NOW,
  });
  assert.equal(storedProposal.state, "EVALUATED");
  const decision = flow.publish({
    tenant: tenantContext(TENANT_ALPHA),
    proposal: storedProposal,
    delta: evaluation.delta,
    baselineRun: evaluation.baseline,
    candidateRun: evaluation.candidate,
    pack,
    adoptingClient: CLIENT,
    decision_id: "dec_00000001",
    now: NOW,
    actor: ACTOR_AUTHOR,
  }).decision;
  assert.equal(decision.outcome, "PUBLISHED");
  assert.ok(decision.evidence.every((record) => isRecordableAsEvidence(record as never)));
  const adoption = flow.adopt({
    tenant: tenantContext(TENANT_ALPHA),
    decision,
    client: CLIENT,
    adoption_id: "adp_00000001",
    now: NOW,
  });
  assert.equal(adoption.kind, "ADOPTED");
  const adopted = store.getPack(tenantContext(TENANT_ALPHA), "pck_00000001", 1);
  assert.ok(adopted !== null);
  assert.equal(adopted.content_digest, pack.content_digest, "the client adopted the immutable version");

  /* 9. a later regression fixture triggers rollback without rewriting history */
  const v2Dataset = blenderDatasetV2();
  const v2Manifest = buildTransformationManifest({
    dataset: v2Dataset,
    intake_id: "itk_00000002",
    manifest_id: "mfs_00000002",
    ops: manifestOps(),
    now: LATER,
    created_by: ACTOR_AUTHOR,
  });
  const proposal2 = upgradeProposal({
    proposal_id: "prp_00000002",
    idempotency_key: "idem-ar2-018-0002",
    source: {
      dataset_id: v2Dataset.dataset_id,
      intake_id: "itk_00000002",
      manifest_id: "mfs_00000002",
      manifest_digest: computeManifestDigest(v2Manifest.manifest!),
      source_digest: computeCanonicalDigest(v2Dataset),
    },
  });
  const v2Build = new ScopedRetrievalIndexStrategy().build({
    dataset: v2Dataset,
    manifest: v2Manifest.manifest!,
    entries: v2Manifest.entries,
    proposal: proposal2,
    policy,
    now: LATER,
    actor: ACTOR_AUTHOR,
    pack_id: "pck_00000001",
    pack_version: 2,
  });
  assert.equal(v2Build.kind, "BUILT");
  const packV2 = (v2Build as { kind: "BUILT"; pack: CapabilityPack }).pack;
  const v2Suite = evaluationSuite({
    suite_id: "sut_00000002",
    suite_version: "1.1.0",
    target_tasks: [
      { task_id: "tsk_00000001", fixture_input: "What is the roughness of Brushed Metal?", expected_output: "0.35", grader: { kind: "EXACT_MATCH" } },
      { task_id: "tsk_00000002", fixture_input: "What is the node of Noisy Scratch?", expected_output: "tex_noise", grader: { kind: "EXACT_MATCH" } },
    ],
  });
  const evaluation2 = runCapabilityEvaluation({
    suite: v2Suite,
    proposal: proposal2,
    baselineHarness: new TargetAgentHarness({ mode: "BASELINE" }),
    candidateHarness: new TargetAgentHarness({
      mode: "CANDIDATE",
      consultation: createPackConsultation(packV2, TENANT_ALPHA),
    }),
    pack: packV2,
    runIds: { baseline: "run_evalbase002", candidate: "run_evalcand002", delta: "dlt_00000002" },
    now: LATER,
    actor: ACTOR_AUTHOR,
    evidencePrefix: [],
  });
  assert.equal(evaluation2.delta.thresholds_met, true);
  store.submitProposal(tenantContext(TENANT_ALPHA), proposal2);
  const stored2 = store.getProposal(tenantContext(TENANT_ALPHA), proposal2.proposal_id)!;
  store.appendProposalEvent(tenantContext(TENANT_ALPHA), proposal2.proposal_id, {
    event_id: "evt_evaluation2",
    to: "EVALUATED",
    reason_code: "evaluation_completed",
    actor: ACTOR_AUTHOR,
    at: LATER,
  });
  const decision2 = flow.publish({
    tenant: tenantContext(TENANT_ALPHA),
    proposal: stored2,
    delta: evaluation2.delta,
    baselineRun: evaluation2.baseline,
    candidateRun: evaluation2.candidate,
    pack: packV2,
    adoptingClient: CLIENT,
    decision_id: "dec_00000002",
    now: LATER,
    actor: ACTOR_AUTHOR,
  }).decision;
  assert.equal(decision2.outcome, "PUBLISHED");
  assert.deepEqual(decision2.rollback_pointer, { pack_id: "pck_00000001", version: 1 });
  flow.adopt({ tenant: tenantContext(TENANT_ALPHA), decision: decision2, client: CLIENT, adoption_id: "adp_00000002", now: LATER });

  // post-adoption regression: the drifted v2 lost the wet-glass reference v1 carried
  const regressionCheck = runCapabilityEvaluation({
    suite: regressionDetectorSuite(),
    proposal: proposal2,
    baselineHarness: new TargetAgentHarness({ mode: "BASELINE" }),
    candidateHarness: new TargetAgentHarness({
      mode: "CANDIDATE",
      consultation: createPackConsultation(packV2, TENANT_ALPHA),
    }),
    pack: packV2,
    runIds: { baseline: "run_evalbase003", candidate: "run_evalcand003", delta: "dlt_00000003" },
    now: LATER,
    actor: ACTOR_AUTHOR,
    evidencePrefix: [],
  });
  assert.equal(regressionCheck.delta.target.candidate_mean, 0, "v2 fails the wet-glass lookup v1 passed");

  const historyBefore = {
    decisions: JSON.stringify(store.listDecisions(tenantContext(TENANT_ALPHA))),
    evaluations: JSON.stringify(store.evaluationRecords(tenantContext(TENANT_ALPHA))),
    packV1: JSON.stringify(store.getPack(tenantContext(TENANT_ALPHA), "pck_00000001", 1)),
  };
  const rollback = flow.rollback({
    tenant: tenantContext(TENANT_ALPHA),
    pack_id: "pck_00000001",
    from_version: 2,
    to_version: 1,
    reason: "post-adoption regression: wet-glass ior lookups regressed after source drift",
    rollback_id: "rlb_00000001",
    now: LATER,
    actor: ACTOR_CLIENT,
  });
  assert.equal(rollback.kind, "ROLLED_BACK");
  // history preserved byte-for-byte; the previous version stays queryable
  assert.equal(JSON.stringify(store.listDecisions(tenantContext(TENANT_ALPHA))), historyBefore.decisions);
  assert.equal(JSON.stringify(store.evaluationRecords(tenantContext(TENANT_ALPHA))), historyBefore.evaluations);
  assert.equal(JSON.stringify(store.getPack(tenantContext(TENANT_ALPHA), "pck_00000001", 1)), historyBefore.packV1);
  assert.ok(store.getPack(tenantContext(TENANT_ALPHA), "pck_00000001", 1) !== null);
  assert.ok(store.getPack(tenantContext(TENANT_ALPHA), "pck_00000001", 2) !== null);
  assert.equal(store.listRollbacks(tenantContext(TENANT_ALPHA)).length, 1);
});
