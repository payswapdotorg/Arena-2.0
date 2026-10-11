import assert from "node:assert/strict";
import test from "node:test";
import {
  GAP_REPORT_IS_NOT_CLOSURE_PROOF_RULE,
  GAP_REPORT_NO_CHAIN_OF_THOUGHT_RULE,
  canonicalJsonStringify,
  checkCapabilityGapReport,
  computeGapReportDigest,
  validateCapabilityGapReportSemantics,
} from "../src/contract.js";
import { gapReport } from "./fixtures.js";

/**
 * AR2-016 验收（issue #32）：CapabilityGapReport 契约向量 ——
 * 正/负向量、未知字段拒绝、缺最小复现用例拒绝（typed code）、
 * 无私有思维链字段、语义负例、digest 稳定性。
 */

test("gap report: valid vector parses through the trust-boundary check", () => {
  const check = checkCapabilityGapReport(gapReport());
  assert.equal(check.ok, true);
});

test("gap report: ACQ1.0 schema version is pinned (version gate first)", () => {
  for (const bad of ["CF1.0", "ES2.0", "ACQ0.9", "ACQ2.0", ""]) {
    const check = checkCapabilityGapReport({ ...gapReport(), schema_version: bad });
    assert.equal(check.ok, false);
    if (!check.ok) assert.equal(check.code, "ACQ_SCHEMA_VERSION_UNSUPPORTED");
  }
});

test("gap report: unknown fields are rejected with the typed unknown-field code", () => {
  const check = checkCapabilityGapReport({ ...gapReport(), tenant_id: "tnt_99999999" });
  assert.equal(check.ok, false);
  if (!check.ok) assert.equal(check.code, "ACQ_UNKNOWN_FIELD");

  const nested = checkCapabilityGapReport({
    ...gapReport(),
    observed_task: { ...gapReport().observed_task, smuggled_note: "extra" },
  });
  assert.equal(nested.ok, false); // nested strict envelopes reject unknown keys too
  if (!nested.ok) assert.equal(nested.code, "ACQ_UNKNOWN_FIELD");
});

test("gap report: a missing or empty repro-case list is rejected (ACQ_REPRO_CASE_MISSING)", () => {
  const missing = { ...gapReport() };
  delete (missing as Partial<typeof missing>).repro_cases;
  const missingCheck = checkCapabilityGapReport(missing);
  assert.equal(missingCheck.ok, false);
  if (!missingCheck.ok) assert.equal(missingCheck.code, "ACQ_REPRO_CASE_MISSING");

  const empty = checkCapabilityGapReport({ ...gapReport(), repro_cases: [] });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.code, "ACQ_REPRO_CASE_MISSING");
});

test("gap report: chain-of-thought smuggling is an unknown field, never a payload", () => {
  const smuggle = checkCapabilityGapReport({
    ...gapReport(),
    private_chain_of_thought: "step 1: consider ...",
  });
  assert.equal(smuggle.ok, false);
  if (!smuggle.ok) assert.equal(smuggle.code, "ACQ_UNKNOWN_FIELD");
  assert.ok(GAP_REPORT_NO_CHAIN_OF_THOUGHT_RULE.length > 0);
  assert.ok(GAP_REPORT_IS_NOT_CLOSURE_PROOF_RULE.length > 0);
});

test("gap report: strict shape negatives (typed generic validation code)", () => {
  const badLevel = checkCapabilityGapReport({
    ...gapReport(),
    capability_statement: { capability_id: "cap_00000001", minimum_level: "" },
  });
  assert.equal(badLevel.ok, false);
  if (!badLevel.ok) assert.equal(badLevel.code, "ACQ_VALIDATION_FAILED");

  const badCase = checkCapabilityGapReport({
    ...gapReport(),
    repro_cases: [{ ...gapReport().repro_cases[0]!, case_id: "short" }],
  });
  assert.equal(badCase.ok, false);
});

test("gap report: semantic negatives are structural-pass + semantic-fail", () => {
  const pastDeadline = gapReport({
    constraint_boundaries: {
      deadline: "1969-01-01T00:00:00Z",
      budget_ceiling: null,
      currency: null,
    },
  });
  const parsed = checkCapabilityGapReport(pastDeadline);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    const issues = validateCapabilityGapReportSemantics(parsed.report);
    assert.ok(issues.some((issue) => issue.field === "constraint_boundaries.deadline"));
  }

  const halfCurrency = gapReport({
    constraint_boundaries: { deadline: null, budget_ceiling: 500, currency: null },
  });
  const parsedBudget = checkCapabilityGapReport(halfCurrency);
  assert.equal(parsedBudget.ok, true);
  if (parsedBudget.ok) {
    const issues = validateCapabilityGapReportSemantics(parsedBudget.report);
    assert.ok(issues.some((issue) => issue.field === "constraint_boundaries.budget_ceiling"));
  }
});

test("gap report: repro case IDs must be unique (semantic)", () => {
  const duplicate = gapReport({
    repro_cases: [gapReport().repro_cases[0]!, { ...gapReport().repro_cases[0]! }],
  });
  const issues = validateCapabilityGapReportSemantics(duplicate);
  assert.ok(issues.some((issue) => issue.field === "repro_cases.case_id"));
});

test("gap report: canonical digest is key-order independent and content-sensitive", () => {
  const base = gapReport();
  const shuffled: Record<string, unknown> = {};
  for (const key of Object.keys(base).sort().reverse()) {
    shuffled[key] = (base as unknown as Record<string, unknown>)[key];
  }
  assert.equal(computeGapReportDigest(base), computeGapReportDigest(shuffled));

  const changed = gapReport({
    repro_cases: [
      { ...base.repro_cases[0]!, observed_output: "The agent cites Blender 5.x nodes." },
    ],
  });
  assert.notEqual(computeGapReportDigest(base), computeGapReportDigest(changed));
  assert.match(computeGapReportDigest(base), /^[a-f0-9]{64}$/);
});

test("gap report: canonical JSON is byte-stable for the same content", () => {
  const base = gapReport();
  const reordered: Record<string, unknown> = {};
  for (const key of ["expected_behavior", "domain", "schema_version"]) {
    reordered[key] = (base as unknown as Record<string, unknown>)[key];
  }
  assert.equal(
    canonicalJsonStringify({ a: 1, b: [2, 3] }),
    canonicalJsonStringify({ b: [2, 3], a: 1 }),
  );
  assert.equal(typeof reordered.schema_version, "string");
});
