import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_MACHINES,
  checkCompleteness,
  reachableStates,
  transitionCommandSchema,
} from "../src/contract.js";

/**
 * B4 — 状态机完备性：每个枚举状态可达、有进入/出口文档、
 * 无孤儿状态；终态合法；迁移命令都属于冻结的命令集。
 * 同时输出「生成表」：状态 × 进入/出口文档（assert 快照式核对）。
 */

for (const [name, machine] of Object.entries(ALL_MACHINES)) {
  test(`${name}: completeness check finds no issues`, () => {
    const issues = checkCompleteness(machine);
    assert.deepEqual(issues, [], `${name} must have no orphan/undocumented states`);
  });

  test(`${name}: every state is reachable from the initial state`, () => {
    const reached = reachableStates(machine);
    for (const state of machine.states) {
      assert.ok(reached.has(state), `${name} state ${state} must be reachable`);
    }
  });

  test(`${name}: every state has entry/exit documentation`, () => {
    for (const state of machine.states) {
      const doc = machine.state_docs[state];
      assert.ok(doc, `${name} state ${state} needs documentation`);
      assert.ok(doc.entry.length > 0, `${name} state ${state} needs an entry doc`);
      assert.ok(doc.exit.length > 0, `${name} state ${state} needs an exit doc`);
    }
  });

  test(`${name}: terminals are a subset of states and admit no outbound rules`, () => {
    for (const terminal of machine.terminals) {
      assert.ok(
        machine.states.includes(terminal),
        `${name} terminal ${terminal} must be enumerated`,
      );
      assert.ok(
        machine.transitions.every((rule) => rule.from !== terminal),
        `${name} terminal ${terminal} must have no outbound transitions`,
      );
    }
  });

  test(`${name}: transitions only reference enumerated states and frozen commands`, () => {
    for (const rule of machine.transitions) {
      assert.ok(
        machine.states.includes(rule.from),
        `${name} transition from unknown state ${rule.from}`,
      );
      assert.ok(machine.states.includes(rule.to), `${name} transition to unknown state ${rule.to}`);
      const parsedCommand = transitionCommandSchema.safeParse(rule.command);
      assert.ok(
        parsedCommand.success,
        `${name} command ${String(rule.command)} is not in the frozen command set`,
      );
      for (const guard of rule.guards) {
        assert.ok(
          typeof guard === "string" && guard.length > 0,
          `${name} guards must be non-empty ids`,
        );
      }
    }
  });

  test(`${name}: generated state table matches the enumerated state count`, () => {
    const table = machine.states.map((state) => ({
      state,
      entry: machine.state_docs[state]?.entry ?? null,
      exit: machine.state_docs[state]?.exit ?? null,
      terminal: machine.terminals.includes(state),
    }));
    assert.equal(table.length, machine.states.length);
    assert.ok(table.every((row) => row.entry !== null && row.exit !== null));
    assert.ok(table.filter((row) => row.terminal).length === machine.terminals.length);
  });
}

test("escalation machine covers the ES2.0 lifecycle states named in §6", () => {
  const names = ALL_MACHINES.escalation.states as readonly string[];
  for (const required of ["ASSIGNED", "ENVIRONMENT_READY", "VERIFYING", "ACCEPTED"]) {
    assert.ok(names.includes(required), `ES2.0 §6 names the ${required} state`);
  }
});

test("payment machine enumerates the twelve PVP1.0 payout states", () => {
  assert.equal(ALL_MACHINES.payment.states.length, 12);
  for (const required of [
    "NOT_APPLICABLE",
    "RESERVED",
    "PENDING_EVIDENCE",
    "EVIDENCE_ACCEPTED",
    "READY_TO_RELEASE",
    "RELEASE_SUBMITTED",
    "SETTLED",
    "DISPUTED",
    "REFUND_PENDING",
    "REFUNDED",
    "FAILED_REQUIRES_RECONCILIATION",
    "CANCELLED",
  ]) {
    assert.ok((ALL_MACHINES.payment.states as readonly string[]).includes(required));
  }
});
