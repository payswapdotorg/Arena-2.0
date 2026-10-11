import assert from "node:assert/strict";
import test from "node:test";
import { learningStateMachine } from "@arena/contracts";
import {
  RightsGrantRegistry,
  ProposalRegistry,
  verifyProvenance,
  BodyVersionRegistry,
  LearningPublicationFlow,
  compositionDigestOf,
  verifyCertificationBinding,
} from "../src/contract.js";
import type { LearningProposal, BodyVersion } from "../src/contract.js";

/**
 * AR2-014 — 权利门控学习验收（issue #16）：
 * 权利失败阻断复用；客户制品默认私有；既有证据不可变（新版本追加）；
 * 认证绑定测试过的组合/策略/环境/范围；发布只经冻结 learningStateMachine。
 */

const NOW = "2026-10-11T14:00:00Z";

function grant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    grant_id: "rgt_00000001",
    tenant_id: "tnt_00000001",
    artifact_ids: ["evd_00000001", "evd_00000002"],
    scope: "marketplace_publication",
    purpose: "publish a hardened prompt rule pack derived from the accepted evidence",
    granted_at: "2026-10-11T10:00:00Z",
    expires_at: null,
    revoked_at: null,
    provenance_terms: "reuse preserves the recorded provenance chain and tenant attribution",
    ...overrides,
  };
}

function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    proposal_id: "lpr_00000001",
    proposal_version: 1,
    tenant_id: "tnt_00000001",
    source_artifact_ids: ["evd_00000001"],
    target_kind: "tool_rule",
    rationale: "the adjudicated root-cause pattern generalizes into a lint rule",
    provenance: [
      {
        node_id: "pnd_00000001",
        kind: "accepted_evidence",
        source_ref: "evd_00000001",
        content_digest: "ab".repeat(32),
        recorded_at: "2026-10-11T09:00:00Z",
        supersedes_node_id: null,
        note: "AR2-007 accepted evidence for the winning attempt",
      },
    ],
    created_at: NOW,
    supersedes_proposal_id: null,
    source_visibility: "tenant_private",
    ...overrides,
  };
}

test("rights failure blocks reuse — customer artifacts are private by default", () => {
  const registry = new RightsGrantRegistry();

  // 无任何授予 → 复用被挡（fail-closed）。
  const noGrant = registry.evaluateReuseRight({
    tenant_id: "tnt_00000001",
    artifact_id: "evd_00000001",
    scope: "marketplace_publication",
    now: NOW,
  });
  assert.equal(noGrant.kind, "RIGHTS_MISSING");
  if (noGrant.kind === "RIGHTS_MISSING") {
    assert.equal(noGrant.reason, "no_grant");
    assert.equal(noGrant.fail_closed, true);
  }

  // 授予后复用放行。
  const recorded = registry.recordGrant(grant());
  assert.equal(recorded.kind, "RECORDED");
  const granted = registry.evaluateReuseRight({
    tenant_id: "tnt_00000001",
    artifact_id: "evd_00000001",
    scope: "marketplace_publication",
    now: NOW,
  });
  assert.equal(granted.kind, "RIGHTS_GRANTED");

  // 范围不匹配 → 挡下。
  const wrongScope = registry.evaluateReuseRight({
    tenant_id: "tnt_00000001",
    artifact_id: "evd_00000001",
    scope: "aggregated_anonymous",
    now: NOW,
  });
  assert.equal(wrongScope.kind === "RIGHTS_MISSING" && wrongScope.reason, "scope_mismatch");

  // 撤销立即生效 → 挡下。
  assert.equal(registry.revoke("rgt_00000001", NOW), true);
  const revoked = registry.evaluateReuseRight({
    tenant_id: "tnt_00000001",
    artifact_id: "evd_00000001",
    scope: "marketplace_publication",
    now: NOW,
  });
  assert.equal(revoked.kind === "RIGHTS_MISSING" && revoked.reason, "grant_revoked");

  // 过期 → 挡下。
  const registry2 = new RightsGrantRegistry();
  registry2.recordGrant(grant({ grant_id: "rgt_00000002", expires_at: "2026-10-11T12:00:00Z" }));
  const expired = registry2.evaluateReuseRight({
    tenant_id: "tnt_00000001",
    artifact_id: "evd_00000001",
    scope: "marketplace_publication",
    now: NOW,
  });
  assert.equal(expired.kind === "RIGHTS_MISSING" && expired.reason, "grant_expired");

  // 未覆盖的制品 → 挡下（租户私有默认）。
  const otherArtifact = registry2.evaluateReuseRight({
    tenant_id: "tnt_00000001",
    artifact_id: "evd_00000009",
    scope: "marketplace_publication",
    now: NOW,
  });
  assert.equal(otherArtifact.kind === "RIGHTS_MISSING" && otherArtifact.reason, "no_grant");

  // 跨租户：别人的授予不可用。
  const crossTenant = registry2.evaluateReuseRight({
    tenant_id: "tnt_00000002",
    artifact_id: "evd_00000001",
    scope: "marketplace_publication",
    now: NOW,
  });
  assert.equal(crossTenant.kind, "RIGHTS_MISSING");
});

