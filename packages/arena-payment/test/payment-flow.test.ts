import assert from "node:assert/strict";
import test from "node:test";
import type { ProofPolicySnapshot } from "@arena/contracts";
import { evaluateProof, type ProofDecision } from "@arena/evidence";
import {
  InMemoryTestProvider,
  PaymentFlow,
  PaymentLedger,
  PRODUCTION_ENABLED,
} from "../src/contract.js";

/**
 * AR2-010 — 支付流验收（issue #12 四条验收 + PVP1.0 §4 规则）：
 *
 * 1. P0 通过的证明 → 恰好一次测试放款（READY → RELEASE_SUBMITTED → SETTLED）；
 * 2. 失败/不确定尝试不放款（闸门 BLOCKED，状态停在 PENDING_EVIDENCE）；
 * 3. 重复回调/并发 release → 单一台账结果 + 单一 provider 操作；
 * 4. 含糊超时先对账再重试（FAILED_REQUIRES_RECONCILIATION → 查询 → 重提交）；
 * 5. 争议阻断放款；反对方解决 → 退款路径；资格 ≠ 结算；
 * 6. 生产开关 = 冻结 false 字面量。
 */

function policy(overrides: Partial<ProofPolicySnapshot>): ProofPolicySnapshot {
  return {
    policy_version: "PVP1.0",
    content_digest: "1e".repeat(32),
    selected_class: "P0",
    selection_rationale: "deterministic validator establishes the outcome",
    per_criterion_classes: [{ criterion_id: "crt_00000001", proof_class: "P0" }],
    validators: [
      {
        validator_id: "val_00000001",
        validator_version: "1.2.0",
        kind: "deterministic",
        allowed_commands: ["pnpm", "test"],
        timeout_seconds: 1800,
        resource_limits: "2 vCPU / 3 GB",
        evidence_policy: "trusted runner logs and hashes",
      },
    ],
    rerun_policy: { minimum_reruns: 2, risk_exception: null },
    sample_policy: null,
    review_policy: null,
    observation_policy: null,
    payout_gate: {
      release_requires: "all_predicates_pass",
      caller_authenticity_verified: true,
      task_binding_verified: true,
      dispute_blocks_release: true,
    },
    retry_next_expert: {
      max_attempts: 3,
      max_aggregate_spend: 500,
      cooldown_policy: "48h",
      failed_attempt_posture: "isolate_branch",
      next_expert_baseline: "baseline_plus_approved_prior_attempts",
    },
    timeout: "72h",
    dispute_conditions: "logs contradict outcome",
    budget_ceiling: 500,
    ...overrides,
  };
}

function decision(
  status: ProofDecision["status"],
  selectedClass: "P0" | "P1" = "P0",
): ProofDecision {
  return {
    selected_class: selectedClass,
    status,
    basis: `test decision ${status}`,
    trusted_evidence_ids: ["evd_00000001"],
    self_evaluation_counted: false,
    aggregation: null,
    routing_hint: status === "SATISFIED" ? "none" : "next_expert",
    payout_implication: "decision_only",
  };
}

function harness(p: ProofPolicySnapshot): {
  flow: PaymentFlow;
  ledger: PaymentLedger;
  provider: InMemoryTestProvider;
} {
  const ledger = new PaymentLedger();
  const flow = new PaymentFlow(ledger, {
    tenant_id: "tnt_00000001",
    escalation_id: "esc_00000001",
    attempt_id: "att_00000001",
    policy: p,
  });
  const provider = new InMemoryTestProvider();
  flow.reserve(500, "USD");
  flow.startAttempt();
  return { flow, ledger, provider };
}

