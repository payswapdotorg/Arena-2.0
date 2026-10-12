import assert from "node:assert/strict";
import test from "node:test";
import { RightsGrantRegistry } from "@arena/learning";
import {
  CapabilityPublicationFlow,
  TargetAgentHarness,
  UpgradeStore,
  createPackConsultation,
  runCapabilityEvaluation,
  toolQuery,
  type CapabilityPack,
} from "../src/contract.js";
import { ScopedRetrievalIndexStrategy } from "../src/strategy/retrieval-index.js";
import { buildTransformationManifest } from "../src/manifest.js";
import {
  ACTOR_AUTHOR,
  CLIENT,
  NOW,
  TENANT_ALPHA,
  TENANT_BETA,
  blenderDataset,
  evaluationSuite,
  manifestOps,
  rightsGrant,
  tenantContext,
  upgradePolicy,
  upgradeProposal,
} from "./fixtures.js";

/**
 * AR2-018 验收（issue #34）组 8：租户隔离 —— 跨租户读取/写入 fail-closed
 * 且与「不存在」不可区分（404 风格，无存在性预言子），镜像
 * arena-acquisition 的隔离约定。
 */

function buildPack(): CapabilityPack {
  const dataset = blenderDataset();
  const built = buildTransformationManifest({
    dataset,
    intake_id: "itk_00000001",
    manifest_id: "mfs_00000001",
    ops: manifestOps(),
    now: NOW,
    created_by: ACTOR_AUTHOR,
  });
  const outcome = new ScopedRetrievalIndexStrategy().build({
    dataset,
    manifest: built.manifest!,
    entries: built.entries,
    proposal: upgradeProposal(),
    policy: upgradePolicy(),
    now: NOW,
    actor: ACTOR_AUTHOR,
    pack_id: "pck_00000001",
    pack_version: 1,
  });
  if (outcome.kind !== "BUILT") throw new Error("pack build failed");
  return outcome.pack;
}

