import { createHash } from "node:crypto";
import { CONTRACT_VERSION, type EscalationRequest, type OutboxPort } from "@arena/contracts";
import { sdkQuickstart, type QuickstartReport } from "./sdk-client.js";
import {
  dispatchWebhookRound,
  type WebhookDispatchReport,
  type WebhookSubscription,
} from "./webhook-dispatcher.js";
import {
  InMemoryWebhookDedupeStore,
  startWebhookReceiver,
  type WebhookDedupeStore,
  type WebhookReceiveVerdict,
} from "./webhook-receiver.js";
import { GENERIC_EXAMPLE_DISCLOSURE } from "./disclosures.js";

/**
 * AR2-011 — 通用 AI 应用示例（issue #13）：独立于 Epoch/ZCode 类型。
 *
 * 任务材料是领域无关的（data-operations 形状：把一批记录交给 Arena，
 * 换回一个经验证的结构化结果）—— 证明集成面不依赖任何特定上游域。
 * 示例完整走通真实组件链：SDK quickstart（真实 URL）→ 事务性 outbox →
 * 签名 webhook 投递（真实 HTTP）→ 接收端验签 → apply-once → 「丢确认」
 * 重试 → DUPLICATE（效应清单长度不变 —— 重试零重复效应）。
 */

export interface GenericTaskSpec {
  title: string;
  outcome_description: string;
  /** 领域无关的输出模式（如分类标签集）。 */
  output_schema_id: string;
  caller_idempotency_key: string;
  client_application_id: string;
}

const GENERIC_HEX = createHash("sha256").update("generic-example-p0").digest("hex");

/** 通用 CF1.0 请求信封（P0 确定性证明策略 —— 领域无关材料）。 */
export function buildGenericEscalationRequest(spec: GenericTaskSpec): EscalationRequest {
  return {
    contract_version: CONTRACT_VERSION,
    client_application_id: spec.client_application_id,
    caller_idempotency_key: spec.caller_idempotency_key,
    request_digest: createHash("sha256")
      .update(JSON.stringify({ title: spec.title, outcome: spec.outcome_description }))
      .digest("hex"),
    task: {
      title: spec.title,
      outcome_description: spec.outcome_description,
    },
    task_type: { domain: "data-operations", type_id: "typ_generic_0001", type_version: "1.0.0" },
    required_capabilities: [{ capability_id: "cap_generic_0001", minimum_level: "senior" }],
    required_qualifications: [],
    acceptance_criteria: [
      {
        criterion_id: "cri_generic_0001",
        statement: "The returned dataset reproduces the fixture classification for all rows",
        measurement: {
          definition:
            "Re-run the fixture comparison over the returned dataset and count mismatches",
          metric: "mismatch_count",
          unit: "rows",
          threshold: 0,
          comparator: "eq",
        },
        hard_stop: true,
        proof_class: "P0",
        weight: 1,
      },
    ],
    proof_policy: {
      policy_version: "PVP1.0",
      content_digest: GENERIC_HEX,
      selected_class: "P0",
      selection_rationale:
        "Generic example: deterministic validator coverage only — no human review machinery in this preset",
      per_criterion_classes: [{ criterion_id: "cri_generic_0001", proof_class: "P0" }],
      validators: [
        {
          validator_id: "val_generic_0001",
          validator_version: "1.0.0",
          kind: "deterministic",
          allowed_commands: ["node", "tsx"],
          timeout_seconds: 300,
          resource_limits: "generic example: 2 cpu, 2GiB memory, 10GiB disk",
          evidence_policy:
            "generic example: validator stdout captured as evidence, no network access",
        },
      ],
      rerun_policy: { minimum_reruns: 1, risk_exception: null },
      sample_policy: null,
      review_policy: null,
      observation_policy: null,
      payout_gate: {
        release_requires: "all_predicates_pass",
        caller_authenticity_verified: true,
        task_binding_verified: true,
        dispute_blocks_release: true,
      },
      retry_next_expert: {
        max_attempts: 3,
        max_aggregate_spend: 500,
        cooldown_policy: "generic example: exponential cooldown, 1h base",
        failed_attempt_posture: "retain_attributed",
        next_expert_baseline: "immutable_baseline_only",
      },
      timeout: "generic example: 24h wall clock",
      dispute_conditions: "generic example: any hard-stop criterion failure or evidence dispute",
      budget_ceiling: 400,
    },
    constraints: {
      risk_tier: "MEDIUM",
      privacy_profile: "TENANT",
      retention_profile: "STANDARD",
      jurisdiction: null,
      professional_requirements: [],
      deadline: "2027-01-01T00:00:00Z",
      escalation_modes: ["next_expert", "budget_stop"],
    },
    budget: { limit_amount: 500, currency: "USD", allowed_attempts: 3, per_attempt_limit: 200 },
    input_artifacts: [],
    result_schema: { schema_id: spec.output_schema_id, schema_version: "1.0.0" },
    delivery_preferences: {
      channel: "poll",
      webhook_reference: null,
    },
  };
}

