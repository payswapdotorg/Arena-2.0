import type { Attempt, EvidenceEnvelope, ResultEnvelope } from "@arena/contracts";
import { DEMO_HEX_DIGEST, DEMO_TAG, type DemoTag } from "./demo-fixtures.js";
import {
  SELF_EVALUATION_IS_NOT_A_VOTE_RULE,
  type StructuredSelfEvaluation,
} from "./expert-flow.js";

/**
 * AR2-003 slice 2 — expert/reviewer 流的 DEMO fixtures（验收场景 2/3）。
 *
 * 全部确定性（无随机、无时钟读取）；在 mock client 构造时经冻结 schema
 * fail-closed 校验（attemptSchema/evidenceEnvelopeSchema/resultEnvelopeSchema
 * + 各自语义校验），非法 demo 数据直接抛错——绝不静默降级。
 * 所有记录属于 DEMO 租户，跨租户不可见。
 */

/** demo 租户（expert/reviewer fixtures 的属主租户）。 */
export const DEMO_EXPERT_TENANT_ID = "tnt_demo0001";

/** demo 主体（tenant/user 对；服务端凭据推导的替身，不含任何 role）。 */
export const DEMO_EXPERT_PRINCIPAL = {
  tenant_id: DEMO_EXPERT_TENANT_ID,
  user_id: "usr_expert001",
} as const;

const T0 = "2026-10-10T08:00:00Z";
const T1 = "2026-10-10T09:00:00Z";
const T2 = "2026-10-10T10:00:00Z";
const T3 = "2026-10-10T11:00:00Z";

/** att_00000001：ENVIRONMENT_READY、0 candidate —— 候选提交流的活体目标。 */
export const DEMO_ATTEMPT_OPEN: Attempt = {
  attempt_id: "att_00000001",
  escalation_id: "esc_00000001",
  attempt_number: 1,
  status: "ENVIRONMENT_READY",
  expert: {
    expert_id: "exp_00000001",
    capability_profile_digest: DEMO_HEX_DIGEST,
    qualification_digest: DEMO_HEX_DIGEST,
    conflict_check_digest: DEMO_HEX_DIGEST,
    assigned_at: T0,
  },
  budget: { authorized_amount: 200, currency: "USD", consumed_amount: 0, remaining_amount: 200 },
  capsule: {
    capsule_id: "cap_00000001",
    manifest_digest: DEMO_HEX_DIGEST,
    environment_ready: true,
    teardown_verified: false,
  },
  candidates: [],
  failure: null,
  created_at: T0,
  updated_at: T0,
};

/** att_00000002：SUBMITTED、1 个不可变候选 —— 自评提交流的活体目标。 */
export const DEMO_ATTEMPT_SUBMITTED: Attempt = {
  ...DEMO_ATTEMPT_OPEN,
  attempt_id: "att_00000002",
  status: "SUBMITTED",
  budget: { authorized_amount: 200, currency: "USD", consumed_amount: 20, remaining_amount: 180 },
  candidates: [
    {
      candidate_version: 1,
      submitted_at: T1,
      artifact_manifest_digest: DEMO_HEX_DIGEST,
      immutable: true,
    },
  ],
  updated_at: T1,
};

/** att_00000003：INCONCLUSIVE 终态（携带历史自评 DEMO_SELF_EVALUATION）。 */
export const DEMO_ATTEMPT_INCONCLUSIVE: Attempt = {
  ...DEMO_ATTEMPT_OPEN,
  attempt_id: "att_00000003",
  status: "INCONCLUSIVE",
  budget: { authorized_amount: 200, currency: "USD", consumed_amount: 160, remaining_amount: 40 },
  candidates: [
    {
      candidate_version: 1,
      submitted_at: T1,
      artifact_manifest_digest: DEMO_HEX_DIGEST,
      immutable: true,
    },
    {
      candidate_version: 2,
      submitted_at: T2,
      artifact_manifest_digest: DEMO_HEX_DIGEST,
      immutable: true,
    },
  ],
  updated_at: T3,
};

/** att_00000004：INCONCLUSIVE 终态（携带历史自评 DEMO_SELF_EVALUATION_ALT）。 */
export const DEMO_ATTEMPT_DIVERGENT: Attempt = {
  ...DEMO_ATTEMPT_INCONCLUSIVE,
  attempt_id: "att_00000004",
  candidates: [
    {
      candidate_version: 1,
      submitted_at: T1,
      artifact_manifest_digest: DEMO_HEX_DIGEST,
      immutable: true,
    },
  ],
};

