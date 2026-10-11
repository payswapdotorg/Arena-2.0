import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * AR2-011 — webhook 签名（issue #13）。
 *
 * 方案（Stripe 风格的 t=/v1= 时间戳签名）：
 * - 签名覆盖 EXACT 请求字节：sig = HMAC-SHA256(secret, `${t}.${rawBody}`)；
 * - 头形如 `X-Arena-Signature: t=<unix_seconds>,v1=<hex>`；
 * - 验证：重算 + timingSafeEqual（常量时间 —— 不泄露前缀信息）；
 * - 时间戳容差（默认 300s）拒绝过期签名（重放窗口）；
 * - 未知 scheme / 多 v1 中无一匹配 / 篡改正文 → 类型化拒绝（fail-closed）。
 */

export const WEBHOOK_SIGNATURE_HEADER = "x-arena-signature" as const;
export const WEBHOOK_DELIVERY_HEADER = "x-arena-webhook-id" as const;
export const WEBHOOK_ATTEMPT_HEADER = "x-arena-attempt" as const;
export const WEBHOOK_SIGNATURE_SCHEME = "v1" as const;
export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;

export type WebhookSignatureVerdict =
  | { kind: "VALID"; timestamp: number }
  | { kind: "BAD_SIGNATURE" }
  | { kind: "STALE_TIMESTAMP"; timestamp: number }
  | { kind: "MALFORMED_HEADER" }
  | { kind: "WRONG_SCHEME" };

export interface WebhookSecret {
  keyId: string;
  secret: string;
}

/** 计算一个投递的签名字符串（t + v1）。 */
export function signWebhookDelivery(
  secret: string,
  rawBody: string,
  timestampSeconds: number,
): string {
  const t = String(timestampSeconds);
  const v1 = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

/** 组装投递头（签名 + 投递身份 + 尝试序号）。 */
export function webhookDeliveryHeaders(input: {
  secret: string;
  rawBody: string;
  timestampSeconds: number;
  deliveryId: string;
  attempt: number;
}): Record<string, string> {
  return {
    "content-type": "application/json",
    [WEBHOOK_DELIVERY_HEADER]: input.deliveryId,
    [WEBHOOK_ATTEMPT_HEADER]: String(input.attempt),
    [WEBHOOK_SIGNATURE_HEADER]: signWebhookDelivery(
      input.secret,
      input.rawBody,
      input.timestampSeconds,
    ),
  };
}

/** 验证一个投递的签名（常量时间比较 + 容差窗口）。 */
export function verifyWebhookSignature(input: {
  header: string | null | undefined;
  rawBody: string;
  secret: string;
  nowSeconds: number;
  toleranceSeconds?: number;
}): WebhookSignatureVerdict {
  if (input.header === null || input.header === undefined || input.header.length === 0) {
    return { kind: "MALFORMED_HEADER" };
  }
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of input.header.split(",")) {
    const trimmed = part.trim();
    const equals = trimmed.indexOf("=");
    if (equals <= 0) return { kind: "MALFORMED_HEADER" };
    const prefix = trimmed.slice(0, equals);
    const value = trimmed.slice(equals + 1);
    if (prefix === "t") {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) return { kind: "MALFORMED_HEADER" };
      timestamp = parsed;
    } else if (prefix === WEBHOOK_SIGNATURE_SCHEME) {
      signatures.push(value);
    } else {
      return { kind: "WRONG_SCHEME" };
    }
  }
  if (timestamp === null || signatures.length === 0) return { kind: "MALFORMED_HEADER" };
  const tolerance = input.toleranceSeconds ?? DEFAULT_SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(input.nowSeconds - timestamp) > tolerance) {
    return { kind: "STALE_TIMESTAMP", timestamp };
  }
  const expected = createHmac("sha256", input.secret)
    .update(`${String(timestamp)}.${input.rawBody}`)
    .digest("hex");
  for (const candidate of signatures) {
    if (
      candidate.length === expected.length &&
      timingSafeEqual(Buffer.from(candidate), Buffer.from(expected))
    ) {
      return { kind: "VALID", timestamp };
    }
  }
  return { kind: "BAD_SIGNATURE" };
}

/** 投递负载（正文即被签名的字节 —— 元数据随事件一起走，验证后可读）。 */
export interface WebhookDeliveryPayload {
  delivery_id: string;
  event_id: string;
  attempt: number;
  event_type: string;
  occurred_at: string;
  event: unknown;
}

export function serializeWebhookPayload(payload: WebhookDeliveryPayload): string {
  return JSON.stringify(payload);
}
