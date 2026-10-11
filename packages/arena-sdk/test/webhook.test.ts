import assert from "node:assert/strict";
import test from "node:test";
import {
  signWebhookDelivery,
  verifyWebhookSignature,
  webhookDeliveryHeaders,
  dispatchWebhookRound,
  startWebhookReceiver,
  InMemoryWebhookDedupeStore,
} from "../src/contract.js";
import { InMemoryOutbox, scriptedFetch, testEventEnvelope } from "./helpers.js";

/**
 * AR2-011 — webhook 单元验收（issue #13）：
 * 签名矩阵（篡改正文/过期时间戳/畸形头/错 scheme/错密钥全部类型化拒绝）；
 * 投递器重试语义（非 2xx 与网络错误 → markFailed + 指数退避，消息永不
 * 丢失；2xx → markDispatched 终态）；重试携带同一 delivery_id +
 * attempt 递增；接收端 apply-once（重试 → DUPLICATE，效应恰好一次）。
 */

const NOW = 1_800_000_000;
const SECRET = "whsec_unit_00000001";

test("signature verifies over exact bytes and rejects every tamper vector", () => {
  const rawBody = JSON.stringify({ delivery_id: "whd_sub_1_obx_1", event_id: "evt_00000001" });
  const header = signWebhookDelivery(SECRET, rawBody, NOW);
  assert.match(header, /^t=\d+,v1=[a-f0-9]{64}$/);

  assert.equal(
    verifyWebhookSignature({ header, rawBody, secret: SECRET, nowSeconds: NOW }).kind,
    "VALID",
  );

  // 篡改正文。
  assert.equal(
    verifyWebhookSignature({
      header,
      rawBody: rawBody.replace("1", "2"),
      secret: SECRET,
      nowSeconds: NOW,
    }).kind,
    "BAD_SIGNATURE",
  );
  // 错密钥。
  assert.equal(
    verifyWebhookSignature({ header, rawBody, secret: "whsec_other_000001", nowSeconds: NOW }).kind,
    "BAD_SIGNATURE",
  );
  // 过期时间戳（超出容差 —— 重放窗口）。
  assert.equal(
    verifyWebhookSignature({ header, rawBody, secret: SECRET, nowSeconds: NOW + 3600 }).kind,
    "STALE_TIMESTAMP",
  );
  // 畸形头 / 缺头 / 未知 scheme。
  assert.equal(
    verifyWebhookSignature({ header: "garbage", rawBody, secret: SECRET, nowSeconds: NOW }).kind,
    "MALFORMED_HEADER",
  );
  assert.equal(
    verifyWebhookSignature({ header: null, rawBody, secret: SECRET, nowSeconds: NOW }).kind,
    "MALFORMED_HEADER",
  );
  assert.equal(
    verifyWebhookSignature({
      header: `t=${NOW},v2=deadbeef`,
      rawBody,
      secret: SECRET,
      nowSeconds: NOW,
    }).kind,
    "WRONG_SCHEME",
  );
  // 自定义容差生效。
  assert.equal(
    verifyWebhookSignature({
      header: signWebhookDelivery(SECRET, rawBody, NOW - 60),
      rawBody,
      secret: SECRET,
      nowSeconds: NOW,
      toleranceSeconds: 30,
    }).kind,
    "STALE_TIMESTAMP",
  );
});

test("delivery headers carry identity, attempt and signature", () => {
  const rawBody = "{}";
  const headers = webhookDeliveryHeaders({
    secret: SECRET,
    rawBody,
    timestampSeconds: NOW,
    deliveryId: "whd_sub_1_obx_1",
    attempt: 3,
  });
  assert.equal(headers["x-arena-webhook-id"], "whd_sub_1_obx_1");
  assert.equal(headers["x-arena-attempt"], "3");
  assert.match(headers["x-arena-signature"], /^t=/);
});

