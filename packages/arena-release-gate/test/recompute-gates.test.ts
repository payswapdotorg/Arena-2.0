import assert from "node:assert/strict";
import test from "node:test";
import {
  recomputeGates,
  validateGateRegistry,
  canonicalJson,
  type GateEvidenceSubmission,
} from "../src/contract.js";
import {
  ar2015Rows,
  ar2015EvidenceSet,
  allGreenEvidenceSet,
} from "./decision-fixtures.js";

/**
 * AR2-023 — 门重算验收（issue #55）：
 * - 确定性：同一证据集两次重算，结果逐字节一致（纯函数，无网络/时钟/随机）；
 * - 非回归：AR2-015 门报告的证据集重算 ⇒ 复现记录在案的判定
 *   （15 行分类逐一一致；机器决策 NOT_GO / blocked_core_gate；
 *   三个阻断门 grg_00000002/08/13；0 个未决 critical/high）；
 * - fail-closed：缺提交 ⇒ BLOCKED（绝不默认通过）；悬空依据/重复提交/
 *   未知门/无授权 WAIVED/坏注册表 ⇒ INVALID。
 */

test("recomputation is deterministic: the same evidence set yields the identical result twice", () => {
  const first = recomputeGates({ registry_rows: ar2015Rows(), evidence_set: ar2015EvidenceSet() });
  const second = recomputeGates({ registry_rows: ar2015Rows(), evidence_set: ar2015EvidenceSet() });
  assert.equal(first.kind, "VALID");
  assert.equal(second.kind, "VALID");
  assert.equal(canonicalJson(first), canonicalJson(second));
});

test("the AR2-015 gate-report evidence set recomputes to its recorded verdicts (non-regression)", () => {
  const rows = ar2015Rows();
  const outcome = recomputeGates({ registry_rows: rows, evidence_set: ar2015EvidenceSet() });
  assert.equal(outcome.kind, "VALID");
  if (outcome.kind !== "VALID") return;
  const result = outcome.result;
  assert.equal(result.schema_version, "RGR1.0");
  assert.equal(result.entries.length, 15);
  // 逐门复现记录在案的分类（顺序与规范注册表一致）。
  for (let index = 0; index < rows.length; index += 1) {
    const canonical = rows[index]!;
    const recomputed = result.entries[index]!;
    assert.equal(recomputed.gate_id, canonical.gate_id);
    assert.equal(recomputed.verdict, canonical.classification);
    assert.equal(recomputed.section, canonical.section);
    assert.equal(recomputed.scope, canonical.scope);
    assert.deepEqual(recomputed.findings, canonical.findings);
    assert.ok(recomputed.basis.length >= 1);
    assert.equal(recomputed.basis[0]!.link, "docs/evidence/release/AR2-015-gate-report-2026-10-11.md");
    assert.equal(recomputed.basis[0]!.sha, "df621a6a176f186be49a110cbe9c09a44b8b078a");
  }
  // 机器决策复现记录在案的 NOT_GO（blocked_core_gate；三个阻断门；0 critical/high）。
  const decision = result.machine_decision;
  assert.equal(decision.decision, "NOT_GO");
  if (decision.decision === "NOT_GO") {
    assert.equal(decision.reason, "blocked_core_gate");
    assert.equal(decision.blocking_findings, 0);
    assert.equal(decision.sections_covered, 9);
    assert.equal(decision.rows_classified, 15);
    assert.match(decision.detail, /grg_00000002/);
    assert.match(decision.detail, /grg_00000008/);
    assert.match(decision.detail, /grg_00000013/);
  }
  // 重算后的行集仍通过 AR2-015 注册表机器（9 段全覆盖）。
  assert.equal(validateGateRegistry(result.entries.map((entry) => entry.recomputed_row)).kind, "VALID");
});

