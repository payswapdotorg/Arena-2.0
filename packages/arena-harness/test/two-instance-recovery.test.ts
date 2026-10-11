import assert from "node:assert/strict";
import test from "node:test";
import { createSqliteRuntime } from "@arena/persistence";
import { executeCommand } from "@arena/application";
import {
  ArenaSdkClient,
  buildGenericEscalationRequest,
  dispatchWebhookRound,
  InMemoryWebhookDedupeStore,
  startWebhookReceiver,
} from "@arena/sdk";
import { collectOutboxEvents } from "../src/contract.js";
import {
  ASSIGNMENT_FACTS,
  CANDIDATE_FACTS,
  ENVIRONMENT_FACTS,
  nowIso,
  openWorkspace,
  startRealApi,
} from "./support.js";

/**
 * AR2-012 — 验收剖面 D（issue #14）：双实例 + 崩溃/重启恢复。
 *
 * 两个真实 arena-api 进程共享同一 durable sqlite 文件（WAL 多连接拓扑
 * —— AR2-005 验收场景 3 的基础）：A 提交 → B 读到同一规范状态（跨进程
 * 可见）；A 被 SIGKILL（outage）→ 重启 → 状态完好（无丢失）→ outbox
 * 事件仍可投递且恰一次（无双重投递/双重支付）。
 */

const ALPHA = { bearerToken: "demo-token-requester-alpha" };

