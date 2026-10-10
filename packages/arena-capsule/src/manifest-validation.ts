import {
  capsuleManifestSchema,
  validateCapsuleManifestSemantics,
  type CapsuleManifest,
} from "@arena/contracts";

/**
 * 失败关闭的 capsule manifest 校验（AR2-004 验收场景 2）。
 * 顺序：结构 schema（strict，未知字段即拒）→ 冻结语义规则 → 本模块补充语义。
 * 任何一步失败都返回 ARENA_CAPSULE_MANIFEST_INVALID + 分字段 issue 列表；
 * 绝不"部分接受"一个非法或超范围的 manifest。
 */

/** 单条校验问题（字段 + 规则名；可直接映射到错误信封 details）。 */
export interface ManifestIssue {
  field: string;
  rule: string;
}

export type CapsuleManifestCheck =
  | { kind: "VALID"; manifest: CapsuleManifest }
  | { kind: "INVALID"; issues: ManifestIssue[] };

/** 本模块在冻结语义之外的补充规则（每条都可测）。 */
const SUPPLEMENTARY_SEMANTICS: Array<{
  field: string;
  rule: string;
  violated: (m: CapsuleManifest) => boolean;
}> = [
  {
    field: "permitted_actions.command_allowlist",
    rule: "every permitted action must declare at least one allowed command (empty allowlist is over-scoped, not unrestricted)",
    violated: (m) => m.permitted_actions.some((a) => a.command_allowlist.length === 0),
  },
  {
    field: "resource_policy.max_duration_seconds",
    rule: "capsule sessions must be bounded to 24h regardless of artifact transfer mode",
    violated: (m) => m.resource_policy.max_duration_seconds > 86400,
  },
  {
    field: "lifecycle.heartbeat_interval_seconds",
    rule: "heartbeat interval must be shorter than the provisioning timeout (a capsule that can never report liveness is unusable)",
    violated: (m) =>
      m.lifecycle.heartbeat_interval_seconds >= m.lifecycle.provisioning_timeout_seconds,
  },
  {
    field: "credentials.scope",
    rule: "credential scope must be unique within the manifest (duplicate scopes are ambiguous revocation surfaces)",
    violated: (m) => {
      const scopes = m.credentials.map((c) => c.scope);
      return new Set(scopes).size !== scopes.length;
    },
  },
];

export function checkCapsuleManifest(input: unknown): CapsuleManifestCheck {
  const parsed = capsuleManifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      kind: "INVALID",
      issues: parsed.error.issues.map((issue) => ({
        field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
        rule: `schema: ${issue.code}${issue.message ? ` — ${issue.message}` : ""}`,
      })),
    };
  }
  const manifest = parsed.data;
  const issues: ManifestIssue[] = [...validateCapsuleManifestSemantics(manifest)];
  for (const rule of SUPPLEMENTARY_SEMANTICS) {
    if (rule.violated(manifest)) {
      issues.push({ field: rule.field, rule: rule.rule });
    }
  }
  if (issues.length > 0) {
    return { kind: "INVALID", issues };
  }
  return { kind: "VALID", manifest };
}

/** 快速断言形式：校验失败抛出携带全部 issue 的类型化错误。 */
export class CapsuleManifestRejected extends Error {
  readonly code = "ARENA_CAPSULE_MANIFEST_INVALID" as const;
  readonly issues: ManifestIssue[];
  constructor(issues: ManifestIssue[]) {
    super(`capsule manifest rejected (fail closed): ${issues.length} issue(s)`);
    this.issues = issues;
  }
}

export function requireValidCapsuleManifest(input: unknown): CapsuleManifest {
  const check = checkCapsuleManifest(input);
  if (check.kind === "INVALID") {
    throw new CapsuleManifestRejected(check.issues);
  }
  return check.manifest;
}
