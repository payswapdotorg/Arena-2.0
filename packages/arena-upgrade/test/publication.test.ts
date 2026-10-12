import assert from "node:assert/strict";
import test from "node:test";
import { RightsGrantRegistry, compositionDigestOf } from "@arena/learning";
import {
  CapabilityPublicationFlow,
  TargetAgentHarness,
  UpgradeStore,
  createPackConsultation,
  runCapabilityEvaluation,
  computePackContentDigest,
  type CapabilityPack,
} from "../src/contract.js";
import { ScopedRetrievalIndexStrategy } from "../src/strategy/retrieval-index.js";
import { buildTransformationManifest } from "../src/manifest.js";
import {
  ACTOR_AUTHOR,
  ACTOR_CLIENT,
  CLIENT,
  NOW,
  LATER,
  TENANT_ALPHA,
  TENANT_BETA,
  blenderDataset,
  blenderDatasetV2,
  evaluationSuite,
  bodyVersion,
  manifestOps,
  rightsGrant,
  tenantContext,
  upgradePolicy,
  upgradeProposal,
  regressionDetectorSuite,
} from "./fixtures.js";

/**
 * AR2-018 验收（issue #34）组 6：publication —— 阈值达标 + rights OK →
 * 仅在批准范围内 PUBLISHED；阈值未达 → INCONCLUSIVE（旧版本保留）；
 * 发布时 rights 失败 → BLOCKED；rollback 追加事件且历史证据字节不变；
 * popularity 洪峰不能翻转 rights-blocked 决策（守卫测试）。
 */

function buildPack(dataset = blenderDataset(), packVersion = 1, packId = "pck_00000001"): CapabilityPack {
  const built = buildTransformationManifest({
    dataset,
    intake_id: "itk_00000001",
    manifest_id: "mfs_00000001",
    ops: manifestOps(),
    now: NOW,
    created_by: ACTOR_AUTHOR,
  });
  if (built.outcome.kind !== "OK" || built.manifest === null) throw new Error("fixture build failed");
  const proposal = upgradeProposal();
  const outcome = new ScopedRetrievalIndexStrategy().build({
    dataset,
    manifest: built.manifest,
    entries: built.entries,
    proposal,
    policy: upgradePolicy(),
    now: NOW,
    actor: ACTOR_AUTHOR,
    pack_id: packId,
    pack_version: packVersion,
  });
  if (outcome.kind !== "BUILT") throw new Error("pack build failed");
  return outcome.pack;
}

function evaluatePack(pack: CapabilityPack, suite = evaluationSuite()) {
  const proposal = upgradeProposal();
  return runCapabilityEvaluation({
    suite,
    proposal,
    baselineHarness: new TargetAgentHarness({ mode: "BASELINE" }),
    candidateHarness: new TargetAgentHarness({
      mode: "CANDIDATE",
      consultation: createPackConsultation(pack, TENANT_ALPHA),
    }),
    pack,
    runIds: { baseline: "run_evalbase001", candidate: "run_evalcand001", delta: "dlt_00000001" },
    now: NOW,
    actor: ACTOR_AUTHOR,
    evidencePrefix: [],
  });
}

function setup(registry = new RightsGrantRegistry()) {
  registry.recordGrant(rightsGrant());
  const store = new UpgradeStore();
  const flow = new CapabilityPublicationFlow(store, registry);
  const submitAndEvaluate = (input = upgradeProposal()) => {
    const submitted = store.submitProposal(tenantContext(TENANT_ALPHA), input);
    assert.equal(submitted.kind, "RECORDED");
    // zod parsing clones: publish must see the STORED (live) aggregate, not the input copy
    const stored = store.getProposal(tenantContext(TENANT_ALPHA), input.proposal_id);
    if (stored === null) throw new Error("proposal not stored");
    const transition = store.appendProposalEvent(tenantContext(TENANT_ALPHA), input.proposal_id, {
      event_id: "evt_evaluation1",
      to: "EVALUATED",
      reason_code: "evaluation_completed",
      actor: ACTOR_AUTHOR,
      at: NOW,
    });
    assert.equal(transition.kind, "APPENDED");
    return stored;
  };
  return { store, flow, registry, submitAndEvaluate };
}

