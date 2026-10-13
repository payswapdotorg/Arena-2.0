import { z } from "zod";
import { arenaIdSchema, isoDateSchema, isoTimestampSchema } from "@arena/contracts";
import {
  decideRelease,
  severitySchema,
  validateGateRegistry,
  type ReleaseDecision,
} from "./gate-registry.js";
import {
  evidenceManifestEntrySchema,
  gateRecomputationResultSchema,
  type GateRecomputationResult,
} from "./recompute-gates.js";

/**
 * AR2-023 — 版本化发布决策记录（issue #55；spec/work-orders/release-plan.md）。
 *
 * 冻结纪律（镜像 AR2-015 门注册表）：
 * - 决策类只有三种：PRODUCTION_GO / LIMITED_SCOPE_GO / NOT_GO_HOLD —— 其他一律
 *   校验失败（fail-closed）；本记录是「仪器」不是「授权」—— 真正的签署/提
 *   交/公告流程见 docs/evidence/release/AR2-023-authorization-workflow-*.md；
 * - 记录只有附着一份与决策类一致的门重算结果才有效（PRODUCTION_GO ⇒ 全绿；
 *   LIMITED_SCOPE_GO ⇒ AR2-015 已记录的受限范围内可满足的判定；NOT_GO_HOLD ⇒
 *   未决阻断项全部列入残余风险）；
 * - 证据清单条目必须带精确 SHA；评审/到期条件对 GO 类必填非空；
 * - 签署块是机制性的（name/role/method —— 身份由工作流文档定义的 docs-commit
 *   机制验证，不做密码学签名）；
 * - 附着的重算结果可被独立重推导（decideRelease 重跑 + 摘要/门行一致性 +
 *   依据/清单一致性）—— 篡改即失效。
 */

export const RELEASE_DECISION_SCHEMA_VERSION = "RDR1.0" as const;

/** 范围边界（显式 allow-list —— 每项一个 typed enum）。 */
export const releasePlatformSchema = z.enum(["linux", "macos", "windows"]);
export const financeModeSchema = z.enum(["test_mode", "live_mode"]);
export const untrustedExecutionModeSchema = z.enum([
  "disabled",
  "enabled_expert",
  "enabled_expert_and_scraper",
]);
export const identityModeSchema = z.enum(["demo_auth", "production_adapter"]);
export const isolationModeSchema = z.enum(["synthetic_provider_only", "approved_os_level_provider"]);

export const releaseScopeSchema = z
  .object({
    platforms: z.array(releasePlatformSchema).min(1).max(3),
    finance_mode: financeModeSchema,
    untrusted_execution: untrustedExecutionModeSchema,
    identity_mode: identityModeSchema,
    isolation_mode: isolationModeSchema,
  })
  .strict();

export const decisionClassSchema = z.enum(["PRODUCTION_GO", "LIMITED_SCOPE_GO", "NOT_GO_HOLD"]);
export const decisionRecordStatusSchema = z.enum(["TEMPLATE_UNSIGNED", "RECORDED"]);

/** 决策记录 id 家族（rdr_ 前缀 —— 与 grg_/fnr_ 约定同构）。 */
export const decisionIdSchema = arenaIdSchema.refine(
  (id) => id.startsWith("rdr_"),
  "decision id must use the rdr_ family",
);

/** 签署方法：单一身份组织内以 main 上的 docs 提交记录身份（工作流文档定义）。 */
export const signerMethodSchema = z.enum(["github_identity_docs_commit"]);

export const decisionSignerSchema = z
  .object({
    name: z.string().min(1).max(200),
    role: z.enum(["release_owner"]),
    method: signerMethodSchema,
    github_identity: z.string().min(1).max(200),
  })
  .strict();

/** 残余风险处置。 */
export const riskDispositionSchema = z.enum([
  "OPEN",
  "ACCEPTED_WITH_CONTROLS",
  "MITIGATED",
  "RETIRED",
]);

export const residualRiskIdSchema = arenaIdSchema.refine(
  (id) => id.startsWith("rsk_"),
  "risk id must use the rsk_ family",
);

