import { z } from "zod";
import { arenaIdSchema } from "@arena/contracts";
import {
  decideRelease,
  evidenceClassSchema,
  gateClassificationSchema,
  gateFindingSchema,
  gateRowSchema,
  gateScopeSchema,
  gateSectionSchema,
  validateGateRegistry,
  type GateRow,
  type ReleaseDecision,
} from "./gate-registry.js";

/**
 * AR2-023 — 门重算（issue #55；spec/work-orders/release-plan.md 的 AR2-023 机制件）。
 *
 * 冻结纪律（延续 AR2-015 证据政策）：
 * - 重算 = 用提交的证据集逐门重建类型化 G0–G8 门行，然后原样复用
 *   AR2-015 机器（validateGateRegistry + decideRelease）重新验证与判定；
 * - 确定性、纯函数：无网络、无时钟、无随机 —— 同样的证据集进去，
 *   逐字节同样的结果出来（两次运行可验证）；
 * - 缺证据的门 ⇒ BLOCKED（绝不默认通过 —— 「没有证据」永远不是 PASS）；
 * - 引用清单里不存在的证据条目 / 重复提交 / 未知门 ⇒ 整个证据集 INVALID
 *   （fail-closed，可检视的 issues）。
 */

export const GATE_RECOMPUTATION_SCHEMA_VERSION = "RGR1.0" as const;

/** git 提交 SHA（小写 hex；sha1 40 位或 sha256 64 位 —— 精确 SHA，拒绝短 SHA）。 */
export const gitCommitShaSchema = z
  .string()
  .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/, "sha must be exact lowercase hex (40 or 64 chars)");

/** 证据链接类型：issue / PR / 证据文档路径 / 提交。 */
export const evidenceLinkKindSchema = z.enum(["issue", "pull_request", "evidence_doc", "commit"]);

/** 证据集 id 家族（evs_ 前缀 —— 与仓库 grg_/fnr_/tnt_ 约定同构）。 */
export const evidenceSetIdSchema = arenaIdSchema.refine(
  (id) => id.startsWith("evs_"),
  "evidence set id must use the evs_ family",
);

/** 证据条目 id 家族（evd_ 前缀）。 */
export const evidenceEntryIdSchema = arenaIdSchema.refine(
  (id) => id.startsWith("evd_"),
  "evidence entry id must use the evd_ family",
);

/** 证据清单条目：链接 + 精确 SHA（typed，必填 —— 缺 SHA 即无效）。 */
export const evidenceManifestEntrySchema = z
  .object({
    entry_id: evidenceEntryIdSchema,
    kind: evidenceLinkKindSchema,
    link: z.string().min(1).max(500),
    sha: gitCommitShaSchema,
    description: z.string().min(1).max(2000),
  })
  .strict();

/** 提交者对单个门的证据声明（镜像 gate-registry 的 WAIVED 授权形状）。 */
const submissionWaiverAuthorizationSchema = z
  .object({
    authorized_by: z.string().min(1),
    authorized_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/),
    rationale: z.string().min(1),
  })
  .strict();

/** 单门证据提交：分类 + 证据块 + 引用的清单条目（至少 1 条 —— 无证据不得声明）。 */
export const gateEvidenceSubmissionSchema = z
  .object({
    gate_id: arenaIdSchema,
    classification: gateClassificationSchema,
    evidence_class: evidenceClassSchema,
    command: z.string().min(1),
    environment: z.string().min(1),
    result: z.string().min(1),
    limitations: z.string(),
    reviewer: z.string().min(1),
    basis_entry_ids: z.array(evidenceEntryIdSchema).min(1).max(16),
    waiver_authorization: submissionWaiverAuthorizationSchema.nullable(),
    findings: z.array(gateFindingSchema).max(32),
  })
  .strict();

/** 证据集：清单 + 逐门提交。 */
export const evidenceSetSchema = z
  .object({
    evidence_set_id: evidenceSetIdSchema,
    manifest: z.array(evidenceManifestEntrySchema).min(1).max(128),
    submissions: z.array(gateEvidenceSubmissionSchema).min(1).max(32),
  })
  .strict();

