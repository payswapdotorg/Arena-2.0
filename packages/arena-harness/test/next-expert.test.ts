import assert from "node:assert/strict";
import test from "node:test";
import { ArenaSdkClient, buildGenericEscalationRequest } from "@arena/sdk";
import { executeCommand } from "@arena/application";
import { PaymentFlow, PaymentLedger, InMemoryTestProvider } from "@arena/payment";
import {
  matchExperts,
  routeNextExpert,
  compileCapabilityDemand,
  type ExpertProfile,
} from "@arena/matching";
import {
  evaluateScenarioProof,
  interventionFailingRuns,
  interventionPassingRuns,
  scenarioP0Policy,
  trustedEvidence,
} from "../src/contract.js";
import {
  ASSIGNMENT_FACTS,
  CANDIDATE_FACTS,
  ENVIRONMENT_FACTS,
  openWorkspace,
  PROOF_FACTS,
  startRealApi,
} from "./support.js";

/**
 * AR2-012 — 验收剖面 B（issue #14）：失败首专家 → 预算内路由下一位合格专家。
 *
 * 第一位专家尝试 FAILED → 支付闸门 BLOCKED（失败尝试不放款）→
 * AR2-008 routeNextExpert（真实匹配/路由引擎，预算与尝试上限内）→
 * 第二位专家尝试 SATISFIED → 恰好一次放款（provider 提交数 = 1，
 * 台账 RELEASE_OPERATION = 1；失败尝试零放款）。
 */

const ALPHA = { bearerToken: "demo-token-requester-alpha" };

function profile(expertId: string, tenantId: string): ExpertProfile {
  return {
    expert_id: expertId,
    tenant_id: tenantId,
    capabilities: [
      { capability_id: "cap_generic_0001", level: "senior", evidence_refs: ["evd_00000009"] },
    ],
    qualifications: [
      {
        qualification: "licensed engineer",
        evidence_refs: ["evd_00000010"],
        jurisdiction: "GH",
        expires_at: null,
      },
    ],
    availability: { max_concurrent_attempts: 3, active_attempts: 0 },
    jurisdictions: ["GH"],
    policy_flags: [],
  };
}

