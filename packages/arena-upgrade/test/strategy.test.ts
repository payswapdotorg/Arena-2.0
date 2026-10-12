import assert from "node:assert/strict";
import test from "node:test";
import { RightsGrantRegistry } from "@arena/learning";
import {
  ScopedRetrievalIndexStrategy,
  StructuredKnowledgePackStrategy,
  ToolAdapterStrategy,
  RulesExamplesStrategy,
  AuthorizedFineTuningStrategy,
  createPackConsultation,
  toolQuery,
  selectStrategy,
  scopeEntries,
  type StrategyBuildInput,
  type CapabilityStrategy,
} from "../src/contract.js";
import { buildTransformationManifest } from "../src/manifest.js";
import { validateDatasetIntake } from "../src/intake.js";
import {
  ACTOR_AUTHOR,
  NOW,
  TENANT_ALPHA,
  TENANT_BETA,
  blenderDataset,
  manifestOps,
  rightsGrant,
  rulesDataset,
  tenantContext,
  upgradePolicy,
  upgradeProposal,
  CROSS_TENANT_MARKER,
  CREDENTIAL_MARKER,
  PII_MARKER,
} from "./fixtures.js";

/**
 * AR2-018 验收（issue #34）组 4：delivery strategies —— 每个策略确定性构建
 * （同输入 → 同摘要两次）、scoped retrieval 只在授权租户/权利范围内应答、
 * knowledge pack 带引用、tool adapter 强制权限/限流、fine-tuning stub
 * 门禁、选择顺序 + reason codes。
 */

const STRATEGIES: Record<string, CapabilityStrategy> = {
  SCOPED_RETRIEVAL_INDEX: new ScopedRetrievalIndexStrategy(),
  STRUCTURED_KNOWLEDGE_PACK: new StructuredKnowledgePackStrategy(),
  TOOL_ADAPTER: new ToolAdapterStrategy(),
  RULES_EXAMPLES: new RulesExamplesStrategy(),
  AUTHORIZED_FINE_TUNING: new AuthorizedFineTuningStrategy(),
};

function pipeline(policy = upgradePolicy(), dataset = blenderDataset()) {
  const registry = new RightsGrantRegistry();
  registry.recordGrant(rightsGrant());
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
  const built = buildTransformationManifest({
    dataset,
    intake_id: intake.intake_id,
    manifest_id: "mfs_00000001",
    ops: manifestOps(),
    now: NOW,
    created_by: ACTOR_AUTHOR,
  });
  if (built.outcome.kind !== "OK" || built.manifest === null) {
    throw new Error("fixture manifest build failed");
  }
  const proposal = upgradeProposal({
    policy_snapshot: policy,
    policy_snapshot_digest: "0".repeat(64),
  });
  const input: StrategyBuildInput = {
    dataset,
    manifest: built.manifest,
    entries: built.entries,
    proposal,
    policy,
    now: NOW,
    actor: ACTOR_AUTHOR,
    pack_id: "pck_00000001",
    pack_version: 1,
  };
  return { intake, manifest: built.manifest, entries: built.entries, input };
}

test("strategy: each packable strategy builds a deterministic pack (same inputs, same digest twice)", () => {
  for (const id of ["SCOPED_RETRIEVAL_INDEX", "STRUCTURED_KNOWLEDGE_PACK", "TOOL_ADAPTER", "RULES_EXAMPLES"]) {
    const { input } = pipeline(upgradePolicy(), rulesDataset());
    const first = STRATEGIES[id]!.build(input);
    const second = STRATEGIES[id]!.build({ ...input, now: "2027-01-01T00:00:00Z" });
    assert.equal(first.kind, "BUILT", `${id} must build`);
    assert.equal(second.kind, "BUILT", `${id} must rebuild`);
    if (first.kind === "BUILT" && second.kind === "BUILT") {
      assert.equal(first.pack.content_digest, second.pack.content_digest, `${id} digest must be time-independent`);
      assert.equal(first.pack.content_digest, first.pack.content_digest);
      assert.match(first.pack.content_digest, /^[a-f0-9]{64}$/);
      assert.equal(first.pack.build_provenance.deterministic, true);
    }
  }
});

test("strategy: the retrieval index answers only within its licensed/tenant scope", () => {
  const { input } = pipeline();
  const outcome = STRATEGIES.SCOPED_RETRIEVAL_INDEX!.build(input);
  assert.equal(outcome.kind, "BUILT");
  if (outcome.kind !== "BUILT") return;
  const pack = outcome.pack;
  assert.equal(pack.payload.kind, "SCOPED_RETRIEVAL_INDEX");
  // tenant clamp: cross-tenant attachment fails closed (indistinguishable from no pack)
  assert.equal(createPackConsultation(pack, TENANT_ALPHA) !== null, true);
  assert.equal(createPackConsultation(pack, TENANT_BETA), null);
  // rights scope clamp: the operator-class cross-tenant entry never entered the index
  assert.equal(JSON.stringify(pack.payload).includes(CROSS_TENANT_MARKER), false);
  assert.ok(outcome.log.excluded.some((exclusion) => exclusion.reason_code === "REDACTION_CLASS_NOT_PERMITTED"));
  assert.ok(pack.retention_expiry.excluded_entry_count >= 1);
  // licensed answers carry provenance and citation fields
  if (pack.payload.kind === "SCOPED_RETRIEVAL_INDEX") {
    for (const entry of pack.payload.entries) {
      assert.ok(entry.source_url.length > 0);
      assert.ok(entry.license_assessment.length > 0);
      assert.ok(entry.terms.length > 0);
      assert.match(entry.content_digest, /^[a-f0-9]{64}$/);
    }
  }
});