test("prior evidence stays immutable — proposals version forward, corrections append", () => {
  const proposals = new ProposalRegistry();
  const first = proposals.submit(proposal());
  assert.equal(first.kind, "RECORDED");

  // 同版本重放 → 拒绝（版本必须严格递增）。
  const replay = proposals.submit(proposal());
  assert.equal(replay.kind, "REJECTED");

  // 新版本 = 新记录（旧版本原样保留）。
  const second = proposals.submit(
    proposal({
      proposal_version: 2,
      supersedes_proposal_id: "lpr_00000001",
      rationale: "refined rule after reviewer feedback (new version, not a rewrite)",
    }),
  );
  assert.equal(second.kind, "RECORDED");
  assert.equal(proposals.versions("lpr_00000001").length, 2);
  assert.equal(proposals.historyIsImmutable("lpr_00000001"), true);
  assert.equal(proposals.current("lpr_00000001")?.proposal_version, 2);

  // 溯源修正：追加 superseding 节点（旧节点保留）。
  const corrected = proposals.submit(
    proposal({
      proposal_version: 3,
      provenance: [
        {
          node_id: "pnd_00000001",
          kind: "accepted_evidence",
          source_ref: "evd_00000001",
          content_digest: "ab".repeat(32),
          recorded_at: "2026-10-11T09:00:00Z",
          supersedes_node_id: null,
          note: "original accepted-evidence node (kept verbatim)",
        },
        {
          node_id: "pnd_00000002",
          kind: "dataset",
          source_ref: "evd_00000001",
          content_digest: "cd".repeat(32),
          recorded_at: "2026-10-11T13:00:00Z",
          supersedes_node_id: "pnd_00000001",
          note: "corrected dataset view (append-only correction)",
        },
      ],
    }),
  );
  assert.equal(corrected.kind, "RECORDED");

  // 悬空修正 → 类型化 GAPS（fail-closed）。
  const dangling = verifyProvenance({
    proposal: proposal() as unknown as LearningProposal,
    all_known_node_ids: [],
  });
  const danglingCheck = verifyProvenance({
    proposal: {
      ...(proposal() as unknown as LearningProposal),
      provenance: [
        {
          node_id: "pnd_00000009",
          kind: "accepted_evidence",
          source_ref: "evd_00000001",
          content_digest: "ab".repeat(32),
          recorded_at: NOW,
          supersedes_node_id: "pnd_does_not_exist_",
          note: "dangling correction",
        },
      ],
    },
    all_known_node_ids: [],
  });
  assert.equal(dangling.kind, "VERIFIED");
  assert.equal(danglingCheck.kind, "GAPS");
  if (danglingCheck.kind === "GAPS") {
    assert.ok(danglingCheck.issues.some((issue) => issue.rule.includes("dangling")));
  }

  // 无溯源节点的源制品 → GAPS。
  const uncovered = verifyProvenance({
    proposal: {
      ...(proposal() as unknown as LearningProposal),
      source_artifact_ids: ["evd_00000001", "evd_00000002"],
    },
    all_known_node_ids: [],
  });
  assert.equal(uncovered.kind, "GAPS");
  if (uncovered.kind === "GAPS") {
    assert.ok(uncovered.issues.some((issue) => issue.rule.includes("evd_00000002")));
  }
});

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    body_id: "body_00000001",
    version: 1,
    composition: [
      {
        part_kind: "tool_rule",
        part_id: "rule_00000001",
        part_version: 1,
        part_digest: "11".repeat(32),
      },
      {
        part_kind: "knowledge_pack",
        part_id: "kpk_00000001",
        part_version: 2,
        part_digest: "22".repeat(32),
      },
    ],
    possession_metadata: {
      owner_tenant_id: "tnt_00000001",
      distribution: "tenant_only",
      derived_from_body_version: null,
    },
    content_digest: "33".repeat(32),
    created_at: NOW,
    deprecated_at: null,
    deprecation_reason: null,
    ...overrides,
  };
}