export const residualRiskSchema = z
  .object({
    risk_id: residualRiskIdSchema,
    description: z.string().min(1).max(2000),
    severity: severitySchema,
    linked_gates: z.array(arenaIdSchema).max(32),
    disposition: riskDispositionSchema,
    mitigation: z.string().max(2000),
  })
  .strict();

/** 复审/到期条件。 */
export const reviewConditionKindSchema = z.enum([
  "expires_on",
  "re_review_by_date",
  "re_review_on_event",
  "enablement_precondition",
]);

export const reviewConditionSchema = z
  .object({
    kind: reviewConditionKindSchema,
    description: z.string().min(1).max(2000),
    date: isoDateSchema.nullable(),
  })
  .strict();

/** 修订引用（修订链 —— B 覆盖 A；链级校验见 decision-chain.ts）。 */
export const amendmentRefSchema = z
  .object({
    decision_id: decisionIdSchema,
    reason: z.string().min(1).max(2000),
  })
  .strict();

export const releaseDecisionRecordSchema = z
  .object({
    schema_version: z.literal(RELEASE_DECISION_SCHEMA_VERSION),
    status: decisionRecordStatusSchema,
    decision_id: decisionIdSchema,
    decision_class: decisionClassSchema,
    decision_date: isoTimestampSchema,
    scope: releaseScopeSchema,
    evidence_manifest: z.array(evidenceManifestEntrySchema).min(1).max(128),
    gate_recomputation: gateRecomputationResultSchema,
    residual_risks: z.array(residualRiskSchema).max(32),
    signer: decisionSignerSchema,
    review_conditions: z.array(reviewConditionSchema).max(16),
    supersedes: amendmentRefSchema.nullable(),
    statement: z.string().min(1).max(4000),
  })
  .strict();

export type ReleasePlatform = z.infer<typeof releasePlatformSchema>;
export type FinanceMode = z.infer<typeof financeModeSchema>;
export type UntrustedExecutionMode = z.infer<typeof untrustedExecutionModeSchema>;
export type IdentityMode = z.infer<typeof identityModeSchema>;
export type IsolationMode = z.infer<typeof isolationModeSchema>;
export type ReleaseScope = z.infer<typeof releaseScopeSchema>;
export type DecisionClass = z.infer<typeof decisionClassSchema>;
export type DecisionRecordStatus = z.infer<typeof decisionRecordStatusSchema>;
export type RiskDisposition = z.infer<typeof riskDispositionSchema>;
export type ResidualRisk = z.infer<typeof residualRiskSchema>;
export type ReviewCondition = z.infer<typeof reviewConditionSchema>;
export type AmendmentRef = z.infer<typeof amendmentRefSchema>;
export type ReleaseDecisionRecord = z.infer<typeof releaseDecisionRecordSchema>;

export type DecisionRecordValidation =
  | { kind: "VALID"; record: ReleaseDecisionRecord }
  | { kind: "INVALID"; issues: ReadonlyArray<{ rule: string }> };

/** LIMITED_SCOPE_GO 下可按范围豁免的门（AR2-015 记录的受限范围基线，钉在该注册表）。 */
const LIMITED_SCOPE_EXCUSABLE_GATES: ReadonlySet<string> = new Set([
  "grg_00000002",
  "grg_00000008",
  "grg_00000013",
]);

function invalid(rules: readonly string[]): DecisionRecordValidation {
  return { kind: "INVALID", issues: rules.map((rule) => ({ rule })) };
}

/** 稳定序列化（键排序）—— 结构比较用（确定性，不依赖键序）。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function machineDecisionsEqual(a: ReleaseDecision, b: ReleaseDecision): boolean {
  if (a.decision !== b.decision) return false;
  if (a.blocking_findings !== b.blocking_findings) return false;
  if (a.sections_covered !== b.sections_covered) return false;
  if (a.rows_classified !== b.rows_classified) return false;
  if (a.decision === "GO" || b.decision === "GO") return a.decision === b.decision;
  return a.reason === b.reason && a.detail === b.detail;
}

function gateIdsInSection(recomputation: GateRecomputationResult, section: string): Set<string> {
  return new Set(
    recomputation.entries
      .filter((entry) => entry.section === section)
      .map((entry) => entry.gate_id),
  );
}

/**
 * 决策记录校验（shape + 语义；全部 fail-closed）：
 * 范围/条件/处置自洽；附着重算可重推导且与决策类一致；修订不自引用。
 */
