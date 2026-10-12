import assert from "node:assert/strict";
import test from "node:test";
import { RightsGrantRegistry } from "@arena/learning";
import {
  CapabilityPublicationFlow,
  TargetAgentHarness,
  UpgradeStore,
  createPackConsultation,
  runCapabilityEvaluation,
  scrubSecrets,
  redactPii,
  type CapabilityPack,
} from "../src/contract.js";
import { ScopedRetrievalIndexStrategy } from "../src/strategy/retrieval-index.js";
import { buildTransformationManifest } from "../src/manifest.js";
import { validateDatasetIntake } from "../src/intake.js";
import {
  ACTOR_AUTHOR,
  CLIENT,
  CREDENTIAL_MARKER,
  CROSS_TENANT_MARKER,
  NOW,
  PII_MARKER,
  TENANT_ALPHA,
  blenderDataset,
  evaluationSuite,
  manifestOps,
  rightsGrant,
  tenantContext,
  upgradePolicy,
  upgradeProposal,
} from "./fixtures.js";

/**
 * AR2-018 验收（issue #34）组 9：秘密卫生 —— 记录/日志/工件绝不包含凭据
 * 值；PII 脱敏类别按保留策略从源数据集传播进 pack。
 */

test("secrets: the credential scrubber neutralizes every modeled credential shape", () => {
  assert.equal(scrubSecrets("token sk-live-abcdef123456789 here"), "token [REDACTED:credential] here");
  assert.equal(scrubSecrets("ghp_" + "0".repeat(36) + " end"), "[REDACTED:credential] end");
  assert.equal(scrubSecrets("key AKIAIOSFODNN7EXAMPLE"), "key [REDACTED:credential]");
  assert.equal(scrubSecrets("auth: Bearer abcdef0123456789abcd"), "auth: [REDACTED:credential]");
  assert.equal(scrubSecrets("apify-token-TEST-DO-NOT-LEAK-0001"), "[REDACTED:credential]");
  assert.equal(scrubSecrets("material: Brushed Metal\nroughness: 0.35"), "material: Brushed Metal\nroughness: 0.35");
});

test("secrets: PII redaction covers the modeled email class", () => {
  assert.equal(redactPii("contact jane.doe@example.org now"), "contact [PII-REDACTED:email] now");
  assert.equal(redactPii("no pii here"), "no pii here");
});

test("secrets: the full record chain never contains the credential or PII values", () => {
  const dataset = blenderDataset();
  const registry = new RightsGrantRegistry();
  registry.recordGrant(rightsGrant());
  const store = new UpgradeStore();
  const flow = new CapabilityPublicationFlow(store, registry);

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

  const built = buildTransformationManifest({
    dataset,
    intake_id: intake.intake_id,
    manifest_id: "mfs_00000001",
    ops: manifestOps(),
    now: NOW,
    created_by: ACTOR_AUTHOR,
  });
  const policy = upgradePolicy();
  const proposal = upgradeProposal({
    source: {
      dataset_id: dataset.dataset_id,
      intake_id: intake.intake_id,
      manifest_id: built.manifest!.manifest_id,
      manifest_digest: "0".repeat(64),
      source_digest: "1".repeat(64),
    },
  });
  const build = new ScopedRetrievalIndexStrategy().build({
    dataset,
    manifest: built.manifest!,
    entries: built.entries,
    proposal,
    policy,
    now: NOW,
    actor: ACTOR_AUTHOR,
    pack_id: "pck_00000001",
    pack_version: 1,
  });
  assert.equal(build.kind, "BUILT");
  const pack: CapabilityPack = (build as { kind: "BUILT"; pack: CapabilityPack }).pack;

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
  store.submitProposal(tenantContext(TENANT_ALPHA), proposal);
  store.appendProposalEvent(tenantContext(TENANT_ALPHA), proposal.proposal_id, {
    event_id: "evt_evaluation1",
    to: "EVALUATED",
    reason_code: "evaluation_completed",
    actor: ACTOR_AUTHOR,
    at: NOW,
  });
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
  assert.equal(decision.outcome, "PUBLISHED");

  // every record class in the chain is serialized and inspected
  for (const [label, serialized] of [
    ["intake", JSON.stringify(intake)],
    ["manifest", JSON.stringify(built.manifest)],
    ["proposal", JSON.stringify(proposal)],
    ["pack", JSON.stringify(pack)],
    ["baseline run", JSON.stringify(evaluation.baseline)],
    ["candidate run", JSON.stringify(evaluation.candidate)],
    ["delta", JSON.stringify(evaluation.delta)],
    ["decision", JSON.stringify(decision)],
  ] as const) {
    assert.equal(serialized.includes(CREDENTIAL_MARKER), false, `${label} leaked the credential`);
    assert.equal(serialized.includes(PII_MARKER), false, `${label} leaked PII`);
    assert.equal(serialized.includes(CROSS_TENANT_MARKER), false, `${label} leaked cross-tenant data`);
  }
});

test("secrets: redaction classes propagate from the source dataset into the pack (retention policy)", () => {
  const dataset = blenderDataset();
  const built = buildTransformationManifest({
    dataset,
    intake_id: "itk_00000001",
    manifest_id: "mfs_00000001",
    ops: manifestOps(),
    now: NOW,
    created_by: ACTOR_AUTHOR,
  });
  const build = new ScopedRetrievalIndexStrategy().build({
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
  assert.equal(build.kind, "BUILT");
  if (build.kind !== "BUILT") return;
  const pack = build.pack;
  // the source observed {public?, tenant, operator}; the pack only carries tenant-class content
  assert.equal(pack.retention_expiry.redaction_class, "tenant");
  assert.equal(pack.retention_expiry.privacy_profile, "TENANT");
  assert.equal(pack.retention_expiry.retention_profile, "STANDARD");
  assert.ok(build.log.excluded.length >= 1);
  assert.ok(build.log.excluded.every((exclusion) => exclusion.reason_code === "REDACTION_CLASS_NOT_PERMITTED"));
  // the operator-class source entry is quarantined out of the payload
  assert.equal(JSON.stringify(pack.payload).includes(CROSS_TENANT_MARKER), false);
  // scrubbed content survives as data with the redaction marker
  assert.ok(JSON.stringify(pack.payload).includes("[REDACTED:credential]"));
  assert.ok(JSON.stringify(pack.payload).includes("[PII-REDACTED:email]"));
});