test("dispatcher: 2xx acks terminally (markDispatched, never redelivered)", async () => {
  const outbox = new InMemoryOutbox();
  await outbox.enqueue([testEventEnvelope("evt_00000001", "EscalationCreated")]);
  const fetchImpl = scriptedFetch([200]);
  const report = await dispatchWebhookRound({
    outbox,
    subscription: {
      subscription_id: "sub_1",
      endpoint_url: "http://receiver.local/hook",
      secret: SECRET,
      event_type_prefixes: [],
    },
    fetchImpl,
    now: () => "2026-10-11T00:00:30Z",
    nowSeconds: () => NOW,
  });
  assert.equal(report.processedCount, 1);
  assert.equal(report.processed[0]?.kind, "DELIVERED");
  const call = fetchImpl.calls[0];
  assert.ok(call !== undefined);
  assert.equal(call.url, "http://receiver.local/hook");
  const body = JSON.parse(String(call.body)) as {
    delivery_id: string;
    attempt: number;
    event_id: string;
  };
  assert.match(body.delivery_id, /^whd_sub_1_obx_/);
  assert.equal(body.attempt, 1);
  assert.equal(body.event_id, "evt_00000001");
  // 终态：再驱动一轮 —— 无到期消息。
  const again = await dispatchWebhookRound({
    outbox,
    subscription: {
      subscription_id: "sub_1",
      endpoint_url: "http://receiver.local/hook",
      secret: SECRET,
      event_type_prefixes: [],
    },
    fetchImpl,
    now: () => "2026-10-11T01:00:00Z",
    nowSeconds: () => NOW,
  });
  assert.equal(again.processedCount, 0);
});

test("dispatcher: non-2xx and network failures back off exponentially and never drop the message", async () => {
  const outbox = new InMemoryOutbox();
  await outbox.enqueue([testEventEnvelope("evt_00000002", "EscalationCreated")]);
  const fetchImpl = scriptedFetch([500, "network-error"]);
  const subscription = {
    subscription_id: "sub_1",
    endpoint_url: "http://receiver.local/hook",
    secret: SECRET,
    event_type_prefixes: [],
  };
  let clock = Date.parse("2026-10-11T00:00:00Z");
  const now = () => new Date(clock).toISOString().replace(/\.\d{3}Z$/, "Z");

  const first = await dispatchWebhookRound({
    outbox,
    subscription,
    fetchImpl,
    now,
    nowSeconds: () => NOW,
    backoffBaseMs: 1000,
  });
  assert.equal(first.processed[0]?.kind, "FAILED");
  if (first.processed[0]?.kind === "FAILED") {
    assert.equal(first.processed[0].retryInMs, 1000); // base * 2^0
    assert.equal(first.processed[0].attempt, 1);
  }

  // 退避未到 —— 不重试。
  clock += 500;
  const early = await dispatchWebhookRound({
    outbox,
    subscription,
    fetchImpl,
    now,
    nowSeconds: () => NOW,
  });
  assert.equal(early.processedCount, 0);

  // 退避到期 —— 重试（网络错误路径）→ 指数退避翻倍。
  clock += 600;
  const second = await dispatchWebhookRound({
    outbox,
    subscription,
    fetchImpl,
    now,
    nowSeconds: () => NOW,
    backoffBaseMs: 1000,
  });
  assert.equal(second.processed[0]?.kind, "FAILED");
  if (second.processed[0]?.kind === "FAILED") {
    assert.equal(second.processed[0].retryInMs, 2000); // base * 2^1
    assert.equal(second.processed[0].attempt, 2);
    assert.equal(
      second.processed[0].delivery_id,
      first.processed[0]?.kind === "FAILED" ? first.processed[0].delivery_id : "",
    );
  }

  // 消息仍在（未丢失）：第 3 次成功 → 终态。
  clock += 2100;
  const third = await dispatchWebhookRound({
    outbox,
    subscription,
    fetchImpl,
    now,
    nowSeconds: () => NOW,
  });
  assert.equal(third.processed[0]?.kind, "DELIVERED");
  const snapshot = outbox.snapshot()[0];
  assert.ok(snapshot !== undefined);
  assert.equal(snapshot.attempts, 2);
  assert.notEqual(snapshot.dispatched_at, null);
});

