import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { verifyWebhookSignature, type WebhookDeliveryPayload } from "./webhook-signer.js";

/**
 * AR2-011 — webhook 接收端（issue #13）：验签 + apply-once 去重。
 *
 * - 验签在解析正文之前用 EXACT 原始字节（先读全文 → verify → 再 parse）；
 * - 去重键 = delivery_id（同一 outbox 行的所有重试携带同一 delivery_id，
 *   attempt 递增）→ 重试被确认但绝不二次施加效应；
 * - 效应函数 apply() 只对首次 APPLIED 调用 —— DUPLICATE 路径零调用；
 * - 验签失败 → 401（BAD_SIGNATURE/STALE_TIMESTAMP）或 400（MALFORMED/
 *   WRONG_SCHEME）—— 发送端将其视为失败并按退避重试（永不丢失）。
 */

export type WebhookReceiveVerdict =
  | { kind: "APPLIED"; delivery_id: string; event_id: string; attempt: number }
  | { kind: "DUPLICATE"; delivery_id: string; event_id: string; attempt: number }
  | { kind: "REJECTED"; delivery_id: string | null; reason: string };

export interface WebhookDedupeStore {
  /** 返回 true = 首见（调用方随后施加效应）；false = 已处理。 */
  markProcessed(deliveryId: string): boolean;
}

export class InMemoryWebhookDedupeStore implements WebhookDedupeStore {
  private readonly seen = new Set<string>();
  markProcessed(deliveryId: string): boolean {
    if (this.seen.has(deliveryId)) return false;
    this.seen.add(deliveryId);
    return true;
  }
}

export interface WebhookReceiverOptions {
  secret: string;
  dedupe: WebhookDedupeStore;
  /** 效应函数：只在首次 APPLIED 时调用一次。 */
  apply: (payload: WebhookDeliveryPayload) => void;
  nowSeconds?: () => number;
  toleranceSeconds?: number;
  port?: number;
  host?: string;
  /** 确认策略（默认恒 200）—— 「丢确认」演示/测试注入 500 模拟 ack 丢失。 */
  ackStatus?: (verdict: WebhookReceiveVerdict) => number;
}

export interface WebhookReceiverHandle {
  server: Server;
  url: string;
  verdicts: readonly WebhookReceiveVerdict[];
  stop(): Promise<void>;
}

/** 验签 + 去重核（可直接组合进任意 HTTP 服务器的请求处理）。 */
export async function handleWebhookDelivery(
  request: IncomingMessage,
  response: ServerResponse,
  options: WebhookReceiverOptions,
): Promise<WebhookReceiveVerdict> {
  const ackOf = (verdict: WebhookReceiveVerdict): number =>
    options.ackStatus === undefined ? 200 : options.ackStatus(verdict);
  const rawBody = await readRawBody(request);
  const verdict = verifyWebhookSignature({
    header: request.headers["x-arena-signature"] as string | undefined | null,
    rawBody,
    secret: options.secret,
    nowSeconds: options.nowSeconds?.() ?? Math.floor(Date.now() / 1000),
    toleranceSeconds: options.toleranceSeconds,
  });
  if (verdict.kind !== "VALID") {
    respond(
      response,
      verdict.kind === "BAD_SIGNATURE" || verdict.kind === "STALE_TIMESTAMP" ? 401 : 400,
      { code: "ARENA_WEBHOOK_SIGNATURE_REJECTED", reason: verdict.kind },
    );
    return { kind: "REJECTED", delivery_id: null, reason: verdict.kind };
  }
  let payload: WebhookDeliveryPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookDeliveryPayload;
  } catch {
    respond(response, 400, { code: "ARENA_WEBHOOK_PAYLOAD_INVALID", reason: "MALFORMED_JSON" });
    return { kind: "REJECTED", delivery_id: null, reason: "MALFORMED_JSON" };
  }
  if (typeof payload.delivery_id !== "string" || typeof payload.event_id !== "string") {
    respond(response, 400, { code: "ARENA_WEBHOOK_PAYLOAD_INVALID", reason: "MISSING_IDENTITY" });
    return { kind: "REJECTED", delivery_id: null, reason: "MISSING_IDENTITY" };
  }
  if (
    payload.delivery_id !== ((request.headers["x-arena-webhook-id"] as string | undefined) ?? "")
  ) {
    respond(response, 400, {
      code: "ARENA_WEBHOOK_PAYLOAD_INVALID",
      reason: "DELIVERY_ID_MISMATCH",
    });
    return { kind: "REJECTED", delivery_id: payload.delivery_id, reason: "DELIVERY_ID_MISMATCH" };
  }
  const first = options.dedupe.markProcessed(payload.delivery_id);
  if (!first) {
    respond(
      response,
      ackOf({
        kind: "DUPLICATE",
        delivery_id: payload.delivery_id,
        event_id: payload.event_id,
        attempt: payload.attempt,
      }),
      {
        received: true,
        duplicate: true,
        delivery_id: payload.delivery_id,
      },
    );
    return {
      kind: "DUPLICATE",
      delivery_id: payload.delivery_id,
      event_id: payload.event_id,
      attempt: payload.attempt,
    };
  }
  const applied: WebhookReceiveVerdict = {
    kind: "APPLIED",
    delivery_id: payload.delivery_id,
    event_id: payload.event_id,
    attempt: payload.attempt,
  };
  options.apply(payload);
  respond(response, ackOf(applied), {
    received: true,
    duplicate: false,
    delivery_id: payload.delivery_id,
  });
  return applied;
}

/** 启动一个真实 HTTP 接收端（node:http —— E2E 与 generic example 使用）。 */
export async function startWebhookReceiver(
  options: WebhookReceiverOptions,
): Promise<WebhookReceiverHandle> {
  const verdicts: WebhookReceiveVerdict[] = [];
  const server = createServer((request, response) => {
    void handleWebhookDelivery(request, response, options).then((verdict) => {
      verdicts.push(verdict);
    });
  });
  const port = options.port ?? 0;
  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((accept) => {
    server.listen(port, host, () => accept());
  });
  const address = server.address() as { port: number };
  return {
    server,
    url: `http://${host}:${address.port}/webhook`,
    verdicts,
    stop: () =>
      new Promise<void>((accept) => {
        server.closeAllConnections?.();
        server.close(() => accept());
      }),
  };
}

function readRawBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (chunks.reduce((sum, c) => sum + c.length, 0) > 5 * 1024 * 1024) {
        reject(new Error("body too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
