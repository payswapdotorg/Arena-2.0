import type { EventEnvelope, OutboxPort, ProofPolicySnapshot } from "@arena/contracts";
import { evaluateProof, type NormalizedValidatorOutput, type ProofDecision } from "@arena/evidence";
import type { EvidenceEnvelope } from "@arena/contracts";

/**
 * AR2-012 — 纵向场景共享件（issue #14）：基线失败软件任务的 P0 证明材料
 * + 同一预声明验证器运行 + 稳定 ID 追踪断言材料。
 *
 * 只组合真实组件（write fence：integration harness；绝不平行假实现）。
 */

/** 「基线失败的软件任务」：干预前 FAIL、干预后 PASS 的 validator 运行。 */
export function baselineFailingRuns(): readonly NormalizedValidatorOutput[] {
  return [
    {
      validator_id: "val_00000001",
      validator_version: "1.0.0",
      kind: "deterministic",
      verdict: { kind: "FAIL", reason: "3 of 12 fixture cases mismatch before the fix" },
      samples: [],
      dimensions: [],
      duration_ms: 812,
      failure: null,
    },
  ];
}

export function interventionPassingRuns(): readonly NormalizedValidatorOutput[] {
  return [
    {
      validator_id: "val_00000001",
      validator_version: "1.0.0",
      kind: "deterministic",
      verdict: { kind: "PASS" },
      samples: [],
      dimensions: [],
      duration_ms: 790,
      failure: null,
    },
  ];
}

export function interventionFailingRuns(): readonly NormalizedValidatorOutput[] {
  return [
    {
      validator_id: "val_00000001",
      validator_version: "1.0.0",
      kind: "deterministic",
      verdict: { kind: "FAIL", reason: "4 of 12 fixture cases still mismatch after the attempt" },
      samples: [],
      dimensions: [],
      duration_ms: 801,
      failure: null,
    },
  ];
}

/** 受信 runner 证据信封（同一绑定 —— attempt 维度由调用方替换）。 */
export function trustedEvidence(evidenceId: string, attemptId: string): EvidenceEnvelope {
  return {
    evidence_id: evidenceId,
    object: {
      content_digest: "ab".repeat(32),
      size_bytes: 256,
      media_type: "application/json",
      storage_ref: `harness://evidence/${evidenceId}`,
    },
    provenance: {
      issuer_tier: "arena_runner",
      issuer_id: "run_00000001",
      signature_algorithm: "test-hmac-sha256",
      signature: "sig_harness_00000001",
      issued_at: "2026-10-11T09:00:00Z",
      replay_protection: "nonce",
    },
    binding: {
      tenant_id: "tnt_00000001",
      escalation_id: "esc_00000001",
      attempt_id: attemptId,
      environment_digest: "cd".repeat(32),
      validator_id: "val_00000001",
      validator_version: "1.0.0",
    },
    redaction_class: "tenant",
    immutable: true,
    correction: null,
    recorded_at: "2026-10-11T09:01:00Z",
  };
}

/** 同一预声明验证证明（真实 AR2-007 evaluateProof 调用）。 */
export function evaluateScenarioProof(input: {
  policy: ProofPolicySnapshot;
  post_runs: readonly NormalizedValidatorOutput[];
  evidence: readonly EvidenceEnvelope[];
  self_evaluation_present: boolean;
}): ProofDecision {
  return evaluateProof({
    policy: input.policy,
    baseline_runs: baselineFailingRuns(),
    post_intervention_runs: input.post_runs,
    evidence: input.evidence,
    self_evaluation_present: input.self_evaluation_present,
  });
}

/** 场景 P0 策略（与 @arena/sdk generic example 同族 —— 12 用例夹具表）。 */
export function scenarioP0Policy(): ProofPolicySnapshot {
  return {
    policy_version: "PVP1.0",
    content_digest: "ee".repeat(32),
    selected_class: "P0",
    selection_rationale: "harness: deterministic fixture-table validator establishes the outcome",
    per_criterion_classes: [{ criterion_id: "cri_00000001", proof_class: "P0" }],
    validators: [
      {
        validator_id: "val_00000001",
        validator_version: "1.0.0",
        kind: "deterministic",
        allowed_commands: ["node", "tsx"],
        timeout_seconds: 300,
        resource_limits: "harness: 2 cpu, 2GiB memory",
        evidence_policy: "harness: trusted runner output captured, no network",
      },
    ],
    rerun_policy: { minimum_reruns: 1, risk_exception: null },
    sample_policy: null,
    review_policy: null,
    observation_policy: null,
    payout_gate: {
      release_requires: "all_predicates_pass",
      caller_authenticity_verified: true,
      task_binding_verified: true,
      dispute_blocks_release: true,
    },
    retry_next_expert: {
      max_attempts: 3,
      max_aggregate_spend: 500,
      cooldown_policy: "harness: exponential, 1h base",
      failed_attempt_posture: "retain_attributed",
      next_expert_baseline: "immutable_baseline_only",
    },
    timeout: "harness: 24h wall clock",
    dispute_conditions: "harness: any hard-stop criterion failure",
    budget_ceiling: 400,
  };
}

/** P2 策略（rubric + 独立评审 —— 非应用可验证场景）。 */
export function scenarioP2Policy(): ProofPolicySnapshot {
  return {
    ...scenarioP0Policy(),
    content_digest: "dd".repeat(32),
    selected_class: "P2",
    selection_rationale:
      "harness: non-application-verifiable outcome — rubric plus independent review",
    per_criterion_classes: [{ criterion_id: "cri_00000002", proof_class: "P2" }],
    review_policy: {
      minimum_independent_reviews: 2,
      raise_to: 3,
      blind: true,
      rubric_version: "rub_harness_p2",
      adjudication_trigger:
        "score disagreement over 0.4, verdict divergence, reviewer escalation, or hard-stop safety concern",
      abstention_policy: "abstentions do not count toward quorum; replacement requested",
    },
    payout_gate: {
      release_requires: "rubric_plus_independent_approval",
      caller_authenticity_verified: true,
      task_binding_verified: true,
      dispute_blocks_release: true,
    },
  };
}

/** 从持久 outbox 收集全部事件（投递前/后共用 —— 稳定 ID 追踪材料）。 */
export async function collectOutboxEvents(
  outbox: OutboxPort,
  now: string,
): Promise<readonly EventEnvelope[]> {
  const messages = await outbox.fetchDue(1024, now);
  return messages.map((message) => message.event);
}
