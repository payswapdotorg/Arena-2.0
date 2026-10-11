import {
  eventEnvelopeSchema,
  type EventEnvelope,
  type OutboxMessage,
  type OutboxPort,
} from "@arena/contracts";

/** 构造 schema 合法的 EventEnvelope（证明夹具本身过冻结校验）。 */
export function testEventEnvelope(
  eventId: string,
  eventType: string,
  occurredAt = "2026-10-11T00:00:00Z",
): EventEnvelope {
  const candidate = {
    event_id: eventId,
    schema_version: "ES2.0-EV1",
    tenant_id: "tnt_00000001",
    aggregate: { type: "escalation", id: "esc_00000001", version: 1 },
    event_type: eventType,
    occurred_at: occurredAt,
    recorded_at: occurredAt,
    actor: { type: "requester", id: "usr_00000001" },
    correlation_id: "cor_00000001",
    causation_id: null,
    request_id: null,
    policy_version: "PVP1.0",
    payload: { schema_id: "sch_00000001", redaction_class: "tenant" },
    immutable: true,
    correction: null,
  };
  return eventEnvelopeSchema.parse(candidate);
}

/** 内存 OutboxPort 假件（可控时钟 —— 单测重试/退避路径）。 */
export class InMemoryOutbox implements OutboxPort {
  private rows: Array<{
    outbox_id: string;
    event: EventEnvelope;
    delivery_identity: string;
    attempts: number;
    next_attempt_at: string;
    dispatched_at: string | null;
  }> = [];
  private sequence = 0;

  async enqueue(events: readonly EventEnvelope[]): Promise<void> {
    for (const event of events) {
      this.sequence += 1;
      this.rows.push({
        outbox_id: `obx_${String(this.sequence).padStart(8, "0")}`,
        event,
        delivery_identity: `delivery:${this.sequence}`,
        attempts: 0,
        next_attempt_at: "2026-10-11T00:00:00Z",
        dispatched_at: null,
      });
    }
  }

  async fetchDue(limit: number, now: string): Promise<OutboxMessage[]> {
    return this.rows
      .filter((row) => row.dispatched_at === null && row.next_attempt_at <= now)
      .sort((a, b) => (a.next_attempt_at < b.next_attempt_at ? -1 : 1))
      .slice(0, limit)
      .map((row) => ({
        outbox_id: row.outbox_id,
        event: row.event,
        delivery_identity: row.delivery_identity,
        attempts: row.attempts,
        next_attempt_at: row.next_attempt_at,
      }));
  }

  async markDispatched(outbox_id: string, delivered_at: string): Promise<void> {
    const row = this.rows.find((candidate) => candidate.outbox_id === outbox_id);
    if (row !== undefined) row.dispatched_at = delivered_at;
  }

  async markFailed(outbox_id: string, next_attempt_at: string): Promise<void> {
    const row = this.rows.find((candidate) => candidate.outbox_id === outbox_id);
    if (row !== undefined) {
      row.attempts += 1;
      row.next_attempt_at = next_attempt_at;
    }
  }

  /** 测试观察口（非端口契约）。 */
  snapshot(): readonly {
    outbox_id: string;
    attempts: number;
    dispatched_at: string | null;
    next_attempt_at: string;
  }[] {
    return this.rows.map((row) => ({
      outbox_id: row.outbox_id,
      attempts: row.attempts,
      dispatched_at: row.dispatched_at,
      next_attempt_at: row.next_attempt_at,
    }));
  }
}

/** 可编排 fetch 假件（按调用序返回状态/Response/抛网络错误）。 */
export function scriptedFetch(
  script: ReadonlyArray<number | "network-error" | Response>,
): typeof fetch & {
  calls: Array<{ url: string; body: unknown; headers: Record<string, string> }>;
} {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  let index = 0;
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: init?.body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const step = script[index] ?? 200;
    index += 1;
    if (step === "network-error") throw new Error("scripted network failure");
    if (step instanceof Response) return step;
    return new Response(JSON.stringify({ scripted: true }), { status: step });
  }) as typeof fetch & { calls: typeof calls };
  fake.calls = calls;
  return fake;
}
