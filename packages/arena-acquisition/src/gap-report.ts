import { z } from "zod";
import {
  arenaIdSchema,
  currencyCodeSchema,
  isoTimestampSchema,
  positiveAmountSchema,
  privacyProfileSchema,
  retentionProfileSchema,
  semverSchema,
} from "@arena/contracts";
import {
  ACQUISITION_SCHEMA_FAMILY,
  nonEmptyMedium,
  nonEmptyShort,
  type SemanticIssue,
} from "./primitives.js";
import { classifyShapeIssues, describeShapeIssues, type AcqErrorCode } from "./errors.js";
import { computeCanonicalDigest } from "./canonical.js";

/**
 * AR2-016 — CapabilityGapReport（issue #32；spec §2）。
 *
 * 客户 agent 报告一个可测试的能力缺口：目标 agent/body 组成+版本、能力声明、
 * 观察到的任务/准则、最小可复现失败/评估用例、期望行为、领域/环境、
 * deadline/预算边界、隐私/权利/保留约束。
 *
 * - 严格 envelope：未知字段拒绝（含任何试图携带私有思维链的字段）。
 * - repro_cases 至少 1 条 —— 没有可复现用例的「缺口」不可测试，拒绝。
 * - 报告足以陈述可测试缺口，但绝不证明缺口已被修复（spec §3）。
 */

/** 最小可复现失败/评估用例（缺一条即拒绝：ACQ_REPRO_CASE_MISSING）。 */
export const reproCaseSchema = z
  .object({
    case_id: arenaIdSchema,
    kind: z.enum(["MINIMAL_FAILURE", "EVALUATION"]),
    setup: nonEmptyMedium,
    input_description: nonEmptyMedium,
    expected_output: nonEmptyMedium,
    observed_output: nonEmptyMedium,
  })
  .strict();

export type ReproCase = z.infer<typeof reproCaseSchema>;

/** 报告方身份（client agent；不携带任何授权语义）。 */
export const gapReporterSchema = z
  .object({
    client_application_id: arenaIdSchema,
    agent_id: arenaIdSchema,
  })
  .strict();

export type GapReporter = z.infer<typeof gapReporterSchema>;

/** 目标 agent/body 组成与版本。 */
export const gapTargetSchema = z
  .object({
    body_composition_id: arenaIdSchema,
    body_composition_version: semverSchema,
  })
  .strict();

export type GapTarget = z.infer<typeof gapTargetSchema>;

/** 能力声明（能力 ID + 所需最低等级；等级词表与 AR2-008 一致）。 */
export const gapCapabilityStatementSchema = z
  .object({
    capability_id: arenaIdSchema,
    minimum_level: nonEmptyShort,
  })
  .strict();

export type GapCapabilityStatement = z.infer<typeof gapCapabilityStatementSchema>;

/** deadline/预算边界（null = 报告方未给出边界）。 */
export const gapConstraintBoundariesSchema = z
  .object({
    deadline: isoTimestampSchema.nullable(),
    budget_ceiling: positiveAmountSchema.nullable(),
    currency: currencyCodeSchema.nullable(),
  })
  .strict();

export type GapConstraintBoundaries = z.infer<typeof gapConstraintBoundariesSchema>;

/** 隐私/权利/保留约束。 */
export const gapPrivacyConstraintsSchema = z
  .object({
    privacy_profile: privacyProfileSchema,
    retention_profile: retentionProfileSchema,
    rights_notes: nonEmptyMedium,
  })
  .strict();

export type GapPrivacyConstraints = z.infer<typeof gapPrivacyConstraintsSchema>;

export const capabilityGapReportSchema = z
  .object({
    schema_version: z.literal(ACQUISITION_SCHEMA_FAMILY),
    report_id: arenaIdSchema,
    reported_by: gapReporterSchema,
    target: gapTargetSchema,
    capability_statement: gapCapabilityStatementSchema,
    observed_task: z
      .object({
        title: nonEmptyShort,
        outcome_description: nonEmptyMedium,
        criteria: z.array(nonEmptyMedium).max(32),
      })
      .strict(),
    repro_cases: z.array(reproCaseSchema).min(1).max(16),
    expected_behavior: nonEmptyMedium,
    domain: nonEmptyShort,
    environment_notes: nonEmptyMedium.nullable(),
    constraint_boundaries: gapConstraintBoundariesSchema,
    privacy_constraints: gapPrivacyConstraintsSchema,
  })
  .strict();

export type CapabilityGapReport = z.infer<typeof capabilityGapReportSchema>;

/** 缺口报告绝不要求/携带私有模型思维链（ACQ 家族纪律，与 CF1.0 同源）。 */
export const GAP_REPORT_NO_CHAIN_OF_THOUGHT_RULE =
  "a gap report must never require or include private model chain-of-thought; the strict envelope has no " +
  "such field, so any attempt to supply one is rejected as an unknown field, and gap evidence never " +
  "conditions capability claims on hidden reasoning";

/** 报告只陈述可测试缺口，不是修复证明。 */
export const GAP_REPORT_IS_NOT_CLOSURE_PROOF_RULE =
  "a CapabilityGapReport is sufficient to state a testable capability gap; it is never evidence that the " +
  "gap was closed — closure claims require a separate before/after evaluation";

/**
 * 语义校验（结构校验之后在信任边界调用）。
 */
export function validateCapabilityGapReportSemantics(input: CapabilityGapReport): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  const boundaries = input.constraint_boundaries;
  if (boundaries.deadline !== null && boundaries.deadline <= "1970-01-01T00:00:00Z") {
    issues.push({
      field: "constraint_boundaries.deadline",
      rule: "deadline must be a plausible future timestamp",
    });
  }
  if ((boundaries.budget_ceiling === null) !== (boundaries.currency === null)) {
    issues.push({
      field: "constraint_boundaries.budget_ceiling",
      rule: "budget ceiling and currency must be provided together",
    });
  }
  const seenCases = new Set<string>();
  for (const reproCase of input.repro_cases) {
    if (seenCases.has(reproCase.case_id)) {
      issues.push({ field: "repro_cases.case_id", rule: "repro case IDs must be unique" });
    }
    seenCases.add(reproCase.case_id);
  }
  return issues;
}

export type GapReportCheck =
  | { ok: true; report: CapabilityGapReport }
  | { ok: false; code: AcqErrorCode; issues: SemanticIssue[] };

/**
 * 信任边界入口校验：typed 错误（版本门 -> 未知字段 -> 缺复现用例 -> 通用校验）。
 */
export function checkCapabilityGapReport(input: unknown): GapReportCheck {
  const parsed = capabilityGapReportSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
      rule: `${issue.code}${issue.message ? ` — ${issue.message}` : ""}`,
    }));
    return {
      ok: false,
      code: classifyShapeIssues(parsed.error.issues, {
        versionField: "schema_version",
        missingField: "repro_cases",
      }),
      issues,
    };
  }
  return { ok: true, report: parsed.data };
}

/** 规范化摘要（canonical JSON 的 sha256 —— gap_reference 引用锚定用）。 */
export function computeGapReportDigest(report: CapabilityGapReport): string {
  return computeCanonicalDigest(report);
}

/** 校验失败详情的确定性渲染（envelope details 用）。 */
export function describeGapReportIssues(issues: readonly SemanticIssue[]): string {
  return describeShapeIssues(
    issues.map((issue) => ({ code: "custom", path: [issue.field], message: issue.rule })),
  );
}
