import { escalationRequestSchema, type Attempt, type EscalationRequest } from "@arena/contracts";
import { DEMO_ACCEPTANCE_CRITERIA, DEMO_TAG, type DemoTag } from "./demo-fixtures.js";
import type { FieldError } from "./requester-form.js";
import {
  evaluateCandidateSubmission,
  evaluateSelfEvaluationSubmission,
  validateCandidateDraft,
  validateSelfEvaluationDraft,
  type CandidateDraft,
  type ExpertFlowDeps,
  type SelfEvaluationDraft,
  type StructuredSelfEvaluation,
} from "./expert-flow.js";
import { expertSeedStore, type StoredAttempt } from "./expert-seeds.js";
import { buildReviewDeck, type ReviewDeckView } from "./reviewer-deck.js";

/**
 * AR2-003 — typed mock client（冻结 schema 驱动；AR2-006 绑定真实 API 时替换）。
 *
 * ROLE_IS_NOT_AUTHORIZATION_RULE 在此强制：
 * - 每个方法都只接收 principal（tenant/user——服务端凭据推导的替身），
 *   从不接收也不读取 UI role/lens；
 * - 提交入口 fail-closed：envelope 先过冻结 schema（strict），
 *   非法/超范围直接 REJECTED（分字段 issue），绝不部分接受；
 * - 跨租户读取与不存在不可区分（NOT_FOUND 单一形态）；
 * - 专家流状态跃迁只经冻结 attempt 状态机（evaluateTransition）；
 * - 一切记录携带 DemoTag（DEMO 标注，architecture-lock 23）。
 */

/** 服务端凭据推导的主体（demo 形态；真实形态是 AR2-002 的 auth adapter）。 */
export interface WorkbenchPrincipal {
  tenant_id: string;
  user_id: string;
}

export interface EscalationSummary {
  escalation_id: string;
  title: string;
  state: string;
  budget_limit: number;
  currency: string;
  deadline: string;
  demo: DemoTag;
}

export interface AttemptSummary {
  attempt_id: string;
  escalation_id: string;
  state: string;
  expert_id: string;
  budget_remaining: number;
  currency: string;
  candidates: number;
  demo: DemoTag;
}

export type SubmitOutcome =
  | { kind: "SUBMITTED"; escalation_id: string; request_digest: string; demo: DemoTag }
  | { kind: "REJECTED"; fieldErrors: FieldError[] };

export type LookupOutcome =
  | { kind: "FOUND"; request: EscalationRequest; summary: EscalationSummary }
  | { kind: "NOT_FOUND" };

export type AttemptLookupOutcome =
  | { kind: "FOUND"; attempt: Attempt; demo: DemoTag }
  | { kind: "NOT_FOUND" };

export type CandidateSubmitOutcome =
  | {
      kind: "SUBMITTED";
      attempt_id: string;
      candidate_version: number;
      state: string;
      demo: DemoTag;
    }
  | { kind: "REJECTED"; fieldErrors: FieldError[] }
  | { kind: "INVALID_TRANSITION"; code: string; failed_guards: readonly string[] }
  | { kind: "NOT_FOUND" };

export type SelfEvaluationSubmitOutcome =
  | { kind: "SUBMITTED"; attempt_id: string; state: string; evaluation: StructuredSelfEvaluation }
  | { kind: "REJECTED"; fieldErrors: FieldError[] }
  | { kind: "INVALID_TRANSITION"; code: string; failed_guards: readonly string[] }
  | { kind: "NOT_FOUND" };

export type ReviewDeckOutcome = { kind: "FOUND"; deck: ReviewDeckView } | { kind: "NOT_FOUND" };

export interface ArenaWorkbenchClient {
  submitEscalation(request: unknown, principal: WorkbenchPrincipal): Promise<SubmitOutcome>;
  listEscalations(principal: WorkbenchPrincipal): Promise<EscalationSummary[]>;
  getEscalation(escalation_id: string, principal: WorkbenchPrincipal): Promise<LookupOutcome>;
  listAssignments(principal: WorkbenchPrincipal): Promise<AttemptSummary[]>;
  getAttempt(attempt_id: string, principal: WorkbenchPrincipal): Promise<AttemptLookupOutcome>;
  submitCandidate(
    attempt_id: string,
    draft: CandidateDraft,
    principal: WorkbenchPrincipal,
  ): Promise<CandidateSubmitOutcome>;
  submitSelfEvaluation(
    attempt_id: string,
    draft: SelfEvaluationDraft,
    principal: WorkbenchPrincipal,
  ): Promise<SelfEvaluationSubmitOutcome>;
  getReviewDeck(result_id: string, principal: WorkbenchPrincipal): Promise<ReviewDeckOutcome>;
}