test("certification binds the tested composition, policy, environment and scope", () => {
  const bodies = new BodyVersionRegistry();
  const recorded = bodies.publishVersion(body());
  assert.equal(recorded.kind, "RECORDED");
  if (recorded.kind !== "RECORDED") return;
  const published = recorded.body as BodyVersion;

  const certification = {
    certification_id: "crt_00000001",
    body_id: "body_00000001",
    body_version: 1,
    tested_composition_digest: compositionDigestOf(published),
    policy_digest: "44".repeat(32),
    environment_digest: "55".repeat(32),
    scope_digest: "66".repeat(32),
    certified_at: NOW,
  };

  // 完全一致 → BINDS。
  const binds = verifyCertificationBinding({
    certification,
    body: published,
    published_policy_digest: "44".repeat(32),
    published_environment_digest: "55".repeat(32),
    published_scope_digest: "66".repeat(32),
  });
  assert.equal(binds.kind, "BINDS");

  // 组合变化（新版本）→ 认证不转移。
  const evolved = bodies.publishVersion(
    body({
      version: 2,
      composition: [
        {
          part_kind: "tool_rule",
          part_id: "rule_00000001",
          part_version: 1,
          part_digest: "11".repeat(32),
        },
        {
          part_kind: "knowledge_pack",
          part_id: "kpk_00000001",
          part_version: 3,
          part_digest: "99".repeat(32),
        },
      ],
      content_digest: "77".repeat(32),
    }),
  );
  assert.equal(evolved.kind, "RECORDED");
  if (evolved.kind !== "RECORDED") return;
  const compositionMismatch = verifyCertificationBinding({
    certification,
    body: evolved.body as BodyVersion,
    published_policy_digest: "44".repeat(32),
    published_environment_digest: "55".repeat(32),
    published_scope_digest: "66".repeat(32),
  });
  assert.equal(compositionMismatch.kind, "MISMATCH");
  if (compositionMismatch.kind === "MISMATCH") {
    assert.ok(compositionMismatch.issues.some((issue) => issue.field === "body_version"));
    assert.ok(
      compositionMismatch.issues.some((issue) => issue.field === "tested_composition_digest"),
    );
  }

  // 策略/环境/范围任一变化 → 认证失效（fail-closed）。
  for (const field of ["policy", "environment", "scope"] as const) {
    const digestMap: Record<string, string> = {
      policy: "44".repeat(32),
      environment: "55".repeat(32),
      scope: "66".repeat(32),
    };
    digestMap[field] = "ee".repeat(32);
    const mismatch = verifyCertificationBinding({
      certification,
      body: published,
      published_policy_digest: digestMap.policy,
      published_environment_digest: digestMap.environment,
      published_scope_digest: digestMap.scope,
    });
    assert.equal(mismatch.kind, "MISMATCH", `${field} change must invalidate the certification`);
  }
});