export interface GenericExampleOptions {
  baseUrl: string;
  bearerToken: string;
  spec: GenericTaskSpec;
  outbox: OutboxPort;
  /** 订阅（endpoint_url 由示例内的真实接收端接管）。 */
  subscription: Omit<WebhookSubscription, "endpoint_url">;
  dedupe?: WebhookDedupeStore;
  fetchImpl?: typeof fetch;
}

export interface GenericExampleReport {
  disclosure: string;
  quickstart: QuickstartReport;
  roundOne: WebhookDispatchReport;
  roundTwo: WebhookDispatchReport;
  verdicts: readonly WebhookReceiveVerdict[];
  /** 效应清单：跨两轮投递恰好一条（apply-once 的直接证据）。 */
  effects: readonly string[];
}

/**
 * 运行通用示例（验收形态）。两轮投递：
 * - 第一轮：接收端「丢确认」—— 效应已施加但 HTTP 500（ack 丢失）→
 *   markFailed + 退避（消息永不丢失）；
 * - 第二轮（时钟推进越过退避）：同一 outbox 行重投（同 delivery_id，
 *   attempt+1）→ 接收端验签 → DUPLICATE → 200 → markDispatched 终态。
 */
export async function runGenericExample(
  options: GenericExampleOptions,
): Promise<GenericExampleReport> {
  const request = buildGenericEscalationRequest(options.spec);
  const quickstart = await sdkQuickstart(
    { baseUrl: options.baseUrl, fetchImpl: options.fetchImpl },
    request,
    { bearerToken: options.bearerToken },
  );
  const dedupe = options.dedupe ?? new InMemoryWebhookDedupeStore();
  const effects: string[] = [];
  // 丢确认策略：首次 APPLIED 回 500（效应已施加 —— 模拟 ack 丢失）。
  let lossyAcks = 1;
  const receiver = await startWebhookReceiver({
    secret: options.subscription.secret,
    dedupe,
    apply: (payload) => {
      effects.push(`applied:${payload.event_id}:${payload.event_type}`);
    },
    ackStatus: (verdict) => {
      if (verdict.kind === "APPLIED" && lossyAcks > 0) {
        lossyAcks -= 1;
        return 500;
      }
      return 200;
    },
  });
  try {
    const dispatchOptions = {
      outbox: options.outbox,
      subscription: { ...options.subscription, endpoint_url: receiver.url },
      fetchImpl: options.fetchImpl,
      backoffBaseMs: 1000,
    } satisfies Parameters<typeof dispatchWebhookRound>[0];
    const roundOne = await dispatchWebhookRound(dispatchOptions);
    // 时钟推进 2s（越过 1s 退避 —— 重试到期）。
    const advanced = Date.now() + 2000;
    const roundTwo = await dispatchWebhookRound({
      ...dispatchOptions,
      now: () => new Date(advanced).toISOString().replace(/\.\d{3}Z$/, "Z"),
    });
    return {
      disclosure: GENERIC_EXAMPLE_DISCLOSURE,
      quickstart,
      roundOne,
      roundTwo,
      verdicts: receiver.verdicts,
      effects,
    };
  } finally {
    await receiver.stop();
  }
}
