import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanonicalGateRows,
  coreReleaseDecision,
  renderGateReport,
  validateGateRegistry,
} from "../src/contract.js";

/**
 * AR2-015 — 分类门报告（docs/evidence/release/AR2-015-gate-report-2026-10-11.md
 * 的类型化来源）验收：
 * - 规范行集 VALID（9 段全覆盖；G0–G7 core；G8 extension）；
 * - 每行证据完整（class/command/environment/SHA/result/limitations/reviewer）；
 * - 核心决策 = NOT_GO（blocked_core_gate：OS 级 capsule 隔离、跨平台安装、
 *   可访问性 E2E 均为 BLOCKED —— 诚实分类）；
 * - G8 扩展行不参与核心决策（移除后决策不变）；
 * - 渲染报告包含决策、披露、全部段落与 owner 授权占位。
 */

const META = {
  head_sha: "b".repeat(40),
  base_sha: "d89182619a995710361883015e53e741eb9eedfa",
  environment: "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)",
};

test("canonical gate rows validate: 9 sections, core/extension scopes, complete evidence", () => {
  const rows = buildCanonicalGateRows(META);
  const registry = validateGateRegistry(rows);
  assert.equal(registry.kind, "VALID");
  if (registry.kind === "VALID") {
    assert.equal(registry.rows.length, 15);
    const sections = new Set(registry.rows.map((row) => row.section));
    assert.equal(sections.size, 9);
  }
  for (const row of rows) {
    assert.equal(row.evidence.sha, META.head_sha);
    assert.ok(row.evidence.command.length > 0);
    assert.ok(row.evidence.environment.length > 0);
    assert.ok(row.evidence.result.length > 0);
    assert.ok(row.evidence.reviewer.length > 0);
    if (row.section === "G8-capability-acquisition") {
      assert.equal(row.scope, "extension");
    } else {
      assert.equal(row.scope, "core");
    }
  }
});

test("core release decision is honestly NOT_GO (blocked_core_gate)", () => {
  const rows = buildCanonicalGateRows(META);
  const decision = coreReleaseDecision(rows);
  assert.equal(decision.decision, "NOT_GO");
  if (decision.decision === "NOT_GO") {
    assert.equal(decision.reason, "blocked_core_gate");
    // 三个 BLOCKED core 门：跨平台安装、OS 级 capsule 隔离、可访问性 E2E。
    assert.match(decision.detail, /grg_00000002/);
    assert.match(decision.detail, /grg_00000008/);
    assert.match(decision.detail, /grg_00000013/);
    // 记录的发现都是 medium —— 不经发现规则阻断，决策来自 BLOCKED 门本身。
    assert.equal(decision.blocking_findings, 0);
  }
});

test("the G8 extension row does not drive the core decision", () => {
  const rows = buildCanonicalGateRows(META);
  const g8Blocked = coreReleaseDecision(rows);
  // 翻转 G8 扩展行的分类（BLOCKED → PASS）不得改变核心决策 ——
  // （移除 G8 行会使注册表 INVALID：9 段必须全覆盖。）
  const g8Passing = coreReleaseDecision(
    rows.map((row) =>
      row.section === "G8-capability-acquisition"
        ? { ...row, classification: "PASS" as const }
        : row,
    ),
  );
  assert.equal(g8Blocked.decision, "NOT_GO");
  assert.equal(g8Passing.decision, "NOT_GO");
  if (g8Blocked.decision === "NOT_GO" && g8Passing.decision === "NOT_GO") {
    assert.equal(g8Blocked.reason, g8Passing.reason);
    assert.equal(g8Blocked.detail, g8Passing.detail);
    assert.equal(g8Blocked.rows_classified, g8Passing.rows_classified);
  }
});

test("rendered report carries the decision, disclosure, every section and the owner-authorization placeholder", () => {
  const rows = buildCanonicalGateRows(META);
  const report = renderGateReport(META, rows);
  assert.ok(report.includes("# AR2-015 — Classified release-gate report"));
  assert.ok(report.includes("**NOT_GO**"));
  assert.ok(report.includes("blocked_core_gate"));
  assert.ok(report.includes("separate extension gate"));
  assert.ok(report.includes("Release owner authorization"));
  assert.ok(report.includes("grg_00000001"));
  assert.ok(report.includes("grg_00000015"));
  for (const section of [
    "G0-fork-baseline",
    "G1-contracts-architecture",
    "G2-security-tenant-boundaries",
    "G3-durability-idempotency-resilience",
    "G4-proof-payments",
    "G5-expert-arena",
    "G6-product-end-to-end",
    "G7-observability-operations",
    "G8-capability-acquisition",
  ]) {
    assert.ok(report.includes(section), `report must classify ${section}`);
  }
  assert.ok(report.includes(META.head_sha));
  assert.ok(report.includes("green build is never a release decision"));
  // 对抗剖面四件套在报告中逐一列明。
  assert.ok(report.includes("Cross-tenant ID-guessing sweep"));
  assert.ok(report.includes("Webhook signature matrix"));
  assert.ok(report.includes("Prompt-injection as data"));
  assert.ok(report.includes("Capsule tenant-refusal matrix"));
});
