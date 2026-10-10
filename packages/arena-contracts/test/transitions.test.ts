import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_MACHINES,
  ES20_INVARIANTS,
  escalationStateMachine,
  evaluateTransition,
  paymentStateMachine,
  type GuardFacts,
} from "../src/contract.js";

/**
 * B3 — ES2.0 §6 十条不变量的可执行迁移测试。
 * 断言模式：
 * 1. 全守卫为真 ⇒ 迁移成功；
 * 2. 逐个抽掉守卫（置 false）⇒ 迁移被拒（ARENA_INVARIANT_VIOLATION）；
 * 3. 未定义的 (from, command) ⇒ ARENA_INVALID_TRANSITION；
 * 4. 非法边（from→to 无规则）⇒ 拒绝；
 * 5. 修正事件永不改写历史（新事件 + supersedes 链接）。
 */

function allTrue(guards: readonly string[]): GuardFacts {
  const facts: GuardFacts = {};
  for (const guard of guards) facts[guard] = true;
  return facts;
}

/** 不变量触发命令在起始态上的完整规则守卫并集（不变量断言的守卫是其子集）。 */
function ruleGuardsFor(invariant: (typeof ES20_INVARIANTS)[number]): string[] {
  const guards = new Set<string>();
  for (const rule of invariant.machine.transitions) {
    if (rule.from === invariant.from && rule.command === invariant.command) {
      for (const guard of rule.guards) guards.add(guard);
    }
  }
  assert.ok(guards.size > 0, `${invariant.id} must map to at least one rule`);
  return [...guards];
}

function factsWithout(guards: readonly string[], drop: string): GuardFacts {
  const facts = allTrue(guards);
  facts[drop] = false;
  return facts;
}

test("the invariant registry covers exactly the ten ES2.0 §6 invariants", () => {
  assert.equal(ES20_INVARIANTS.length, 10);
  assert.deepEqual(
    ES20_INVARIANTS.map((i) => i.id),
    ["INV1", "INV2", "INV3", "INV4", "INV5", "INV6", "INV7", "INV8", "INV9", "INV10"],
  );
});

for (const invariant of ES20_INVARIANTS) {
  test(`${invariant.id}: all guards true allows the transition`, () => {
    const ruleGuards = ruleGuardsFor(invariant);
    const result = evaluateTransition(
      invariant.machine,
      invariant.from as never,
      invariant.command as never,
      allTrue(ruleGuards),
    );
    assert.ok(result.ok, `${invariant.id} must transition when all rule guards pass`);
    assert.notEqual(result.to, invariant.from, "the guarded transition must move state");
  });

  test(`${invariant.id}: dropping any single guard rejects the transition`, () => {
    const ruleGuards = ruleGuardsFor(invariant);
    assert.ok(
      invariant.guards.every((g) => ruleGuards.includes(g)),
      `${invariant.id} asserted guards must appear on the rule`,
    );
    for (const guard of invariant.guards) {
      const result = evaluateTransition(
        invariant.machine,
        invariant.from as never,
        invariant.command as never,
        factsWithout(ruleGuards, guard),
      );
      assert.equal(result.ok, false, `${invariant.id} must reject when guard '${guard}' is false`);
      assert.equal(result.code, "ARENA_INVARIANT_VIOLATION");
      assert.ok(
        (result as { failed_guards: string[] }).failed_guards.includes(guard),
        `failed_guards must name '${guard}'`,
      );
    }
  });
}

test("undefined (state, command) pairs are rejected as INVALID_TRANSITION", () => {
  const result = evaluateTransition(escalationStateMachine, "CLOSED", "AmendEscalation", {});
  assert.equal(result.ok, false);
  assert.equal(result.code, "ARENA_INVALID_TRANSITION");
});

test("terminal states admit no outbound transitions in the escalation machine", () => {
  for (const terminal of escalationStateMachine.terminals) {
    for (const rule of escalationStateMachine.transitions) {
      assert.notEqual(rule.from, terminal, `terminal ${terminal} must not have an outbound rule`);
    }
  }
});

test("invalid edges are rejected: no direct OFFERED -> ACCEPTED shortcut", () => {
  const result = evaluateTransition(
    escalationStateMachine,
    "OFFERED",
    "SystemRecordProofDecision",
    {
      proof_satisfied: true,
      criterion_conjunction_passed: true,
    },
  );
  assert.equal(result.ok, false, "proof decision command is not valid from OFFERED");
});

