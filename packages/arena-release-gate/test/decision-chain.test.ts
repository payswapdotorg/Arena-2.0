import assert from "node:assert/strict";
import test from "node:test";
import { validateDecisionChain, validateDecisionRecord } from "../src/contract.js";
import { limitedScopeRecord, notGoHoldRecord } from "./decision-fixtures.js";

/**
 * AR2-023 — 修订链验收（issue #55：revocation/amendment）：
 * - B 覆盖 A 的链通过（amendment：新决策 + supersedes 引用 + 理由）；
 * - 环（A→B→A）、自引用、孤儿引用、分叉（两条记录覆盖同一决策）、
 *   重复 decision id、日期倒流 ⇒ 全部 INVALID（fail-closed）；
 * - 链成员本身无效 ⇒ 链无效。
 */

function amendingRecord() {
  return {
    ...limitedScopeRecord(),
    decision_id: "rdr_00000010",
    decision_date: "2026-10-20T00:00:00Z",
    supersedes: {
      decision_id: "rdr_00000001",
      reason: "Re-recorded after AR2-021 accessibility evidence landed; scope boundaries unchanged",
    },
  };
}

test("an amendment chain validates: record B superseding record A", () => {
  const chain = validateDecisionChain([limitedScopeRecord(), amendingRecord()]);
  assert.equal(chain.kind, "VALID");
  if (chain.kind === "VALID") {
    assert.equal(chain.records.length, 2);
    assert.equal(chain.records[1]!.supersedes?.decision_id, "rdr_00000001");
  }
  // 单条记录（无修订）也是合法链。
  assert.equal(validateDecisionChain([notGoHoldRecord()]).kind, "VALID");
});

test("a chain member that is not a valid decision record makes the chain invalid", () => {
  const chain = validateDecisionChain([notGoHoldRecord(), { nonsense: true }]);
  assert.equal(chain.kind, "INVALID");
  if (chain.kind === "INVALID") {
    assert.ok(chain.issues.some((issue) => issue.rule.includes("chain member invalid")));
  }
});

test("amendment cycles fail closed", () => {
  const a = {
    ...limitedScopeRecord(),
    decision_date: "2026-10-20T00:00:00Z",
    supersedes: { decision_id: "rdr_00000010", reason: "cycle fixture" },
  };
  const b = amendingRecord();
  const chain = validateDecisionChain([a, b]);
  assert.equal(chain.kind, "INVALID");
  if (chain.kind === "INVALID") {
    assert.ok(chain.issues.some((issue) => issue.rule.includes("cycle")));
  }
});

test("an orphan supersedes reference fails closed", () => {
  const orphan = {
    ...amendingRecord(),
    supersedes: { decision_id: "rdr_99999999", reason: "references a record outside the chain" },
  };
  const chain = validateDecisionChain([orphan]);
  assert.equal(chain.kind, "INVALID");
  if (chain.kind === "INVALID") {
    assert.ok(chain.issues.some((issue) => issue.rule.includes("not present in the chain")));
  }
});

test("a forked amendment chain (two records superseding the same decision) fails closed", () => {
  const fork = {
    ...amendingRecord(),
    decision_id: "rdr_00000011",
    supersedes: { decision_id: "rdr_00000001", reason: "competing amendment" },
  };
  const chain = validateDecisionChain([limitedScopeRecord(), amendingRecord(), fork]);
  assert.equal(chain.kind, "INVALID");
  if (chain.kind === "INVALID") {
    assert.ok(chain.issues.some((issue) => issue.rule.includes("must not fork")));
  }
});

test("duplicate decision ids and date-regressing amendments fail closed", () => {
  const duplicate = validateDecisionChain([notGoHoldRecord(), notGoHoldRecord()]);
  assert.equal(duplicate.kind, "INVALID");
  if (duplicate.kind === "INVALID") {
    assert.ok(duplicate.issues.some((issue) => issue.rule.includes("duplicate decision id")));
  }
  const timeTravel = {
    ...amendingRecord(),
    decision_date: "2026-10-01T00:00:00Z", // 早于被修订的 rdr_00000001（2026-10-14）
  };
  const chain = validateDecisionChain([limitedScopeRecord(), timeTravel]);
  assert.equal(chain.kind, "INVALID");
  if (chain.kind === "INVALID") {
    assert.ok(chain.issues.some((issue) => issue.rule.includes("dated before")));
  }
});

test("revocation is an amendment: a NOT_GO_HOLD superseding a GO records the revocation", () => {
  const revocation = {
    ...notGoHoldRecord(),
    decision_id: "rdr_00000020",
    decision_date: "2026-10-21T00:00:00Z",
    supersedes: {
      decision_id: "rdr_00000010",
      reason: "Revocation: new blocker evidence recorded; release withdrawn pending re-evaluation",
    },
  };
  // 三段链：limited GO → 修订 → 撤销（回到 hold）。
  const chain = validateDecisionChain([limitedScopeRecord(), amendingRecord(), revocation]);
  assert.equal(chain.kind, "VALID");
  if (chain.kind === "VALID") {
    assert.equal(chain.records.length, 3);
    // 链上每条记录单独校验也通过。
    for (const record of chain.records) {
      assert.equal(validateDecisionRecord(record).kind, "VALID");
    }
  }
});
