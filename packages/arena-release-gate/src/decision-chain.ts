import {
  validateDecisionRecord,
  type ReleaseDecisionRecord,
} from "./decision-record.js";

/**
 * AR2-023 — 修订链校验（issue #55：revocation/amendment —— amendment chain）。
 *
 * 冻结纪律：
 * - 链上每条记录先单独通过 validateDecisionRecord（fail-closed）；
 * - decision id 唯一；supersedes 只能指向链内存在的记录（孤儿引用无效）；
 * - 同一条记录只能被一条修订覆盖（分叉 = 歧义 ⇒ 无效）；
 * - 不允许环（A→B→A）也不允许自引用（记录级已拦，链级复查）；
 * - 修订日期不得早于被修订记录的日期（时间倒流 = 无效）。
 */

export type DecisionChainValidation =
  | { kind: "VALID"; records: readonly ReleaseDecisionRecord[] }
  | { kind: "INVALID"; issues: ReadonlyArray<{ rule: string }> };

function invalid(rules: readonly string[]): DecisionChainValidation {
  return { kind: "INVALID", issues: rules.map((rule) => ({ rule })) };
}

/** 修订链校验：输入一组决策记录候选，输出 VALID（有序记录集）或 INVALID（规则列表）。 */
export function validateDecisionChain(candidates: readonly unknown[]): DecisionChainValidation {
  const records: ReleaseDecisionRecord[] = [];
  const problems: string[] = [];
  for (const candidate of candidates) {
    const validation = validateDecisionRecord(candidate);
    if (validation.kind === "INVALID") {
      problems.push(
        ...validation.issues.map((issue) => `chain member invalid: ${issue.rule}`),
      );
      continue;
    }
    records.push(validation.record);
  }
  if (problems.length > 0) return invalid(problems);
  const byId = new Map<string, ReleaseDecisionRecord>();
  for (const record of records) {
    if (byId.has(record.decision_id)) {
      return invalid([`duplicate decision id ${record.decision_id} in the chain`]);
    }
    byId.set(record.decision_id, record);
  }
  const supersededCount = new Map<string, number>();
  for (const record of records) {
    if (record.supersedes === null) continue;
    const target = record.supersedes.decision_id;
    if (target === record.decision_id) {
      return invalid([`record ${record.decision_id} supersedes itself`]);
    }
    const targetRecord = byId.get(target);
    if (targetRecord === undefined) {
      return invalid([
        `record ${record.decision_id} supersedes ${target} which is not present in the chain`,
      ]);
    }
    if (Date.parse(record.decision_date) < Date.parse(targetRecord.decision_date)) {
      return invalid([
        `record ${record.decision_id} is dated before the decision it supersedes (${target})`,
      ]);
    }
    supersededCount.set(target, (supersededCount.get(target) ?? 0) + 1);
  }
  for (const [target, count] of supersededCount) {
    if (count > 1) {
      return invalid([
        `decision ${target} is superseded by ${count} records — the amendment chain must not fork`,
      ]);
    }
  }
  const VISITING = 1;
  const DONE = 2;
  const state = new Map<string, number>();
  const follow = (id: string): boolean => {
    state.set(id, VISITING);
    const record = byId.get(id);
    const next = record?.supersedes?.decision_id ?? null;
    if (next !== null) {
      if (state.get(next) === VISITING) return false;
      if (state.get(next) === undefined && !follow(next)) return false;
    }
    state.set(id, DONE);
    return true;
  };
  for (const record of records) {
    if (state.get(record.decision_id) === undefined && !follow(record.decision_id)) {
      return invalid([`amendment chain contains a cycle through ${record.decision_id}`]);
    }
  }
  return { kind: "VALID", records };
}