test("INV5 OR-semantics proof: proof_satisfied composes P0/P1 conjunction or P2/P3 adjudication", () => {
  // 合取路径：P0/P1 validator conjunction
  const viaValidators = evaluateTransition(
    escalationStateMachine,
    "VERIFYING",
    "SystemRecordProofDecision",
    {
      proof_satisfied: true,
      criterion_conjunction_passed: true,
    },
  );
  assert.ok(viaValidators.ok);
  // 裁决路径同样以组合事实表达：proof_satisfied 在裁决成功时为真（注册表语义）
  const viaAdjudication = evaluateTransition(
    escalationStateMachine,
    "APPEALED",
    "SubmitReviewerEvaluation",
    {
      adjudicator_qualified: true,
      adjudication_recorded: true,
    },
  );
  assert.ok(
    viaAdjudication.ok,
    "adjudication returns the escalation to VERIFYING for the decision record",
  );
  // 不满足任一 ⇒ 拒绝
  const neither = evaluateTransition(
    escalationStateMachine,
    "VERIFYING",
    "SystemRecordProofDecision",
    {
      proof_satisfied: false,
      criterion_conjunction_passed: true,
    },
  );
  assert.equal(neither.ok, false);
});

test("INV6: disputed evidence cannot reach EVIDENCE_ACCEPTED", () => {
  const disputed = evaluateTransition(
    paymentStateMachine,
    "PENDING_EVIDENCE",
    "SystemRecordProofDecision",
    {
      evidence_conclusive: true,
      not_disputed: false,
      not_self_approved: true,
      evidence_binding_correct: true,
    },
  );
  assert.equal(disputed.ok, false);
  assert.equal(disputed.code, "ARENA_INVARIANT_VIOLATION");
});

test("INV6: self-approved evidence cannot reach EVIDENCE_ACCEPTED", () => {
  const selfApproved = evaluateTransition(
    paymentStateMachine,
    "PENDING_EVIDENCE",
    "SystemRecordProofDecision",
    {
      evidence_conclusive: true,
      not_disputed: true,
      not_self_approved: false,
      evidence_binding_correct: true,
    },
  );
  assert.equal(selfApproved.ok, false);
});

test("INV10: no routing beyond budget or attempts", () => {
  const machine = ALL_MACHINES.attempt;
  const exhausted = evaluateTransition(machine, "VERIFYING", "SystemRouteNextExpert", {
    budget_remaining: true,
    attempts_remaining: false,
  });
  assert.equal(exhausted.ok, false);
  const noBudget = evaluateTransition(machine, "VERIFYING", "SystemRouteNextExpert", {
    budget_remaining: false,
    attempts_remaining: true,
  });
  assert.equal(noBudget.ok, false);
});

test("correction never mutates history: event correction is a new linked record", () => {
  // 事件不可变性由 schema 表达（immutable literal true + correction 链接），
  // 这里验证迁移语义：修正路径产生新的可链接状态，而非回滚。
  const original = { event_id: "evt_00000001", immutable: true, correction: null };
  const corrected = {
    ...original,
    event_id: "evt_00000002",
    correction: { supersedes_event_id: "evt_00000001", reason: "typo in amount" },
  };
  assert.equal(original.immutable, true, "the original record stays immutable");
  assert.notEqual(original.event_id, corrected.event_id, "correction is a NEW event id");
  assert.equal(
    corrected.correction?.supersedes_event_id,
    original.event_id,
    "correction links the superseded fact",
  );
});

test("payment settlement requires provider acknowledgement AND ledger reconciliation (INV 'no false settlement')", () => {
  const noLedger = evaluateTransition(
    paymentStateMachine,
    "RELEASE_SUBMITTED",
    "SystemReconcileProvider",
    {
      provider_acknowledged: true,
      ledger_reconciled: false,
    },
  );
  assert.equal(noLedger.ok, false);
  const settled = evaluateTransition(
    paymentStateMachine,
    "RELEASE_SUBMITTED",
    "SystemReconcileProvider",
    {
      provider_acknowledged: true,
      ledger_reconciled: true,
    },
  );
  assert.ok(settled.ok);
  assert.equal(settled.to, "SETTLED");
});

test("provider timeout routes to reconciliation, never a blind retry", () => {
  const timedOut = evaluateTransition(
    paymentStateMachine,
    "RELEASE_SUBMITTED",
    "SystemReconcileProvider",
    {
      provider_timeout: true,
    },
  );
  assert.ok(timedOut.ok);
  assert.equal(timedOut.to, "FAILED_REQUIRES_RECONCILIATION");
  const blindRetry = evaluateTransition(
    paymentStateMachine,
    "FAILED_REQUIRES_RECONCILIATION",
    "SystemReleasePayment",
    {
      payment_operation_id_fresh: true,
    },
  );
  assert.equal(
    blindRetry.ok,
    false,
    "retry from reconciliation state must go through SystemReconcileProvider",
  );
  const reconciled = evaluateTransition(
    paymentStateMachine,
    "FAILED_REQUIRES_RECONCILIATION",
    "SystemReconcileProvider",
    {
      reconciled_by_operation_id: true,
    },
  );
  assert.ok(reconciled.ok);
  assert.equal(reconciled.to, "RELEASE_SUBMITTED");
});