test("strategy: the knowledge pack normalizes entries with per-entry citation and provenance", () => {
  const { input } = pipeline();
  const outcome = STRATEGIES.STRUCTURED_KNOWLEDGE_PACK!.build(input);
  assert.equal(outcome.kind, "BUILT");
  if (outcome.kind !== "BUILT") return;
  assert.equal(outcome.pack.payload.kind, "STRUCTURED_KNOWLEDGE_PACK");
  if (outcome.pack.payload.kind !== "STRUCTURED_KNOWLEDGE_PACK") return;
  const brushed = outcome.pack.payload.table.find((row) => row.key === "Brushed Metal");
  assert.ok(brushed !== undefined);
  assert.equal(brushed.fields.roughness, "0.35");
  assert.equal(brushed.fields.node, "bsdf_principled");
  assert.ok(brushed.citation.source_url.includes("docs.example.org"));
  assert.ok(brushed.citation.retrieved_at.length > 0);
  assert.ok(brushed.citation.license_assessment.length > 0);
});

test("strategy: the tool adapter enforces its permission and rate-limit surface", () => {
  const { input } = pipeline();
  const outcome = STRATEGIES.TOOL_ADAPTER!.build(input);
  assert.equal(outcome.kind, "BUILT");
  if (outcome.kind !== "BUILT") return;
  const pack = outcome.pack;
  assert.equal(pack.payload.kind, "TOOL_ADAPTER");
  const alpha = tenantContext(TENANT_ALPHA);
  const first = toolQuery(pack, TENANT_ALPHA, "roughness brushed metal");
  assert.equal(first.kind, "RESULT");
  if (first.kind === "RESULT") {
    assert.ok(first.rows!.length > 0);
    assert.ok(first.rows![0]!.content.includes("material: Brushed Metal"));
  }
  // cross-tenant invocation is refused
  const cross = toolQuery(pack, TENANT_BETA, "roughness brushed metal");
  assert.equal(cross.kind, "REFUSED");
  // non-tool packs expose no tool interface
  const retrieval = STRATEGIES.SCOPED_RETRIEVAL_INDEX!.build(input);
  if (retrieval.kind === "BUILT") {
    assert.equal(toolQuery(retrieval.pack, TENANT_ALPHA, "anything").kind, "REFUSED");
  }
  // rate limit: a manually pinned low limit refuses the third same-minute call
  const limited = structuredClone(pack);
  if (limited.payload.kind === "TOOL_ADAPTER") {
    limited.payload.tool.rate_limits.max_calls_per_minute = 2;
    let clock = 1_000_000;
    const window = new Map<string, number>();
    const call = () => toolQuery(limited, TENANT_ALPHA, "roughness brushed metal", { nowMs: () => clock, windowRef: window });
    assert.equal(call().kind, "RESULT");
    assert.equal(call().kind, "RESULT");
    assert.equal(call().kind, "REFUSED");
    clock += 60_000;
    assert.equal(call().kind, "RESULT");
  }
  void alpha;
});

test("strategy: the rules strategy extracts evaluated rule artifacts with citation", () => {
  const { input } = pipeline(upgradePolicy(), rulesDataset());
  const outcome = STRATEGIES.RULES_EXAMPLES!.build(input);
  assert.equal(outcome.kind, "BUILT");
  if (outcome.kind !== "BUILT") return;
  assert.equal(outcome.pack.payload.kind, "RULES_EXAMPLES");
  if (outcome.pack.payload.kind !== "RULES_EXAMPLES") return;
  assert.equal(outcome.pack.payload.artifacts.length, 1);
  const artifact = outcome.pack.payload.artifacts[0]!;
  assert.match(artifact.rule_text, /use roughness 0\.5 for default metals/);
  assert.equal(artifact.example_input, "default metal finish");
  assert.equal(artifact.example_output, "roughness 0.5");
  assert.ok(artifact.citation.source_url.includes("docs.example.org"));
});

test("strategy: the fine-tuning stub refuses without the full authorization chain (typed throw)", () => {
  const { input } = pipeline(
    upgradePolicy({
      permitted_use_kinds: ["FINE_TUNING"],
      fine_tuning_authorized: true,
      fine_tuning_approval_ref: "approval:ACR-finetune-2026-10",
    }),
  );
  assert.throws(
    () => STRATEGIES.AUTHORIZED_FINE_TUNING!.build(input),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const envelope = (error as { envelope?: { code: string } }).envelope;
      assert.equal(envelope?.code, "UPG_FINE_TUNING_NOT_AUTHORIZED");
      return true;
    },
  );
});

