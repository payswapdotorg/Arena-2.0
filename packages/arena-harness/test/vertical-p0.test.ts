import assert from "node:assert/strict";
import test from "node:test";
import { executeCommand } from "@arena/application";
import {
  ArenaSdkClient,
  buildGenericEscalationRequest,
  dispatchWebhookRound,
  InMemoryWebhookDedupeStore,
  startWebhookReceiver,
} from "@arena/sdk";
import { PaymentFlow, PaymentLedger, InMemoryTestProvider } from "@arena/payment";
import {
  baselineFailingRuns,
  buildStableIdTrace,
  collectOutboxEvents,
  evaluateScenarioProof,
  interventionPassingRuns,
  scenarioP0Policy,
  trustedEvidence,
} from "../src/contract.js";
import {
  ASSIGNMENT_FACTS,
  CANDIDATE_FACTS,
  ENVIRONMENT_FACTS,
  nowIso,
  openWorkspace,
  PROOF_FACTS,
  startRealApi,
} from "./support.js";

/**
 * AR2-012 — 验收剖面 A（issue #14）：P0 纵向端到端。
 *
 * 基线失败的软件任务（真实 arena-api 进程 + durable sqlite + SDK 真实
 * HTTP）→ 生命周期命令（真实状态机）→ 同一预声明 validator 证明
 * （真实 AR2-007 evaluateProof）→ 恰好一次测试放款（真实 AR2-010
 * PaymentFlow + InMemoryTestProvider）→ 全事件流签名 webhook 投递
 * （真实 outbox + 真实 HTTP 接收端）→ 稳定 ID 追踪（请求 → 事件 → 支付）。
 * 断言：无状态丢失、无双重放款、webhook 每事件恰一次。
 */

const ALPHA = { bearerToken: "demo-token-requester-alpha" };

