# @arena/sdk

AR2-011 — typed SDK, MCP facade, signed webhooks and generic integration (issue #13).

Adapters only (`no alternate domain logic`): every operation goes through the frozen
CF1.0 API edge (`@arena/api`); webhook delivery consumes the frozen AR2-005
transactional `OutboxPort`. The server remains the sole authority for validation,
state transitions and tenant derivation.

## SDK quickstart

```ts
import { ArenaSdkClient, sdkQuickstart } from "@arena/sdk";

const client = new ArenaSdkClient({ baseUrl: "http://127.0.0.1:3901" });
const readiness = await client.readiness(); // GET /readyz — composition root first

const report = await sdkQuickstart(
  { baseUrl: "http://127.0.0.1:3901" },
  request, // CF1.0 EscalationRequest (frozen-mirror validated client-side, server stays authoritative)
  { bearerToken: "demo-token-requester-alpha" },
);
// report.submit.kind === "CREATED" | "REPLAYED" | "REJECTED" | "CONFLICT" | ...
// report.projection — server-canonical status/version/updated_at
```

Idempotency: `caller_idempotency_key` travels as `x-idempotency-key`; same key +
same digest → `REPLAYED` (never a second creation); same key + different digest →
typed `CONFLICT` (fail-closed). Authorization is the Bearer token only — tenant
context is always server-derived; no tenant/lens/role ever appears in a request path.

## MCP facade

JSON-RPC 2.0 over stdio (newline-delimited). Every tool call goes through the same
public API URL and the same authorization — the facade never bypasses the auth
adapter or invents use cases.

```sh
ARENA_SDK_BASE_URL=http://127.0.0.1:3901 \
ARENA_SDK_BEARER=demo-token-requester-alpha \
  tsx packages/arena-sdk/src/mcp-main.ts
```

Tools: `arena_submit_escalation`, `arena_get_escalation`, `arena_list_escalations`,
`arena_get_timeline`, `arena_escalation_command`. Typed outcomes are serialized as
MCP text content with `isError` for legible failures.

## Signed webhooks

- Scheme: `X-Arena-Signature: t=<unix_seconds>,v1=<hmac-sha256(secret, "<t>.<raw body>")>`
  (timing-safe compare, timestamp tolerance window — stale timestamps are rejected).
- Delivery: `dispatchWebhookRound` consumes the durable outbox (`fetchDue` → sign →
  POST → 2xx `markDispatched`, else `markFailed` + exponential backoff — messages
  are never lost). Retries of one outbox row carry the same `delivery_id` with
  `attempt` incremented.
- Receiver: `startWebhookReceiver` / `handleWebhookDelivery` verify the signature
  over the exact raw bytes, then apply-once by `delivery_id` — a retry after a lost
  ack is acknowledged as `DUPLICATE` and never re-applies the effect.

## Generic example

`runGenericExample` wires the whole story with domain-agnostic material
(data-operations shape, no Epoch types): SDK submit over a real URL → signed
webhook from the transactional outbox → receiver verify → apply-once → lost-ack
retry → `DUPLICATE`. See `test/e2e-real-integration.test.ts` for the real-process
acceptance run.

## Disclosures

DEMO auth registry, test-mode signature material — production key management and
provider wiring are later work-order adapters (see `src/disclosures.ts`).