test("strategy: with every gate present the stub still records-not-trains", () => {
  const policy = upgradePolicy({
    permitted_use_kinds: ["FINE_TUNING"],
    fine_tuning_authorized: true,
    fine_tuning_approval_ref: "approval:ACR-finetune-2026-10",
  });
  const { input } = pipeline(policy);
  const outcome = STRATEGIES.AUTHORIZED_FINE_TUNING!.build({
    ...input,
    fine_tuning_authorization: {
      authorized: true,
      rights_documented: true,
      privacy_review_ref: "review:privacy-2026-10-12",
      dataset_validation_ref: "itk_00000001",
      model_target: { model_id: "mdl_target0001", version: "2.1.0", config_digest: "9".repeat(64) },
      rollback_provenance_ref: "prv_rollback00001",
    },
  });
  assert.equal(outcome.kind, "RECORDED_NOT_TRAINED");
  if (outcome.kind === "RECORDED_NOT_TRAINED") {
    assert.equal(outcome.record.trained, false);
    assert.equal(outcome.record.recorded, true);
    assert.equal(outcome.record.model_target?.model_id, "mdl_target0001");
    assert.ok(outcome.record.gates.every((gate) => gate.satisfied));
    assert.match(outcome.record.note, /NOT TRAINED/);
  }
});

test("strategy: selection walks the preferred order and records why", () => {
  const { entries } = pipeline();
  const full = selectStrategy(STRATEGIES, { entries, policy: upgradePolicy() });
  assert.equal(full.strategy, "SCOPED_RETRIEVAL_INDEX");
  assert.equal(full.reason_code, "first_applicable_preferred_order");
  assert.equal(full.applied_order[0]!.strategy, "SCOPED_RETRIEVAL_INDEX");
  assert.equal(full.applied_order[0]!.applicable, true);

  const knowledgeOnly = selectStrategy(STRATEGIES, {
    entries,
    policy: upgradePolicy({ permitted_use_kinds: ["KNOWLEDGE_PACK"] }),
  });
  assert.equal(knowledgeOnly.strategy, "STRUCTURED_KNOWLEDGE_PACK");
  assert.equal(knowledgeOnly.applied_order[0]!.applicable, false);
  assert.equal(knowledgeOnly.applied_order[0]!.reason_code, "retrieval_use_not_permitted");

  const toolOnly = selectStrategy(STRATEGIES, {
    entries,
    policy: upgradePolicy({ permitted_use_kinds: ["TOOL_ADAPTER"] }),
  });
  assert.equal(toolOnly.strategy, "TOOL_ADAPTER");

  const rulesOnly = selectStrategy(STRATEGIES, {
    entries: pipeline(upgradePolicy(), rulesDataset()).entries,
    policy: upgradePolicy({ permitted_use_kinds: ["EXAMPLES_RULES"] }),
  });
  assert.equal(rulesOnly.strategy, "RULES_EXAMPLES");

  const unauthorizedFineTuning = selectStrategy(STRATEGIES, {
    entries,
    policy: upgradePolicy({ permitted_use_kinds: ["FINE_TUNING"] }),
  });
  assert.equal(unauthorizedFineTuning.reason_code, "no_strategy_applicable");

  const authorizedFineTuning = selectStrategy(STRATEGIES, {
    entries,
    policy: upgradePolicy({
      permitted_use_kinds: ["FINE_TUNING"],
      fine_tuning_authorized: true,
      fine_tuning_approval_ref: "approval:ACR-finetune-2026-10",
    }),
  });
  assert.equal(authorizedFineTuning.strategy, "AUTHORIZED_FINE_TUNING");
  assert.equal(authorizedFineTuning.applied_order[0]!.reason_code, "retrieval_use_not_permitted");
});

test("strategy: pack builds never contain credentials or policy-redacted PII", () => {
  const { input } = pipeline();
  const outcome = STRATEGIES.SCOPED_RETRIEVAL_INDEX!.build(input);
  assert.equal(outcome.kind, "BUILT");
  if (outcome.kind !== "BUILT") return;
  const serialized = JSON.stringify(outcome.pack);
  assert.equal(serialized.includes(CREDENTIAL_MARKER), false, "credential must be scrubbed");
  assert.equal(serialized.includes(PII_MARKER), false, "PII must be redacted under policy");
  assert.ok(serialized.includes("[REDACTED:credential]"));
  assert.ok(serialized.includes("[PII-REDACTED:email]"));
});

test("strategy: PII redaction is policy-gated (propagation follows retention policy)", () => {
  const { entries } = pipeline();
  const noPiiPolicy = upgradePolicy({ pii_redaction_required: false });
  const scoped = scopeEntries(entries, noPiiPolicy);
  assert.ok(scoped.included.some(({ content }) => content.includes(PII_MARKER)));
  const withPiiPolicy = scopeEntries(entries, upgradePolicy());
  assert.ok(withPiiPolicy.included.every(({ content }) => !content.includes(PII_MARKER)));
});
