import type { EvidenceEnvelope, ProofPolicySnapshot } from "@arena/contracts";
import type { NormalizedValidatorOutput } from "./validator-registry.js";

/**
 * AR2-007 — proof-class 评估器（PVP1.0 §2/§3/§4；issue #9 验收）。
 *
 * 冻结规则强制：
 * - P0（deterministic）：必须存在「基线失败 → 干预后通过」的成对 validator
 *   运行（受信 tier 证据）；minimum_reruns 次重跑全部通过；缺基线失败
 *   证据 = INCONCLUSIVE（fail-closed —— 无从证明干预产生了改变）。
 * - P1（statistical）：按 snapshot.sample_policy 聚合（sample_size ×
 *   repetitions），聚合阈值由冻结的 aggregate_threshold 描述；flaky/
 *   不一致结果 → INCONCLUSIVE 并按 inconclusive_rule 路由 —— 绝不自动
 *   判 PASS。
 * - P2（rubric）：作者自评不是独立评审（SELF_EVALUATION_IS_NOT_A_VOTE），
 *   永不计入；独立评审记录属于 AR2-009 的流程域 —— 本评估器对 P2/P3
 *   在缺乏独立证据时输出 INCONCLUSIVE(fail-closed)，绝不因自评通过。
 * - P3（observation）：可信来源观察/attestation 属 AR2-009/AR2-013 流程；
 *   同样 fail-closed。
 * - 评估器绝不写 payout 状态（AR2-007 write fence）：ProofDecision 只描述
 *   证明成立与否与路由提示；payment eligibility 的状态机归 AR2-010。
 */

export type ProofDecisionStatus = "SATISFIED" | "FAILED" | "INCONCLUSIVE";

export interface ProofDecision {
  selected_class: ProofPolicySnapshot["selected_class"];
  status: ProofDecisionStatus;
  /** 决策依据（可审计的人类可读摘要 + 机器可读要素）。 */
  basis: string;
  /** 构成决策的受信证据 id（不含 untrusted_attachment）。 */
  trusted_evidence_ids: readonly string[];
  /** 自评参与情况（P2/P3 下永远为 false 的显式记录）。 */
  self_evaluation_counted: false;
  /** P1 聚合细节（非 P1 为 null）。 */
  aggregation: P1Aggregation | null;
  /** 路由提示（不执行路由；由 escalation 编排消费）。 */
  routing_hint:
    | "none"
    | "retry_within_budget"
    | "independent_review"
    | "next_expert"
    | "fail_closed";
  /** 显式披露：本决策不是 payout 指令（ELIGIBILITY_IS_NOT_SETTLEMENT_RULE 同族）。 */
  payout_implication: "decision_only";
}

export interface P1Aggregation {
  sample_size: number;
  repetitions: number;
  passed: number;
  failed: number;
  threshold_description: string;
  meets_threshold: boolean;
}

/** 评估输入：受信运行结果（归一化）+ 存储已接受的证据 + 显式自评标记。 */
export interface ProofEvaluationInput {
  policy: ProofPolicySnapshot;
  /** validator 运行（已归一化；baseline 与 post-intervention 由 note 约定区分）。 */
  baseline_runs: readonly NormalizedValidatorOutput[];
  post_intervention_runs: readonly NormalizedValidatorOutput[];
  /** 评估所引用的已接受证据（受信 tier 过滤在本函数内执行）。 */
  evidence: readonly EvidenceEnvelope[];
  /** 作者结构化自评（如提供 —— P2/P3 下被显式忽略并披露）。 */
  self_evaluation_present: boolean;
}

/** 受信 tier 集合（arena_runner / registered_application_runner）。 */
function trustedEvidence(evidence: readonly EvidenceEnvelope[]): EvidenceEnvelope[] {
  return evidence.filter(
    (e) =>
      e.provenance.issuer_tier === "arena_runner" ||
      e.provenance.issuer_tier === "registered_application_runner",
  );
}

function trustedRunIds(runs: readonly NormalizedValidatorOutput[]): string[] {
  return runs.map((r) => `${r.validator_id}@${r.validator_version}`);
}

export function evaluateProof(input: ProofEvaluationInput): ProofDecision {
  const policy = input.policy;
  const trusted = trustedEvidence(input.evidence);
  const trustedIds = trusted.map((e) => e.evidence_id);

  switch (policy.selected_class) {
    case "P0":
      return evaluateP0(input, trustedIds);
    case "P1":
      return evaluateP1(input, trustedIds);
    case "P2":
      return evaluateP2(policy, input.self_evaluation_present, trustedIds);
    case "P3":
      return evaluateP3(policy, input.self_evaluation_present, trustedIds);
  }
}