test("publication: threshold met + rights ok publishes within the approved scope only", () => {
  const { store, flow, submitAndEvaluate } = setup();
  const pack = buildPack();
  const { baseline, candidate, delta } = evaluatePack(pack);
  store.recordEvaluation(baseline);
  store.recordEvaluation(candidate);
  store.recordDelta(delta);
  const proposal = submitAndEvaluate();
  const outcome = flow.publish({
    tenant: tenantContext(TENANT_ALPHA),
    proposal,
    delta,
    baselineRun: baseline,
    candidateRun: candidate,
    pack,
    adoptingClient: CLIENT,
    decision_id: "dec_00000001",
    now: NOW,
    actor: ACTOR_AUTHOR,
  });
  assert.equal(outcome.decision.outcome, "PUBLISHED");
  assert.equal(outcome.decision.reason_code, "thresholds_and_gates_met");
  assert.equal(outcome.decision.published_pack!.version, 1);
  assert.equal(outcome.decision.rollback_pointer, null);
  assert.deepEqual(outcome.decision.adopting_client, CLIENT);
  assert.equal(outcome.decision.rights_snapshot.state, "LINKED");
  // evidence chain is walkable: source → transformation → pack → runs → decision
  const stages = outcome.decision.evidence.map((record) => record.stage);
  assert.deepEqual(stages, [
    "SOURCE_CAPTURE",
    "TRANSFORMATION",
    "PACK_BUILD",
    "TARGET_CAPABILITY_VERSION",
    "EVALUATION_BASELINE",
    "EVALUATION_CANDIDATE",
    "DECISION",
  ]);
  // scope clamp: visible to the owning tenant, invisible cross-tenant
  assert.ok(store.getPack(tenantContext(TENANT_ALPHA), "pck_00000001", 1) !== null);
  assert.equal(store.getPack(tenantContext(TENANT_BETA), "pck_00000001", 1), null);
  assert.equal(store.isPublished("pck_00000001", 1), true);
  // proposal terminal state + event appended
  assert.equal(proposal.state, "PUBLISHED");
  assert.equal(proposal.events.length, 2);
  // adoption by the client
  const adoption = flow.adopt({
    tenant: tenantContext(TENANT_ALPHA),
    decision: outcome.decision,
    client: CLIENT,
    adoption_id: "adp_00000001",
    now: NOW,
  });
  assert.equal(adoption.kind, "ADOPTED");
});

test("publication: a threshold miss is INCONCLUSIVE and the previous version is preserved", () => {
  const { store, flow, submitAndEvaluate } = setup();
  const v1 = buildPack();
  const good = evaluatePack(v1);
  const firstProposal = submitAndEvaluate(upgradeProposal());
  const first = flow.publish({
    tenant: tenantContext(TENANT_ALPHA),
    proposal: firstProposal,
    delta: good.delta,
    baselineRun: good.baseline,
    candidateRun: good.candidate,
    pack: v1,
    adoptingClient: CLIENT,
    decision_id: "dec_00000001",
    now: NOW,
    actor: ACTOR_AUTHOR,
  });
  assert.equal(first.decision.outcome, "PUBLISHED");

  // second cycle: drifted dataset answers only 2 of 3 target tasks
  const degradedPack = buildPack(blenderDatasetV2(), 2);
  const strictSuite = evaluationSuite({
    thresholds: { min_target_metric_delta: 0.9, max_regression_failures: 0, require_leakage_pass: true, require_guardrail_pass: true },
  });
  const degraded = evaluatePack(degradedPack, strictSuite);
  assert.equal(degraded.delta.thresholds_met, false);
  const secondProposal = submitAndEvaluate(
    upgradeProposal({
      proposal_id: "prp_00000002",
      idempotency_key: "idem-ar2-018-0002",
      source: { ...upgradeProposal().source, dataset_id: "dst_00000002" },
    }),
  );
  const second = flow.publish({
    tenant: tenantContext(TENANT_ALPHA),
    proposal: secondProposal,
    delta: degraded.delta,
    baselineRun: degraded.baseline,
    candidateRun: degraded.candidate,
    pack: degradedPack,
    adoptingClient: CLIENT,
    decision_id: "dec_00000002",
    now: NOW,
    actor: ACTOR_AUTHOR,
  });
  assert.equal(second.decision.outcome, "INCONCLUSIVE");
  assert.equal(second.decision.reason_code, "thresholds_not_met");
  assert.equal(second.decision.published_pack, null);
  // previous version untouched and still the current published one
  assert.ok(store.getPack(tenantContext(TENANT_ALPHA), "pck_00000001", 1) !== null);
  assert.equal(store.getPack(tenantContext(TENANT_ALPHA), "pck_00000001", 2), null);
  assert.equal(secondProposal.state, "INCONCLUSIVE");
});

