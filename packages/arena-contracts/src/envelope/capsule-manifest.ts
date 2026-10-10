import { z } from "zod";
import {
  arenaIdSchema,
  digestSchema,
  isoTimestampSchema,
  nonEmptyMediumSchema,
  nonEmptyShortSchema,
  positiveAmountSchema,
  positiveIntSchema,
  semverSchema,
} from "../common.js";

/**
 * A5 — CapsuleManifest 契约（AR2-004 的冻结输入）。
 * Capsule host 拥有运行时供给、资源/出口管控与已验证的拆除；
 * Arena 侧只保存 manifest 与引用（ES2.0 §3）。
 * 失败关闭：非法或超范围 manifest 必须拒绝（AR2-004 验收）。
 */

export const isolationClassSchema = z.enum([
  "none",
  "process",
  "container",
  "microvm",
  "hardware_backed",
]);

export const permittedActionSchema = z
  .object({
    action_id: arenaIdSchema,
    tool: nonEmptyShortSchema,
    scope: nonEmptyMediumSchema,
    command_allowlist: z.array(nonEmptyShortSchema).max(256),
  })
  .strict();

export const resourcePolicySchema = z
  .object({
    cpu_limit: positiveAmountSchema,
    memory_limit_mb: positiveIntSchema,
    disk_limit_mb: positiveIntSchema,
    max_duration_seconds: positiveIntSchema,
  })
  .strict();

export const egressPolicySchema = z
  .object({
    denied_default: z.literal(true),
    allowed_hosts: z.array(nonEmptyShortSchema).max(64),
    allow_ingress: z.boolean(),
  })
  .strict();

export const scopedCredentialSchema = z
  .object({
    credential_id: arenaIdSchema,
    scope: nonEmptyMediumSchema,
    ttl_seconds: positiveIntSchema.max(86400),
    rotation_policy: nonEmptyMediumSchema,
  })
  .strict();

export const capsuleLifecycleSchema = z
  .object({
    provisioning_timeout_seconds: positiveIntSchema,
    heartbeat_interval_seconds: positiveIntSchema,
    teardown_timeout_seconds: positiveIntSchema,
  })
  .strict();

export const isolationAssuranceSchema = z
  .object({
    isolation_class: isolationClassSchema,
    conformance_suite_digest: digestSchema,
    conformance_suite_version: semverSchema,
    verified_at: isoTimestampSchema,
    provider_id: arenaIdSchema,
  })
  .strict();

export const artifactTransferPolicySchema = z.object({
  transfer: z.enum(["pull_only", "push_scoped"]),
  max_artifact_bytes: positiveIntSchema,
});

export const capsuleManifestSchema = z
  .object({
    manifest_id: arenaIdSchema,
    capsule_id: arenaIdSchema,
    manifest_version: positiveIntSchema,
    tenant_id: arenaIdSchema,
    escalation_id: arenaIdSchema,
    attempt_id: arenaIdSchema,
    environment: z
      .object({
        environment_ref: nonEmptyMediumSchema,
        toolchain_pins: z.array(nonEmptyShortSchema).max(64),
        workspace_init: nonEmptyMediumSchema,
      })
      .strict(),
    permitted_actions: z.array(permittedActionSchema).min(1).max(128),
    resource_policy: resourcePolicySchema,
    egress_policy: egressPolicySchema,
    credentials: z.array(scopedCredentialSchema).max(32),
    lifecycle: capsuleLifecycleSchema,
    assurance: isolationAssuranceSchema,
    artifact_transfer: artifactTransferPolicySchema,
    content_digest: digestSchema,
  })
  .strict();

export type CapsuleManifest = z.infer<typeof capsuleManifestSchema>;

/** 失败关闭规则（AR2-004 验收 + ES2.0 §6 不变量 2）。 */
export const CAPSULE_FAIL_CLOSED_RULE =
  "invalid or over-scoped manifests fail closed: no ENVIRONMENT_READY until a capsule manifest and " +
  "isolation assurance are recorded; the production provider stays disabled until a system-level " +
  "isolation conformance suite passes";

/** 上游运行时不可作 capsule（AR2-000 基线结论）。 */
export const UPSTREAM_RUNTIME_NOT_A_BOUNDARY_RULE =
  "the inherited ZCode agent runtime provides no default OS-level sandboxing (upstream NOTICE) and is " +
  "not a tenant boundary; untrusted expert execution must go through the CapsuleProvider seam";

/**
 * 语义校验。
 */
export interface SemanticIssue {
  field: string;
  rule: string;
}

export function validateCapsuleManifestSemantics(input: CapsuleManifest): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  if (input.assurance.isolation_class === "none") {
    issues.push({
      field: "assurance.isolation_class",
      rule: "isolation_class none cannot carry a verified isolation assurance (fail closed)",
    });
  }
  if (input.credentials.some((c) => c.ttl_seconds > 86400)) {
    issues.push({
      field: "credentials.ttl_seconds",
      rule: "capsule credentials are short-lived (<= 24h)",
    });
  }
  if (input.egress_policy.denied_default !== true) {
    issues.push({ field: "egress_policy.denied_default", rule: "egress must default to denied" });
  }
  if (
    input.artifact_transfer.transfer === "push_scoped" &&
    input.resource_policy.max_duration_seconds > 86400
  ) {
    issues.push({
      field: "resource_policy.max_duration_seconds",
      rule: "push-scoped artifact sessions must be bounded to 24h",
    });
  }
  return issues;
}
