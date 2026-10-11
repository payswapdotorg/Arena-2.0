import {
  computeAcquisitionRequestDigest,
  createProviderRegistry,
  type CapabilityAcquisitionRequest,
  type CapabilityGapReport,
  type CapabilityProviderDescriptor,
  type CapabilityProviderRegistry,
  type RoutingState,
} from "../src/contract.js";

/**
 * AR2-016 测试共享 fixtures —— 全确定性：无真实时钟（NOW 固定）、无随机、
 * 无网络；所有 ID/时间由本文件注入（spec §8 测试纪律）。
 */

export const NOW = "2026-10-11T00:00:00Z";
export const TENANT_ALPHA = "tnt_00000001";
export const TENANT_BETA = "tnt_00000002";
export const CAPABILITY = "cap_00000001";
export const OUTPUT_SCHEMA_ID = "sch_00000001";

export function gapReport(overrides: Partial<CapabilityGapReport> = {}): CapabilityGapReport {
  return {
    schema_version: "ACQ1.0",
    report_id: "gap_00000001",
    reported_by: { client_application_id: "app_00000001", agent_id: "agt_00000001" },
    target: { body_composition_id: "bod_00000001", body_composition_version: "1.2.0" },
    capability_statement: { capability_id: CAPABILITY, minimum_level: "senior" },
    observed_task: {
      title: "Find current Blender procedural-material references",
      outcome_description: "The agent must cite current procedural material documentation.",
      criteria: ["cites Blender 4.x nodes"],
    },
    repro_cases: [
      {
        case_id: "cse_00000001",
        kind: "MINIMAL_FAILURE",
        setup: "Fresh session with the default tool set.",
        input_description: "Ask for a procedural material node graph for Blender 4.2.",
        expected_output: "A cited node graph using current nodes.",
        observed_output: "The agent cites nodes removed in 2.9x.",
      },
    ],
    expected_behavior: "The agent cites current Blender 4.x procedural material nodes.",
    domain: "3d-graphics",
    environment_notes: null,
    constraint_boundaries: {
      deadline: "2026-11-01T00:00:00Z",
      budget_ceiling: 500,
      currency: "USD",
    },
    privacy_constraints: {
      privacy_profile: "TENANT",
      retention_profile: "STANDARD",
      rights_notes: "Only public documentation sources are permitted.",
    },
    ...overrides,
  };
}

/** 语义校验要求 request_digest 等于「除 digest 外载荷」的 canonical 摘要。 */
export function withCanonicalDigest(
  request: CapabilityAcquisitionRequest,
): CapabilityAcquisitionRequest {
  return { ...request, request_digest: computeAcquisitionRequestDigest(request) };
}

export function acquisitionRequest(
  overrides: Partial<CapabilityAcquisitionRequest> = {},
): CapabilityAcquisitionRequest {
  return withCanonicalDigest({
    schema_version: "ACQ1.0",
    request_id: "req_00000001",
    tenant_context: {
      tenant_id: TENANT_ALPHA,
      derived_from: "authenticated_credentials",
      client_application_id: "app_00000001",
      principal_id: "prn_00000001",
      acting_identity_id: null,
      role: "requester",
      authorization_scope_ids: [],
    },
    idempotency_key: "acq-key-1",
    correlation_id: "cor_00000001",
    causation_id: null,
    request_digest: "ab".repeat(32),
    gap_reference: { gap_report_id: "gap_00000001", gap_report_digest: "cd".repeat(32) },
    desired_output_schema: { schema_id: OUTPUT_SCHEMA_ID, schema_version: "1.0.0" },
    scope: {
      permitted_source_patterns: ["docs.blender.org/*"],
      required_regions: ["GH"],
    },
    budget: { limit_amount: 500, currency: "USD" },
    deadline: "2026-12-01T00:00:00Z",
    attempt_limit: 3,
    risk_tier: "MEDIUM",
    acceptance_criteria: [
      {
        criterion_id: "crt_00000001",
        statement: "Cited references use Blender 4.x node names.",
        measurement: {
          definition: "Share of cited nodes present in the 4.x node registry.",
          metric: "cite_accuracy",
          unit: "ratio",
          threshold: 0.9,
          comparator: "ge",
        },
        hard_stop: true,
        proof_class: "P1",
        weight: null,
      },
    ],
    data_use_policy: {
      use_kinds: ["RETRIEVAL"],
      retention_profile: "STANDARD",
      privacy_profile: "TENANT",
      redaction_class: "tenant",
      fine_tuning_approval: null,
    },
    preferred_route: {
      mode: "ANY_COMPATIBLE_PROVIDER",
      pinned_provider: null,
      fallback_permitted: false,
    },
    ...overrides,
  });
}

export function descriptor(
  overrides: Partial<CapabilityProviderDescriptor> & { provider_id: string },
): CapabilityProviderDescriptor {
  return {
    provider_version: "1.0.0",
    kind: "SCRAPER",
    tenant_id: TENANT_ALPHA,
    status: "ACTIVE",
    supported_capabilities: [
      {
        capability_id: CAPABILITY,
        level: "senior",
        evidence_refs: ["evd_00000001", "evd_00000002"],
      },
    ],
    input_schema: { schema_id: "sch_00000002", schema_version: "1.0.0" },
    output_schema: { schema_id: OUTPUT_SCHEMA_ID, schema_version: "1.0.0" },
    source_rights: {
      posture: "PERMITTED",
      approved_source_patterns: ["docs.blender.org/*"],
    },
    available_regions: ["GH", "NG"],
    cost: { currency: "USD", per_run_estimate: 120, quota_remaining: 10 },
    latency: { sla_seconds: 600 },
    reliability: { recent_success_ratio: 0.95, completed_runs: 120 },
    required_entitlements: [],
    allowed_use: ["RETRIEVAL", "INDEX", "KNOWLEDGE_PACK"],
    max_risk_tier: "HIGH",
    ...overrides,
  };
}

/** 注册表构建：任一非法描述符 => 直接 fail（测试数据必须全部合法）。 */
export function registry(
  ...descriptors: readonly (Partial<CapabilityProviderDescriptor> & { provider_id: string })[]
): CapabilityProviderRegistry {
  const built = descriptors.map((entry) => descriptor(entry));
  const check = createProviderRegistry(built);
  if (!check.ok) {
    throw new Error(`fixture registry is invalid: ${JSON.stringify(check.issues)}`);
  }
  return check.registry;
}

export function routingState(overrides: Partial<RoutingState> = {}): RoutingState {
  return {
    now: NOW,
    spend_so_far: 0,
    attempts_used: 0,
    tenant_entitlements: [],
    ...overrides,
  };
}