test("publication: rights failing at publication time is BLOCKED (fail closed)", () => {
  const { store, flow, registry, submitAndEvaluate } = setup();
  const pack = buildPack();
  const { baseline, candidate, delta } = evaluatePack(pack);
  const proposal = submitAndEvaluate();
  // the grant is revoked AFTER evaluation, BEFORE publication
  registry.revoke("grt_00000001", LATER);
  const outcome = flow.publish({
    tenant: tenantContext(TENANT_ALPHA),
    proposal,
    delta,
    baselineRun: baseline,
    candidateRun: candidate,
    pack,
    adoptingClient: CLIENT,
    decision_id: "dec_00000001",
    now: LATER,
    actor: ACTOR_AUTHOR,
  });
  assert.equal(outcome.decision.outcome, "BLOCKED");
  assert.equal(outcome.decision.reason_code, "rights_grant_revoked");
  assert.equal(outcome.decision.rights_snapshot.state, "DENIED");
  assert.equal(outcome.decision.published_pack, null);
  assert.equal(store.isPublished("pck_00000001", 1), false);
  assert.equal(store.getPack(tenantContext(TENANT_ALPHA), "pck_00000001", 1), null);
  assert.equal(proposal.state, "REJECTED");
  const adoption = flow.adopt({
    tenant: tenantContext(TENANT_ALPHA),
    decision: outcome.decision,
    client: CLIENT,
    adoption_id: "adp_00000001",
    now: LATER,
  });
  assert.equal(adoption.kind, "REJECTED");
});

test("publication: a scope-mismatched grant blocks publication", () => {
  const registry = new RightsGrantRegistry();
  registry.recordGrant(rightsGrant({ scope: "single_tenant_reuse" }));
  const { flow, submitAndEvaluate } = setup(registry);
  const pack = buildPack();
  const { baseline, candidate, delta } = evaluatePack(pack);
  const proposal = submitAndEvaluate(
    upgradeProposal({
      proposed_publication_scope: { tenant_id: TENANT_ALPHA, scope: "marketplace_publication" },
    }),
  );
  const outcome = flow.publish({
    tenant: tenantContext(TENANT_ALPHA),
    proposal,
    delta,
    baselineRun: baseline,
    candidateRun: candidate,
    pack,
    adoptingClient: null,
    decision_id: "dec_00000001",
    now: NOW,
    actor: ACTOR_AUTHOR,
  });
  assert.equal(outcome.decision.outcome, "BLOCKED");
  assert.equal(outcome.decision.reason_code, "rights_scope_mismatch");
  assert.equal(outcome.decision.rights_snapshot.state, "SCOPE_MISMATCH");
});

