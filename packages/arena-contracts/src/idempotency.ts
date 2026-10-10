import { z } from "zod";
import { arenaIdSchema, digestSchema, isoTimestampSchema, nonEmptyShortSchema } from "./common.js";
import { actorTypeSchema } from "./envelope/event-envelope.js";

/**
 * A9 — 幂等/重试契约（ES2.0 §2）。
 * 每个命令需要 actor 与授权策略、request ID、幂等键、correlation ID
 * 与可选的 causation ID；副作用命令持久化其幂等结果。
 * 语义：
 * - same key + same digest → 重放已存储结果；
 * - same key + different digest → 类型化冲突 ERR IDEMPOTENCY_DIGEST_MISMATCH；
 * - 重试受聚合预算与 attempt 上限约束（ES2.0 §6 不变量 10）。
 */

export const commandNameSchema = z.enum([
  "CreateEscalation",
  "AmendEscalation",
  "CancelEscalation",
  "RespondToClarification",
  "AcceptOffer",
  "DeclineOffer",
  "StartAttempt",
  "SubmitIntervention",
  "RequestRevision",
  "SubmitSelfEvaluation",
  "SubmitReviewerEvaluation",
  "SubmitAppeal",
  "AcknowledgeResult",
]);

/** 系统自治触发器（非公开命令；用于超时、路由、状态机推进）。 */
export const systemCommandNameSchema = z.enum([
  "SystemProposeOffer",
  "SystemBeginVerification",
  "SystemRecordProofDecision",
  "SystemRouteNextExpert",
  "SystemReleasePayment",
  "SystemReconcileProvider",
  "SystemResolveDispute",
  "SystemExpireEscalation",
  "SystemPublishLearning",
]);

export const commandEnvelopeSchema = z
  .object({
    command: commandNameSchema,
    actor: z
      .object({
        type: actorTypeSchema,
        id: arenaIdSchema,
      })
      .strict(),
    authorization_policy_id: nonEmptyShortSchema,
    request_id: arenaIdSchema,
    idempotency_key: nonEmptyShortSchema,
    request_digest: digestSchema,
    correlation_id: arenaIdSchema,
    causation_id: arenaIdSchema.nullable(),
  })
  .strict();

export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;

export const idempotencyOutcomeStatusSchema = z.enum([
  "REPLAYED",
  "COMPLETED",
  "CONFLICT",
  "IN_PROGRESS",
]);

export const idempotencyRecordSchema = z
  .object({
    idempotency_key: nonEmptyShortSchema,
    request_digest: digestSchema,
    status: idempotencyOutcomeStatusSchema,
    response_digest: digestSchema.nullable(),
    completed_at: isoTimestampSchema.nullable(),
  })
  .strict();

export type IdempotencyRecord = z.infer<typeof idempotencyRecordSchema>;

/** 幂等语义（冻结）。 */
export const IDEMPOTENCY_SEMANTICS = {
  sameKeySameDigest: "replay the stored outcome; no second side effect",
  sameKeyDifferentDigest: "return typed conflict ERR IDEMPOTENCY_DIGEST_MISMATCH",
  concurrentSameKey:
    "exactly one logical command wins; losers observe IN_PROGRESS or the stored outcome",
  retryBound:
    "retries are bounded by authorized aggregate budget and attempt count; exhaustion returns a typed failure",
} as const;

/**
 * 语义校验。
 */
export interface SemanticIssue {
  field: string;
  rule: string;
}

export function validateCommandEnvelopeSemantics(input: CommandEnvelope): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  if (input.causation_id === input.request_id) {
    issues.push({ field: "causation_id", rule: "a command cannot cause itself" });
  }
  return issues;
}

export function validateIdempotencyRecordSemantics(input: IdempotencyRecord): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  if (
    input.status === "COMPLETED" &&
    (input.response_digest === null || input.completed_at === null)
  ) {
    issues.push({
      field: "response_digest",
      rule: "a completed record carries its response digest and completion time",
    });
  }
  if (input.status === "IN_PROGRESS" && input.response_digest !== null) {
    issues.push({ field: "response_digest", rule: "an in-progress record has no response yet" });
  }
  return issues;
}
