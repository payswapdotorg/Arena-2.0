import { buildCanonicalGateRows, recomputeGates } from "../src/contract.js";
import type { GateRecomputationResult } from "../src/contract.js";

/**
 * AR2-023 测试夹具（issue #55 验收）：
 * - AR2-015 规范门行 + 由其派生的证据集（门报告文档 = 单一证据依据）——
 *   非回归锚点：重算必须复现 AR2-015 记录在案的判定；
 * - 全绿证据集（假想未来证据 —— 合成 SHA，仅用于 PRODUCTION_GO 机制测试）；
 * - 受限范围 / NOT_GO_HOLD / PRODUCTION_GO 决策记录夹具与修订链夹具。
 */

export const AR2015_META = {
  head_sha: "df621a6a176f186be49a110cbe9c09a44b8b078a",
  base_sha: "d89182619a995710361883015e53e741eb9eedfa",
  environment: "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)",
};

export function ar2015Rows() {
  return buildCanonicalGateRows(AR2015_META);
}

/** AR2-015 记录在案的证据集：门报告文档作为全部 15 个门的证据依据。 */
export function ar2015EvidenceSet() {
  return {
    evidence_set_id: "evs_ar2015gate",
    manifest: [
      {
        entry_id: "evd_00000001",
        kind: "evidence_doc",
        link: "docs/evidence/release/AR2-015-gate-report-2026-10-11.md",
        sha: "df621a6a176f186be49a110cbe9c09a44b8b078a",
        description: "AR2-015 classified release-gate report — the recorded NOT_GO basis and limited-scope template case",
      },
    ],
    submissions: ar2015Rows().map((row) => ({
      gate_id: row.gate_id,
      classification: row.classification,
      evidence_class: row.evidence.evidence_class,
      command: row.evidence.command,
      environment: row.evidence.environment,
      result: row.evidence.result,
      limitations: row.evidence.limitations,
      reviewer: row.evidence.reviewer,
      basis_entry_ids: ["evd_00000001"],
      waiver_authorization: row.waiver_authorization,
      findings: row.findings,
    })),
  };
}

/** AR2-015 重算（非回归锚点 —— 必须复现记录在案的判定）。 */
export function ar2015Recomputation(): GateRecomputationResult {
  const outcome = recomputeGates({
    registry_rows: ar2015Rows(),
    evidence_set: ar2015EvidenceSet(),
  });
  if (outcome.kind !== "VALID") throw new Error("AR2-015 evidence set must recompute VALID");
  return outcome.result;
}

/** 全绿证据集（假想未来证据；合成 SHA 仅用于机制测试 —— 不冒充真实证据）。 */
export function allGreenEvidenceSet() {
  return {
    evidence_set_id: "evs_allgreen",
    manifest: [
      {
        entry_id: "evd_00000001",
        kind: "evidence_doc",
        link: "docs/evidence/release/hypothetical-future-gate-report.md",
        sha: "b".repeat(40),
        description: "hypothetical all-green evidence fixture (synthetic SHA — machinery test only)",
      },
    ],
    submissions: ar2015Rows().map((row) => ({
      gate_id: row.gate_id,
      classification: "PASS",
      evidence_class: row.evidence.evidence_class,
      command: row.evidence.command,
      environment: row.evidence.environment,
      result: "green",
      limitations: "",
      reviewer: "arena-tl",
      basis_entry_ids: ["evd_00000001"],
      waiver_authorization: null,
      findings: [],
    })),
  };
}

export function allGreenRecomputation(): GateRecomputationResult {
  const outcome = recomputeGates({
    registry_rows: ar2015Rows(),
    evidence_set: allGreenEvidenceSet(),
  });
  if (outcome.kind !== "VALID") throw new Error("all-green evidence set must recompute VALID");
  return outcome.result;
}