interface StoredRecord {
  tenant_id: string;
  escalation_id: string;
  request: EscalationRequest;
}

/** 可注入依赖：时钟与 digest（确定性测试;默认真实实现）。 */
export interface MockClientDeps extends ExpertFlowDeps {}

/**
 * 确定性 mock：内存存储、按租户隔离、无时钟依赖（自增序号做 id；
 * clock/digest 可注入）。构造与所有方法都不含任何 role/lens 参数
 * ——这是 ROLE_IS_NOT_AUTHORIZATION_RULE 的一部分。
 */
export class MockArenaClient implements ArenaWorkbenchClient {
  private readonly records: StoredRecord[] = [];
  private readonly seeded: ReturnType<typeof expertSeedStore>;
  private readonly liveSelfEvaluations = new Map<string, StructuredSelfEvaluation>();
  private readonly deps: MockClientDeps;
  private sequence = 0;

  constructor(deps: MockClientDeps = {}) {
    this.deps = deps;
    this.seeded = expertSeedStore();
  }

  async submitEscalation(request: unknown, principal: WorkbenchPrincipal): Promise<SubmitOutcome> {
    const parsed = escalationRequestSchema.safeParse(request);
    if (!parsed.success) {
      return {
        kind: "REJECTED",
        fieldErrors: parsed.error.issues.map((issue) => ({
          field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
          rule: `${issue.code}${issue.message ? ` — ${issue.message}` : ""}`,
        })),
      };
    }
    const valid = parsed.data;
    this.sequence += 1;
    const escalationId = `esc_${String(this.sequence).padStart(8, "0")}`;
    this.records.push({
      tenant_id: principal.tenant_id,
      escalation_id: escalationId,
      request: valid,
    });
    return {
      kind: "SUBMITTED",
      escalation_id: escalationId,
      request_digest: valid.request_digest,
      demo: DEMO_TAG,
    };
  }

  async listEscalations(principal: WorkbenchPrincipal): Promise<EscalationSummary[]> {
    return this.records
      .filter((record) => record.tenant_id === principal.tenant_id)
      .map((record) => this.summaryOf(record));
  }

  async getEscalation(
    escalation_id: string,
    principal: WorkbenchPrincipal,
  ): Promise<LookupOutcome> {
    // 跨租户与不存在不可区分：先按租户过滤再找 id。
    const record = this.records.find(
      (candidate) =>
        candidate.tenant_id === principal.tenant_id && candidate.escalation_id === escalation_id,
    );
    if (record === undefined) {
      return { kind: "NOT_FOUND" };
    }
    return { kind: "FOUND", request: record.request, summary: this.summaryOf(record) };
  }

  async listAssignments(principal: WorkbenchPrincipal): Promise<AttemptSummary[]> {
    return this.allAttempts()
      .filter((stored) => stored.tenant_id === principal.tenant_id)
      .map((stored) => ({
        attempt_id: stored.attempt.attempt_id,
        escalation_id: stored.attempt.escalation_id,
        state: stored.attempt.status,
        expert_id: stored.attempt.expert.expert_id,
        budget_remaining: stored.attempt.budget.remaining_amount,
        currency: stored.attempt.budget.currency,
        candidates: stored.attempt.candidates.length,
        demo: DEMO_TAG,
      }));
  }

  async getAttempt(
    attempt_id: string,
    principal: WorkbenchPrincipal,
  ): Promise<AttemptLookupOutcome> {
    const stored = this.findAttempt(attempt_id, principal);
    if (stored === undefined) {
      return { kind: "NOT_FOUND" };
    }
    return { kind: "FOUND", attempt: stored.attempt, demo: DEMO_TAG };
  }