test("next-expert path: failed first attempt does not pay; routed second expert is paid exactly once", async () => {
  const workspace = openWorkspace("next");
  const api = await startRealApi(workspace.dbPath);
  try {
    // 1) 提交（真实 API）。
    const client = new ArenaSdkClient({ baseUrl: api.baseUrl });
    const request = buildGenericEscalationRequest({
      title: "Recover the corrupted migration script",
      outcome_description: "The migration script replays cleanly on the fixture database.",
      output_schema_id: "sch_harness_next",
      caller_idempotency_key: "harness-next-1",
      client_application_id: "app_00000001",
    });
    const submitted = await client.submitEscalation(request, ALPHA);
    assert.equal(submitted.kind, "CREATED");
    const escalationId = submitted.kind === "CREATED" ? submitted.escalation_id : "";
    const policy = scenarioP0Policy();
    const demand = compileCapabilityDemand(request);

    const systemCommand = async (name: string, facts: Record<string, boolean>) =>
      executeCommand(workspace.consumerRuntime, {
        aggregate_type: "escalation",
        aggregate_id: escalationId,
        command: name as never,
        facts,
        actor: { type: "system", id: "sys_00000001" },
        tenant_id: "tnt_00000001",
        request_id: null,
        correlation_id: `harness-next-${name}`,
      });
    const command = async (name: string, facts: Record<string, boolean>) =>
      client.escalationCommand(escalationId, name, facts, ALPHA);

    // 2) 第一位专家：指派 → 干预 → 证明 FAILED。
    await systemCommand("SystemProposeOffer", { candidate_expert_matched: true });
    await command("AcceptOffer", { ...ASSIGNMENT_FACTS });
    await command("StartAttempt", { ...ENVIRONMENT_FACTS });
    await command("SubmitIntervention", { ...CANDIDATE_FACTS });
    const failedDecision = evaluateScenarioProof({
      policy,
      post_runs: interventionFailingRuns(),
      evidence: [trustedEvidence("evd_harness_next_1", "att_harness_next_1")],
      self_evaluation_present: true,
    });
    assert.equal(failedDecision.status, "FAILED");
    assert.equal(failedDecision.routing_hint, "next_expert");

    // 3) 支付（失败尝试）：闸门 BLOCKED —— 零放款。
    const ledger = new PaymentLedger();
    const provider = new InMemoryTestProvider();
    const firstFlow = new PaymentFlow(ledger, {
      tenant_id: "tnt_00000001",
      escalation_id: escalationId,
      attempt_id: "att_harness_next_1",
      policy,
    });
    firstFlow.reserve(500, "USD");
    firstFlow.startAttempt();
    const firstRecorded = firstFlow.recordProofDecision({
      decision: failedDecision,
      policy,
      disputed: false,
      bindingCorrect: true,
    });
    assert.equal(firstRecorded.kind, "BLOCKED");
    assert.equal(firstFlow.current().state, "PENDING_EVIDENCE");
    assert.equal(ledger.all().filter((entry) => entry.kind === "RELEASE_OPERATION").length, 0);

    // 4) 路由下一位合格专家（真实 AR2-008）：预算/尝试上限内 → NEXT_EXPERT。
    const candidates = [
      profile("exp_00000001", "tnt_00000001"),
      profile("exp_00000002", "tnt_00000002"),
    ];
    const matches = matchExperts(demand, candidates, {
      failedAttemptExpertIds: ["exp_00000001"], // 失败尝试归因保留 —— 冲突筛查排除
      priorInvolvementExpertIds: [],
      conflictedTenantIds: [],
      knownEvidenceIds: ["evd_00000009", "evd_00000010"],
    });
    const routing = routeNextExpert(demand, matches, {
      attemptsUsed: 1,
      aggregateSpend: 0,
      nextAttemptAmount: 200,
      now: "2026-10-11T09:00:00Z",
    });
    assert.equal(routing.kind, "NEXT_EXPERT");
    if (routing.kind === "NEXT_EXPERT") {
      assert.equal(
        routing.expert_id,
        "exp_00000002",
        "failed expert excluded with attribution retained",
      );
      assert.equal(routing.rank, 1);
    }

    // 5) 第二位专家尝试（新 attempt —— 失败尝试保留归因）：SATISFIED → 放款恰一次。
    //    预算控制在路由层（max_aggregate_spend/尝试上限）；每个 attempt 的
    //    支付流各自预留（追加式台账记录两笔预留、恰一笔放款）。
    const secondFlow = new PaymentFlow(ledger, {
      tenant_id: "tnt_00000001",
      escalation_id: escalationId,
      attempt_id: "att_harness_next_2",
      policy,
    });
    secondFlow.reserve(500, "USD");
    secondFlow.startAttempt();
    const passedDecision = evaluateScenarioProof({
      policy,
      post_runs: interventionPassingRuns(),
      evidence: [trustedEvidence("evd_harness_next_2", "att_harness_next_2")],
      self_evaluation_present: true,
    });
    assert.equal(passedDecision.status, "SATISFIED");
    const secondRecorded = secondFlow.recordProofDecision({
      decision: passedDecision,
      policy,
      disputed: false,
      bindingCorrect: true,
    });
    assert.equal(secondRecorded.kind, "TRANSITIONED");
    const released = await secondFlow.release({
      payment_operation_id: "pop_harness_next_2",
      amount: 200,
      currency: "USD",
      payee: "exp_00000002",
      provider,
    });
    assert.equal(released.kind, "TRANSITIONED");
    assert.equal(secondFlow.current().state, "SETTLED");

    // 6) 恰好一次放款（整个 escalation）：
    assert.equal(provider.submitCount("pop_harness_next_2"), 1);
    assert.equal(provider.operationCount(), 1, "no other payment operation was submitted");
    assert.equal(ledger.all().filter((entry) => entry.kind === "RELEASE_OPERATION").length, 1);
    // 失败尝试零放款 + 归因保留（保留字段在 ledger 预留/尝试条目上）。
    const releaseEntries = ledger.all().filter((entry) => entry.kind === "RELEASE_OPERATION");
    assert.equal(releaseEntries[0]?.attempt_id, "att_harness_next_2");

    // 7) 系统侧证明决策 → ACCEPTED（真实状态机收尾）。
    const decided = await systemCommand("SystemRecordProofDecision", { ...PROOF_FACTS });
    assert.equal(decided.to, "ACCEPTED");
  } finally {
    await api.stop();
    workspace.cleanup();
  }
});
