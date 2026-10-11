import { z } from "zod";
import { arenaIdSchema, isoTimestampSchema } from "@arena/contracts";

/**
 * AR2-015 — 发布门注册表（issue #17；spec/testing/acceptance-gates.md）。
 *
 * 冻结纪律（证据政策）：
 * - 每个门行显式分类 PASS / FAIL / BLOCKED / WAIVED —— 空行或「不适用」
 *   绝不允许按已通过处理；
 * - 证据必须记录类别（automated unit / adversarial profile / live /
 *   inspectable doc）、命令、环境、SHA、结果、局限与评审人；
 * - WAIVED 需要记录的 owner 授权文本；无授权的 WAIVED → 无效；
 * - 未解决的 critical/high 发现 ⇒ 发布决策 NOT_GO（「构建通过」绝不是
 *   发布决策 —— release decision 是显式产出物）。
 */

export const gateSectionSchema = z.enum([
  "G0-fork-baseline",
  "G1-contracts-architecture",
  "G2-security-tenant-boundaries",
  "G3-durability-idempotency-resilience",
  "G4-proof-payments",
  "G5-expert-arena",
  "G6-product-end-to-end",
  "G7-observability-operations",
  "G8-capability-acquisition",
]);

export const gateClassificationSchema = z.enum(["PASS", "FAIL", "BLOCKED", "WAIVED"]);

/** 门范围：core = 核心发布门；extension = 独立扩展门（G8 剥离原则 —— 扩展未实现不阻断核心发布，但它是扩展自身发布的硬门）。 */
export const gateScopeSchema = z.enum(["core", "extension"]);

/** 只有 G8 段允许 extension 范围（G0–G7 永远是核心门 —— 不许借 scope 豁免）。 */
const EXTENSION_ALLOWED_SECTIONS: readonly string[] = ["G8-capability-acquisition"];

export const evidenceClassSchema = z.enum([
  "automated_unit_suite",
  "adversarial_profile",
  "live_evidence",
  "inspectable_document",
]);

export const severitySchema = z.enum(["critical", "high", "medium", "low"]);

export const gateEvidenceSchema = z
  .object({
    evidence_class: evidenceClassSchema,
    command: z.string().min(1),
    environment: z.string().min(1),
    sha: z.string().min(1),
    result: z.string().min(1),
    limitations: z.string(),
    reviewer: z.string().min(1),
  })
  .strict();

