import type { OutboxPort } from "@arena/contracts";
import {
  serializeWebhookPayload,
  webhookDeliveryHeaders,
  type WebhookDeliveryPayload,
} from "./webhook-signer.js";

/**
 * AR2-011 — 签名 webhook 投递器（issue #13）。
 *
 * 持久重试语义（消费 AR2-005 冻结 OutboxPort —— 事务性 outbox，事件
 * 只在权威状态事务提交后可见，投递永不丢失）：
 * - fetchDue 取到期未投递消息 → 签名 → POST 到订阅端点；
 * - 2xx = 确认 → markDispatched（终态）；否则 markFailed(attempts+1，
 *   指数退避 next_attempt_at) —— 永不丢消息、永不静默成功；
 * - 重试安全：同一 outbox 行重试携带相同 delivery_id + attempt+1；
 *   接收端按 delivery_id 去重（apply-once）→ 重试无重复效应；
 * - 订阅过滤（event_type 前缀白名单）在派发前判定 —— 不匹配 = 跳过
 *   （markDispatched：该订阅对此事件无投递义务），绝不静默丢弃到黑洞。
 */

export interface WebhookSubscription {
  subscription_id: string;
  endpoint_url: string;
  secret: string;
  /** 事件类型前缀白名单（空 = 全部）。 */
  event_type_prefixes: readonly string[];
}

export interface WebhookDispatcherOptions {
  outbox: OutboxPort;
  subscription: WebhookSubscription;
  fetchImpl?: typeof fetch;
  /** 指数退避：base * 2^(attempts) 上限 cap（毫秒）。 */
  backoffBaseMs?: number;
  backoffCapMs?: number;
  now?: () => string;
  nowSeconds?: () => number;
}

export type WebhookDeliveryAttempt =
  | { kind: "DELIVERED"; outbox_id: string; delivery_id: string; attempt: number; status: number }
  | { kind: "FAILED"; outbox_id: string; delivery_id: string; attempt: number; retryInMs: number }
  | { kind: "SKIPPED"; outbox_id: string; delivery_id: string; reason: "event_filter" };

export interface WebhookDispatchReport {
  processed: readonly WebhookDeliveryAttempt[];
  /** 本轮处理条数（= limit 时队列可能仍有到期消息 —— 调用方再驱动一轮）。 */
  processedCount: number;
}

/** 一次投递循环（幂等可重入 —— 调用方按节奏驱动，如 cron/job worker）。 */
export async function dispatchWebhookRound(
  options: WebhookDispatcherOptions,
  limit = 16,
): Promise<WebhookDispatchReport> {
  const now = options.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
  const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const doFetch = options.fetchImpl ?? fetch;
  const base = options.backoffBaseMs ?? 1000;
  const cap = options.backoffCapMs ?? 60_000;
  const messages = await options.outbox.fetchDue(limit, now());
  const processed: WebhookDeliveryAttempt[] = [];
  for (const message of messages) {
    const deliveryId = webhookDeliveryId(message.outbox_id, options.subscription.subscription_id);
    const matched =
      options.subscription.event_type_prefixes.length === 0 ||
      options.subscription.event_type_prefixes.some((prefix) =>
        message.event.event_type.startsWith(prefix),
      );
    if (!matched) {
      await options.outbox.markDispatched(message.outbox_id, now());
      processed.push({
        kind: "SKIPPED",
        outbox_id: message.outbox_id,
        delivery_id: deliveryId,
        reason: "event_filter",
      });
      continue;
    }
    const attempt = message.attempts + 1;
    const payload: WebhookDeliveryPayload = {
      delivery_id: deliveryId,
      event_id: message.event.event_id,
      attempt,
      event_type: message.event.event_type,
      occurred_at: message.event.occurred_at,
      event: message.event,
    };
    const rawBody = serializeWebhookPayload(payload);
    const headers = webhookDeliveryHeaders({
      secret: options.subscription.secret,
      rawBody,
      timestampSeconds: nowSeconds(),
      deliveryId,
      attempt,
    });
    let status: number | null = null;
    try {
      const response = await doFetch(options.subscription.endpoint_url, {
        method: "POST",
        headers,
        body: rawBody,
      });
      status = response.status;
    } catch {
      status = null;
    }
    if (status !== null && status >= 200 && status < 300) {
      await options.outbox.markDispatched(message.outbox_id, now());
      processed.push({
        kind: "DELIVERED",
        outbox_id: message.outbox_id,
        delivery_id: deliveryId,
        attempt,
        status,
      });
    } else {
      const retryInMs = Math.min(base * 2 ** message.attempts, cap);
      await options.outbox.markFailed(
        message.outbox_id,
        new Date(Date.parse(now()) + retryInMs).toISOString().replace(/\.\d{3}Z$/, "Z"),
      );
      processed.push({
        kind: "FAILED",
        outbox_id: message.outbox_id,
        delivery_id: deliveryId,
        attempt,
        retryInMs,
      });
    }
  }
  return { processed, processedCount: messages.length };
}

function webhookDeliveryId(outboxId: string, subscriptionId: string): string {
  return `whd_${subscriptionId}_${outboxId}`;
}
