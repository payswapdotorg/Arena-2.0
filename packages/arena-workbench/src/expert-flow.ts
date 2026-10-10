import { createHash } from "node:crypto";
import {
  attemptStateMachine,
  candidateVersionSchema,
  criterionDecisionSchema,
  evaluateTransition,
  type AcceptanceCriteria,
  type Attempt,
  type AttemptState,
  type GuardFacts,
  type TransitionCommand,
  type TransitionEvaluation,
} from "@arena/contracts";
import { DEMO_TAG, type DemoTag } from "./demo-fixtures.js";
import type { FieldError } from "./requester-form.js";

/**
 * AR2-003 slice 2 — 专家流（验收场景 2）。
 *
 * 冻结规则（architecture-lock 17）：作者-专家可以提交结构化自评；
 * 自评是可见证据，但永远不是独立投票、verifier 决定或唯一支付触发。
 * 本模块的所有类型与校验都让这条规则不可绕过：
 * - StructuredSelfEvaluation 携带 never_an_independent_vote: true 字面量；
 * - 候选提交/自评提交只经由冻结 attempt 状态机（evaluateTransition），
 *   绝不手写状态赋值；
 * - 证据引用 fail-closed：未知 evidence_id 直接类型化拒绝。
 */

/** architecture-lock 17（冻结文本）。 */
export const SELF_EVALUATION_IS_NOT_A_VOTE_RULE =
  "the author-expert may submit a structured self-evaluation; a self-evaluation is visible evidence " +
  "but never an independent vote, verifier decision or sole payment trigger";

/** 候选提交的表单草稿（调用方可编辑子集；版本号/时间戳/不可变位由 builder 组合）。 */
export interface CandidateDraft {
  artifact_manifest: string;
  submission_notes: string;
}

const KNOWN_CANDIDATE_KEYS = ["artifact_manifest", "submission_notes"] as const;

export interface CandidateBuildContext {
  previous_candidates: number;
}

export interface ExpertFlowDeps {
  digest?: (payload: string) => string;
  clock?: () => string;
}

export type CandidateValidation =
  | {
      ok: true;
      candidate: {
        candidate_version: number;
        submitted_at: string;
        artifact_manifest_digest: string;
        immutable: true;
      };
    }
  | { ok: false; fieldErrors: FieldError[] };

function sha256Hex(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

/** 候选草稿 → 不可变候选版本（candidateVersionSchema 校验；未知键拒绝）。 */
export function validateCandidateDraft(
  draft: CandidateDraft,
  context: CandidateBuildContext,
  deps: ExpertFlowDeps = {},
): CandidateValidation {
  const fieldErrors: FieldError[] = [];
  for (const key of Object.keys(draft as unknown as Record<string, unknown>)) {
    if (!(KNOWN_CANDIDATE_KEYS as readonly string[]).includes(key)) {
      fieldErrors.push({ field: key, rule: "unknown candidate draft field (strict form)" });
    }
  }
  if (typeof draft.artifact_manifest !== "string" || draft.artifact_manifest.length === 0) {
    fieldErrors.push({ field: "artifact_manifest", rule: "artifact manifest content is required" });
  }
  if (typeof draft.submission_notes !== "string" || draft.submission_notes.length === 0) {
    fieldErrors.push({ field: "submission_notes", rule: "submission notes are required" });
  }
  if (context.previous_candidates >= 64) {
    fieldErrors.push({ field: "candidates", rule: "attempt admits at most 64 candidate versions" });
  }
  const digest = deps.digest ?? sha256Hex;
  const clock = deps.clock ?? (() => "2026-10-10T12:00:00Z");
  const candidate = {
    candidate_version: context.previous_candidates + 1,
    submitted_at: clock(),
    artifact_manifest_digest: digest(draft.artifact_manifest),
    immutable: true as const,
  };
  const parsed = candidateVersionSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      fieldErrors.push({
        field: issue.path.length > 0 ? `candidates.${issue.path.map(String).join(".")}` : "(root)",
        rule: `${issue.code}${issue.message ? ` — ${issue.message}` : ""}`,
      });
    }
  }
  if (fieldErrors.length > 0) {
    return { ok: false, fieldErrors };
  }
  return { ok: true, candidate };
}

/** 自评条目：criterion 级、证据引用（decision 枚举与冻结 criterionDecisionSchema 一致）。 */
export interface SelfAssessedCriterion {
  criterion_id: string;
  decision: "PASS" | "FAIL" | "INCONCLUSIVE" | "NOT_EVALUATED";
  evidence_ids: string[];
  rationale: string;
}

export interface SelfEvaluationDraft {
  entries: SelfAssessedCriterion[];
}