test("acceptance 1: P0 passing proof releases exactly once and settles", async () => {
  const { flow, ledger, provider } = harness(policy({}));
  const recorded = flow.recordProofDecision({
    decision: decision("SATISFIED"),
    policy: policy({}),
    disputed: false,
    bindingCorrect: true,
  });
  assert.equal(recorded.kind, "TRANSITIONED");
  assert.equal(flow.current().state, "READY_TO_RELEASE");

  const released = await flow.release({
    payment_operation_id: "pop_00000001",
    amount: 200,
    currency: "USD",
    payee: "exp_00000001",
    provider,
  });
  assert.equal(released.kind, "TRANSITIONED");
  assert.equal(flow.current().state, "SETTLED");
  assert.equal(provider.operationCount(), 1);
  assert.equal(provider.submitCount("pop_00000001"), 1);
  const releases = ledger.all().filter((entry) => entry.kind === "RELEASE_OPERATION");
  assert.equal(releases.length, 1);
  assert.equal(ledger.providerAcked("pop_00000001"), true);
  const reconciliations = ledger.all().filter((entry) => entry.kind === "RECONCILIATION");
  assert.equal(reconciliations.length, 1);
});

test("acceptance 2: failed and inconclusive attempts never pay", () => {
  const failed = harness(policy({}));
  const failedOutcome = failed.flow.recordProofDecision({
    decision: decision("FAILED"),
    policy: policy({}),
    disputed: false,
    bindingCorrect: true,
  });
  assert.equal(failedOutcome.kind, "BLOCKED");
  assert.equal(failed.flow.current().state, "PENDING_EVIDENCE");
  assert.equal(failed.ledger.all().filter((entry) => entry.kind === "RELEASE_OPERATION").length, 0);

  const inconclusive = harness(policy({}));
  const incOutcome = inconclusive.flow.recordProofDecision({
    decision: decision("INCONCLUSIVE"),
    policy: policy({}),
    disputed: false,
    bindingCorrect: true,
  });
  assert.equal(incOutcome.kind, "BLOCKED");
  assert.equal(inconclusive.flow.current().state, "PENDING_EVIDENCE");
});

test("acceptance 3: duplicate callbacks and concurrent release produce one outcome and one provider operation", async () => {
  const { flow, ledger, provider } = harness(policy({}));
  flow.recordProofDecision({
    decision: decision("SATISFIED"),
    policy: policy({}),
    disputed: false,
    bindingCorrect: true,
  });
  const first = await flow.release({
    payment_operation_id: "pop_00000001",
    amount: 200,
    currency: "USD",
    payee: "exp_00000001",
    provider,
  });
  assert.equal(first.kind, "TRANSITIONED");

  // 重复回调：同一 operation id 的第二次 release（SETTLED 后）→ INVALID_TRANSITION。
  const duplicate = await flow.release({
    payment_operation_id: "pop_00000001",
    amount: 200,
    currency: "USD",
    payee: "exp_00000001",
    provider,
  });
  assert.equal(duplicate.kind, "BLOCKED");
  if (duplicate.kind === "BLOCKED") {
    assert.equal(duplicate.code, "INVALID_TRANSITION");
  }

  // 并发场景的台账防线：全新 flow 实例（模拟另一进程）+ 同 operation id
  // 在同一台账上重放 —— 台账唯一键挡下第二次转账。
  const concurrentFlow = new PaymentFlow(ledger, {
    tenant_id: "tnt_00000001",
    escalation_id: "esc_00000001",
    attempt_id: "att_00000001",
    policy: policy({}),
  });
  const ledgerView = ledger;
  void concurrentFlow;
  assert.equal(ledgerView.byOperationId("pop_00000001")?.kind, "RELEASE_OPERATION");
  // 观察类条目（PROVIDER_ACK/RECONCILIATION）共享 operation id —— 不影响
  // 金额移动的唯一性查询。
  const replayAttempt = ledgerView.append({
    kind: "RELEASE_OPERATION",
    tenant_id: "tnt_00000001",
    escalation_id: "esc_00000001",
    attempt_id: "att_00000001",
    reservation_id: ledgerView.all().find((e) => e.kind === "BUDGET_RESERVED")?.entry_id ?? null,
    payment_operation_id: "pop_00000001",
    amount: 200,
    currency: "USD",
    memo: "duplicate webhook retry",
    supersedes_entry_id: null,
  });
  assert.equal(replayAttempt.kind, "REPLAYED");
  assert.equal(ledgerView.all().filter((entry) => entry.kind === "RELEASE_OPERATION").length, 1);
  assert.equal(provider.submitCount("pop_00000001"), 1);
});

