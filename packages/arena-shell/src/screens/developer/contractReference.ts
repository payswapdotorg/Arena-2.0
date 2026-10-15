/**
 * UIA-001 Lane C — 开发者门户契约参考视图模型（packet C2）。
 *
 * 冻结纪律：
 * - 类型化请求/结果契约参考从 **真实的冻结 zod schema** 运行时枚举
 *   （escalationRequestSchema.shape / eventEnvelopeSchema.shape /
 *   resultStatusSchema.options —— 绝不手抄第二份字段清单）；
 * - webhook 签名/投递语义从 CF1.0 的 IDEMPOTENCY_SEMANTICS 与投递偏好
 *   契约逐字呈现（apply-once / 重复 / 重放按冻结定义）；
 * - @arena/sdk 与 @arena/ops 在 base 上不可从 arena-shell 解析（模块
 *   requires 只有 arena-contracts + arena-workbench；包依赖无 sdk/ops，
 *   且 root manifest 不在本 lane 的 fence）——按 packet 的回退条款，
 *   经可解析面呈现并记录约束（SDK 客户端/MCP 面的挂接属 TL 集成）。
 */
import {
  escalationRequestSchema,
  eventEnvelopeSchema,
  IDEMPOTENCY_SEMANTICS,
  resultStatusSchema,
  deliveryPreferencesSchema,
} from "@arena/contracts";

/** 请求信封字段（真实 schema 的 shape keys —— 逐字）。 */
export const REQUEST_ENVELOPE_FIELDS: readonly string[] = Object.keys(
  escalationRequestSchema.shape,
);

/** 事件信封字段（真实 schema 的 shape keys —— 逐字）。 */
export const EVENT_ENVELOPE_FIELDS: readonly string[] = Object.keys(eventEnvelopeSchema.shape);

/** 结果状态词表（真实枚举 options —— 逐字）。 */
export const RESULT_STATUS_VOCABULARY: readonly string[] = resultStatusSchema.options;

/** 投递偏好字段（真实 schema —— 逐字）。 */
export const DELIVERY_PREFERENCES_FIELDS: readonly string[] = Object.keys(
  deliveryPreferencesSchema.shape,
);

/** 幂等/投递语义（CF1.0 冻结文本逐字）。 */
export const IDEMPOTENCY_RULES: readonly { key: string; text: string }[] = (
  Object.keys(IDEMPOTENCY_SEMANTICS) as (keyof typeof IDEMPOTENCY_SEMANTICS)[]
).map((key) => ({ key, text: IDEMPOTENCY_SEMANTICS[key] }));

/** 传输头（真实绑定 api-client 的规范头 —— 从其公开行为记录）。 */
export const CANONICAL_TRANSPORT_HEADERS = [
  { header: "authorization", semantics: "Bearer <token> — the server derives the tenant context; never a UI role" },
  { header: "x-idempotency-key", semantics: "the caller_idempotency_key from the request envelope — apply-once, replay, or typed conflict" },
  { header: "content-type", semantics: "application/json on command/submit bodies" },
] as const;

/** SDK/OPS 可解析性约束（诚实披露 —— packet 的回退条款）。 */
export const SDK_OPS_RESOLUTION_CONSTRAINT =
  "@arena/sdk and @arena/ops are not resolvable from @arena/shell at this base (the module's " +
  "requires are arena-contracts + arena-workbench and the package manifest is TL-owned); this " +
  "portal presents the typed contract surfaces through the resolvable frozen schemas above — " +
  "the SDK client surface and MCP facade mount at TL integration when the module requires extend";

/** 键/凭据供给状态（诚实 —— 无 live provider 供给面）。 */
export const CREDENTIAL_PROVISIONING_DISCLOSURE =
  "credential provisioning has no live provider surface at this base: the demo token registry " +
  "(DEMO_PRINCIPAL_TOKENS) mirrors the API's DEMO_PRINCIPALS; a production credential adapter " +
  "replaces the token source without contract change — provisioning renders as truthfully " +
  "pending, never fake success";

/** 能力提供方配置（词表只读呈现 —— acquisition 包同样不可解析，约束记录）。 */
export const PROVIDER_CONFIGURATION_CONSTRAINT =
  "capability-provider configuration is presented as the read-only routing vocabulary (spec " +
  "\u00a71.1: human expert / scraper / external API / combination); the provider registry and " +
  "route-command surfaces live in @arena/acquisition (not resolvable from this module at base) " +
  "and mount at TL integration";

/** webhook 投递状态（FIXTURE 标注的展示清单 —— 语义逐字来自 CF1.0）。 */
export interface DeliveryStatusRow {
  delivery_id: string;
  outcome: "DELIVERED" | "REPLAYED" | "DUPLICATE_IGNORED" | "PENDING" | "FAILED";
  semantics: string;
  fixture: true;
}

export function deliveryStatusFixtureRows(): readonly DeliveryStatusRow[] {
  return [
    {
      delivery_id: "dlv_fixture_0001",
      outcome: "DELIVERED",
      semantics: IDEMPOTENCY_RULES.find((rule) => rule.key === "sameKeySameDigest")?.text ?? "",
      fixture: true,
    },
    {
      delivery_id: "dlv_fixture_0002",
      outcome: "DUPLICATE_IGNORED",
      semantics:
        "a duplicate delivery of an already-applied event applies once — the stored outcome is replayed with no second side effect",
      fixture: true,
    },
    {
      delivery_id: "dlv_fixture_0003",
      outcome: "PENDING",
      semantics:
        "the durable outbox retries with bounded backoff; exhaustion returns a typed failure (retryBound)",
      fixture: true,
    },
  ];
}