function setup() {
  const registry = new RightsGrantRegistry();
  registry.recordGrant(rightsGrant());
  const store = new UpgradeStore();
  const flow = new CapabilityPublicationFlow(store, registry);
  const pack = buildPack();
  const proposal = upgradeProposal();
  const submitted = store.submitProposal(tenantContext(TENANT_ALPHA), proposal);
  assert.equal(submitted.kind, "RECORDED");
  store.appendProposalEvent(tenantContext(TENANT_ALPHA), proposal.proposal_id, {
    event_id: "evt_evaluation1",
    to: "EVALUATED",
    reason_code: "evaluation_completed",
    actor: ACTOR_AUTHOR,
    at: NOW,
  });
  const evaluation = runCapabilityEvaluation({
    suite: evaluationSuite(),
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
  store.recordEvaluation(evaluation.baseline);
  const decision = flow.publish({
    tenant: tenantContext(TENANT_ALPHA),
    proposal: store.getProposal(tenantContext(TENANT_ALPHA), proposal.proposal_id)!,
    delta: evaluation.delta,
    baselineRun: evaluation.baseline,
    candidateRun: evaluation.candidate,
    pack,
    adoptingClient: CLIENT,
    decision_id: "dec_00000001",
    now: NOW,
    actor: ACTOR_AUTHOR,
  }).decision;
  flow.adopt({ tenant: tenantContext(TENANT_ALPHA), decision, client: CLIENT, adoption_id: "adp_00000001", now: NOW });
  return { store, flow, pack, proposal, decision, evaluation };
}

test("isolation: cross-tenant proposal reads are indistinguishable from missing (no existence oracle)", () => {
  const { store, proposal } = setup();
  const alpha = tenantContext(TENANT_ALPHA);
  const beta = tenantContext(TENANT_BETA);
  assert.ok(store.getProposal(alpha, proposal.proposal_id) !== null);
  assert.equal(store.getProposal(beta, proposal.proposal_id), null);
  assert.equal(store.getProposal(alpha, "prp_missing999"), null);
  // same code path and same null result for "other tenant" and "does not exist"
  assert.deepEqual(store.getProposal(beta, proposal.proposal_id), store.getProposal(alpha, "prp_missing999"));
});

test("isolation: cross-tenant pack reads and consultation fail closed", () => {
  const { store, pack } = setup();
  const alpha = tenantContext(TENANT_ALPHA);
  const beta = tenantContext(TENANT_BETA);
  assert.ok(store.getPack(alpha, "pck_00000001", 1) !== null);
  assert.equal(store.getPack(beta, "pck_00000001", 1), null);
  assert.equal(store.getPack(beta, "pck_00000001", 1), store.getPack(alpha, "pck_missing001", 1));
  assert.equal(createPackConsultation(pack, TENANT_ALPHA) !== null, true);
  assert.equal(createPackConsultation(pack, TENANT_BETA), null);
  assert.equal(toolQuery(pack, TENANT_BETA, "roughness brushed metal").kind, "REFUSED");
  assert.deepEqual(store.packVersions(beta, "pck_00000001"), []);
});

test("isolation: cross-tenant event appends are BLOCKED as NOT_FOUND (not 403-with-existence)", () => {
  const { store, proposal } = setup();
  const outcome = store.appendProposalEvent(tenantContext(TENANT_BETA), proposal.proposal_id, {
    event_id: "evt_cross_tenant",
    to: "REJECTED",
    reason_code: "attempted_cross_tenant_write",
    actor: ACTOR_AUTHOR,
    at: NOW,
  });
  assert.equal(outcome.kind, "BLOCKED");
  if (outcome.kind === "BLOCKED") assert.equal(outcome.code, "UPG_NOT_FOUND");
  // the stored proposal was not touched
  assert.equal(store.getProposal(tenantContext(TENANT_ALPHA), proposal.proposal_id)!.state, "PUBLISHED");
});

test("isolation: cross-tenant pack registration is rejected (write fail-closed)", () => {
  const { store, pack } = setup();
  const outcome = store.registerPack(tenantContext(TENANT_BETA), pack);
  assert.equal(outcome.kind, "REJECTED");
  if (outcome.kind === "REJECTED") assert.equal(outcome.code, "UPG_TENANT_MISMATCH");
});

test("isolation: decisions, rollbacks, evaluations and deltas are tenant-filtered projections", () => {
  const { store, decision } = setup();
  const alpha = tenantContext(TENANT_ALPHA);
  const beta = tenantContext(TENANT_BETA);
  assert.equal(store.listDecisions(alpha).length, 1);
  assert.deepEqual(store.listDecisions(beta), []);
  assert.equal(store.listDecisions(beta)[0]?.decision_id ?? "none", "none");
  assert.equal(store.listRollbacks(beta).length, 0);
  assert.equal(store.evaluationRecords(beta).length, 0);
  assert.equal(store.deltaRecords(beta).length, 0);
  // usage counters are per-tenant and invisible cross-tenant
  store.recordUsageSignal(alpha, "pck_00000001", 1);
  assert.equal(store.usageCounter(alpha, "pck_00000001", 1), 1);
  assert.equal(store.usageCounter(beta, "pck_00000001", 1), 0);
  void decision;
});

test("isolation: rollback is impossible from another tenant's context", () => {
  const { flow } = setup();
  const outcome = flow.rollback({
    tenant: tenantContext(TENANT_BETA),
    pack_id: "pck_00000001",
    from_version: 1,
    to_version: 1,
    reason: "cross-tenant rollback attempt",
    rollback_id: "rlb_00000001",
    now: NOW,
    actor: ACTOR_AUTHOR,
  });
  assert.equal(outcome.kind, "REJECTED");
  if (outcome.kind === "REJECTED") assert.equal(outcome.code, "UPG_ROLLBACK_NOT_POSSIBLE");
});