export function ar2015Manifest() {
  return [
    {
      entry_id: "evd_00000001",
      kind: "evidence_doc",
      link: "docs/evidence/release/AR2-015-gate-report-2026-10-11.md",
      sha: "df621a6a176f186be49a110cbe9c09a44b8b078a",
      description: "AR2-015 classified release-gate report — the recorded NOT_GO basis and limited-scope template case",
    },
    {
      entry_id: "evd_00000002",
      kind: "pull_request",
      link: "https://github.com/payswapdotorg/Arena-2.0/pull/47",
      sha: "7d117f1d1b2bc4adbd7e38b6048737f19167da55",
      description: "AR2-015 acceptance merge (squash) — the tree the adversarial profiles and gate report were accepted on",
    },
    {
      entry_id: "evd_00000003",
      kind: "issue",
      link: "https://github.com/payswapdotorg/Arena-2.0/issues/55",
      sha: "c9b86d199d9fe95180de0e817b9af4c0b2d0055b",
      description: "AR2-023 registration (WO3.0 release plan registration commit)",
    },
    {
      entry_id: "evd_00000004",
      kind: "evidence_doc",
      link: "spec/work-orders/release-plan.md",
      sha: "c9b86d199d9fe95180de0e817b9af4c0b2d0055b",
      description: "WO3.0 production-readiness release plan — sequencing and disabled-capability boundaries",
    },
  ];
}

/** 受限范围记录夹具（AR2-015 记录在案的基线：Linux、test-mode、无不可信执行）。 */
export function limitedScopeRecord(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "RDR1.0",
    status: "RECORDED",
    decision_id: "rdr_00000001",
    decision_class: "LIMITED_SCOPE_GO",
    decision_date: "2026-10-14T00:00:00Z",
    scope: {
      platforms: ["linux"],
      finance_mode: "test_mode",
      untrusted_execution: "disabled",
      identity_mode: "demo_auth",
      isolation_mode: "synthetic_provider_only",
    },
    evidence_manifest: ar2015Manifest(),
    gate_recomputation: ar2015Recomputation(),
    residual_risks: [
      {
        risk_id: "rsk_00000001",
        description: "Cross-platform install proof outstanding (macOS/Windows) — limited scope is Linux-only",
        severity: "medium",
        linked_gates: ["grg_00000002"],
        disposition: "ACCEPTED_WITH_CONTROLS",
        mitigation:
          "Scope bounded to linux; no cross-platform distribution or claim is made; AR2-020 harness evidence is tracked before any platform expansion.",
      },
      {
        risk_id: "rsk_00000002",
        description: "OS-level capsule isolation unproven — untrusted expert/scraper execution stays disabled",
        severity: "high",
        linked_gates: ["grg_00000008"],
        disposition: "ACCEPTED_WITH_CONTROLS",
        mitigation:
          "Untrusted execution DISABLED in this scope; only trusted in-process execution paths run; enablement requires AR2-019-passing evidence plus a new recorded owner decision.",
      },
      {
        risk_id: "rsk_00000003",
        description: "Accessibility E2E coverage incomplete (keyboard/screen-reader across all five flows)",
        severity: "medium",
        linked_gates: ["grg_00000013"],
        disposition: "ACCEPTED_WITH_CONTROLS",
        mitigation:
          "No customer-facing accessibility claim; operator/lab use with the limitation recorded; AR2-021 evidence is tracked before any customer-facing expansion.",
      },
      {
        risk_id: "rsk_00000004",
        description: "Demo-auth identity adapter in use — production identity seam recorded (AR2-022 in flight)",
        severity: "medium",
        linked_gates: ["grg_00000005"],
        disposition: "ACCEPTED_WITH_CONTROLS",
        mitigation:
          "Deployment bounded to recorded demo tenants; no external tenant onboarding; the production identity adapter is required before multi-tenant exposure.",
      },
    ],
    signer: {
      name: "arena-release-owner",
      role: "release_owner",
      method: "github_identity_docs_commit",
      github_identity: "payswapdotorg",
    },
    review_conditions: [
      {
        kind: "expires_on",
        description: "This limited-scope authorization expires on this date unless re-recorded or amended",
        date: "2027-01-31",
      },
      {
        kind: "re_review_on_event",
        description: "Re-review when any new G0–G8 gate evidence lands on main (AR2-019/020/021/022 outcomes)",
        date: null,
      },
      {
        kind: "enablement_precondition",
        description:
          "Live-money payments stay DISABLED; enabling requires a separately registered work order created only after a recorded owner decision",
        date: null,
      },
    ],
    supersedes: null,
    statement:
      "Limited-scope release on the recorded AR2-015 basis: Linux only, test-mode finance, untrusted execution disabled. The attached gate recomputation reproduces the recorded NOT_GO machine decision; the three BLOCKED core gates are each outside this scope's boundaries and are recorded as owner-accepted residual risks with controls.",
    ...overrides,
  };
}