test("two API processes share durable state; SIGKILL outage loses nothing and double-delivers nothing", async () => {
  const workspace = openWorkspace("two");
  const apiA = await startRealApi(workspace.dbPath);
  try {
    // 1) A 提交（实例 1）。
    const clientA = new ArenaSdkClient({ baseUrl: apiA.baseUrl });
    const submitted = await clientA.submitEscalation(
      buildGenericEscalationRequest({
        title: "Survive the hard kill",
        outcome_description:
          "The escalation state and events survive a SIGKILL outage of one API instance.",
        output_schema_id: "sch_harness_two",
        caller_idempotency_key: "harness-two-1",
        client_application_id: "app_00000001",
      }),
      ALPHA,
    );
    assert.equal(submitted.kind, "CREATED");
    const escalationId = submitted.kind === "CREATED" ? submitted.escalation_id : "";

    // 2) 实例 B（同一 durable 文件）读到同一规范状态 —— 跨进程可见。
    const apiB = await startRealApi(workspace.dbPath);
    try {
      const clientB = new ArenaSdkClient({ baseUrl: apiB.baseUrl });
      const seenByB = await clientB.getEscalation(escalationId, ALPHA);
      assert.equal(seenByB.kind, "FOUND");
      if (seenByB.kind === "FOUND") {
        assert.equal(seenByB.projection.status, "CREATED");
        assert.equal(seenByB.projection.escalation_id, escalationId);
      }
      // B 也可以推进生命周期（同一状态机、同一持久层）。
      const offered = await clientB.escalationCommand(
        escalationId,
        "AmendEscalation",
        {
          pre_assignment_amendment: true,
        },
        ALPHA,
      );
      assert.equal(offered.kind, "ACCEPTED");

      // 3) 事件已在 outbox（投递前采集）。
      const eventsBefore = await collectOutboxEvents(workspace.consumerRuntime.outbox, nowIso());
      assert.ok(eventsBefore.length >= 2);

      // 4) outage：A 被 SIGKILL（进程内状态全丢 —— durable 层是唯一事实）。
      apiA.killHard();
      await new Promise((sleep) => setTimeout(sleep, 300));

      // 5) 重启 A（新进程、新端口、同一 durable 文件）→ 状态完好（无丢失）。
      const apiARestarted = await startRealApi(workspace.dbPath);
      try {
        const clientARestarted = new ArenaSdkClient({ baseUrl: apiARestarted.baseUrl });
        const seenByRestarted = await clientARestarted.getEscalation(escalationId, ALPHA);
        assert.equal(seenByRestarted.kind, "FOUND", "no state lost across SIGKILL + restart");
        if (seenByRestarted.kind === "FOUND") {
          assert.equal(seenByRestarted.projection.status, "CREATED");
          // 跨进程写入可见性：实例 B 的 AmendEscalation 事件出现在重启后
          // 实例 A 读到的服务端时间线里（规范状态由 durable 层唯一持有）。
          const timelineAfterRestart = await clientARestarted.getTimeline(escalationId, ALPHA);
          assert.equal(timelineAfterRestart.kind, "FOUND");
          if (timelineAfterRestart.kind === "FOUND") {
            assert.ok(
              timelineAfterRestart.events.some(
                (event) => event.event_type === "EscalationAmendEscalation",
              ),
              "amendment by instance B is visible to the restarted instance A",
            );
          }
        }

        // 6) 重启后继续推进（真实状态机在 durable 状态上工作）：系统触发器经
        //    编排侧运行时（同一 durable 库），公开命令经重启后的 API 进程。
        await executeCommand(workspace.consumerRuntime, {
          aggregate_type: "escalation",
          aggregate_id: escalationId,
          command: "SystemProposeOffer" as never,
          facts: { candidate_expert_matched: true },
          actor: { type: "system", id: "sys_00000001" },
          tenant_id: "tnt_00000001",
          request_id: null,
          correlation_id: "harness-two-post-restart",
        });
        const assigned = await clientARestarted.escalationCommand(
          escalationId,
          "AcceptOffer",
          {
            ...ASSIGNMENT_FACTS,
          },
          ALPHA,
        );
        assert.equal(assigned.kind, "ACCEPTED");
        if (assigned.kind === "ACCEPTED") assert.equal(assigned.to, "ASSIGNED");
        await clientARestarted.escalationCommand(
          escalationId,
          "StartAttempt",
          { ...ENVIRONMENT_FACTS },
          ALPHA,
        );
        const intervention = await clientARestarted.escalationCommand(
          escalationId,
          "SubmitIntervention",
          {
            ...CANDIDATE_FACTS,
          },
          ALPHA,
        );
        assert.equal(intervention.kind, "ACCEPTED");

        // 7) outbox 投递：崩溃前后的事件都恰一次（无丢失、无双重投递）。
        const effects: string[] = [];
        const receiver = await startWebhookReceiver({
          secret: "whsec_harness_two_000000001",
          dedupe: new InMemoryWebhookDedupeStore(),
          apply: (payload) => {
            effects.push(`${payload.event_id}:${payload.event_type}`);
          },
        });
        try {
          let delivered = 0;
          for (let round = 0; round < 10; round += 1) {
            const roundReport = await dispatchWebhookRound({
              outbox: workspace.consumerRuntime.outbox,
              subscription: {
                subscription_id: "sub_harness_two",
                endpoint_url: receiver.url,
                secret: "whsec_harness_two_000000001",
                event_type_prefixes: [],
              },
            });
            if (roundReport.processedCount === 0) break;
            delivered += roundReport.processedCount;
          }
          const allEvents = await collectOutboxEvents(
            workspace.consumerRuntime.outbox,
            new Date(Date.now() + 60_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
          );
          // 全部事件都已终态投递（重启后无残余到期）。
          assert.equal(
            allEvents.length,
            0,
            "every outbox event terminally dispatched after the outage",
          );
          // 每个事件恰一次：effects 无重复。
          assert.equal(new Set(effects).size, effects.length, "no event delivered twice");
          assert.equal(effects.length, delivered);
          assert.ok(
            delivered >= 5,
            `lifecycle events across the outage delivered (got ${delivered})`,
          );
          assert.ok(effects.some((effect) => effect.endsWith(":EscalationCreated")));
        } finally {
          await receiver.stop();
        }
      } finally {
        await apiARestarted.stop();
      }
    } finally {
      await apiB.stop();
    }
  } finally {
    workspace.cleanup();
  }
});

test("crash mid-flight leaves the durable aggregates consistent for a fresh connection", async () => {
  const workspace = openWorkspace("crash");
  const api = await startRealApi(workspace.dbPath);
  try {
    const client = new ArenaSdkClient({ baseUrl: api.baseUrl });
    const submitted = await client.submitEscalation(
      buildGenericEscalationRequest({
        title: "Consistent after hard kill",
        outcome_description:
          "A fresh sqlite connection sees the exact canonical state after the API process dies.",
        output_schema_id: "sch_harness_crash",
        caller_idempotency_key: "harness-crash-1",
        client_application_id: "app_00000001",
      }),
      ALPHA,
    );
    assert.equal(submitted.kind, "CREATED");
    const escalationId = submitted.kind === "CREATED" ? submitted.escalation_id : "";

    api.killHard();
    await new Promise((sleep) => setTimeout(sleep, 200));

    // 全新连接（无任何进程内缓存）：规范状态 + outbox 事件都完好。
    const fresh = createSqliteRuntime({ path: workspace.dbPath, busyTimeoutMs: 8000 });
    try {
      const stored = await fresh.aggregates.loadAggregate("escalation", escalationId);
      assert.notEqual(stored, null, "aggregate survives the hard kill");
      const due = await fresh.outbox.fetchDue(64, nowIso());
      assert.ok(due.length >= 1, "the EscalationCreated event is still due in the outbox");
      assert.ok(due.some((message) => message.event.event_type === "EscalationCreated"));
    } finally {
      fresh.close();
    }
  } finally {
    try {
      await api.stop();
    } catch {
      // already killed
    }
    workspace.cleanup();
  }
});