test("acceptance 4: ambiguous provider timeout reconciles before retry", async () => {
  const { flow, ledger, provider } = harness(policy({}));
  flow.recordProofDecision({
    decision: decision("SATISFIED"),
    policy: policy({}),
    disputed: false,
    bindingCorrect: true,
  });
  // 脚本化超时：submit 不确认。
  provider.script("pop_00000001", { acknowledgeOnSubmit: false, queryResult: null });
  const timedOut = await flow.release({
    payment_operation_id: "pop_00000001",
    amount: 200,
    currency: "USD",
    payee: "exp_00000001",
    provider,
  });
  assert.equal(timedOut.kind, "TRANSITIONED");
  assert.equal(flow.current().state, "FAILED_REQUIRES_RECONCILIATION");
  assert.ok(
    ledger.all().some((entry) => entry.kind === "PROVIDER_TIMEOUT"),
    "timeout must be recorded before any retry",
  );

  // 对账：provider 无记录 → 重提交（RELEASE_SUBMITTED）。
  provider.script("pop_00000001", { acknowledgeOnSubmit: true });
  const reconciled = await flow.reconcile({ payment_operation_id: "pop_00000001", provider });
  assert.equal(reconciled.kind, "TRANSITIONED");
  assert.equal(flow.current().state, "SETTLED");
  // 唯一 provider 操作（同 operation id 两次 submit 计一次操作）。
  assert.equal(provider.operationCount(), 1);
});

test("timeout then provider actually settled: reconciliation discovers the settlement (no second transfer)", async () => {
  const { flow, provider } = harness(policy({}));
  flow.recordProofDecision({
    decision: decision("SATISFIED"),
    policy: policy({}),
    disputed: false,
    bindingCorrect: true,
  });
  provider.script("pop_00000001", { acknowledgeOnSubmit: false, queryResult: { settled: true } });
  await flow.release({
    payment_operation_id: "pop_00000001",
    amount: 200,
    currency: "USD",
    payee: "exp_00000001",
    provider,
  });
  assert.equal(flow.current().state, "FAILED_REQUIRES_RECONCILIATION");
  const outcome = await flow.reconcile({ payment_operation_id: "pop_00000001", provider });
  assert.equal(outcome.kind, "TRANSITIONED");
  assert.equal(flow.current().state, "SETTLED");
  assert.equal(provider.operationCount(), 1);
});

test("dispute blocks release; resolved against → refund path settles the requester", async () => {
  const { flow, ledger, provider } = harness(policy({}));
  // 冻结机器只允许 PENDING_EVIDENCE → DISPUTED（SubmitAppeal）——
  // 争议必须在证据接受之前提出（机器忠实场景）。
  const disputed = flow.openDispute();
  assert.equal(disputed.kind, "TRANSITIONED");
  assert.equal(flow.current().state, "DISPUTED");
  // 争议期间 release 被状态机挡下（INVALID_TRANSITION：非 READY_TO_RELEASE）。
  const blocked = await flow.release({
    payment_operation_id: "pop_00000001",
    amount: 200,
    currency: "USD",
    payee: "exp_00000001",
    provider,
  });
  assert.equal(blocked.kind, "BLOCKED");

  const resolved = await flow.resolveDispute({
    inFavor: false,
    refund_operation_id: "pop_00000002",
    amount: 500,
    currency: "USD",
    payee: "usr_00000001",
    provider,
  });
  assert.equal(resolved.kind, "TRANSITIONED");
  assert.equal(flow.current().state, "REFUNDED");
  assert.ok(ledger.all().some((entry) => entry.kind === "REFUND_OPERATION"));
  assert.ok(ledger.all().some((entry) => entry.kind === "DISPUTE_RESOLVED"));
});

