import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateDecisionRecord,
  canonicalJson,
  recomputeGates,
  type ReleaseDecisionRecord,
} from "../src/contract.js";
import { ar2015Rows, ar2015EvidenceSet } from "./decision-fixtures.js";

/**
 * AR2-023 — 模板示例验收（issue #55）：文档里的 JSON 块必须
 * (1) 解析为合法的 TEMPLATE_UNSIGNED 记录（未签署 —— 但结构完全一致）；
 * (2) 附着的门重算与「AR2-015 规范行 + 记录在案证据集」的全新重算逐字节一致
 *     （模板即常备仪器 —— 文档不得与机器输出漂移）；
 * (3) 水印声明在文档中显著存在（TEMPLATE — NOT A DECISION）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC = resolve(
  join(HERE, "../../../docs/evidence/release/decision-record-template-limited-scope.md"),
);

function extractJsonBlock(markdown: string): string {
  const match = markdown.match(/```json\r?\n([\s\S]*?)\r?\n```/);
  assert.ok(match !== undefined && match[1] !== undefined, "template doc must contain a ```json block");
  return match[1];
}

test("the template example parses as a valid unsigned (TEMPLATE_UNSIGNED) record", () => {
  const markdown = readFileSync(DOC, "utf8");
  const parsed: unknown = JSON.parse(extractJsonBlock(markdown));
  const validation = validateDecisionRecord(parsed);
  assert.equal(validation.kind, "VALID");
  if (validation.kind === "VALID") {
    const record: ReleaseDecisionRecord = validation.record;
    assert.equal(record.status, "TEMPLATE_UNSIGNED");
    assert.equal(record.decision_class, "LIMITED_SCOPE_GO");
    assert.equal(record.decision_id, "rdr_00000000");
    assert.deepEqual(record.scope.platforms, ["linux"]);
    assert.equal(record.scope.finance_mode, "test_mode");
    assert.equal(record.scope.untrusted_execution, "disabled");
    assert.equal(record.signer.github_identity, "TEMPLATE-PLACEHOLDER");
  }
});

test("the attached recomputation is byte-identical to a fresh recomputation over the AR2-015 recorded basis", () => {
  const markdown = readFileSync(DOC, "utf8");
  const parsed = JSON.parse(extractJsonBlock(markdown)) as { gate_recomputation: unknown };
  const fresh = recomputeGates({
    registry_rows: ar2015Rows(),
    evidence_set: ar2015EvidenceSet(),
  });
  assert.equal(fresh.kind, "VALID");
  if (fresh.kind === "VALID") {
    assert.equal(canonicalJson(parsed.gate_recomputation), canonicalJson(fresh.result));
  }
});

test("the template doc is prominently watermarked as NOT A DECISION and links the workflow", () => {
  const markdown = readFileSync(DOC, "utf8");
  assert.match(markdown, /TEMPLATE — NOT A DECISION/);
  assert.match(markdown, /status: "RECORDED"/);
  assert.match(markdown, /AR2-023-authorization-workflow-2026-10-14\.md/);
  // 模板的签署块携带占位符 —— 文档必须显式声明这一点。
  assert.match(markdown, /TEMPLATE PLACEHOLDER/);
});