/** 已解析的证据依据（清单条目的解析副本 —— 嵌入重算结果，可独立检视）。 */
export const evidenceBasisRefSchema = z
  .object({
    entry_id: evidenceEntryIdSchema,
    kind: evidenceLinkKindSchema,
    link: z.string().min(1).max(500),
    sha: gitCommitShaSchema,
  })
  .strict();

/** 机器发布决策（decideRelease 输出的 zod 镜像 —— 供记录内嵌时 fail-closed 校验）。 */
export const releaseDecisionMachineSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("GO"),
      blocking_findings: z.literal(0),
      sections_covered: z.number().int().min(1),
      rows_classified: z.number().int().min(1),
    })
    .strict(),
  z
    .object({
      decision: z.literal("NOT_GO"),
      reason: z.enum([
        "unresolved_critical_or_high",
        "failed_core_gate",
        "blocked_core_gate",
        "invalid_rows",
        "missing_sections",
      ]),
      blocking_findings: z.number().int().min(0),
      sections_covered: z.number().int().min(1),
      rows_classified: z.number().int().min(1),
      detail: z.string(),
    })
    .strict(),
]);

/** 单门重算条目：可检视摘要（gate id / 判定 / 依据链接 / 缺口）+ 完整类型化门行。 */
export const gateRecomputationEntrySchema = z
  .object({
    gate_id: arenaIdSchema,
    section: gateSectionSchema,
    scope: gateScopeSchema,
    verdict: gateClassificationSchema,
    basis: z.array(evidenceBasisRefSchema).max(16),
    gaps: z.array(z.string().min(1).max(2000)).max(16),
    findings: z.array(gateFindingSchema).max(32),
    recomputed_row: gateRowSchema,
  })
  .strict();

/** 重算结果（决策记录的机器依据，整体附着于记录）。 */
export const gateRecomputationResultSchema = z
  .object({
    schema_version: z.literal(GATE_RECOMPUTATION_SCHEMA_VERSION),
    evidence_set_id: evidenceSetIdSchema,
    entries: z.array(gateRecomputationEntrySchema).min(1).max(32),
    machine_decision: releaseDecisionMachineSchema,
  })
  .strict();

export type EvidenceLinkKind = z.infer<typeof evidenceLinkKindSchema>;
export type EvidenceManifestEntry = z.infer<typeof evidenceManifestEntrySchema>;
export type GateEvidenceSubmission = z.infer<typeof gateEvidenceSubmissionSchema>;
export type EvidenceSet = z.infer<typeof evidenceSetSchema>;
export type EvidenceBasisRef = z.infer<typeof evidenceBasisRefSchema>;
export type GateRecomputationEntry = z.infer<typeof gateRecomputationEntrySchema>;
export type GateRecomputationResult = z.infer<typeof gateRecomputationResultSchema>;

export type RecomputationOutcome =
  | { kind: "VALID"; result: GateRecomputationResult }
  | { kind: "INVALID"; issues: ReadonlyArray<{ gate_id: string; rule: string }> };

/**
 * 重算入口：注册表行（AR2-015 类型化 G0–G8 注册表 —— 门定义的规范来源）+
 * 证据集（清单条目 + 逐门提交）⇒ 类型化重算结果。
 * 确定性、纯函数；证据集畸形 / 引用悬空 / 重复 / 未知门 ⇒ INVALID。
 */