/** 四个脱敏等级各一条的 demo 证据（trusted 层全部签名——冻结语义校验要求）。 */
export const DEMO_EVIDENCE_RECORDS: readonly EvidenceEnvelope[] = [
  {
    evidence_id: "evd_public001",
    object: {
      content_digest: DEMO_HEX_DIGEST,
      size_bytes: 2048,
      media_type: "text/plain",
      storage_ref: "demo://evidence/validator-stdout.txt",
    },
    provenance: {
      issuer_tier: "arena_runner",
      issuer_id: "run_00000001",
      signature_algorithm: "ed25519",
      signature: "sig_demo_public_0001",
      issued_at: T1,
      replay_protection: "sequence",
    },
    binding: {
      tenant_id: DEMO_EXPERT_TENANT_ID,
      escalation_id: "esc_00000001",
      attempt_id: "att_00000003",
      environment_digest: DEMO_HEX_DIGEST,
      validator_id: "val_00000001",
      validator_version: "1.0.0",
    },
    redaction_class: "public",
    immutable: true,
    correction: null,
    recorded_at: T1,
  },
  {
    evidence_id: "evd_tenant001",
    object: {
      content_digest: DEMO_HEX_DIGEST,
      size_bytes: 4096,
      media_type: "application/json",
      storage_ref: "demo://evidence/fixture-table-diff.json",
    },
    provenance: {
      issuer_tier: "arena_runner",
      issuer_id: "run_00000002",
      signature_algorithm: "ed25519",
      signature: "sig_demo_tenant_0001",
      issued_at: T1,
      replay_protection: "sequence",
    },
    binding: {
      tenant_id: DEMO_EXPERT_TENANT_ID,
      escalation_id: "esc_00000001",
      attempt_id: "att_00000003",
      environment_digest: DEMO_HEX_DIGEST,
      validator_id: "val_00000001",
      validator_version: "1.0.0",
    },
    redaction_class: "tenant",
    immutable: true,
    correction: null,
    recorded_at: T1,
  },
  {
    evidence_id: "evd_review001",
    object: {
      content_digest: DEMO_HEX_DIGEST,
      size_bytes: 512,
      media_type: "text/markdown",
      storage_ref: "demo://evidence/rubric-rationale.md",
    },
    provenance: {
      issuer_tier: "registered_application_runner",
      issuer_id: "app_00000001",
      signature_algorithm: "ed25519",
      signature: "sig_demo_review_0001",
      issued_at: T2,
      replay_protection: "nonce",
    },
    binding: {
      tenant_id: DEMO_EXPERT_TENANT_ID,
      escalation_id: "esc_00000001",
      attempt_id: "att_00000003",
      environment_digest: DEMO_HEX_DIGEST,
      validator_id: "val_00000002",
      validator_version: "1.0.0",
    },
    redaction_class: "reviewer_private",
    immutable: true,
    correction: null,
    recorded_at: T2,
  },
  {
    evidence_id: "evd_operator01",
    object: {
      content_digest: DEMO_HEX_DIGEST,
      size_bytes: 1024,
      media_type: "text/plain",
      storage_ref: "demo://evidence/teardown-log.txt",
    },
    provenance: {
      issuer_tier: "arena_runner",
      issuer_id: "run_00000003",
      signature_algorithm: "ed25519",
      signature: "sig_demo_operator001",
      issued_at: T3,
      replay_protection: "timestamp_window",
    },
    binding: {
      tenant_id: DEMO_EXPERT_TENANT_ID,
      escalation_id: "esc_00000001",
      attempt_id: "att_00000003",
      environment_digest: DEMO_HEX_DIGEST,
      validator_id: "val_00000001",
      validator_version: "1.0.0",
    },
    redaction_class: "operator",
    immutable: true,
    correction: null,
    recorded_at: T3,
  },
];

/** 汇敛结果：PARTIALLY_ACCEPTED（cri1 PASS / cri2 INCONCLUSIVE）。 */
export const DEMO_RESULT: ResultEnvelope = {
  result_id: "res_00000001",
  escalation_id: "esc_00000001",
  attempt_id: "att_00000003",
  tenant_id: DEMO_EXPERT_TENANT_ID,
  status: "PARTIALLY_ACCEPTED",
  structured_outputs: {
    schema_id: "sch_00000001",
    schema_version: "1.0.0",
    data: { demo: "corrected pricing rule artifact" },
  },
  criterion_decisions: [
    {
      criterion_id: "cri_00000001",
      decision: "PASS",
      proof_class: "P1",
      evidence_ids: ["evd_public001", "evd_tenant001"],
      hard_stop_triggered: false,
    },
    {
      criterion_id: "cri_00000002",
      decision: "INCONCLUSIVE",
      proof_class: "P2",
      evidence_ids: ["evd_review001"],
      hard_stop_triggered: false,
    },
  ],
  proof_class: "P1",
  evidence_references: [
    { evidence_id: "evd_public001", integrity_digest: DEMO_HEX_DIGEST },
    { evidence_id: "evd_tenant001", integrity_digest: DEMO_HEX_DIGEST },
    { evidence_id: "evd_review001", integrity_digest: DEMO_HEX_DIGEST },
  ],
  verification: {
    validator_ids: ["val_00000001", "val_00000002"],
    validator_versions: ["1.0.0", "1.0.0"],
    reviewer_ids: ["rev_00000001", "rev_00000002"],
    adjudicator_id: null,
    outcomes: ["rubric_band_B", "rubric_band_B"],
    policy_version: "PVP1.0",
  },
  limitations: ["demo: partial acceptance — documentation criterion inconclusive"],
  assumptions: ["demo: fixture table is the authoritative oracle"],
  residual_risk: "demo: residual risk of fixture-table drift remains for edge case 12",
  follow_up_recommendations: ["demo: re-run rubric review after reproducer artifact lands"],
  artifact: { artifact_version: "demo-artifact-v2", lineage: [DEMO_HEX_DIGEST] },
  payment_eligibility_reference: { eligibility_id: "eli_00000001", is_reference_only: true },
  correlation_id: "cor_00000001",
  created_at: T3,
  contract_version: "ES2.0",
};

