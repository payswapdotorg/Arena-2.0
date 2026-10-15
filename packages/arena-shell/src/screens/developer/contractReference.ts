/**
 * UIA-001 Lane C — 开发者门户契约参考视图模型（packet C2；UIA-003 扩展）。
 *
 * 冻结纪律：
 * - 类型化请求/结果契约参考从 **真实的冻结 zod schema** 运行时枚举
 *   （escalationRequestSchema.shape / eventEnvelopeSchema.shape /
 *   resultStatusSchema.options —— 绝不手抄第二份字段清单）；
 * - webhook 签名/投递语义从 CF1.0 的 IDEMPOTENCY_SEMANTICS 与投递偏好
 *   契约逐字呈现（apply-once / 重复 / 重放按冻结定义）；
 * - UIA-003：@arena/sdk / @arena/ops / @arena/acquisition 已在模块 requires
 *   与包依赖中落地（TL 注册提交 4b4c2f6）—— 回退条款的两个约束披露
 *   （SDK_OPS_RESOLUTION_CONSTRAINT / PROVIDER_CONFIGURATION_CONSTRAINT）
 *   随真实挂接面一并退役（真实 SDK 面 = sdkMount/sdkBinding；真实 ACQ
 *   提供方词表 = providerRegistry）。
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

/** 键/凭据供给状态（诚实 —— 无 live provider 供给面；UIA-003 保留原样：
 *  生产凭据适配器仍是所有者前沿）。 */
export const CREDENTIAL_PROVISIONING_DISCLOSURE =
  "credential provisioning has no live provider surface at this base: the demo token registry " +
  "(DEMO_PRINCIPAL_TOKENS) mirrors the API's DEMO_PRINCIPALS; a production credential adapter " +
  "replaces the token source without contract change — provisioning renders as truthfully " +
  "pending, never fake success";

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