  async submitCandidate(
    attempt_id: string,
    draft: CandidateDraft,
    principal: WorkbenchPrincipal,
  ): Promise<CandidateSubmitOutcome> {
    const stored = this.findAttempt(attempt_id, principal);
    if (stored === undefined) {
      return { kind: "NOT_FOUND" };
    }
    const validation = validateCandidateDraft(
      draft,
      { previous_candidates: stored.attempt.candidates.length },
      this.deps,
    );
    if (!validation.ok) {
      return { kind: "REJECTED", fieldErrors: validation.fieldErrors };
    }
    // 只经冻结 attempt 状态机跃迁（绝不手写状态赋值）。
    const transition = evaluateCandidateSubmission(stored.attempt);
    if (!transition.ok) {
      return {
        kind: "INVALID_TRANSITION",
        code: transition.code,
        failed_guards: transition.failed_guards,
      };
    }
    stored.attempt.candidates.push(validation.candidate);
    stored.attempt.status = transition.to;
    stored.attempt.updated_at = validation.candidate.submitted_at;
    return {
      kind: "SUBMITTED",
      attempt_id: stored.attempt.attempt_id,
      candidate_version: validation.candidate.candidate_version,
      state: stored.attempt.status,
      demo: DEMO_TAG,
    };
  }

  async submitSelfEvaluation(
    attempt_id: string,
    draft: SelfEvaluationDraft,
    principal: WorkbenchPrincipal,
  ): Promise<SelfEvaluationSubmitOutcome> {
    const stored = this.findAttempt(attempt_id, principal);
    if (stored === undefined) {
      return { kind: "NOT_FOUND" };
    }
    const validation = validateSelfEvaluationDraft(
      draft,
      {
        attempt_id: stored.attempt.attempt_id,
        criteria: DEMO_ACCEPTANCE_CRITERIA,
        known_evidence_ids: this.knownEvidenceIds(principal),
      },
      this.deps,
    );
    if (!validation.ok) {
      return { kind: "REJECTED", fieldErrors: validation.fieldErrors };
    }
    // guard self_evaluation_structured 只有结构化自评通过校验才为 true。
    const transition = evaluateSelfEvaluationSubmission(stored.attempt, true);
    if (!transition.ok) {
      return {
        kind: "INVALID_TRANSITION",
        code: transition.code,
        failed_guards: transition.failed_guards,
      };
    }
    stored.attempt.status = transition.to;
    stored.attempt.updated_at = validation.evaluation.submitted_at;
    this.liveSelfEvaluations.set(stored.attempt.attempt_id, validation.evaluation);
    return {
      kind: "SUBMITTED",
      attempt_id: stored.attempt.attempt_id,
      state: stored.attempt.status,
      evaluation: validation.evaluation,
    };
  }

  async getReviewDeck(
    result_id: string,
    principal: WorkbenchPrincipal,
  ): Promise<ReviewDeckOutcome> {
    const storedResult = this.seeded.results.find(
      (candidate) =>
        candidate.tenant_id === principal.tenant_id && candidate.result.result_id === result_id,
    );
    if (storedResult === undefined) {
      return { kind: "NOT_FOUND" };
    }
    const evidence = this.seeded.evidence
      .filter((candidate) => candidate.tenant_id === principal.tenant_id)
      .map((candidate) => candidate.envelope);
    const selfEvaluation =
      this.liveSelfEvaluations.get(storedResult.result.attempt_id) ??
      this.seeded.selfEvaluations.get(storedResult.result.attempt_id) ??
      null;
    const deck = buildReviewDeck(
      storedResult.result,
      DEMO_ACCEPTANCE_CRITERIA,
      evidence,
      selfEvaluation,
      DEMO_TAG,
    );
    return { kind: "FOUND", deck };
  }

  private allAttempts(): StoredAttempt[] {
    return this.seeded.attempts;
  }

  private findAttempt(
    attempt_id: string,
    principal: WorkbenchPrincipal,
  ): StoredAttempt | undefined {
    // 跨租户与不存在不可区分。
    return this.seeded.attempts.find(
      (candidate) =>
        candidate.tenant_id === principal.tenant_id && candidate.attempt.attempt_id === attempt_id,
    );
  }

  private knownEvidenceIds(principal: WorkbenchPrincipal): string[] {
    return this.seeded.evidence
      .filter((candidate) => candidate.tenant_id === principal.tenant_id)
      .map((candidate) => candidate.envelope.evidence_id);
  }

  private summaryOf(record: StoredRecord): EscalationSummary {
    return {
      escalation_id: record.escalation_id,
      title: record.request.task.title,
      state: "CREATED",
      budget_limit: record.request.budget.limit_amount,
      currency: record.request.budget.currency,
      deadline: record.request.constraints.deadline,
      demo: DEMO_TAG,
    };
  }
}
