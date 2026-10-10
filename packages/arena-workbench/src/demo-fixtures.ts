import type { AcceptanceCriteria, ProofPolicySnapshot } from "@arena/contracts";

/**
 * AR2-003 — DEMO fixtures（验收场景 6 / architecture-lock 23）。
 *
 * 一切 demo 数据都显式标注：DEMO — deterministic fixtures, never customer state。
 * fixtures 是确定性的（无随机、无时钟依赖），供 mock client、表单预填与
 * 冒烟脚本使用。proof policy preset 是完整的 CF1.0 快照（过冻结校验）。
 */

export const WORKBENCH_DEMO_DISCLOSURE =
  "DEMO — deterministic fixtures, never customer state (architecture-lock 23); " +
  "all workbench demo data is generated in-memory and labelled";

/** demo 标记：每条 demo 记录都携带（mock client 强制注入）。 */
export interface DemoTag {
  demo: true;
  disclosure: string;
}

export const DEMO_TAG: Readonly<DemoTag> = {
  demo: true,
  disclosure: WORKBENCH_DEMO_DISCLOSURE,
};

const HEX64 = "ab".repeat(32);

/** demo 验收标准（criterion 级、可测量、带证明等级）。 */
export const DEMO_ACCEPTANCE_CRITERIA: AcceptanceCriteria = [
  {
    criterion_id: "cri_00000001",
    statement: "The corrected pricing rule reproduces the fixture table for all 12 edge cases",
    measurement: {
      definition: "Run the fixture table comparison after the fix and count mismatches",
      metric: "mismatch_count",
      unit: "cases",
      threshold: 0,
      comparator: "eq",
    },
    hard_stop: true,
    proof_class: "P1",
    weight: 0.6,
  },
  {
    criterion_id: "cri_00000002",
    statement: "The expert documents the root cause with a reproducer artifact",
    measurement: {
      definition: "A reviewer confirms the reproducer artifact demonstrates the root cause",
      metric: null,
      unit: null,
      threshold: null,
      comparator: "passes_predicate",
    },
    hard_stop: false,
    proof_class: "P2",
    weight: 0.4,
  },
];

/** demo 证明策略预设（完整 ProofPolicySnapshot，过冻结 schema）。 */
export const DEMO_PROOF_POLICY_PRESET: ProofPolicySnapshot = {
  policy_version: "PVP1.0",
  content_digest: HEX64,
  selected_class: "P1",
  selection_rationale:
    "Demo preset: deterministic validator coverage plus rubric review for the documentation criterion",
  per_criterion_classes: [
    { criterion_id: "cri_00000001", proof_class: "P1" },
    { criterion_id: "cri_00000002", proof_class: "P2" },
  ],
  validators: [
    {
      validator_id: "val_00000001",
      validator_version: "1.0.0",
      kind: "deterministic",
      allowed_commands: ["node", "tsx"],
      timeout_seconds: 300,
      resource_limits: "demo: 2 cpu, 3GiB memory, 20GiB disk",
      evidence_policy: "demo: validator stdout captured as evidence, no network access",
    },
    {
      validator_id: "val_00000002",
      validator_version: "1.0.0",
      kind: "rubric",
      allowed_commands: [],
      timeout_seconds: 600,
      resource_limits: "demo: reviewer-side rubric, no execution",
      evidence_policy: "demo: rubric scores with reviewer rationale (reviewer_private redaction)",
    },
  ],
  rerun_policy: { minimum_reruns: 1, risk_exception: null },
  sample_policy: null,
  review_policy: {
    minimum_independent_reviews: 2,
    raise_to: 3,
    blind: true,
    rubric_version: "1.0.0",
    adjudication_trigger: "demo: rubric divergence greater than one band, or hard-stop dispute",
    abstention_policy: "demo: reviewer may abstain with recorded reason; abstention does not score",
  },
  observation_policy: null,
  payout_gate: {
    release_requires: "rubric_plus_independent_approval",
    caller_authenticity_verified: true,
    task_binding_verified: true,
    dispute_blocks_release: true,
  },
  retry_next_expert: {
    max_attempts: 3,
    max_aggregate_spend: 900,
    cooldown_policy: "demo: 30 minutes between attempts",
    failed_attempt_posture: "retain_attributed",
    next_expert_baseline: "immutable_baseline_only",
  },
  timeout: "demo: 24h from environment ready",
  dispute_conditions: "demo: caller disputes within 14 days with evidence of criterion divergence",
  budget_ceiling: 900,
};

export const DEMO_HEX_DIGEST = HEX64;
