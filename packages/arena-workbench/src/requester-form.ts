import { createHash } from "node:crypto";
import {
  CONTRACT_VERSION,
  escalationRequestSchema,
  validateAcceptanceCriteriaSemantics,
  type AcceptanceCriteria,
  type EscalationRequest,
  type ProofPolicySnapshot,
} from "@arena/contracts";
import { DEMO_PROOF_POLICY_PRESET } from "./demo-fixtures.js";

/**
 * AR2-003 — Requester cockpit 表单（验收场景 1）。
 *
 * draft 只覆盖调用方可编辑字段；系统字段（contract_version、id、digest、
 * proof policy snapshot）由 builder 组合：
 * - tenant 永远不在 draft/表单里（服务端从凭据推导——未知字段即拒绝）；
 * - 未知 draft 字段被拒绝并呈现为类型化表单错误（strict 镜像）；
 * - 校验 = CF1.0 zod（escalationRequestSchema）+ 冻结语义
 *   （validateAcceptanceCriteriaSemantics）→ 分字段错误列表；
 * - request_digest 由可注入 digestFn 计算（默认 node:crypto sha256）。
 */

export type FieldError = { field: string; rule: string };

/** 表单可直接编辑的字段（信封的调用方侧子集）。 */
export interface EscalationDraft {
  task: { title: string; outcome_description: string };
  task_type: { domain: string; type_id: string; type_version: string };
  required_capabilities: Array<{ capability_id: string; minimum_level: string }>;
  required_qualifications: string[];
  acceptance_criteria: AcceptanceCriteria;
  proof_policy_preset: string;
  constraints: {
    risk_tier: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    privacy_profile: "PUBLIC" | "TENANT" | "CONFIDENTIAL" | "REGULATED";
    retention_profile: "STANDARD" | "EXTENDED" | "SHORT" | "COMPLIANCE";
    jurisdiction: string | null;
    professional_requirements: string[];
    deadline: string;
    escalation_modes: Array<"next_expert" | "budget_stop" | "manual_review" | "deadline_stop">;
  };
  budget: {
    limit_amount: number;
    currency: string;
    allowed_attempts: number;
    per_attempt_limit: number | null;
  };
  input_artifacts: EscalationRequest["input_artifacts"];
  result_schema: { schema_id: string; schema_version: string };
  delivery_preferences: { channel: "webhook" | "poll"; webhook_url: string | null };
}

const KNOWN_DRAFT_KEYS = [
  "task",
  "task_type",
  "required_capabilities",
  "required_qualifications",
  "acceptance_criteria",
  "proof_policy_preset",
  "constraints",
  "budget",
  "input_artifacts",
  "result_schema",
  "delivery_preferences",
] as const;

/** proof policy 预设登记表（demo 预设唯一；真实预设属后续 WO 的策略面）。 */
const PROOF_POLICY_PRESETS: Record<string, ProofPolicySnapshot> = {
  demo_p1_rubric: DEMO_PROOF_POLICY_PRESET,
};

export interface BuildContext {
  client_application_id: string;
  caller_idempotency_key: string;
}

export interface BuildDeps {
  digest?: (payload: string) => string;
}

export type DraftValidation =
  | { ok: true; request: EscalationRequest }
  | { ok: false; fieldErrors: FieldError[] };

function sha256Hex(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

/** 未知 draft 字段检查（表单层 strict 镜像：tenant 等未知键立即拒绝）。 */
function unknownDraftKeys(draft: Record<string, unknown>): string[] {
  return Object.keys(draft).filter((key) => !(KNOWN_DRAFT_KEYS as readonly string[]).includes(key));
}

export function validateEscalationDraft(
  draft: EscalationDraft,
  context: BuildContext,
  deps: BuildDeps = {},
): DraftValidation {
  const fieldErrors: FieldError[] = [];
  for (const key of unknownDraftKeys(draft as unknown as Record<string, unknown>)) {
    fieldErrors.push({
      field: key,
      rule: "unknown draft field (strict form; e.g. tenant is server-derived and never client-supplied)",
    });
  }
  const preset = PROOF_POLICY_PRESETS[draft.proof_policy_preset];
  if (preset === undefined) {
    fieldErrors.push({ field: "proof_policy_preset", rule: "unknown proof policy preset" });
  }
  // 冻结跨 criterion 语义（重复 criterion_id 等）。
  for (const issue of validateAcceptanceCriteriaSemantics(draft.acceptance_criteria)) {
    fieldErrors.push({ field: `acceptance_criteria.${issue.field}`, rule: issue.rule });
  }
  const digest = deps.digest ?? sha256Hex;
  const envelope = {
    contract_version: CONTRACT_VERSION,
    client_application_id: context.client_application_id,
    caller_idempotency_key: context.caller_idempotency_key,
    request_digest: digest(
      JSON.stringify({
        task: draft.task,
        task_type: draft.task_type,
        acceptance_criteria: draft.acceptance_criteria,
        constraints: draft.constraints,
        budget: draft.budget,
      }),
    ),
    task: draft.task,
    task_type: draft.task_type,
    required_capabilities: draft.required_capabilities,
    required_qualifications: draft.required_qualifications,
    acceptance_criteria: draft.acceptance_criteria,
    proof_policy: preset ?? DEMO_PROOF_POLICY_PRESET,
    constraints: {
      ...draft.constraints,
      escalation_modes: draft.constraints.escalation_modes,
    },
    budget: draft.budget,
    input_artifacts: draft.input_artifacts,
    result_schema: draft.result_schema,
    delivery_preferences: {
      channel: draft.delivery_preferences.channel,
      webhook_reference:
        draft.delivery_preferences.channel === "webhook" &&
        draft.delivery_preferences.webhook_url !== null
          ? { url: draft.delivery_preferences.webhook_url, signature_key_id: "wsk_00000001" }
          : null,
    },
  };
  const parsed = escalationRequestSchema.safeParse(envelope);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      fieldErrors.push({
        field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
        rule: `${issue.code}${issue.message ? ` — ${issue.message}` : ""}`,
      });
    }
  }
  if (fieldErrors.length > 0 || !parsed.success) {
    return { ok: false, fieldErrors };
  }
  return { ok: true, request: parsed.data };
}