/**
 * P0：deterministic。「before-fail / after-pass」演示强制：
 * - ≥1 条基线运行 FAIL（证明起点确实失败）；
 * - ≥minimum_reruns 条干预后运行全部 PASS；
 * - 基线全 PASS → FAILED（干预无从归因 —— 不是验收通过）；
 * - 缺基线或基线 INCONCLUSIVE → INCONCLUSIVE(fail_closed)。
 */
function evaluateP0(input: ProofEvaluationInput, trustedIds: string[]): ProofDecision {
  const policy = input.policy;
  const baseline = input.baseline_runs;
  const post = input.post_intervention_runs;

  const baselineFailed = baseline.some((r) => r.verdict.kind === "FAIL");
  const baselineInconclusive = baseline.some((r) => r.verdict.kind === "INCONCLUSIVE");
  const postPasses = post.filter((r) => r.verdict.kind === "PASS").length;
  const postFails = post.filter((r) => r.verdict.kind === "FAIL").length;
  const postInconclusive = post.filter((r) => r.verdict.kind === "INCONCLUSIVE").length;

  if (baseline.length === 0) {
    return inconclusive(
      policy,
      "P0 requires at least one baseline (pre-intervention) validator run recorded as trusted evidence",
      "fail_closed",
      trustedIds,
    );
  }
  if (
    baselineInconclusive ||
    (!baselineFailed && baseline.length > 0 && baseline.every((r) => r.verdict.kind === "PASS"))
  ) {
    return failed(
      policy,
      `P0 baseline must demonstrate the failing pre-intervention state; observed baseline runs: ${trustedRunIds(baseline).join(", ") || "(none)"} — a passing baseline cannot establish that the intervention changed anything`,
      trustedIds,
    );
  }
  if (!baselineFailed) {
    return inconclusive(
      policy,
      "P0 baseline state could not be established (inconclusive baseline runs)",
      "fail_closed",
      trustedIds,
    );
  }
  if (post.length === 0) {
    return inconclusive(
      policy,
      "P0 requires post-intervention validator runs",
      "retry_within_budget",
      trustedIds,
    );
  }
  const required = policy.rerun_policy.minimum_reruns;
  if (postInconclusive > 0) {
    return inconclusive(
      policy,
      `P0 rerun produced an inconclusive result (${postInconclusive}/${post.length}); inconclusive never passes`,
      "retry_within_budget",
      trustedIds,
    );
  }
  if (postFails > 0) {
    return failed(
      policy,
      `P0 post-intervention verification failed (${postFails}/${post.length} runs failed)`,
      trustedIds,
    );
  }
  if (postPasses < required) {
    return inconclusive(
      policy,
      `P0 requires at least ${required} passing rerun(s); observed ${postPasses}`,
      "retry_within_budget",
      trustedIds,
    );
  }
  return satisfied(
    policy,
    `P0 satisfied: baseline failed (${baseline.length} run(s)), post-intervention passed ${postPasses}/${post.length} run(s) with minimum_reruns=${required}`,
    trustedIds,
  );
}

/**
 * P1：statistical。聚合按冻结 sample_policy；flaky（同输入不同结论）或
 * 未达阈值 = INCONCLUSIVE/FAILED，按 inconclusive_rule 路由 —— 绝不自动通过。
 */
function evaluateP1(input: ProofEvaluationInput, trustedIds: string[]): ProofDecision {
  const policy = input.policy;
  const sample = policy.sample_policy;
  if (sample === null) {
    // 语义校验本应挡下 P1 无 sample_policy；评估器仍 fail-closed。
    return inconclusive(
      policy,
      "P1 selected without a frozen sample_policy (proof policy snapshot is malformed)",
      "fail_closed",
      trustedIds,
    );
  }
  const runs = [...input.baseline_runs, ...input.post_intervention_runs];
  const statistical = runs.filter((r) => r.kind === "statistical");
  const passed = statistical.filter((r) => r.verdict.kind === "PASS").length;
  const failedCount = statistical.filter((r) => r.verdict.kind === "FAIL").length;
  const inconclusiveCount = statistical.filter((r) => r.verdict.kind === "INCONCLUSIVE").length;
  const total = statistical.length;

  if (total === 0) {
    return inconclusive(
      policy,
      "P1 requires statistical validator runs; none were supplied",
      sample.inconclusive_rule,
      trustedIds,
    );
  }
  if (inconclusiveCount > 0) {
    return inconclusive(
      policy,
      `P1 aggregation saw ${inconclusiveCount}/${total} inconclusive sample run(s); inconclusive never aggregates to pass`,
      sample.inconclusive_rule,
      trustedIds,
    );
  }
  // 冻结聚合：全部样本通过且数量覆盖 sample_size × repetitions 才达阈值；
  // 任何失败样本 = FAILED（flaky 不例外）。
  const required = sample.sample_size * sample.repetitions;
  const aggregation: P1Aggregation = {
    sample_size: sample.sample_size,
    repetitions: sample.repetitions,
    passed,
    failed: failedCount,
    threshold_description: sample.aggregate_threshold,
    meets_threshold: failedCount === 0 && passed >= required,
  };
  if (failedCount > 0) {
    return {
      selected_class: policy.selected_class,
      status: "FAILED",
      basis: `P1 aggregation failed: ${failedCount}/${total} sample run(s) failed under frozen threshold "${sample.aggregate_threshold}"`,
      trusted_evidence_ids: trustedIds,
      self_evaluation_counted: false,
      aggregation,
      routing_hint: "next_expert",
      payout_implication: "decision_only",
    };
  }
  if (!aggregation.meets_threshold) {
    return inconclusive(
      policy,
      `P1 aggregation incomplete: ${passed}/${required} required sample run(s) passed (sample_size=${sample.sample_size} × repetitions=${sample.repetitions})`,
      sample.inconclusive_rule,
      trustedIds,
      aggregation,
    );
  }
  return satisfied(
    policy,
    `P1 satisfied: ${passed}/${required} sample run(s) passed under frozen threshold "${sample.aggregate_threshold}"`,
    trustedIds,
    aggregation,
  );
}