export function validateDecisionRecord(candidate: unknown): DecisionRecordValidation {
  const parsed = releaseDecisionRecordSchema.safeParse(candidate);
  if (!parsed.success) {
    return invalid(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  const record = parsed.data;
  const problems: string[] = [];
  if (new Set(record.scope.platforms).size !== record.scope.platforms.length) {
    problems.push("scope.platforms contains duplicates");
  }
  for (const condition of record.review_conditions) {
    if (
      (condition.kind === "expires_on" || condition.kind === "re_review_by_date") &&
      condition.date === null
    ) {
      problems.push(`review condition ${condition.kind} requires a date`);
    }
  }
  if (
    record.decision_class === "PRODUCTION_GO" ||
    record.decision_class === "LIMITED_SCOPE_GO"
  ) {
    if (record.review_conditions.length === 0) {
      problems.push(`${record.decision_class} requires non-empty review/expiry conditions`);
    } else if (
      !record.review_conditions.some(
        (condition) =>
          (condition.kind === "expires_on" || condition.kind === "re_review_by_date") &&
          condition.date !== null,
      )
    ) {
      problems.push(`${record.decision_class} requires at least one dated expiry/re-review condition`);
    }
  }
  for (const risk of record.residual_risks) {
    if (
      (risk.disposition === "ACCEPTED_WITH_CONTROLS" ||
        risk.disposition === "MITIGATED" ||
        risk.disposition === "RETIRED") &&
      risk.mitigation.trim().length === 0
    ) {
      problems.push(`residual risk ${risk.risk_id} with disposition ${risk.disposition} requires a recorded mitigation`);
    }
  }
  if (record.supersedes !== null && record.supersedes.decision_id === record.decision_id) {
    problems.push("a decision record cannot supersede itself");
  }
  const recomputation = record.gate_recomputation;
  const recomputedRows = recomputation.entries.map((entry) => entry.recomputed_row);
  const registry = validateGateRegistry(recomputedRows);
  if (registry.kind === "INVALID") {
    problems.push(
      ...registry.issues.map((issue) => `attached recomputation registry invalid: ${issue.gate_id}: ${issue.rule}`),
    );
  } else if (!machineDecisionsEqual(decideRelease({ rows: recomputedRows }), recomputation.machine_decision)) {
    problems.push("attached machine decision does not match decideRelease re-derived over the recomputed rows");
  }
  const manifest = new Map(record.evidence_manifest.map((entry) => [entry.entry_id, entry]));
  for (const entry of recomputation.entries) {
    const row = entry.recomputed_row;
    if (entry.gate_id !== row.gate_id || entry.verdict !== row.classification) {
      problems.push(`recomputation entry ${entry.gate_id} disagrees with its recomputed row`);
    }
    if (entry.section !== row.section || entry.scope !== row.scope) {
      problems.push(`recomputation entry ${entry.gate_id} section/scope disagrees with its recomputed row`);
    }
    if (canonicalJson(entry.findings) !== canonicalJson(row.findings)) {
      problems.push(`recomputation entry ${entry.gate_id} findings disagree with its recomputed row`);
    }
    for (const ref of entry.basis) {
      const source = manifest.get(ref.entry_id);
      if (source === undefined) {
        problems.push(`recomputation basis ${ref.entry_id} is not in the record evidence manifest`);
      } else if (
        source.kind !== ref.kind ||
        source.link !== ref.link ||
        source.sha !== ref.sha
      ) {
        problems.push(`recomputation basis ${ref.entry_id} disagrees with the manifest entry`);
      }
    }
  }
  const coreEntries = recomputation.entries.filter((entry) => entry.scope === "core");
  const nonGreenCore = coreEntries.filter(
    (entry) => entry.verdict === "FAIL" || entry.verdict === "BLOCKED",
  );
  const g8Entry = recomputation.entries.find(
    (entry) => entry.section === "G8-capability-acquisition",
  );
  if (record.decision_class === "PRODUCTION_GO") {
    if (recomputation.machine_decision.decision !== "GO") {
      problems.push("PRODUCTION_GO requires all core gates green (attached machine decision is not GO)");
    }
    if (record.scope.untrusted_execution !== "disabled") {
      if (record.scope.isolation_mode !== "approved_os_level_provider") {
        problems.push("enabling untrusted execution requires the approved OS-level isolation mode");
      }
      if (record.scope.untrusted_execution === "enabled_expert_and_scraper") {
        if (g8Entry === undefined || g8Entry.verdict !== "PASS") {
          problems.push("scraper scope requires the G8 extension gate to PASS");
        }
      }
    }
    if (record.scope.finance_mode === "live_mode") {
      if (!record.review_conditions.some((c) => c.kind === "enablement_precondition")) {
        problems.push("live-money scope requires an enablement_precondition review condition (separately registered WO)");
      }
      const g4Gates = gateIdsInSection(recomputation, "G4-proof-payments");
      if (!record.residual_risks.some((risk) => risk.linked_gates.some((g) => g4Gates.has(g)))) {
        problems.push("live-money scope requires the recorded commercial/legal residual risk linked to G4");
      }
    }
    if (record.scope.identity_mode === "demo_auth") {
      const g2Gates = gateIdsInSection(recomputation, "G2-security-tenant-boundaries");
      if (
        !record.residual_risks.some(
          (risk) =>
            risk.disposition === "ACCEPTED_WITH_CONTROLS" &&
            risk.linked_gates.some((g) => g2Gates.has(g)),
        )
      ) {
        problems.push("demo-auth identity in a PRODUCTION_GO requires the recorded seam risk linked to G2");
      }
    }
  } else if (record.decision_class === "LIMITED_SCOPE_GO") {
    if (
      record.scope.platforms.length !== 1 ||
      record.scope.platforms[0] !== "linux"
    ) {
      problems.push("LIMITED_SCOPE_GO is bounded to the linux-only platform matrix");
    }
    if (record.scope.finance_mode !== "test_mode") {
      problems.push("LIMITED_SCOPE_GO requires test-mode finance (live money stays disabled)");
    }
    if (record.scope.untrusted_execution !== "disabled") {
      problems.push("LIMITED_SCOPE_GO requires untrusted execution disabled");
    }
    if (record.scope.isolation_mode !== "synthetic_provider_only") {
      problems.push("LIMITED_SCOPE_GO is bounded to the recorded synthetic-provider basis");
    }
    if (
      recomputation.machine_decision.decision === "NOT_GO" &&
      recomputation.machine_decision.reason !== "blocked_core_gate"
    ) {
      problems.push(
        `LIMITED_SCOPE_GO cannot excuse machine reason ${recomputation.machine_decision.reason} — only scope-excused BLOCKED gates`,
      );
    }
    for (const entry of nonGreenCore) {
      if (entry.verdict === "FAIL") {
        problems.push(`core gate ${entry.gate_id} FAILed — a FAIL is never scope-excusable`);
      } else if (!LIMITED_SCOPE_EXCUSABLE_GATES.has(entry.gate_id)) {
        problems.push(`core gate ${entry.gate_id} is not excusable under the limited scope`);
      } else if (
        !record.residual_risks.some(
          (risk) =>
            risk.disposition === "ACCEPTED_WITH_CONTROLS" &&
            risk.linked_gates.includes(entry.gate_id),
        )
      ) {
        problems.push(
          `scope-excused gate ${entry.gate_id} must be recorded as an owner-accepted residual risk`,
        );
      }
    }
    if (record.scope.identity_mode === "demo_auth") {
      const g2Gates = gateIdsInSection(recomputation, "G2-security-tenant-boundaries");
      if (
        !record.residual_risks.some(
          (risk) =>
            risk.disposition === "ACCEPTED_WITH_CONTROLS" &&
            risk.linked_gates.some((g) => g2Gates.has(g)),
        )
      ) {
        problems.push("demo-auth identity requires the recorded seam risk linked to G2");
      }
    }
  } else {
    for (const entry of nonGreenCore) {
      if (
        !record.residual_risks.some(
          (risk) => risk.disposition === "OPEN" && risk.linked_gates.includes(entry.gate_id),
        )
      ) {
        problems.push(
          `NOT_GO_HOLD blocker ${entry.gate_id} must be listed as an OPEN residual risk`,
        );
      }
    }
  }
  if (problems.length > 0) return invalid(problems);
  return { kind: "VALID", record };
}