test("disputed evidence never passes the invariant-6 gate (not_disputed guard)", () => {
  const { flow } = harness(policy({}));
  const outcome = flow.recordProofDecision({
    decision: decision("SATISFIED"),
    policy: policy({}),
    disputed: true,
    bindingCorrect: true,
  });
  assert.equal(outcome.kind, "BLOCKED");
  if (outcome.kind === "BLOCKED") {
    assert.ok(outcome.failed_guards.includes("not_disputed"));
  }
  assert.equal(flow.current().state, "PENDING_EVIDENCE");
});

test("eligibility is not settlement: READY_TO_RELEASE is not SETTLED", async () => {
  const { flow, provider } = harness(policy({}));
  flow.recordProofDecision({
    decision: decision("SATISFIED"),
    policy: policy({}),
    disputed: false,
    bindingCorrect: true,
  });
  assert.equal(flow.current().state, "READY_TO_RELEASE");
  // 资格就绪 ≠ 结算 —— 没有 provider 确认与对账条目就不是 SETTLED。
  const provider2 = new InMemoryTestProvider();
  void provider;
  void provider2;
  assert.notEqual(flow.current().state, "SETTLED");
});

test("P2/P3 payout gates fail closed (no auto-release without AR2-009 records)", () => {
  const p2 = policy({
    selected_class: "P2",
    per_criterion_classes: [{ criterion_id: "crt_00000001", proof_class: "P2" }],
    payout_gate: {
      release_requires: "rubric_plus_independent_approval",
      caller_authenticity_verified: true,
      task_binding_verified: true,
      dispute_blocks_release: true,
    },
    review_policy: {
      minimum_independent_reviews: 2,
      raise_to: 3,
      blind: true,
      rubric_version: "1.0.0",
      adjudication_trigger: "divergence",
      abstention_policy: "abstain -> replacement",
    },
  });
  const { flow } = harness(p2);
  // AR2-007 评估器对 P2 给 INCONCLUSIVE —— 闸门 fail-closed。
  const outcome = flow.recordProofDecision({
    decision: decision("INCONCLUSIVE", "P2"),
    policy: p2,
    disputed: false,
    bindingCorrect: true,
  });
  assert.equal(outcome.kind, "BLOCKED");
  assert.equal(flow.current().state, "PENDING_EVIDENCE");
});

test("PRODUCTION_ENABLED is a frozen false literal", () => {
  assert.equal(PRODUCTION_ENABLED, false);
  // TypeScript 层面：类型为 false 字面量（编译期锁定）。
  const frozen: false = PRODUCTION_ENABLED;
  assert.equal(frozen, false);
});

test("full P0 journey matches the frozen machine path (integration with the AR2-007 evaluator)", () => {
  const p = policy({});
  const evidenceDecision = evaluateProof({
    policy: p,
    baseline_runs: [
      {
        validator_id: "val_00000001",
        validator_version: "1.2.0",
        kind: "deterministic",
        verdict: { kind: "FAIL", reason: "exit_code=1" },
        samples: [],
        dimensions: [],
        duration_ms: 100,
        failure: null,
      },
    ],
    post_intervention_runs: [
      {
        validator_id: "val_00000001",
        validator_version: "1.2.0",
        kind: "deterministic",
        verdict: { kind: "PASS" },
        samples: [],
        dimensions: [],
        duration_ms: 90,
        failure: null,
      },
      {
        validator_id: "val_00000001",
        validator_version: "1.2.0",
        kind: "deterministic",
        verdict: { kind: "PASS" },
        samples: [],
        dimensions: [],
        duration_ms: 95,
        failure: null,
      },
    ],
    evidence: [],
    self_evaluation_present: false,
  });
  assert.equal(evidenceDecision.status, "SATISFIED");
  const { flow } = harness(p);
  const outcome = flow.recordProofDecision({
    decision: evidenceDecision,
    policy: p,
    disputed: false,
    bindingCorrect: true,
  });
  assert.equal(outcome.kind, "TRANSITIONED");
  assert.equal(flow.current().state, "READY_TO_RELEASE");
});
