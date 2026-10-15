/**
 * UIA-001 Lane B — 请求方表单模型（spec/ux/arena-native-ui.md §1.1）。
 *
 * 冻结纪律：
 * - 枚举字段一律 typed select —— 选项直接从 CF1.0 zod 枚举的 .options
 *   读取（绝不手抄第二份词表，绝不 free-text 填契约枚举）；
 * - draft 只含调用方可编辑字段（tenant 永不在表单里 —— 服务端从凭据推导）；
 * - 校验 = 冻结的 validateEscalationDraft（fail-fast 分字段错误），
 *   表单层绝不发明第二套规则。
 */
import {
  escalationModeSchema,
  privacyProfileSchema,
  retentionProfileSchema,
  riskTierSchema,
} from "@arena/contracts";
import {
  DEMO_ACCEPTANCE_CRITERIA,
  validateEscalationDraft,
  type BuildContext,
  type EscalationDraft,
  type FieldError,
} from "@arena/workbench";

/** CF1.0 枚举选项（从冻结 schema 读取 —— 逐字，绝不手抄）。 */
export const RISK_TIER_OPTIONS = riskTierSchema.options;
export const PRIVACY_PROFILE_OPTIONS = privacyProfileSchema.options;
export const RETENTION_PROFILE_OPTIONS = retentionProfileSchema.options;
export const ESCALATION_MODE_OPTIONS = escalationModeSchema.options;
export const DELIVERY_CHANNEL_OPTIONS = ["poll", "webhook"] as const;
export const CURRENCY_OPTIONS = ["USD", "EUR", "GHS"] as const;

/** 表单状态（draft 的可编辑投影；字符串形态供受控输入）。 */
export interface RequesterFormState {
  title: string;
  outcomeDescription: string;
  domain: string;
  typeId: string;
  typeVersion: string;
  capabilityId: string;
  minimumLevel: string;
  qualification: string;
  riskTier: (typeof RISK_TIER_OPTIONS)[number];
  privacyProfile: (typeof PRIVACY_PROFILE_OPTIONS)[number];
  retentionProfile: (typeof RETENTION_PROFILE_OPTIONS)[number];
  jurisdiction: string;
  deadline: string;
  escalationModes: readonly (typeof ESCALATION_MODE_OPTIONS)[number][];
  budgetLimit: string;
  currency: (typeof CURRENCY_OPTIONS)[number];
  allowedAttempts: string;
  perAttemptLimit: string;
  deliveryChannel: (typeof DELIVERY_CHANNEL_OPTIONS)[number];
  webhookUrl: string;
}

export function initialFormState(): RequesterFormState {
  return {
    title: "",
    outcomeDescription: "",
    domain: "software-engineering",
    typeId: "typ_00000001",
    typeVersion: "1.0.0",
    capabilityId: "cap_00000001",
    minimumLevel: "senior",
    qualification: "",
    riskTier: "MEDIUM",
    privacyProfile: "TENANT",
    retentionProfile: "STANDARD",
    jurisdiction: "GH",
    deadline: "2026-12-01T00:00:00Z",
    escalationModes: ["next_expert", "budget_stop"],
    budgetLimit: "500",
    currency: "USD",
    allowedAttempts: "3",
    perAttemptLimit: "200",
    deliveryChannel: "poll",
    webhookUrl: "",
  };
}

/** 表单 → 冻结 draft（数值字段解析；解析失败留给冻结校验器逐字报告）。 */
export function buildDraft(form: RequesterFormState): EscalationDraft {
  return {
    task: { title: form.title, outcome_description: form.outcomeDescription },
    task_type: { domain: form.domain, type_id: form.typeId, type_version: form.typeVersion },
    required_capabilities: [
      { capability_id: form.capabilityId, minimum_level: form.minimumLevel },
    ],
    required_qualifications: form.qualification.trim().length
      ? [form.qualification.trim()]
      : [],
    acceptance_criteria: DEMO_ACCEPTANCE_CRITERIA,
    proof_policy_preset: "demo_p1_rubric",
    constraints: {
      risk_tier: form.riskTier,
      privacy_profile: form.privacyProfile,
      retention_profile: form.retentionProfile,
      jurisdiction: form.jurisdiction.trim().length ? form.jurisdiction.trim() : null,
      professional_requirements: [],
      deadline: form.deadline,
      escalation_modes: [...form.escalationModes],
    },
    budget: {
      limit_amount: Number(form.budgetLimit),
      currency: form.currency,
      allowed_attempts: Number(form.allowedAttempts),
      per_attempt_limit: form.perAttemptLimit.trim().length ? Number(form.perAttemptLimit) : null,
    },
    input_artifacts: [],
    result_schema: { schema_id: "sch_00000001", schema_version: "1.0.0" },
    delivery_preferences: {
      channel: form.deliveryChannel,
      webhook_url:
        form.deliveryChannel === "webhook" && form.webhookUrl.trim().length
          ? form.webhookUrl.trim()
          : null,
    },
  };
}

/** 冻结校验（fail-fast；错误逐字上抛给 FieldErrorList 渲染）。 */
export function quickValidate(
  form: RequesterFormState,
  context: BuildContext,
): { ok: true } | { ok: false; fieldErrors: readonly FieldError[] } {
  const validation = validateEscalationDraft(buildDraft(form), context);
  return validation.ok ? { ok: true } : { ok: false, fieldErrors: validation.fieldErrors };
}

/** 提交上下文（幂等键 = 客户端应用 + 会话内单调度；同键同摘要幂等重放）。 */
export function buildContext(idempotencyKey: string): BuildContext {
  return { client_application_id: "app_00000001", caller_idempotency_key: idempotencyKey };
}