export const gateFindingSchema = z
  .object({
    finding_id: arenaIdSchema,
    severity: severitySchema,
    description: z.string().min(1),
    resolution: z.enum(["unresolved", "resolved", "owner_accepted"]),
    owner_acceptance: z
      .object({
        accepted_by: z.string().min(1),
        accepted_at: isoTimestampSchema,
        rationale: z.string().min(1),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const gateRowSchema = z
  .object({
    gate_id: arenaIdSchema,
    section: gateSectionSchema,
    /** 范围：core 参与核心发布决策；extension（仅 G8）不参与核心决策。 */
    scope: gateScopeSchema,
    requirement: z.string().min(1),
    classification: gateClassificationSchema,
    evidence: gateEvidenceSchema,
    /** WAIVED 必须带 owner 授权（无授权 → 无效行）。 */
    waiver_authorization: z
      .object({
        authorized_by: z.string().min(1),
        authorized_at: isoTimestampSchema,
        rationale: z.string().min(1),
      })
      .strict()
      .nullable(),
    findings: z.array(gateFindingSchema).max(32),
  })
  .strict();

export type GateSection = z.infer<typeof gateSectionSchema>;
export type GateClassification = z.infer<typeof gateClassificationSchema>;
export type GateScope = z.infer<typeof gateScopeSchema>;
export type GateEvidence = z.infer<typeof gateEvidenceSchema>;
export type GateFinding = z.infer<typeof gateFindingSchema>;
export type GateRow = z.infer<typeof gateRowSchema>;

export type ReleaseDecision =
  | { decision: "GO"; blocking_findings: 0; sections_covered: number; rows_classified: number }
  | {
      decision: "NOT_GO";
      reason:
        | "unresolved_critical_or_high"
        | "failed_core_gate"
        | "blocked_core_gate"
        | "invalid_rows"
        | "missing_sections";
      blocking_findings: number;
      sections_covered: number;
      rows_classified: number;
      detail: string;
    };

export type RegistryValidation =
  | { kind: "VALID"; rows: readonly GateRow[] }
  | { kind: "INVALID"; issues: ReadonlyArray<{ gate_id: string; rule: string }> };

const ALL_SECTIONS: readonly GateSection[] = [
  "G0-fork-baseline",
  "G1-contracts-architecture",
  "G2-security-tenant-boundaries",
  "G3-durability-idempotency-resilience",
  "G4-proof-payments",
  "G5-expert-arena",
  "G6-product-end-to-end",
  "G7-observability-operations",
  "G8-capability-acquisition",
];

/** 校验一个门行集：全 9 段覆盖；WAIVED 必须有授权；发现须自洽。 */
export function validateGateRegistry(rows: readonly unknown[]): RegistryValidation {
  const issues: Array<{ gate_id: string; rule: string }> = [];
  const parsedRows: GateRow[] = [];
  const seenIds = new Set<string>();
  for (const candidate of rows) {
    const parsed = gateRowSchema.safeParse(candidate);
    if (!parsed.success) {
      issues.push({
        gate_id: "(unparseable)",
        rule: parsed.error.issues
          .map((issue) => issue.message)
          .join("; ")
          .slice(0, 200),
      });
      continue;
    }
    const row = parsed.data;
    if (seenIds.has(row.gate_id)) {
      issues.push({ gate_id: row.gate_id, rule: "duplicate gate id" });
      continue;
    }
    seenIds.add(row.gate_id);
    if (row.scope === "extension" && !EXTENSION_ALLOWED_SECTIONS.includes(row.section)) {
      issues.push({
        gate_id: row.gate_id,
        rule: "extension scope is only valid on G8 rows — core gate sections cannot be exempted from the core release decision",
      });
      continue;
    }
    if (row.classification === "WAIVED" && row.waiver_authorization === null) {
      issues.push({ gate_id: row.gate_id, rule: "WAIVED requires recorded owner authorization" });
      continue;
    }
    if (row.classification !== "WAIVED" && row.waiver_authorization !== null) {
      issues.push({ gate_id: row.gate_id, rule: "waiver authorization only valid on WAIVED rows" });
      continue;
    }
    for (const finding of row.findings) {
      if (finding.resolution === "owner_accepted" && finding.owner_acceptance === null) {
        issues.push({
          gate_id: row.gate_id,
          rule: `finding ${finding.finding_id} claims owner acceptance without a record`,
        });
      }
    }
    parsedRows.push(row);
  }
  if (issues.length > 0) return { kind: "INVALID", issues };
  const covered = new Set(parsedRows.map((row) => row.section));
  const missing = ALL_SECTIONS.filter((section) => !covered.has(section));
  if (missing.length > 0) {
    return {
      kind: "INVALID",
      issues: missing.map((section) => ({
        gate_id: `(section ${section})`,
        rule: "no row covers this gate section",
      })),
    };
  }
  return { kind: "VALID", rows: parsedRows };
}

/**
 * 发布决策（只消费 core 行 —— G8 extension 行是扩展自身的发布门，不阻断核心）：
 * - core 行 FAIL 或 BLOCKED（非 WAIVED）⇒ NOT_GO（门未过/无证据，不许 GO）；
 * - 未解决 critical/high 发现 ⇒ NOT_GO；
 * - 「构建通过」绝不是 GO —— release decision 是显式产出物。
 */
export function decideRelease(input: { rows: readonly unknown[] }): ReleaseDecision {
  const registry = validateGateRegistry(input.rows);
  if (registry.kind === "INVALID") {
    return {
      decision: "NOT_GO",
      reason: "invalid_rows",
      blocking_findings: 0,
      sections_covered: 0,
      rows_classified: 0,
      detail: registry.issues
        .slice(0, 8)
        .map((issue) => `${issue.gate_id}: ${issue.rule}`)
        .join(" | "),
    };
  }
  const coreRows = registry.rows.filter((row) => row.scope === "core");
  const blocking = coreRows.flatMap((row) =>
    row.findings
      .filter(
        (finding) =>
          (finding.severity === "critical" || finding.severity === "high") &&
          finding.resolution === "unresolved",
      )
      .map((finding) => `${row.gate_id}/${finding.finding_id}: ${finding.description}`),
  );
  const failed = coreRows.filter((row) => row.classification === "FAIL");
  const blocked = coreRows.filter((row) => row.classification === "BLOCKED");
  const sectionsCovered = new Set(registry.rows.map((row) => row.section)).size;
  const base = {
    blocking_findings: blocking.length,
    sections_covered: sectionsCovered,
    rows_classified: registry.rows.length,
  };
  if (blocking.length > 0) {
    return {
      decision: "NOT_GO",
      reason: "unresolved_critical_or_high",
      ...base,
      detail: blocking.slice(0, 8).join(" | "),
    };
  }
  if (failed.length > 0) {
    return {
      decision: "NOT_GO",
      reason: "failed_core_gate",
      ...base,
      detail: failed
        .slice(0, 8)
        .map((row) => `${row.gate_id} (${row.section}): ${row.requirement}`)
        .join(" | "),
    };
  }
  if (blocked.length > 0) {
    return {
      decision: "NOT_GO",
      reason: "blocked_core_gate",
      ...base,
      detail: blocked
        .slice(0, 8)
        .map((row) => `${row.gate_id} (${row.section}): ${row.requirement}`)
        .join(" | "),
    };
  }
  return {
    decision: "GO",
    blocking_findings: 0,
    sections_covered: sectionsCovered,
    rows_classified: registry.rows.length,
  };
}

export const RELEASE_GATE_DISCLOSURE =
  "Every gate row is explicitly PASS/FAIL/BLOCKED/WAIVED with recorded evidence (class, command, " +
  "environment, SHA, result, limitations, reviewer) and scope (core vs the separate G8 extension gate); " +
  "WAIVED requires owner authorization; unresolved critical/high findings force NOT_GO; a FAIL or " +
  "BLOCKED core gate forces NOT_GO — a green build is never a release decision";