/** 分歧结果：INCONCLUSIVE + adjudicator 在场（rubric 带分歧 + hard-stop 争议）。 */
export const DEMO_RESULT_DIVERGENT: ResultEnvelope = {
  ...DEMO_RESULT,
  result_id: "res_00000002",
  attempt_id: "att_00000004",
  status: "INCONCLUSIVE",
  criterion_decisions: [
    {
      criterion_id: "cri_00000001",
      decision: "INCONCLUSIVE",
      proof_class: "P1",
      evidence_ids: ["evd_public001"],
      hard_stop_triggered: true,
    },
    {
      criterion_id: "cri_00000002",
      decision: "INCONCLUSIVE",
      proof_class: "P2",
      evidence_ids: ["evd_review001"],
      hard_stop_triggered: false,
    },
  ],
  evidence_references: [
    { evidence_id: "evd_public001", integrity_digest: DEMO_HEX_DIGEST },
    { evidence_id: "evd_review001", integrity_digest: DEMO_HEX_DIGEST },
  ],
  verification: {
    validator_ids: ["val_00000001", "val_00000002"],
    validator_versions: ["1.0.0", "1.0.0"],
    reviewer_ids: ["rev_00000001", "rev_00000003"],
    adjudicator_id: "adj_00000001",
    outcomes: ["rubric_band_A", "rubric_band_C"],
    policy_version: "PVP1.0",
  },
  limitations: ["demo: divergence — rubric bands differ by more than one band"],
  residual_risk: "demo: hard-stop dispute unresolved; adjudication recorded",
  follow_up_recommendations: ["demo: adjudicator ruling pending external reproducer"],
  payment_eligibility_reference: null,
  correlation_id: "cor_00000002",
};

/** 已知 demo 证据 ID 全集（自评证据引用 fail-closed 校验的输入）。 */
export const DEMO_KNOWN_EVIDENCE_IDS: readonly string[] = DEMO_EVIDENCE_RECORDS.map(
  (envelope) => envelope.evidence_id,
);

/** att_00000003 的历史自评（criterion 全覆盖、证据引用已知、可见证据非投票）。 */
export const DEMO_SELF_EVALUATION: StructuredSelfEvaluation = {
  attempt_id: "att_00000003",
  entries: [
    {
      criterion_id: "cri_00000001",
      decision: "PASS",
      evidence_ids: ["evd_public001", "evd_tenant001"],
      rationale:
        "demo: fixture-table comparison rerun in capsule; mismatch count 0 across 12 edge cases",
    },
    {
      criterion_id: "cri_00000002",
      decision: "NOT_EVALUATED",
      evidence_ids: [],
      rationale: "demo: root-cause documentation left to reviewer rubric (self-eval is not a vote)",
    },
  ],
  never_an_independent_vote: true,
  rule: SELF_EVALUATION_IS_NOT_A_VOTE_RULE,
  submitted_at: T2,
  demo: DEMO_TAG,
};

/** att_00000004 的历史自评（分歧案例：自评立场与 reviewer 带不一致并排展示）。 */
export const DEMO_SELF_EVALUATION_ALT: StructuredSelfEvaluation = {
  ...DEMO_SELF_EVALUATION,
  attempt_id: "att_00000004",
  entries: [
    {
      criterion_id: "cri_00000001",
      decision: "PASS",
      evidence_ids: ["evd_public001"],
      rationale: "demo: expert asserts fixture-table parity; reviewer band divergence recorded",
    },
    {
      criterion_id: "cri_00000002",
      decision: "INCONCLUSIVE",
      evidence_ids: ["evd_review001"],
      rationale: "demo: reproducer artifact contested during rubric review",
    },
  ],
};

export type { DemoTag };
