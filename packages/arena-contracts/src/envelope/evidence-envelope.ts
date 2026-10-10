import { z } from "zod";
import {
  arenaIdSchema,
  digestSchema,
  isoTimestampSchema,
  nonEmptyMediumSchema,
  nonEmptyShortSchema,
  positiveIntSchema,
  redactionClassSchema,
  semverSchema,
} from "../common.js";

/**
 * A6 — EvidenceEnvelope 契约（ES2.0 §3/§5；PVP1.0 §6）。
 * Evidence store 拥有不可变证据对象与可信 provenance 元数据。
 * 信任分层：Arena runner / 注册应用 runner（带注册 verifier key 与已证明配置）/
 * 具名策略接受的外部来源 / 不可信附件（仅作 review 输入）。
 * 绑定：tenant、escalation、attempt、environment、validator 版本，防重放。
 */

export const evidenceIssuerTierSchema = z.enum([
  "arena_runner",
  "registered_application_runner",
  "accepted_external_source",
  "untrusted_attachment",
]);

export const evidenceObjectSchema = z
  .object({
    content_digest: digestSchema,
    size_bytes: positiveIntSchema,
    media_type: nonEmptyShortSchema,
    storage_ref: nonEmptyMediumSchema,
  })
  .strict();

export const evidenceProvenanceSchema = z
  .object({
    issuer_tier: evidenceIssuerTierSchema,
    issuer_id: arenaIdSchema,
    signature_algorithm: nonEmptyShortSchema.nullable(),
    signature: nonEmptyShortSchema.nullable(),
    issued_at: isoTimestampSchema,
    replay_protection: z.enum(["nonce", "sequence", "timestamp_window"]),
  })
  .strict();

export const evidenceBindingSchema = z
  .object({
    tenant_id: arenaIdSchema,
    escalation_id: arenaIdSchema,
    attempt_id: arenaIdSchema,
    environment_digest: digestSchema,
    validator_id: arenaIdSchema,
    validator_version: semverSchema,
  })
  .strict();

export const evidenceCorrectionSchema = z
  .object({
    supersedes_evidence_id: arenaIdSchema,
    reason: nonEmptyMediumSchema,
  })
  .strict();

export const evidenceEnvelopeSchema = z
  .object({
    evidence_id: arenaIdSchema,
    object: evidenceObjectSchema,
    provenance: evidenceProvenanceSchema,
    binding: evidenceBindingSchema,
    redaction_class: redactionClassSchema,
    immutable: z.literal(true),
    correction: evidenceCorrectionSchema.nullable(),
    recorded_at: isoTimestampSchema,
  })
  .strict();

export type EvidenceEnvelope = z.infer<typeof evidenceEnvelopeSchema>;

/** 不可变与修正规则（ES2.0 §5）。 */
export const EVIDENCE_IMMUTABILITY_RULE =
  "evidence objects are immutable after acceptance; a correction emits a new evidence envelope linked " +
  "to the superseded fact and never changes history invisibly";

/** 信任模型规则（PVP1.0 §6）。 */
export const CALLER_PROOF_TRUST_RULE =
  "a client-provided success boolean alone is never trusted; trusted runner evidence must be signed or " +
  "authenticated, bound to tenant/escalation/attempt/environment/validator version and replay-protected; " +
  "untrusted attachments are review input only";

/**
 * 语义校验。
 */
export interface SemanticIssue {
  field: string;
  rule: string;
}

export function validateEvidenceEnvelopeSemantics(input: EvidenceEnvelope): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  const trusted =
    input.provenance.issuer_tier === "arena_runner" ||
    input.provenance.issuer_tier === "registered_application_runner";
  if (
    trusted &&
    (input.provenance.signature === null || input.provenance.signature_algorithm === null)
  ) {
    issues.push({
      field: "provenance.signature",
      rule: "trusted-tier evidence must be signed or authenticated",
    });
  }
  if (
    input.provenance.issuer_tier === "untrusted_attachment" &&
    input.redaction_class === "public"
  ) {
    issues.push({
      field: "redaction_class",
      rule: "untrusted attachments must not be classified public",
    });
  }
  if (input.correction !== null && input.correction.supersedes_evidence_id === input.evidence_id) {
    issues.push({
      field: "correction.supersedes_evidence_id",
      rule: "an evidence object cannot supersede itself",
    });
  }
  if (input.recorded_at < input.provenance.issued_at) {
    issues.push({ field: "recorded_at", rule: "recording cannot precede issuance" });
  }
  return issues;
}