test("publication: certification binding is verified before publishing (AR2-014 quadruple)", () => {
  const body = bodyVersion();
  const certification = {
    certification_id: "crt_00000001",
    body_id: body.body_id,
    body_version: body.version,
    tested_composition_digest: compositionDigestOf(body),
    policy_digest: "0".repeat(64),
    environment_digest: "1".repeat(64),
    scope_digest: "2".repeat(64),
    certified_at: NOW,
  };
  const { flow, submitAndEvaluate } = setup();
  const pack = buildPack();
  const { baseline, candidate, delta } = evaluatePack(pack);
  const proposal = submitAndEvaluate();

  const bound = flow.publish({
    tenant: tenantContext(TENANT_ALPHA),
    proposal,
    delta,
    baselineRun: baseline,
    candidateRun: candidate,
    pack,
    adoptingClient: null,
    decision_id: "dec_00000001",
    now: NOW,
    actor: ACTOR_AUTHOR,
    certification: { certification, body, policy_digest: "0".repeat(64), environment_digest: "1".repeat(64), scope_digest: "2".repeat(64) },
  });
  assert.equal(bound.decision.outcome, "PUBLISHED");

  const drifted = flow.publish({
    tenant: tenantContext(TENANT_ALPHA),
    proposal: submitAndEvaluate(
      upgradeProposal({ proposal_id: "prp_00000003", idempotency_key: "idem-ar2-018-0003" }),
    ),
    delta,
    baselineRun: baseline,
    candidateRun: candidate,
    pack,
    adoptingClient: null,
    decision_id: "dec_00000009",
    now: NOW,
    actor: ACTOR_AUTHOR,
    certification: { certification, body, policy_digest: "3".repeat(64), environment_digest: "1".repeat(64), scope_digest: "2".repeat(64) },
  });
  assert.equal(drifted.decision.outcome, "BLOCKED");
  assert.equal(drifted.decision.reason_code, "certification_binding_mismatch");
});

test("publication: rollback appends events and preserves historic evidence byte-for-byte", () => {
  const { store, flow, submitAndEvaluate } = setup();
  const v1 = buildPack();
  const good = evaluatePack(v1, evaluationSuite({
    target_tasks: [
      { task_id: "tsk_00000001", fixture_input: "What is the roughness of Brushed Metal?", expected_output: "0.35", grader: { kind: "EXACT_MATCH" } },
    ],
  }));
  const firstProposal = submitAndEvaluate();
  const firstDecision = flow.publish({
    tenant: tenantContext(TENANT_ALPHA),
    proposal: firstProposal,
    delta: good.delta,
    baselineRun: good.baseline,
    candidateRun: good.candidate,
    pack: v1,
    adoptingClient: CLIENT,
    decision_id: "dec_00000001",
    now: NOW,
    actor: ACTOR_AUTHOR,
  }).decision;
  flow.adopt({ tenant: tenantContext(TENANT_ALPHA), decision: firstDecision, client: CLIENT, adoption_id: "adp_00000001", now: NOW });

  // v2 publishes on its own (drifted but self-consistent) suite
  const v2 = buildPack(blenderDatasetV2(), 2);
  const v2Suite = evaluationSuite({
    suite_id: "sut_00000002",
    suite_version: "1.1.0",
    target_tasks: [
      { task_id: "tsk_00000001", fixture_input: "What is the roughness of Brushed Metal?", expected_output: "0.35", grader: { kind: "EXACT_MATCH" } },
    ],
  });
  const second = evaluatePack(v2, v2Suite);
  const secondProposal = submitAndEvaluate(
    upgradeProposal({ proposal_id: "prp_00000002", idempotency_key: "idem-ar2-018-0002" }),
  );
  const secondDecision = flow.publish({
    tenant: tenantContext(TENANT_ALPHA),
    proposal: secondProposal,
    delta: second.delta,
    baselineRun: second.baseline,
    candidateRun: second.candidate,
    pack: v2,
    adoptingClient: CLIENT,
    decision_id: "dec_00000002",
    now: NOW,
    actor: ACTOR_AUTHOR,
  }).decision;
  assert.equal(secondDecision.outcome, "PUBLISHED");
  assert.deepEqual(secondDecision.rollback_pointer, { pack_id: "pck_00000001", version: 1 });
  flow.adopt({ tenant: tenantContext(TENANT_ALPHA), decision: secondDecision, client: CLIENT, adoption_id: "adp_00000002", now: NOW });

  // a later regression-detector evaluation shows v2 lost Wet Glass while v1 had it
  const v2Regression = evaluatePack(v2, regressionDetectorSuite());
  assert.equal(v2Regression.delta.target.candidate_mean, 0);
  const v1Regression = evaluatePack(v1, regressionDetectorSuite());
  assert.equal(v1Regression.delta.target.candidate_mean, 1);

  const before = {
    decisions: JSON.stringify(store.listDecisions(tenantContext(TENANT_ALPHA))),
    evaluations: JSON.stringify(store.evaluationRecords(tenantContext(TENANT_ALPHA))),
    deltas: JSON.stringify(store.deltaRecords(tenantContext(TENANT_ALPHA))),
    packV1: JSON.stringify(store.getPack(tenantContext(TENANT_ALPHA), "pck_00000001", 1)),
  };

  const rollback = flow.rollback({
    tenant: tenantContext(TENANT_ALPHA),
    pack_id: "pck_00000001",
    from_version: 2,
    to_version: 1,
    reason: "post-adoption regression on wet-glass ior lookups",
    rollback_id: "rlb_00000001",
    now: LATER,
    actor: ACTOR_CLIENT,
  });
  assert.equal(rollback.kind, "ROLLED_BACK");
  assert.deepEqual(rollback.record!.evidence_refs, [{ stage: "DECISION", ref_id: "dec_00000002" }]);

  // history untouched: byte-identical snapshots after rollback
  assert.equal(JSON.stringify(store.listDecisions(tenantContext(TENANT_ALPHA))), before.decisions);
  assert.equal(JSON.stringify(store.evaluationRecords(tenantContext(TENANT_ALPHA))), before.evaluations);
  assert.equal(JSON.stringify(store.deltaRecords(tenantContext(TENANT_ALPHA))), before.deltas);
  assert.equal(JSON.stringify(store.getPack(tenantContext(TENANT_ALPHA), "pck_00000001", 1)), before.packV1);
  // both versions remain queryable; the rollback is an appended record
  assert.ok(store.getPack(tenantContext(TENANT_ALPHA), "pck_00000001", 2) !== null);
  const rollbacks = store.listRollbacks(tenantContext(TENANT_ALPHA));
  assert.equal(rollbacks.length, 1);
  assert.equal(rollbacks[0]!.from_version, 2);
  assert.equal(rollbacks[0]!.to_version, 1);

  // rolling back without an adoption, or forward, is rejected
  const invalid = flow.rollback({
    tenant: tenantContext(TENANT_ALPHA),
    pack_id: "pck_00000001",
    from_version: 1,
    to_version: 2,
    reason: "forward is not rollback",
    rollback_id: "rlb_00000002",
    now: LATER,
    actor: ACTOR_CLIENT,
  });
  assert.equal(invalid.kind, "REJECTED");
});

