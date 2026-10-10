import {
  attemptSchema,
  evidenceEnvelopeSchema,
  resultEnvelopeSchema,
  validateAttemptSemantics,
  validateEvidenceEnvelopeSemantics,
  validateResultEnvelopeSemantics,
  type Attempt,
  type EvidenceEnvelope,
  type ResultEnvelope,
} from "@arena/contracts";
import type { StructuredSelfEvaluation } from "./expert-flow.js";
import {
  DEMO_ATTEMPT_DIVERGENT,
  DEMO_ATTEMPT_INCONCLUSIVE,
  DEMO_ATTEMPT_OPEN,
  DEMO_ATTEMPT_SUBMITTED,
  DEMO_EVIDENCE_RECORDS,
  DEMO_EXPERT_TENANT_ID,
  DEMO_RESULT,
  DEMO_RESULT_DIVERGENT,
  DEMO_SELF_EVALUATION,
  DEMO_SELF_EVALUATION_ALT,
} from "./demo-fixtures-expert.js";

/**
 * AR2-003 slice 2 — expert/reviewer 种子仓库（mock client 的确定性数据层）。
 *
 * demo 种子 fail-closed 校验：任何 fixture 未过冻结 schema 或语义校验，
 * 构造即抛错——绝不静默降级（architecture-lock 23 的确定性前提）。
 * structuredClone 保证每个 mock client 实例持有独立副本——提交流的
 * 内存变异绝不回写模块级 fixtures。
 */

export interface StoredAttempt {
  tenant_id: string;
  attempt: Attempt;
}

export interface StoredResult {
  tenant_id: string;
  result: ResultEnvelope;
}

export interface StoredEvidence {
  tenant_id: string;
  envelope: EvidenceEnvelope;
}

export interface ExpertSeedStore {
  attempts: StoredAttempt[];
  results: StoredResult[];
  evidence: StoredEvidence[];
  selfEvaluations: Map<string, StructuredSelfEvaluation>;
}

/** demo 种子 fail-closed 校验 + 独立副本构造。 */
export function expertSeedStore(): ExpertSeedStore {
  const attempts = [
    DEMO_ATTEMPT_OPEN,
    DEMO_ATTEMPT_SUBMITTED,
    DEMO_ATTEMPT_INCONCLUSIVE,
    DEMO_ATTEMPT_DIVERGENT,
  ];
  for (const attempt of attempts) {
    const parsed = attemptSchema.safeParse(attempt);
    if (!parsed.success) {
      throw new Error(
        `demo attempt fixture invalid: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      );
    }
    const issues = validateAttemptSemantics(parsed.data);
    if (issues.length > 0) {
      throw new Error(`demo attempt fixture semantics: ${issues[0]?.field} ${issues[0]?.rule}`);
    }
  }
  const evidence = DEMO_EVIDENCE_RECORDS;
  for (const envelope of evidence) {
    const parsed = evidenceEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) {
      throw new Error(
        `demo evidence fixture invalid: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      );
    }
    const issues = validateEvidenceEnvelopeSemantics(parsed.data);
    if (issues.length > 0) {
      throw new Error(`demo evidence fixture semantics: ${issues[0]?.field} ${issues[0]?.rule}`);
    }
  }
  const results = [DEMO_RESULT, DEMO_RESULT_DIVERGENT];
  for (const result of results) {
    const parsed = resultEnvelopeSchema.safeParse(result);
    if (!parsed.success) {
      throw new Error(
        `demo result fixture invalid: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      );
    }
    const issues = validateResultEnvelopeSemantics(parsed.data);
    if (issues.length > 0) {
      throw new Error(`demo result fixture semantics: ${issues[0]?.field} ${issues[0]?.rule}`);
    }
  }
  const selfEvaluations = new Map<string, StructuredSelfEvaluation>();
  selfEvaluations.set(DEMO_SELF_EVALUATION.attempt_id, DEMO_SELF_EVALUATION);
  selfEvaluations.set(DEMO_SELF_EVALUATION_ALT.attempt_id, DEMO_SELF_EVALUATION_ALT);
  return {
    // structuredClone：每个 client 实例持有独立副本——提交流的内存变异
    // 绝不回写模块级 fixtures（确定性隔离）。
    attempts: attempts.map((attempt) => ({
      tenant_id: DEMO_EXPERT_TENANT_ID,
      attempt: structuredClone(attempt),
    })),
    results: results.map((result) => ({
      tenant_id: DEMO_EXPERT_TENANT_ID,
      result: structuredClone(result),
    })),
    evidence: evidence.map((envelope) => ({
      tenant_id: DEMO_EXPERT_TENANT_ID,
      envelope: structuredClone(envelope),
    })),
    selfEvaluations,
  };
}