/**
 * P2：rubric。作者自评永远不是独立票（SELF_EVALUATION_IS_NOT_A_VOTE_RULE）；
 * 独立评审记录属于 AR2-009 流程域。本评估器只做 fail-closed 判定：
 * 无 ≥ minimum_independent_reviews 条「独立评审已接受」证据 → INCONCLUSIVE。
 */
function evaluateP2(
  policy: ProofPolicySnapshot,
  selfEvaluationPresent: boolean,
  trustedIds: string[],
): ProofDecision {
  const review = policy.review_policy;
  if (review === null) {
    return inconclusive(
      policy,
      "P2 selected without a frozen review_policy (proof policy snapshot is malformed)",
      "fail_closed",
      trustedIds,
    );
  }
  const basis = selfEvaluationPresent
    ? "P2 cannot pass from author self-evaluation alone: the structured self-evaluation is recorded as an immutable candidate artifact and is explicitly NOT counted as an independent vote"
    : "P2 requires independent qualified review records (AR2-009 flow); none are available to the evaluator";
  return inconclusive(policy, basis, "independent_review", trustedIds);
}

/**
 * P3：observation。可信来源观察/attestation 属 AR2-009/AR2-013 流程域；
 * 同样 fail-closed（自评不构成观察证据）。
 */
function evaluateP3(
  policy: ProofPolicySnapshot,
  selfEvaluationPresent: boolean,
  trustedIds: string[],
): ProofDecision {
  if (policy.observation_policy === null) {
    return inconclusive(
      policy,
      "P3 selected without a frozen observation_policy (proof policy snapshot is malformed)",
      "fail_closed",
      trustedIds,
    );
  }
  const basis = selfEvaluationPresent
    ? "P3 cannot pass from author self-evaluation alone: delayed/external outcomes require trusted-source observation records per the frozen observation policy"
    : "P3 requires trusted-source observation/attestation records; none are available to the evaluator";
  return inconclusive(policy, basis, "fail_closed", trustedIds);
}

function satisfied(
  policy: ProofPolicySnapshot,
  basis: string,
  trustedIds: string[],
  aggregation: P1Aggregation | null = null,
): ProofDecision {
  return {
    selected_class: policy.selected_class,
    status: "SATISFIED",
    basis,
    trusted_evidence_ids: trustedIds,
    self_evaluation_counted: false,
    aggregation,
    routing_hint: "none",
    payout_implication: "decision_only",
  };
}

function failed(policy: ProofPolicySnapshot, basis: string, trustedIds: string[]): ProofDecision {
  return {
    selected_class: policy.selected_class,
    status: "FAILED",
    basis,
    trusted_evidence_ids: trustedIds,
    self_evaluation_counted: false,
    aggregation: null,
    routing_hint: "next_expert",
    payout_implication: "decision_only",
  };
}

function inconclusive(
  policy: ProofPolicySnapshot,
  basis: string,
  routing: ProofDecision["routing_hint"],
  trustedIds: string[],
  aggregation: P1Aggregation | null = null,
): ProofDecision {
  return {
    selected_class: policy.selected_class,
    status: "INCONCLUSIVE",
    basis,
    trusted_evidence_ids: trustedIds,
    self_evaluation_counted: false,
    aggregation,
    routing_hint: routing,
    payout_implication: "decision_only",
  };
}
