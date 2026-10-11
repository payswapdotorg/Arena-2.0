/**
 * AR2-011 披露常量（诚实披露，绝不宣称未落地的能力）。
 */

export const SDK_DISCLOSURE =
  "Arena typed SDK: transport adapter over the frozen CF1.0 API edge only — " +
  "no alternate domain logic; the server remains the sole authority for validation, " +
  "state transitions and tenant derivation";

export const MCP_FACADE_DISCLOSURE =
  "MCP facade: JSON-RPC 2.0 over stdio; every tool call goes through the same " +
  "public API URL and the same authorization (Bearer token -> server-derived tenant " +
  "context) — the facade never bypasses the auth adapter or invents use cases";

export const WEBHOOK_DISCLOSURE =
  "Signed webhooks: HMAC-SHA256 t=/v1= scheme over the exact request body, " +
  "timing-safe comparison, timestamp tolerance window; delivery consumes the AR2-005 " +
  "transactional outbox (unique delivery identity, attempts, retry schedule — never lost); " +
  "receivers deduplicate by delivery_id so retries have no duplicate effects. " +
  "Signature keys are demo/test material until a production key registry WO lands";

export const GENERIC_EXAMPLE_DISCLOSURE =
  "Generic AI application example: domain-agnostic task material (data-operations " +
  "shape), independent of Epoch/ZCode types; demonstrates SDK submit -> signed webhook " +
  "receive -> verify -> apply-once with retry dedupe";

/** 测试模式标记（与 arena-payment/arena-capsule 的冻结纪律一致）。 */
export const SDK_TEST_MODE_DISCLOSURE =
  "SDK/MCP/webhook surface runs in test mode against the demo token registry; " +
  "production key management and provider wiring are later work-order adapters";
