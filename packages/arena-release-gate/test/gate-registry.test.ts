import assert from "node:assert/strict";
import test from "node:test";
import { validateGateRegistry, decideRelease } from "../src/contract.js";
import type { GateRow, GateSection } from "../src/contract.js";

/**
 * AR2-015 — 门注册表语义（issue #17 验收）：
 * 四态显式分类 + core/extension 范围；空段不允许；WAIVED 无授权 → 无效；
 * 未解决 critical/high ⇒ NOT_GO；core 行 FAIL/BLOCKED ⇒ NOT_GO；G8 扩展行
 * 不阻断核心发布；owner 接受的发现不阻断；构建通过绝不是 GO（决策是显式的）。
 */

function row(overrides: Partial<GateRow> & { gate_id: string; section: GateSection }): GateRow {
  return {
    scope: "core",
    requirement: "sample requirement text",
    classification: "PASS",
    evidence: {
      evidence_class: "automated_unit_suite",
      command: "pnpm --filter @arena/contracts test",
      environment: "CI battery (ubuntu-latest, Node 24)",
      sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      result: "104/104 green",
      limitations: "unit scope only",
      reviewer: "arena-tl",
    },
    waiver_authorization: null,
    findings: [],
    ...overrides,
  };
}

function allSections(): GateRow[] {
  const sections: GateSection[] = [
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
  return sections.map((section, index) =>
    row({
      gate_id: `gat_0000000${index + 1}`,
      section,
      scope: section === "G8-capability-acquisition" ? "extension" : "core",
    }),
  );
}

test("a fully classified registry with no blocking findings decides GO", () => {
  const decision = decideRelease({ rows: allSections() });
  assert.equal(decision.decision, "GO");
  if (decision.decision === "GO") {
    assert.equal(decision.sections_covered, 9);
    assert.equal(decision.rows_classified, 9);
    assert.equal(decision.blocking_findings, 0);
  }
});

test("unresolved critical/high findings force NOT_GO — a green build is never GO", () => {
  const rows = allSections();
  const securityRow = rows.find((r) => r.section === "G2-security-tenant-boundaries");
  assert.ok(securityRow !== undefined);
  securityRow.findings.push({
    finding_id: "fnd_00000001",
    severity: "critical",
    description: "tenant boundary bypass under a crafted token",
    resolution: "unresolved",
    owner_acceptance: null,
  });
  const decision = decideRelease({ rows });
  assert.equal(decision.decision, "NOT_GO");
  if (decision.decision === "NOT_GO") {
    assert.equal(decision.reason, "unresolved_critical_or_high");
    assert.equal(decision.blocking_findings, 1);
    assert.match(decision.detail, /tenant boundary bypass/);
  }

  // high 同样阻断；medium 不阻断。
  const highRows = allSections();
  highRows[0]?.findings.push({
    finding_id: "fnd_00000002",
    severity: "high",
    description: "flaky resilience test",
    resolution: "unresolved",
    owner_acceptance: null,
  });
  assert.equal(decideRelease({ rows: highRows }).decision, "NOT_GO");
  const mediumRows = allSections();
  mediumRows[0]?.findings.push({
    finding_id: "fnd_00000003",
    severity: "medium",
    description: "log line wording",
    resolution: "unresolved",
    owner_acceptance: null,
  });
  assert.equal(decideRelease({ rows: mediumRows }).decision, "GO");
});

test("a FAIL core gate forces NOT_GO (failed_core_gate)", () => {
  const rows = allSections();
  const securityRow = rows.find((r) => r.section === "G2-security-tenant-boundaries");
  assert.ok(securityRow !== undefined);
  securityRow.classification = "FAIL";
  const decision = decideRelease({ rows });
  assert.equal(decision.decision, "NOT_GO");
  if (decision.decision === "NOT_GO") {
    assert.equal(decision.reason, "failed_core_gate");
    assert.match(decision.detail, /G2-security-tenant-boundaries/);
  }
});

test("a BLOCKED core gate forces NOT_GO (blocked_core_gate) — no evidence means no GO", () => {
  const rows = allSections();
  const securityRow = rows.find((r) => r.section === "G2-security-tenant-boundaries");
  assert.ok(securityRow !== undefined);
  securityRow.classification = "BLOCKED";
  const decision = decideRelease({ rows });
  assert.equal(decision.decision, "NOT_GO");
  if (decision.decision === "NOT_GO") {
    assert.equal(decision.reason, "blocked_core_gate");
    assert.match(decision.detail, /sample requirement text/);
  }
});

test("the G8 extension gate does NOT block the core release decision", () => {
  const rows = allSections();
  const extensionRow = rows.find((r) => r.section === "G8-capability-acquisition");
  assert.ok(extensionRow !== undefined);
  extensionRow.classification = "BLOCKED";
  extensionRow.findings.push({
    finding_id: "fnd_00000006",
    severity: "critical",
    description: "extension not implemented",
    resolution: "unresolved",
    owner_acceptance: null,
  });
  // 扩展行的 BLOCKED 与 critical 发现都不进入核心决策。
  const decision = decideRelease({ rows });
  assert.equal(decision.decision, "GO");
});

test("extension scope is only valid on G8 rows — core sections cannot be exempted", () => {
  const rows = allSections();
  const securityRow = rows.find((r) => r.section === "G2-security-tenant-boundaries");
  assert.ok(securityRow !== undefined);
  securityRow.scope = "extension";
  const registry = validateGateRegistry(rows);
  assert.equal(registry.kind, "INVALID");
  if (registry.kind === "INVALID") {
    assert.ok(registry.issues.some((issue) => issue.rule.includes("only valid on G8")));
  }
  const decision = decideRelease({ rows });
  assert.equal(decision.decision === "NOT_GO" && decision.reason, "invalid_rows");
});

test("owner-accepted findings do not block when the acceptance is recorded", () => {
  const rows = allSections();
  rows[0]?.findings.push({
    finding_id: "fnd_00000004",
    severity: "critical",
    description: "accepted risk with compensating control",
    resolution: "owner_accepted",
    owner_acceptance: {
      accepted_by: "arena-owner",
      accepted_at: "2026-10-11T16:00:00Z",
      rationale: "compensating control active; fix scheduled next release",
    },
  });
  const decision = decideRelease({ rows });
  assert.equal(decision.decision, "GO");
});

test("a WAIVED core gate with recorded owner authorization does not block GO", () => {
  const rows = allSections();
  const waivedRow = rows.find((r) => r.section === "G6-product-end-to-end");
  assert.ok(waivedRow !== undefined);
  waivedRow.classification = "WAIVED";
  waivedRow.waiver_authorization = {
    authorized_by: "arena-owner",
    authorized_at: "2026-10-11T16:00:00Z",
    rationale: "flow covered by compensating manual procedure this release",
  };
  const decision = decideRelease({ rows });
  assert.equal(decision.decision, "GO");
});

test("owner acceptance claims without a record are invalid rows", () => {
  const rows = allSections();
  rows[0]?.findings.push({
    finding_id: "fnd_00000005",
    severity: "high",
    description: "claims acceptance with no record",
    resolution: "owner_accepted",
    owner_acceptance: null,
  });
  const registry = validateGateRegistry(rows);
  assert.equal(registry.kind, "INVALID");
  if (registry.kind === "INVALID") {
    assert.ok(registry.issues.some((issue) => issue.rule.includes("without a record")));
  }
  const decision = decideRelease({ rows });
  assert.equal(decision.decision, "NOT_GO");
  if (decision.decision === "NOT_GO") assert.equal(decision.reason, "invalid_rows");
});

test("WAIVED without owner authorization is invalid; authorization on non-WAIVED rows is invalid", () => {
  const noAuth = allSections();
  const waivedRow = noAuth.find((r) => r.section === "G6-product-end-to-end");
  assert.ok(waivedRow !== undefined);
  waivedRow.classification = "WAIVED";
  const invalidWaiver = validateGateRegistry(noAuth);
  assert.equal(invalidWaiver.kind, "INVALID");
  if (invalidWaiver.kind === "INVALID") {
    assert.ok(invalidWaiver.issues.some((issue) => issue.rule.includes("owner authorization")));
  }

  const strayAuth = allSections();
  const passRow = strayAuth.find((r) => r.section === "G1-contracts-architecture");
  assert.ok(passRow !== undefined);
  passRow.waiver_authorization = {
    authorized_by: "arena-owner",
    authorized_at: "2026-10-11T16:00:00Z",
    rationale: "stray authorization on a PASS row",
  };
  const invalidStray = validateGateRegistry(strayAuth);
  assert.equal(
    invalidStray.kind === "INVALID" &&
      invalidStray.issues.some((i) => i.rule.includes("only valid on WAIVED")),
    true,
  );
});

test("missing gate sections are invalid (no blank or assumed-pass rows)", () => {
  const rows = allSections().filter((r) => r.section !== "G8-capability-acquisition");
  const registry = validateGateRegistry(rows);
  assert.equal(registry.kind, "INVALID");
  if (registry.kind === "INVALID") {
    assert.ok(registry.issues.some((issue) => issue.gate_id.includes("G8")));
  }
  const decision = decideRelease({ rows });
  assert.equal(decision.decision === "NOT_GO" && decision.reason, "invalid_rows");
});

test("duplicate gate ids and unparseable rows are invalid", () => {
  const rows = allSections();
  const duplicate = { ...rows[0]! };
  const registry = validateGateRegistry([...rows, duplicate]);
  assert.equal(
    registry.kind === "INVALID" && registry.issues.some((i) => i.rule === "duplicate gate id"),
    true,
  );
  const decision = decideRelease({ rows: [...rows, { nonsense: true }] });
  assert.equal(decision.decision === "NOT_GO" && decision.reason, "invalid_rows");
});