test("publication: a popularity surge never flips a rights-blocked decision (the guard test)", () => {
  const { store, flow, registry, submitAndEvaluate } = setup();
  const pack = buildPack();
  const { baseline, candidate, delta } = evaluatePack(pack);
  const proposal = submitAndEvaluate();
  // one million usage signals recorded for this pack
  for (let index = 0; index < 1_000_000; index += 1) {
    store.recordUsageSignal(tenantContext(TENANT_ALPHA), "pck_00000001", 1);
  }
  assert.equal(store.usageCounter(tenantContext(TENANT_ALPHA), "pck_00000001", 1), 1_000_000);
  // rights revoked: the guard must hold regardless of popularity
  registry.revoke("grt_00000001", LATER);
  const outcome = flow.publish({
    tenant: tenantContext(TENANT_ALPHA),
    proposal,
    delta,
    baselineRun: baseline,
    candidateRun: candidate,
    pack,
    adoptingClient: CLIENT,
    decision_id: "dec_00000001",
    now: LATER,
    actor: ACTOR_AUTHOR,
  });
  assert.equal(outcome.decision.outcome, "BLOCKED");
  assert.equal(outcome.decision.rights_snapshot.state, "DENIED");
  // the counter is recorded as feedback, never consulted
  assert.equal(outcome.decision.feedback.usage_counter_at_decision, 1_000_000);
  assert.match(outcome.decision.feedback.note, /never consults them|no publication code path/);
  // the explicit guard hook is a typed rejection
  const guard = flow.popularityBypassGuard();
  assert.equal(guard.code, "UPG_POPULARITY_IS_NOT_AUTHORITY");
});