/** NOT_GO_HOLD 记录夹具：三个阻断门以 OPEN 残余风险列明。 */
export function notGoHoldRecord(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "RDR1.0",
    status: "RECORDED",
    decision_id: "rdr_00000002",
    decision_class: "NOT_GO_HOLD",
    decision_date: "2026-10-14T00:00:00Z",
    scope: {
      platforms: ["linux"],
      finance_mode: "test_mode",
      untrusted_execution: "disabled",
      identity_mode: "demo_auth",
      isolation_mode: "synthetic_provider_only",
    },
    evidence_manifest: ar2015Manifest(),
    gate_recomputation: ar2015Recomputation(),
    residual_risks: [
      {
        risk_id: "rsk_00000001",
        description: "Cross-platform install proof outstanding (macOS/Windows)",
        severity: "medium",
        linked_gates: ["grg_00000002"],
        disposition: "OPEN",
        mitigation: "",
      },
      {
        risk_id: "rsk_00000002",
        description: "OS-level capsule isolation unproven (synthetic provider is not isolation evidence)",
        severity: "high",
        linked_gates: ["grg_00000008"],
        disposition: "OPEN",
        mitigation: "",
      },
      {
        risk_id: "rsk_00000003",
        description: "Accessibility E2E coverage incomplete",
        severity: "medium",
        linked_gates: ["grg_00000013"],
        disposition: "OPEN",
        mitigation: "",
      },
    ],
    signer: {
      name: "arena-release-owner",
      role: "release_owner",
      method: "github_identity_docs_commit",
      github_identity: "payswapdotorg",
    },
    review_conditions: [],
    supersedes: null,
    statement:
      "Hold recorded on the AR2-015 machine basis: production release stays NOT_GO until the three open blockers evidenced in the attached recomputation are closed by the registered WO3.0 work orders.",
    ...overrides,
  };
}

/** PRODUCTION_GO 记录夹具（一致：全绿重算 + 无 live-money/无不可信执行）。 */
export function productionGoRecord(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "RDR1.0",
    status: "RECORDED",
    decision_id: "rdr_00000003",
    decision_class: "PRODUCTION_GO",
    decision_date: "2026-10-14T00:00:00Z",
    scope: {
      platforms: ["linux", "macos", "windows"],
      finance_mode: "test_mode",
      untrusted_execution: "disabled",
      identity_mode: "production_adapter",
      isolation_mode: "synthetic_provider_only",
    },
    evidence_manifest: [
      {
        entry_id: "evd_00000001",
        kind: "evidence_doc",
        link: "docs/evidence/release/hypothetical-future-gate-report.md",
        sha: "b".repeat(40),
        description: "hypothetical all-green evidence fixture (synthetic SHA — machinery test only)",
      },
    ],
    gate_recomputation: allGreenRecomputation(),
    residual_risks: [],
    signer: {
      name: "arena-release-owner",
      role: "release_owner",
      method: "github_identity_docs_commit",
      github_identity: "payswapdotorg",
    },
    review_conditions: [
      {
        kind: "expires_on",
        description: "Production authorization expires on this date unless re-recorded or amended",
        date: "2027-01-31",
      },
    ],
    supersedes: null,
    statement:
      "Production GO on a fully green recomputed gate registry (fixture). All core gates PASS; no extension scope is enabled.",
    ...overrides,
  };
}