test("a gate with no evidence submission recomputes BLOCKED — missing evidence is never an assumed PASS", () => {
  const full = ar2015EvidenceSet();
  const pruned = {
    ...full,
    submissions: full.submissions.filter(
      (submission: GateEvidenceSubmission) => submission.gate_id !== "grg_00000001",
    ),
  };
  const outcome = recomputeGates({ registry_rows: ar2015Rows(), evidence_set: pruned });
  assert.equal(outcome.kind, "VALID");
  if (outcome.kind !== "VALID") return;
  const entry = outcome.result.entries.find((item) => item.gate_id === "grg_00000001");
  assert.ok(entry !== undefined);
  assert.equal(entry.verdict, "BLOCKED");
  assert.equal(entry.basis.length, 0);
  assert.ok(entry.gaps.some((gap) => gap.includes("missing evidence is BLOCKED")));
  assert.equal(entry.recomputed_row.classification, "BLOCKED");
});

test("a submission referencing an evidence entry absent from the manifest is INVALID (fail-closed)", () => {
  const dangling = {
    ...ar2015EvidenceSet(),
    submissions: ar2015EvidenceSet().submissions.map((submission: GateEvidenceSubmission) => ({
      ...submission,
      basis_entry_ids: ["evd_99999999"],
    })),
  };
  const outcome = recomputeGates({ registry_rows: ar2015Rows(), evidence_set: dangling });
  assert.equal(outcome.kind, "INVALID");
  if (outcome.kind === "INVALID") {
    assert.ok(outcome.issues.some((issue) => issue.rule.includes("not present in the manifest")));
  }
});

test("duplicate submissions for the same gate are INVALID", () => {
  const set = ar2015EvidenceSet();
  const duplicated = { ...set, submissions: [...set.submissions, set.submissions[0]!] };
  const outcome = recomputeGates({ registry_rows: ar2015Rows(), evidence_set: duplicated });
  assert.equal(outcome.kind, "INVALID");
  if (outcome.kind === "INVALID") {
    assert.ok(outcome.issues.some((issue) => issue.rule.includes("duplicate evidence submission")));
  }
});

test("a submission for a gate not in the registry is INVALID", () => {
  const set = ar2015EvidenceSet();
  const unknown = {
    ...set,
    submissions: [
      ...set.submissions,
      { ...set.submissions[0]!, gate_id: "grg_99999999" },
    ],
  };
  const outcome = recomputeGates({ registry_rows: ar2015Rows(), evidence_set: unknown });
  assert.equal(outcome.kind, "INVALID");
  if (outcome.kind === "INVALID") {
    assert.ok(outcome.issues.some((issue) => issue.rule.includes("not in the registry")));
  }
});

test("a WAIVED submission without recorded owner authorization is INVALID (machinery re-enforced)", () => {
  const set = ar2015EvidenceSet();
  const waived = {
    ...set,
    submissions: set.submissions.map((submission: GateEvidenceSubmission) =>
      submission.gate_id === "grg_00000001"
        ? { ...submission, classification: "WAIVED", waiver_authorization: null }
        : submission,
    ),
  };
  const outcome = recomputeGates({ registry_rows: ar2015Rows(), evidence_set: waived });
  assert.equal(outcome.kind, "INVALID");
  if (outcome.kind === "INVALID") {
    assert.ok(outcome.issues.some((issue) => issue.rule.includes("owner authorization")));
  }
});

test("an invalid registry (missing section) propagates INVALID before any evidence is read", () => {
  const rows = ar2015Rows().filter((row) => row.section !== "G8-capability-acquisition");
  const outcome = recomputeGates({ registry_rows: rows, evidence_set: ar2015EvidenceSet() });
  assert.equal(outcome.kind, "INVALID");
  if (outcome.kind === "INVALID") {
    assert.ok(outcome.issues.some((issue) => issue.gate_id.includes("G8")));
  }
});

test("an all-green evidence set recomputes to a machine GO", () => {
  const outcome = recomputeGates({ registry_rows: ar2015Rows(), evidence_set: allGreenEvidenceSet() });
  assert.equal(outcome.kind, "VALID");
  if (outcome.kind !== "VALID") return;
  assert.equal(outcome.result.machine_decision.decision, "GO");
  assert.ok(outcome.result.entries.every((entry) => entry.verdict === "PASS"));
  assert.ok(outcome.result.entries.every((entry) => entry.gaps.length === 0));
});