test("P0 vertical: baseline failing task → intervention → proof → exactly one payout → webhooks → stable-ID trace", async () => {
  const workspace = openWorkspace("p0");
  const api = await startRealApi(workspace.dbPath);
  try {
    // 1) 提交基线失败任务（真实 URL + 真实 durable 组装根）。
    const client = new ArenaSdkClient({ baseUrl: api.baseUrl });
    const request = buildGenericEscalationRequest({
      title: "Fix the failing pricing-rule build",
      outcome_description:
        "The corrected pricing rule reproduces the fixture table for all 12 edge cases.",
      output_schema_id: "sch_harness_p0",
      caller_idempotency_key: "harness-p0-1",
      client_application_id: "app_00000001",
    });
    const submitted = await client.submitEscalation(request, ALPHA);
    assert.equal(submitted.kind, "CREATED");
    const escalationId = submitted.kind === "CREATED" ? submitted.escalation_id : "";

    // 2) 生命周期（真实冻结状态机）：公开命令走真实 API 命令端点（SDK）；
    //    系统自治触发器（路由/证明决策）由编排侧经真实 application 执行器
    //    在同一 durable 库的多连接拓扑上驱动（AR2-005 验收场景 3 基础）。
    const command = async (name: string, facts: Record<string, boolean>) =>
      client.escalationCommand(escalationId, name, facts, ALPHA);
    const systemCommand = async (name: string, facts: Record<string, boolean>) =>
      executeCommand(workspace.consumerRuntime, {
        aggregate_type: "escalation",
        aggregate_id: escalationId,
        command: name as never,
        facts,
        actor: { type: "system", id: "sys_00000001" },
        tenant_id: "tnt_00000001",
        request_id: null,
        correlation_id: `harness-p0-${Date.now()}`,
      });
    const offered = await systemCommand("SystemProposeOffer", { candidate_expert_matched: true });
    assert.equal(offered.to, "OFFERED");
    const assigned = await command("AcceptOffer", { ...ASSIGNMENT_FACTS });
    assert.equal(assigned.kind, "ACCEPTED");
    if (assigned.kind === "ACCEPTED") assert.equal(assigned.to, "ASSIGNED");
    const environment = await command("StartAttempt", { ...ENVIRONMENT_FACTS });
    assert.equal(environment.kind, "ACCEPTED");
    if (environment.kind === "ACCEPTED") assert.equal(environment.to, "ENVIRONMENT_READY");
    const intervention = await command("SubmitIntervention", { ...CANDIDATE_FACTS });
    assert.equal(intervention.kind, "ACCEPTED");
    if (intervention.kind === "ACCEPTED") assert.equal(intervention.to, "VERIFYING");

    // 3) 同一预声明 validator 证明（真实 AR2-007）：基线 FAIL → 干预后 PASS ⇒ SATISFIED。
    const policy = scenarioP0Policy();
    const decision = evaluateScenarioProof({
      policy,
      post_runs: interventionPassingRuns(),
      evidence: [trustedEvidence("evd_harness_p0_1", "att_harness_p0_1")],
      self_evaluation_present: true,
    });
    assert.equal(decision.status, "SATISFIED");
    assert.equal(decision.self_evaluation_counted, false);

    // 4) 记录证明决策（系统触发器）→ ACCEPTED（真实状态机 + 事件入 outbox）。
    const decided = await systemCommand("SystemRecordProofDecision", { ...PROOF_FACTS });
    assert.equal(decided.to, "ACCEPTED");

    // 5) 恰好一次测试放款（真实 AR2-010 流 + 测试 provider）。
    const ledger = new PaymentLedger();
    const provider = new InMemoryTestProvider();
    const flow = new PaymentFlow(ledger, {
      tenant_id: "tnt_00000001",
      escalation_id: escalationId,
      attempt_id: "att_harness_p0_1",
      policy,
    });
    flow.reserve(500, "USD");
    flow.startAttempt();
    const recorded = flow.recordProofDecision({
      decision,
      policy,
      disputed: false,
      bindingCorrect: true,
    });
    assert.equal(recorded.kind, "TRANSITIONED");
    const released = await flow.release({
      payment_operation_id: "pop_harness_p0_1",
      amount: 200,
      currency: "USD",
      payee: "exp_00000001",
      provider,
    });
    assert.equal(released.kind, "TRANSITIONED");
    assert.equal(flow.current().state, "SETTLED");
    assert.equal(provider.submitCount("pop_harness_p0_1"), 1, "exactly one provider submission");
    assert.equal(ledger.all().filter((entry) => entry.kind === "RELEASE_OPERATION").length, 1);

    // 6) 先采集全事件流（fetchDue 只读 —— 投递前采集），再签名投递（真实
    //    outbox + 真实 HTTP 接收端 + apply-once 去重）。
    const events = await collectOutboxEvents(workspace.consumerRuntime.outbox, nowIso());
    const escalationEvents = events.filter((event) => event.aggregate.id === escalationId);
    assert.ok(
      escalationEvents.length >= 5,
      `lifecycle events in outbox (got ${escalationEvents.length})`,
    );
    const effects: string[] = [];
    const receiver = await startWebhookReceiver({
      secret: "whsec_harness_p0_000000001",
      dedupe: new InMemoryWebhookDedupeStore(),
      apply: (payload) => {
        effects.push(`${payload.delivery_id}:${payload.event_id}:${payload.event_type}`);
      },
    });
    try {
      let delivered = 0;
      for (let round = 0; round < 8; round += 1) {
        const roundReport = await dispatchWebhookRound({
          outbox: workspace.consumerRuntime.outbox,
          subscription: {
            subscription_id: "sub_harness_p0",
            endpoint_url: receiver.url,
            secret: "whsec_harness_p0_000000001",
            event_type_prefixes: [],
          },
        });
        if (roundReport.processedCount === 0) break;
        delivered += roundReport.processedCount;
      }
      // 每个事件恰一次投递（apply-once；无重复效应）。
      assert.equal(effects.length, delivered);
      assert.equal(new Set(effects).size, effects.length, "no delivery applied twice");
      assert.ok(delivered >= 5, `full lifecycle event stream delivered (got ${delivered})`);
      assert.ok(effects.some((effect) => effect.includes("EscalationCreated")));
    } finally {
      await receiver.stop();
    }

    // 7) 稳定 ID 追踪：请求 → 事件因果链 → 支付操作引用（真实 outbox 事件）。
    const correlationId = escalationEvents[0]?.correlation_id ?? "";
    assert.ok(correlationId.length > 0);
    const trace = buildStableIdTrace({
      events: escalationEvents,
      payment_references: [
        { correlation_id: correlationId, payment_operation_id: "pop_harness_p0_1", settled: true },
      ],
    });
    assert.equal(trace.webhooks_can_trace, true);
    assert.ok(trace.traces.length >= 1, "one trace per command correlation (request-scoped)");
    // 全部 trace 的事件并集 = 该 escalation 的完整事件流（稳定聚合 ID 串起）。
    const tracedEvents = trace.traces.reduce(
      (sum, traceRecord) => sum + traceRecord.events.length,
      0,
    );
    assert.equal(tracedEvents, escalationEvents.length);
    // 根 trace（包含 EscalationCreated 的那条）携带支付操作引用。
    const rootTrace = trace.traces.find((traceRecord) =>
      traceRecord.events.some((entry) => entry.event_type === "EscalationCreated"),
    );
    assert.ok(rootTrace !== undefined);
    assert.equal(rootTrace.payment_operations.length, 1);
    assert.equal(rootTrace.payment_operations[0]?.payment_operation_id, "pop_harness_p0_1");
    assert.equal(rootTrace.payment_operations[0]?.settled, true);
    // 稳定 ID 唯一性：event_id 集合无重复；支付操作恰一个。
    assert.equal(new Set(trace.event_ids).size, trace.event_ids.length);
    assert.deepEqual([...trace.payment_operation_ids], ["pop_harness_p0_1"]);

    // 8) 基线材料自证（baseline FAIL 存在 —— 干预归因成立）。
    assert.equal(baselineFailingRuns()[0]?.verdict.kind, "FAIL");
  } finally {
    await api.stop();
    workspace.cleanup();
  }
});
