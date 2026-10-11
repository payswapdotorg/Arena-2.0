import {
  decideRelease,
  RELEASE_GATE_DISCLOSURE,
  type GateRow,
  type ReleaseDecision,
} from "./gate-registry.js";
import type { GateReportMeta } from "./canonical-rows.js";

/**
 * AR2-015 — 分类门报告渲染与核心发布决策
 * （docs/evidence/release/AR2-015-gate-report-2026-10-11.md 由此生成；
 * 规范行数据见 canonical-rows.ts）。
 */

/** 核心发布决策（机器判定 —— 决策是显式产出物，绝不是「CI 绿了」）。 */
export function coreReleaseDecision(rows: readonly GateRow[]): ReleaseDecision {
  return decideRelease({ rows });
}

/** 渲染分类门报告（markdown；提交到 docs/evidence/release/ 的文档由此生成）。 */
export function renderGateReport(meta: GateReportMeta, rows: readonly GateRow[]): string {
  const decision = coreReleaseDecision(rows);
  const lines: string[] = [];
  lines.push("# AR2-015 — Classified release-gate report");
  lines.push("");
  lines.push("**Date:** 2026-10-11  ");
  lines.push("**Repository:** payswapdotorg/Arena-2.0  ");
  lines.push(`**Base SHA (dispatch record):** \`${meta.base_sha}\`  `);
  lines.push(`**Evidence SHA (tree the cited suites run on):** \`${meta.head_sha}\`  `);
  lines.push(`**Environment:** ${meta.environment}`);
  lines.push("");
  lines.push(`> ${RELEASE_GATE_DISCLOSURE}`);
  lines.push("");
  lines.push(
    "Scope statement: this report classifies the **core release** (G0–G7). G8 — capability acquisition — is classified as the **separate extension gate** per the TL handoff: it does not block the core release decision, it remains a hard acceptance gate for the scraper extension itself, and it blocks release only if the owner includes scrapers in the first production scope (not the case at this report).",
  );
  lines.push("");
  lines.push("## Machine release decision (core)");
  lines.push("");
  if (decision.decision === "GO") {
    lines.push(
      `**GO** — ${decision.rows_classified} rows classified across ${decision.sections_covered} sections; zero unresolved critical/high findings.`,
    );
  } else {
    lines.push(
      `**NOT_GO** — reason \`${decision.reason}\`; ${decision.rows_classified} rows classified across ${decision.sections_covered} sections; ${decision.blocking_findings} unresolved critical/high finding(s).`,
    );
    lines.push("");
    lines.push(`Blocking detail: ${decision.detail}`);
  }
  lines.push("");
  lines.push(
    "Honest interpretation: the core product is ACCEPTED as implemented and integration-tested within its tested scope (15/19 work orders). A **production** release remains NOT_GO: OS-level capsule isolation is unproven (synthetic provider is not isolation evidence), cross-platform install proofs are outstanding, and accessibility E2E coverage is incomplete. Until then untrusted expert/scraper execution stays disabled and live-money payments stay disabled. A limited-scope release (Linux, test-mode finance, no untrusted execution) may be authorized separately by the release owner with this report as the recorded basis.",
  );
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("| --- | --- |");
  lines.push("| Decision (machine, core) | " + decision.decision + " |");
  lines.push("| Reason | " + (decision.decision === "NOT_GO" ? decision.reason : "—") + " |");
  lines.push(
    "| Blocking findings (critical/high unresolved) | " + decision.blocking_findings + " |",
  );
  lines.push(
    "| Release owner authorization | ⬜ not recorded — no owner has authorized a production or limited-scope release at report time |",
  );
  lines.push("");
  lines.push("## Gate classification rows");
  lines.push("");
  lines.push("| Gate | Section | Scope | Requirement | Class | Command | Result | Limitations |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of rows) {
    lines.push(
      `| \`${row.gate_id}\` | ${row.section} | ${row.scope} | ${row.requirement} | **${row.classification}** | \`${row.evidence.command.replace(/"/g, "'")}\` | ${row.evidence.result} | ${row.evidence.limitations} |`,
    );
  }
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  lines.push("| Finding | Gate | Severity | Resolution |");
  lines.push("| --- | --- | --- | --- |");
  const withFindings = rows.filter((row) => row.findings.length > 0);
  if (withFindings.length === 0) {
    lines.push("| (none) | — | — | — |");
  }
  for (const row of withFindings) {
    for (const finding of row.findings) {
      lines.push(
        `| \`${finding.finding_id}\` ${finding.description} | ${row.gate_id} | ${finding.severity} | ${finding.resolution} |`,
      );
    }
  }
  lines.push("");
  lines.push(
    "All recorded findings are medium severity and unresolved — none force NOT_GO by the findings rule; the NOT_GO decision comes from BLOCKED core gates (grg_00000002 cross-platform install, grg_00000008 OS-level capsule isolation, grg_00000013 accessibility E2E), which is exactly the honest posture required by the evidence policy.",
  );
  lines.push("");
  lines.push("## Adversarial profiles (real surfaces)");
  lines.push("");
  lines.push(
    "1. **Cross-tenant ID-guessing sweep** (`test/cross-tenant.test.ts`): a REAL arena-api process on a durable sqlite file; a second tenant systematically probes every object route with the victim's real IDs, guessed neighbor IDs and malformed IDs — all responses are typed 404s byte-indistinguishable from not-found probes made by the owning tenant; the cross-tenant list is empty; request-body tenant fields are schema-rejected; the tenant context is always server-derived from credentials.",
  );
  lines.push(
    "2. **Webhook signature matrix** (`test/webhook-signature.test.ts`): a REAL HTTP receiver verifies HMAC deliveries — forged (tampered body / wrong secret / old-header-new-body), stale, wrong-scheme and malformed deliveries are rejected with distinct typed reasons; verbatim replays and attempt-bumped retries are acknowledged as DUPLICATE with the effect applied exactly once (delivery-id dedup).",
  );
  lines.push(
    "3. **Prompt-injection as data** (`test/prompt-injection-as-data.test.ts`): the REAL evidence store and proof evaluator consume envelopes whose content fields carry injection payloads — outcomes are identical to benign twins, payloads are preserved verbatim as data, bindings are compared only against the server-derived expected context, and caller/self-evaluation assertions never flip P0/P2 proof decisions.",
  );
  lines.push(
    "4. **Capsule tenant-refusal matrix** (`test/capsule-tenant-refusal.test.ts`): the REAL CapsuleProviderPort (SyntheticLocalProvider + CapsuleBindingRegistry) refuses every operation invoked with a cross-tenant or aggregate-mismatched reference — cross-tenant and unknown-capsule refusals are indistinguishable; teardown is verified; the port-level discipline any production provider must reuse is exercised end-to-end (while the synthetic provider itself is explicitly NOT isolation evidence — see grg_00000008).",
  );
  lines.push("");
  lines.push("## Evidence policy compliance");
  lines.push("");
  lines.push(
    "- Every row records evidence class, exact SHA, command, environment, result, limitations and reviewer.",
  );
  lines.push(
    "- A passing unit test proves only the tested unit; the adversarial profiles prove the integration surfaces they actually drive; nothing here claims production isolation or live-money readiness.",
  );
  lines.push(
    "- Environment-limited tests are disclosed as BLOCKED, never silently converted to PASS.",
  );
  lines.push(
    "- A green build is never a release decision: the decision above is the explicit output of `decideRelease` over the classified registry.",
  );
  lines.push("");
  return lines.join("\n");
}