test("publication: proposal submission is idempotent (same key replays, drift conflicts)", () => {
  const store = new UpgradeStore();
  const proposal = upgradeProposal();
  const first = store.submitProposal(tenantContext(TENANT_ALPHA), proposal);
  assert.equal(first.kind, "RECORDED");
  const replay = store.submitProposal(tenantContext(TENANT_ALPHA), proposal);
  assert.equal(replay.kind, "REPLAY");
  const drifted = store.submitProposal(
    tenantContext(TENANT_ALPHA),
    upgradeProposal({ cost_retention: { estimated_cost_usd: 99, currency: "USD", retention_profile: "STANDARD", privacy_profile: "TENANT" } }),
  );
  assert.equal(drifted.kind, "REJECTED");
  if (drifted.kind === "REJECTED") assert.equal(drifted.code, "UPG_IDEMPOTENCY_DIGEST_MISMATCH");
  const crossTenant = store.submitProposal(tenantContext(TENANT_BETA), upgradeProposal());
  assert.equal(crossTenant.kind, "REJECTED");
  if (crossTenant.kind === "REJECTED") assert.equal(crossTenant.code, "UPG_TENANT_MISMATCH");
});

test("publication: published pack versions are immutable (new version = new record)", () => {
  const store = new UpgradeStore();
  const v1 = buildPack();
  const first = store.registerPack(tenantContext(TENANT_ALPHA), v1);
  assert.equal(first.kind, "RECORDED");
  const replay = store.registerPack(tenantContext(TENANT_ALPHA), structuredClone(v1));
  assert.equal(replay.kind, "REPLAY");
  // same (pack_id, version) with different content: attacker re-signs the digest — still rejected
  const tampered = structuredClone(v1);
  if (tampered.payload.kind === "SCOPED_RETRIEVAL_INDEX") tampered.payload.entries = [];
  tampered.content_digest = computePackContentDigest(tampered);
  const mutation = store.registerPack(tenantContext(TENANT_ALPHA), tampered);
  assert.equal(mutation.kind, "REJECTED");
  if (mutation.kind === "REJECTED") assert.equal(mutation.code, "UPG_PUBLISHED_VERSION_IMMUTABLE");
  // a lower version number than the recorded lineage is rejected (monotonic):
  // v1 and v3 recorded; a never-recorded v2 sits below the lineage maximum.
  const v3 = buildPack(undefined, 3);
  assert.equal(store.registerPack(tenantContext(TENANT_ALPHA), v3).kind, "RECORDED");
  const downgraded = store.registerPack(tenantContext(TENANT_ALPHA), buildPack(undefined, 2));
  assert.equal(downgraded.kind, "REJECTED");
  if (downgraded.kind === "REJECTED") assert.equal(downgraded.code, "UPG_PUBLISHED_VERSION_IMMUTABLE");
  // a forged digest that does not match its own content is rejected on integrity
  const forged = buildPack(undefined, 4);
  forged.content_digest = "f".repeat(64);
  const forgedOutcome = store.registerPack(tenantContext(TENANT_ALPHA), forged);
  assert.equal(forgedOutcome.kind, "REJECTED");
  if (forgedOutcome.kind === "REJECTED") assert.equal(forgedOutcome.code, "UPG_INTEGRITY_MISMATCH");
});

test("publication: publishing a non-EVALUATED proposal is impossible", () => {
  const { flow } = setup();
  const pack = buildPack();
  const { baseline, candidate, delta } = evaluatePack(pack);
  assert.throws(() =>
    flow.publish({
      tenant: tenantContext(TENANT_ALPHA),
      proposal: upgradeProposal(),
      delta,
      baselineRun: baseline,
      candidateRun: candidate,
      pack,
      adoptingClient: null,
      decision_id: "dec_00000001",
      now: NOW,
      actor: ACTOR_AUTHOR,
    }),
  /must be EVALUATED/);
});