test("dispatcher: event-type filter skips non-matching events terminally (no silent black hole)", async () => {
  const outbox = new InMemoryOutbox();
  await outbox.enqueue([
    testEventEnvelope("evt_00000003", "EscalationCreated"),
    testEventEnvelope("evt_00000004", "AttemptStarted"),
  ]);
  const fetchImpl = scriptedFetch([200]);
  const report = await dispatchWebhookRound({
    outbox,
    subscription: {
      subscription_id: "sub_1",
      endpoint_url: "http://receiver.local/hook",
      secret: SECRET,
      event_type_prefixes: ["Attempt"],
    },
    fetchImpl,
    now: () => "2026-10-11T00:00:30Z",
    nowSeconds: () => NOW,
  });
  assert.equal(fetchImpl.calls.length, 1); // 只有 AttemptStarted 被投递
  const kinds = report.processed.map((attempt) => attempt.kind).sort();
  assert.deepEqual(kinds, ["DELIVERED", "SKIPPED"]);
});

test("receiver over real HTTP: signature + apply-once (lost-ack retry → DUPLICATE, one effect)", async () => {
  const effects: string[] = [];
  // 丢确认策略：APPLIED 回 500（效应已施加、确认丢失），DUPLICATE 回 200。
  const receiver = await startWebhookReceiver({
    secret: SECRET,
    dedupe: new InMemoryWebhookDedupeStore(),
    apply: (payload) => {
      effects.push(`applied:${payload.event_id}:${payload.event_type}`);
    },
    ackStatus: (verdict) => (verdict.kind === "APPLIED" ? 500 : 200),
    nowSeconds: () => NOW,
  });
  try {
    const payload = {
      delivery_id: "whd_sub_1_obx_00000009",
      event_id: "evt_00000009",
      attempt: 1,
      event_type: "EscalationCreated",
      occurred_at: "2026-10-11T00:00:00Z",
      event: { event_type: "EscalationCreated" },
    };
    const raw = JSON.stringify(payload);
    const headers = webhookDeliveryHeaders({
      secret: SECRET,
      rawBody: raw,
      timestampSeconds: NOW,
      deliveryId: payload.delivery_id,
      attempt: 1,
    });

    const first = await fetch(receiver.url, { method: "POST", headers, body: raw });
    assert.equal(first.status, 500); // 效应已施加，确认丢失
    assert.deepEqual(effects, [`applied:${payload.event_id}:EscalationCreated`]);

    // 重试：同一 delivery（attempt+1）—— 签名重新生成后仍验证通过。
    const retryHeaders = webhookDeliveryHeaders({
      secret: SECRET,
      rawBody: raw,
      timestampSeconds: NOW,
      deliveryId: payload.delivery_id,
      attempt: 2,
    });
    const retry = await fetch(receiver.url, { method: "POST", headers: retryHeaders, body: raw });
    assert.equal(retry.status, 200); // DUPLICATE 被确认 —— 不再施加
    const retryBody = (await retry.json()) as { duplicate: boolean };
    assert.equal(retryBody.duplicate, true);
    assert.deepEqual(effects, [`applied:${payload.event_id}:EscalationCreated`]); // 恰好一次

    assert.equal(receiver.verdicts[0]?.kind, "APPLIED");
    assert.equal(receiver.verdicts[1]?.kind, "DUPLICATE");

    // 伪造签名 → 401（验签 fail-closed）。
    const forged = await fetch(receiver.url, {
      method: "POST",
      headers: {
        ...headers,
        "x-arena-signature": `t=${NOW},v1=${"0".repeat(64)}`,
      },
      body: raw,
    });
    assert.equal(forged.status, 401);
    const forgedBody = (await forged.json()) as { reason: string };
    assert.equal(forgedBody.reason, "BAD_SIGNATURE");
  } finally {
    await receiver.stop();
  }
});