export function recomputeGates(input: {
  registry_rows: readonly unknown[];
  evidence_set: unknown;
}): RecomputationOutcome {
  const registry = validateGateRegistry(input.registry_rows);
  if (registry.kind === "INVALID") return { kind: "INVALID", issues: registry.issues };
  const parsedEvidence = evidenceSetSchema.safeParse(input.evidence_set);
  if (!parsedEvidence.success) {
    return {
      kind: "INVALID",
      issues: [
        {
          gate_id: "(evidence-set)",
          rule: parsedEvidence.error.issues
            .map((issue) => issue.message)
            .join("; ")
            .slice(0, 300),
        },
      ],
    };
  }
  const evidence = parsedEvidence.data;
  const manifest = new Map<string, EvidenceManifestEntry>();
  for (const entry of evidence.manifest) {
    if (manifest.has(entry.entry_id)) {
      return {
        kind: "INVALID",
        issues: [{ gate_id: "(evidence-set)", rule: `duplicate manifest entry ${entry.entry_id}` }],
      };
    }
    manifest.set(entry.entry_id, entry);
  }
  const knownGateIds = new Set(registry.rows.map((row) => row.gate_id));
  const submissions = new Map<string, GateEvidenceSubmission>();
  for (const submission of evidence.submissions) {
    if (submissions.has(submission.gate_id)) {
      return {
        kind: "INVALID",
        issues: [{ gate_id: submission.gate_id, rule: "duplicate evidence submission for gate" }],
      };
    }
    if (!knownGateIds.has(submission.gate_id)) {
      return {
        kind: "INVALID",
        issues: [
          { gate_id: submission.gate_id, rule: "submission references a gate not in the registry" },
        ],
      };
    }
    submissions.set(submission.gate_id, submission);
  }
  const entries: GateRecomputationEntry[] = [];
  const recomputedRows: GateRow[] = [];
  for (const row of registry.rows) {
    const submission = submissions.get(row.gate_id);
    if (!submission) {
      const recomputedRow: GateRow = {
        ...row,
        classification: "BLOCKED",
        evidence: {
          ...row.evidence,
          command: "(no evidence submission for this evidence set — not executed)",
          result: "no evidence submitted — fail-closed BLOCKED at the recorded registry SHA",
        },
        waiver_authorization: null,
        findings: [],
      };
      recomputedRows.push(recomputedRow);
      entries.push({
        gate_id: row.gate_id,
        section: row.section,
        scope: row.scope,
        verdict: "BLOCKED",
        basis: [],
        gaps: [
          "no evidence submission for this gate — missing evidence is BLOCKED, never an assumed PASS",
        ],
        findings: [],
        recomputed_row: recomputedRow,
      });
      continue;
    }
    const basis: EvidenceBasisRef[] = [];
    for (const entryId of submission.basis_entry_ids) {
      const entry = manifest.get(entryId);
      if (!entry) {
        return {
          kind: "INVALID",
          issues: [
            {
              gate_id: row.gate_id,
              rule: `submission references evidence entry ${entryId} not present in the manifest`,
            },
          ],
        };
      }
      basis.push({ entry_id: entry.entry_id, kind: entry.kind, link: entry.link, sha: entry.sha });
    }
    const shas = [...new Set(basis.map((ref) => ref.sha))].join(",");
    const recomputedRow: GateRow = {
      gate_id: row.gate_id,
      section: row.section,
      scope: row.scope,
      requirement: row.requirement,
      classification: submission.classification,
      evidence: {
        evidence_class: submission.evidence_class,
        command: submission.command,
        environment: submission.environment,
        sha: shas,
        result: submission.result,
        limitations: submission.limitations,
        reviewer: submission.reviewer,
      },
      waiver_authorization: submission.waiver_authorization,
      findings: submission.findings,
    };
    const gaps: string[] = [];
    if (submission.limitations.trim().length > 0) gaps.push(submission.limitations);
    for (const finding of submission.findings) {
      if (finding.resolution === "unresolved") {
        gaps.push(`${finding.finding_id} (${finding.severity}, unresolved): ${finding.description}`);
      }
    }
    if (submission.classification === "WAIVED") {
      gaps.push("waived with recorded owner authorization — see waiver_authorization");
    }
    if (submission.classification === "BLOCKED") {
      gaps.push(`classified BLOCKED: ${submission.result}`);
    }
    recomputedRows.push(recomputedRow);
    entries.push({
      gate_id: row.gate_id,
      section: row.section,
      scope: row.scope,
      verdict: submission.classification,
      basis,
      gaps,
      findings: submission.findings,
      recomputed_row: recomputedRow,
    });
  }
  const revalidated = validateGateRegistry(recomputedRows);
  if (revalidated.kind === "INVALID") return { kind: "INVALID", issues: revalidated.issues };
  const machineDecision: ReleaseDecision = decideRelease({ rows: recomputedRows });
  return {
    kind: "VALID",
    result: {
      schema_version: GATE_RECOMPUTATION_SCHEMA_VERSION,
      evidence_set_id: evidence.evidence_set_id,
      entries,
      machine_decision: machineDecision,
    },
  };
}