/** 结构化自评（构建产物）：可见证据，永不构成独立投票。 */
export interface StructuredSelfEvaluation {
  attempt_id: string;
  entries: SelfAssessedCriterion[];
  never_an_independent_vote: true;
  rule: string;
  submitted_at: string;
  demo: DemoTag;
}

export interface SelfEvaluationContext {
  attempt_id: string;
  criteria: AcceptanceCriteria;
  known_evidence_ids: readonly string[];
}

export type SelfEvaluationValidation =
  | { ok: true; evaluation: StructuredSelfEvaluation }
  | { ok: false; fieldErrors: FieldError[] };

/** 自评草稿 → StructuredSelfEvaluation（全覆盖、fail-closed 证据引用）。 */
export function validateSelfEvaluationDraft(
  draft: SelfEvaluationDraft,
  context: SelfEvaluationContext,
  deps: ExpertFlowDeps = {},
): SelfEvaluationValidation {
  const fieldErrors: FieldError[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of (draft.entries ?? []).entries()) {
    const at = `entries.${index}`;
    const criterion = context.criteria.find((c) => c.criterion_id === entry.criterion_id);
    if (criterion === undefined) {
      fieldErrors.push({
        field: `${at}.criterion_id`,
        rule: `unknown criterion (no invented criteria): ${String(entry.criterion_id)}`,
      });
    }
    if (seen.has(entry.criterion_id)) {
      fieldErrors.push({ field: `${at}.criterion_id`, rule: "duplicate criterion entry" });
    }
    seen.add(entry.criterion_id);
    const decision = criterionDecisionSchema.safeParse(entry.decision);
    if (!decision.success) {
      fieldErrors.push({
        field: `${at}.decision`,
        rule: `decision must be PASS | FAIL | INCONCLUSIVE | NOT_EVALUATED`,
      });
    }
    if (!Array.isArray(entry.evidence_ids)) {
      fieldErrors.push({ field: `${at}.evidence_ids`, rule: "evidence_ids must be an array" });
    } else {
      for (const evidenceId of entry.evidence_ids) {
        if (!context.known_evidence_ids.includes(evidenceId)) {
          fieldErrors.push({
            field: `${at}.evidence_ids`,
            rule: `unknown evidence reference (fail-closed): ${String(evidenceId)}`,
          });
        }
      }
      if (entry.evidence_ids.length > 64) {
        fieldErrors.push({ field: `${at}.evidence_ids`, rule: "at most 64 evidence references" });
      }
    }
    if (typeof entry.rationale !== "string" || entry.rationale.length === 0) {
      fieldErrors.push({
        field: `${at}.rationale`,
        rule: "rationale is required (structured entry)",
      });
    } else if (entry.rationale.length > 2000) {
      fieldErrors.push({ field: `${at}.rationale`, rule: "rationale exceeds medium text bound" });
    }
  }
  for (const criterion of context.criteria) {
    if (!seen.has(criterion.criterion_id)) {
      fieldErrors.push({
        field: "entries",
        rule: `missing criterion entry (structured self-evaluation covers every criterion): ${criterion.criterion_id}`,
      });
    }
  }
  if (fieldErrors.length > 0) {
    return { ok: false, fieldErrors };
  }
  const clock = deps.clock ?? (() => "2026-10-10T12:00:00Z");
  return {
    ok: true,
    evaluation: {
      attempt_id: context.attempt_id,
      entries: draft.entries,
      never_an_independent_vote: true,
      rule: SELF_EVALUATION_IS_NOT_A_VOTE_RULE,
      submitted_at: clock(),
      demo: DEMO_TAG,
    },
  };
}

/** 专家流经冻结 attempt 状态机的通用评估入口（绝不手写状态跃迁）。 */
export function evaluateExpertTransition(
  attempt: Attempt,
  command: TransitionCommand,
  facts: GuardFacts,
): TransitionEvaluation<AttemptState> {
  return evaluateTransition(attemptStateMachine, attempt.status, command, facts);
}

/** 候选提交：ENVIRONMENT_READY → SUBMITTED（SubmitIntervention，CANDIDATE_GUARDS）。 */
export function evaluateCandidateSubmission(attempt: Attempt): TransitionEvaluation<AttemptState> {
  return evaluateExpertTransition(attempt, "SubmitIntervention", {
    candidate_version_immutable: true,
    artifact_manifest_present: true,
  });
}

/** 自评提交：SUBMITTED → VERIFYING（SubmitSelfEvaluation，guard self_evaluation_structured）。 */
export function evaluateSelfEvaluationSubmission(
  attempt: Attempt,
  structured: boolean,
): TransitionEvaluation<AttemptState> {
  return evaluateExpertTransition(attempt, "SubmitSelfEvaluation", {
    self_evaluation_structured: structured,
  });
}