test("body versions are immutable; deprecation marks (never rewrites) history", () => {
  const bodies = new BodyVersionRegistry();
  bodies.publishVersion(body());
  // 版本回退/重放 → 拒绝。
  const replay = bodies.publishVersion(body());
  assert.equal(replay.kind, "REJECTED");
  // 新版本 → 记录。
  const v2 = bodies.publishVersion(body({ version: 2, content_digest: "77".repeat(32) }));
  assert.equal(v2.kind === "RECORDED", true);
  assert.equal(bodies.versions("body_00000001").length, 2);

  // 弃用 v1：历史保留（版本记录仍在），标记不可重复。
  const deprecated = bodies.deprecate({
    body_id: "body_00000001",
    version: 1,
    deprecated_at: NOW,
    reason: "superseded by version 2 after re-certification",
  });
  assert.equal(deprecated.kind, "DEPRECATED");
  const stillThere = bodies.versions("body_00000001").find((candidate) => candidate.version === 1);
  assert.ok(stillThere !== undefined, "deprecated version remains in history");
  assert.notEqual(stillThere.deprecated_at, null);
  const again = bodies.deprecate({
    body_id: "body_00000001",
    version: 1,
    deprecated_at: NOW,
    reason: "double deprecation attempt",
  });
  assert.equal(again.kind, "ALREADY_DEPRECATED");
});

test("publication flows only through the frozen learning machine (invariant-8 conjunction)", () => {
  const flow = new LearningPublicationFlow();

  // PROPOSED → UNDER_REVIEW：需要版本化提案。
  const badStart = flow.step({ proposal_versioned: false });
  assert.equal(badStart.kind === "BLOCKED" && badStart.code, "ARENA_INVARIANT_VIOLATION");
  assert.equal(flow.step({ proposal_versioned: true }).kind, "TRANSITIONED");

  // UNDER_REVIEW → RIGHTS_CLEARED：无权利 → rights_verified=false → 挡下。
  const noRights = flow.step({ rights_verified: false });
  assert.equal(noRights.kind === "BLOCKED" && noRights.code, "ARENA_INVARIANT_VIOLATION");
  assert.equal(flow.current(), "UNDER_REVIEW", "rights failure blocks the reuse path");
  assert.equal(flow.step({ rights_verified: true }).kind, "TRANSITIONED");

  // CONSENT → VALIDATED → APPROVED。
  assert.equal(flow.step({ consent_verified: true }).kind, "TRANSITIONED");
  assert.equal(
    flow.step({ provenance_verified: true, validation_passed: true }).kind,
    "TRANSITIONED",
  );
  assert.equal(
    flow.step({ scope_verified: true, publication_approved: true }).kind,
    "TRANSITIONED",
  );

  // APPROVED → PUBLISHED：五守卫合取（缺任一 → INVARIANT_VIOLATION）。
  const missingOne = flow.step({
    rights_verified: true,
    provenance_verified: true,
    validation_passed: true,
    scope_verified: true,
    consent_verified: false,
  });
  assert.equal(missingOne.kind === "BLOCKED" && missingOne.code, "ARENA_INVARIANT_VIOLATION");
  assert.equal(flow.current(), "APPROVED");
  assert.equal(
    flow.step({
      rights_verified: true,
      provenance_verified: true,
      validation_passed: true,
      scope_verified: true,
      consent_verified: true,
    }).kind,
    "TRANSITIONED",
  );
  assert.equal(flow.current(), "PUBLISHED");

  // 发布后唯一出路：RETRACTED（记录理由 —— 新记录，绝不回退改写）。
  const retracted = flow.step({ retraction_reason_recorded: true });
  assert.equal(retracted.kind, "TRANSITIONED");
  assert.equal(flow.current(), "RETRACTED");
  // 终态：任何后续 step → INVALID_TRANSITION。
  const terminal = flow.step({ rights_verified: true });
  assert.equal(terminal.kind === "BLOCKED" && terminal.code, "ARENA_INVALID_TRANSITION");

  // 学习机器结构审计：不存在任何「回退」边（历史不可改写）。
  for (const rule of learningStateMachine.transitions) {
    assert.notEqual(rule.to, "PROPOSED", "no edge may return to PROPOSED (history is immutable)");
  }
});
