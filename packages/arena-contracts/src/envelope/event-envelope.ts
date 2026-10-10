import { z } from "zod";
import {
  EVENT_SCHEMA_VERSION,
  arenaIdSchema,
  isoTimestampSchema,
  nonEmptyShortSchema,
  positiveIntSchema,
  redactionClassSchema,
} from "../common.js";

/**
 * A8 — EventEnvelope 契约（ES2.0 §5 的每一个字段）。
 * 事件在验收后不可变；修正是发出一条链接到被取代事实的新事件，
 * 绝不隐形改历史。事件只有在权威状态事务提交之后才对外可见；
 * webhook 投递走持久 outbox（唯一投递身份、签名、时间戳、重试计划）。
 */

export const aggregateTypeSchema = z.enum([
  "escalation",
  "attempt",
  "capsule",
  "evidence",
  "verification",
  "payment",
  "learning",
]);

export const actorTypeSchema = z.enum([
  "requester",
  "expert",
  "reviewer",
  "adjudicator",
  "system",
  "provider",
  "operator",
]);

export const eventCorrectionSchema = z
  .object({
    supersedes_event_id: arenaIdSchema,
    reason: nonEmptyShortSchema,
  })
  .strict();

export const eventEnvelopeSchema = z
  .object({
    event_id: arenaIdSchema,
    schema_version: z.literal(EVENT_SCHEMA_VERSION),
    tenant_id: arenaIdSchema,
    aggregate: z
      .object({
        type: aggregateTypeSchema,
        id: arenaIdSchema,
        version: positiveIntSchema,
      })
      .strict(),
    event_type: nonEmptyShortSchema,
    occurred_at: isoTimestampSchema,
    recorded_at: isoTimestampSchema,
    actor: z
      .object({
        type: actorTypeSchema,
        id: arenaIdSchema,
      })
      .strict(),
    correlation_id: arenaIdSchema,
    causation_id: arenaIdSchema.nullable(),
    request_id: arenaIdSchema.nullable(),
    policy_version: nonEmptyShortSchema,
    payload: z
      .object({
        schema_id: arenaIdSchema,
        redaction_class: redactionClassSchema,
      })
      .strict(),
    immutable: z.literal(true),
    correction: eventCorrectionSchema.nullable(),
  })
  .strict();

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

/** 可见性规则（ES2.0 §5）。 */
export const EVENT_OBSERVABILITY_RULE =
  "an event becomes externally observable only after its authoritative state transaction commits; " +
  "webhook delivery uses a durable outbox with a unique provider/event delivery identity, signature, " +
  "timestamp, retry schedule and delivery attempts";

/** 修正语义（ES2.0 §5）。 */
export const EVENT_CORRECTION_RULE =
  "correction emits a new event linked to the superseded fact; it never changes history invisibly" as const;

/**
 * 语义校验。
 */
export interface SemanticIssue {
  field: string;
  rule: string;
}

export function validateEventEnvelopeSemantics(input: EventEnvelope): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  if (input.recorded_at < input.occurred_at) {
    issues.push({ field: "recorded_at", rule: "recording cannot precede occurrence" });
  }
  if (input.correction !== null && input.correction.supersedes_event_id === input.event_id) {
    issues.push({
      field: "correction.supersedes_event_id",
      rule: "an event cannot supersede itself",
    });
  }
  if (input.causation_id === input.event_id) {
    issues.push({ field: "causation_id", rule: "an event cannot be its own cause" });
  }
  if (input.payload.redaction_class === "reviewer_private" && input.actor.type === "requester") {
    issues.push({
      field: "payload.redaction_class",
      rule: "reviewer-private payloads require a reviewer-scope actor",
    });
  }
  return issues;
}
