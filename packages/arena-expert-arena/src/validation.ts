import type { EvidenceEnvelope, ProofPolicySnapshot } from "@arena/contracts";
import { evaluateProof, type NormalizedValidatorOutput, type ProofDecision } from "@arena/evidence";

/**
 * AR2-009 — 同一预声明验证的应用（EA1.0 §1.5/§8；issue #11）。
 *
 * 每个合格候选都跑「同一个」预声明应用验证器：同一份冻结
 * ProofPolicySnapshot、同一个 AR2-007 evaluateProof 求值器、同一
 * 受信证据过滤 —— 结构上不存在「只给某个候选换验证器」的入口。
 * P0/P1：这是主要正确性证据；P2/P3：进入冲突筛查的独立评审与裁定。
 */

export interface CandidateValidationInput {
  candidate_id: string;
  /** baseline（干预前）validator 运行（AR2-007 归一化输出）。 */
  baseline_runs: readonly NormalizedValidatorOutput[];
  /** post-intervention（候选分支上）validator 运行。 */
  post_intervention_runs: readonly NormalizedValidatorOutput[];
  /** 该候选的已接受证据（受信 tier 过滤在 AR2-007 求值器内执行）。 */
  evidence: readonly EvidenceEnvelope[];
  /** 作者自评在场标记（P2/P3 下被 AR2-007 显式忽略并披露）。 */
  self_evaluation_present: boolean;
}

export type CandidateValidationDecision = {
  candidate_id: string;
  decision: ProofDecision;
};

/**
 * 对全部合格候选应用同一预声明验证（同一 policy、同一求值器调用形态）。
 * 输出按候选 id 稳定排序（可追溯、可重放）。
 */
export function applyPredeclaredValidation(input: {
  policy: ProofPolicySnapshot;
  candidates: readonly CandidateValidationInput[];
}): readonly CandidateValidationDecision[] {
  return [...input.candidates]
    .sort((a, b) => (a.candidate_id < b.candidate_id ? -1 : 1))
    .map((candidate) => ({
      candidate_id: candidate.candidate_id,
      decision: evaluateProof({
        policy: input.policy,
        baseline_runs: candidate.baseline_runs,
        post_intervention_runs: candidate.post_intervention_runs,
        evidence: candidate.evidence,
        self_evaluation_present: candidate.self_evaluation_present,
      }),
    }));
}

export const VALIDATION_DISCLOSURE =
  "Every eligible candidate is validated by the SAME predeclared application validator: " +
  "one frozen ProofPolicySnapshot and one AR2-007 evaluateProof call shape for all candidates — " +
  "there is no per-candidate validator swap path; self-evaluation presence is explicitly ignored " +
  "by the P2/P3 evaluator (disclosed in its decision basis)";
