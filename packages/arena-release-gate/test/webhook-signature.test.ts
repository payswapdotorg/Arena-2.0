import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryWebhookDedupeStore,
  serializeWebhookPayload,
  signWebhookDelivery,
  startWebhookReceiver,
  webhookDeliveryHeaders,
  type WebhookDeliveryPayload,
} from "@arena/sdk";

/**
 * AR2-015 — 对抗剖面 2（issue #17：real HTTP webhook signature matrix）：
 * 真实 HTTP 接收端上的签名/时间戳/重放/重复投递矩阵。
 *
 * 断言（G2 门行为）：
 * - 合法签名投递 ⇒ APPLIED（效应恰一次）；
 * - 伪造：篡改 body / 错误 secret / 旧 header 配新 body ⇒ BAD_SIGNATURE 401；
 * - 过期时间戳（超容差）⇒ STALE_TIMESTAMP 401；
 * - 错误 scheme（v2）/ 畸形 header ⇒ 400；
 * - 逐字重放与 attempt+1 重试（同 delivery_id）⇒ DUPLICATE，效应仍恰一次
 *   （apply-once：接收端按 delivery_id 去重）；
 * - header 与 payload 的 delivery_id 不一致 ⇒ DELIVERY_ID_MISMATCH 400。
 */

const SECRET = "whsec_release_gate_matrix";

function payload(deliveryId: string, attempt: number): WebhookDeliveryPayload {
  return {
    delivery_id: deliveryId,
    event_id: "evt_00000001",
    attempt,
    event: {
      type: "escalation.state_transitioned",
      aggregate_id: "esc_00000001",
      to: "ASSIGNED",
    },
  } as WebhookDeliveryPayload;
}

async function post(
  url: string,
  headers: Record<string, string>,
  rawBody: string,
): Promise<{ status: number; body: string; json: Record<string, unknown> }> {
  const response = await fetch(url, { method: "POST", headers, body: rawBody });
  const body = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(body) as Record<string, unknown>;
  } catch {
    json = { raw: body };
  }
  return { status: response.status, body, json };
}

test("webhook signature matrix: forged / stale / replay / duplicate — apply exactly once over real HTTP", async () => {
  const applied: string[] = [];
  const receiver = await startWebhookReceiver({
    secret: SECRET,
    dedupe: new InMemoryWebhookDedupeStore(),
    apply: (p) => {
      applied.push(p.delivery_id);
    },
  });
  try {
    const now = Math.floor(Date.now() / 1000);

    // 1) 合法投递 ⇒ APPLIED，效应恰一次。
    const raw = serializeWebhookPayload(payload("dlv_00000001", 1));
    const validHeaders = webhookDeliveryHeaders({
      secret: SECRET,
      rawBody: raw,
      timestampSeconds: now,
      deliveryId: "dlv_00000001",
      attempt: 1,
    });
    const valid = await post(receiver.url, validHeaders, raw);
    assert.equal(valid.status, 200);
    assert.equal(valid.json.duplicate, false);
    assert.deepEqual(applied, ["dlv_00000001"]);

    // 2) 篡改 body（签名后改内容）⇒ BAD_SIGNATURE 401，无新效应。
    const tampered = raw.replace("ASSIGNED", "SETTLED");
    const tamperedResponse = await post(receiver.url, validHeaders, tampered);
    assert.equal(tamperedResponse.status, 401);
    assert.equal(tamperedResponse.json.reason, "BAD_SIGNATURE");
    assert.deepEqual(applied, ["dlv_00000001"]);

    // 3) 错误 secret 签名 ⇒ BAD_SIGNATURE 401。
    const wrongSecretHeaders = webhookDeliveryHeaders({
      secret: "whsec_attacker_guess",
      rawBody: raw,
      timestampSeconds: now,
      deliveryId: "dlv_00000002",
      attempt: 1,
    });
    const wrongSecret = await post(receiver.url, wrongSecretHeaders, raw);
    assert.equal(wrongSecret.status, 401);
    assert.equal(wrongSecret.json.reason, "BAD_SIGNATURE");

    // 4) 旧 header 配新 body（重放签名到不同事件）⇒ BAD_SIGNATURE。
    const otherRaw = serializeWebhookPayload(payload("dlv_00000003", 1));
    const replayToOther = await post(receiver.url, validHeaders, otherRaw);
    assert.equal(replayToOther.status, 401);
    assert.equal(replayToOther.json.reason, "BAD_SIGNATURE");

    // 5) 过期时间戳（容差 + 60s）⇒ STALE_TIMESTAMP 401。
    const staleHeaders = webhookDeliveryHeaders({
      secret: SECRET,
      rawBody: raw,
      timestampSeconds: now - 300 - 60,
      deliveryId: "dlv_00000004",
      attempt: 1,
    });
    const stale = await post(receiver.url, staleHeaders, raw);
    assert.equal(stale.status, 401);
    assert.equal(stale.json.reason, "STALE_TIMESTAMP");

    // 6) 错误 scheme（v2）⇒ 400 WRONG_SCHEME。
    const badSchemeHeader = signWebhookDelivery(SECRET, raw, now).replace("v1=", "v2=");
    const badScheme = await post(
      receiver.url,
      { ...validHeaders, "x-arena-signature": badSchemeHeader },
      raw,
    );
    assert.equal(badScheme.status, 400);
    assert.equal(badScheme.json.reason, "WRONG_SCHEME");

    // 7) 畸形 header ⇒ 400 MALFORMED_HEADER。
    const malformed = await post(
      receiver.url,
      { ...validHeaders, "x-arena-signature": "garbage-not-a-signature" },
      raw,
    );
    assert.equal(malformed.status, 400);
    assert.equal(malformed.json.reason, "MALFORMED_HEADER");

    // 8) 逐字重放（同 delivery_id + 同 header）⇒ DUPLICATE 200，效应仍恰一次。
    const replayed = await post(receiver.url, validHeaders, raw);
    assert.equal(replayed.status, 200);
    assert.equal(replayed.json.duplicate, true);
    assert.deepEqual(applied, ["dlv_00000001"]);

    // 9) attempt+1 重试（同 delivery_id、重新签名）⇒ DUPLICATE，效应仍恰一次
    //    （重试安全：接收端按 delivery_id 去重 —— apply-once）。
    const retryHeaders = webhookDeliveryHeaders({
      secret: SECRET,
      rawBody: raw,
      timestampSeconds: now,
      deliveryId: "dlv_00000001",
      attempt: 2,
    });
    const retry = await post(receiver.url, retryHeaders, raw);
    assert.equal(retry.status, 200);
    assert.equal(retry.json.duplicate, true);
    assert.deepEqual(applied, ["dlv_00000001"]);

    // 10) header 与 payload 的 delivery_id 不一致 ⇒ DELIVERY_ID_MISMATCH 400。
    const mismatchRaw = serializeWebhookPayload(payload("dlv_00000099", 1));
    const mismatchHeaders = webhookDeliveryHeaders({
      secret: SECRET,
      rawBody: mismatchRaw,
      timestampSeconds: now,
      deliveryId: "dlv_00000005",
      attempt: 1,
    });
    const mismatch = await post(receiver.url, mismatchHeaders, mismatchRaw);
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.json.reason, "DELIVERY_ID_MISMATCH");
    assert.deepEqual(applied, ["dlv_00000001"]);
  } finally {
    await receiver.stop();
  }
});
