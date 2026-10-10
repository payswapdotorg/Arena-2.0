import { z } from "zod";

/**
 * B5 — 字段所有权注册表（OWN1.0 的机器可核查形态）。
 * 每个信封的每个顶层字段必须映射到恰好一个 owning module；
 * 零未拥有字段、零双写字段（architecture-lock 第 6 条）。
 *
 * 域模块（ES2.0 §3 的八个）+ 四个基础设施 owner：
 * - api_edge：API 边界（认证/租户推导/命令信封，AR2-002）
 * - idempotency_store：幂等记录的持久层（AR2-005 port）
 * - emitting_aggregate：事件信封的写者 = aggregate.type 指名的聚合
 * - tenant_service：认证凭据 → TenantContext 的推导服务
 */

export const owningModuleSchema = z.enum([
  "escalation",
  "attempt",
  "capsule_host",
  "evidence_store",
  "verification",
  "payment",
  "learning",
  "requester_app",
  "api_edge",
  "idempotency_store",
  "emitting_aggregate",
  "tenant_service",
]);

export type OwningModule = z.infer<typeof owningModuleSchema>;

export const ENVELOPE_IDS = [
  "escalation-request",
  "acceptance-criteria",
  "proof-policy-snapshot",
  "attempt",
  "capsule-manifest",
  "evidence-envelope",
  "result-envelope",
  "event-envelope",
  "command-envelope",
  "idempotency-record",
  "tenant-context",
] as const;

export type EnvelopeId = (typeof ENVELOPE_IDS)[number];

export type FieldOwnershipTable = Record<EnvelopeId, Record<string, OwningModule>>;

export const FIELD_OWNERSHIP: FieldOwnershipTable = {
  "escalation-request": {
    contract_version: "escalation",
    client_application_id: "escalation",
    caller_idempotency_key: "escalation",
    request_digest: "escalation",
    task: "escalation",
    task_type: "escalation",
    required_capabilities: "escalation",
    required_qualifications: "escalation",
    acceptance_criteria: "escalation",
    proof_policy: "escalation",
    constraints: "escalation",
    budget: "escalation",
    input_artifacts: "escalation",
    result_schema: "escalation",
    delivery_preferences: "escalation",
  },
  "acceptance-criteria": {
    criterion_id: "escalation",
    statement: "escalation",
    measurement: "escalation",
    hard_stop: "escalation",
    proof_class: "escalation",
    weight: "escalation",
  },
  "proof-policy-snapshot": {
    policy_version: "escalation",
    content_digest: "escalation",
    selected_class: "escalation",
    selection_rationale: "escalation",
    per_criterion_classes: "escalation",
    validators: "escalation",
    rerun_policy: "escalation",
    sample_policy: "escalation",
    review_policy: "escalation",
    observation_policy: "escalation",
    payout_gate: "escalation",
    retry_next_expert: "escalation",
    timeout: "escalation",
    dispute_conditions: "escalation",
    budget_ceiling: "escalation",
  },
  attempt: {
    attempt_id: "attempt",
    escalation_id: "attempt",
    attempt_number: "attempt",
    status: "attempt",
    expert: "attempt",
    budget: "attempt",
    capsule: "attempt",
    candidates: "attempt",
    failure: "attempt",
    created_at: "attempt",
    updated_at: "attempt",
  },
  "capsule-manifest": {
    manifest_id: "capsule_host",
    capsule_id: "capsule_host",
    manifest_version: "capsule_host",
    tenant_id: "capsule_host",
    escalation_id: "capsule_host",
    attempt_id: "capsule_host",
    environment: "capsule_host",
    permitted_actions: "capsule_host",
    resource_policy: "capsule_host",
    egress_policy: "capsule_host",
    credentials: "capsule_host",
    lifecycle: "capsule_host",
    assurance: "capsule_host",
    artifact_transfer: "capsule_host",
    content_digest: "capsule_host",
  },
  "evidence-envelope": {
    evidence_id: "evidence_store",
    object: "evidence_store",
    provenance: "evidence_store",
    binding: "evidence_store",
    redaction_class: "evidence_store",
    immutable: "evidence_store",
    correction: "evidence_store",
    recorded_at: "evidence_store",
  },
  "result-envelope": {
    result_id: "verification",
    escalation_id: "verification",
    attempt_id: "verification",
    tenant_id: "verification",
    status: "verification",
    structured_outputs: "verification",
    criterion_decisions: "verification",
    proof_class: "verification",
    evidence_references: "verification",
    verification: "verification",
    limitations: "verification",
    assumptions: "verification",
    residual_risk: "verification",
    follow_up_recommendations: "verification",
    artifact: "verification",
    payment_eligibility_reference: "payment",
    correlation_id: "verification",
    created_at: "verification",
    contract_version: "verification",
  },
  "event-envelope": {
    event_id: "emitting_aggregate",
    schema_version: "emitting_aggregate",
    tenant_id: "emitting_aggregate",
    aggregate: "emitting_aggregate",
    event_type: "emitting_aggregate",
    occurred_at: "emitting_aggregate",
    recorded_at: "emitting_aggregate",
    actor: "emitting_aggregate",
    correlation_id: "emitting_aggregate",
    causation_id: "emitting_aggregate",
    request_id: "emitting_aggregate",
    policy_version: "emitting_aggregate",
    payload: "emitting_aggregate",
    immutable: "emitting_aggregate",
    correction: "emitting_aggregate",
  },
  "command-envelope": {
    command: "api_edge",
    actor: "api_edge",
    authorization_policy_id: "api_edge",
    request_id: "api_edge",
    idempotency_key: "api_edge",
    request_digest: "api_edge",
    correlation_id: "api_edge",
    causation_id: "api_edge",
  },
  "idempotency-record": {
    idempotency_key: "idempotency_store",
    request_digest: "idempotency_store",
    status: "idempotency_store",
    response_digest: "idempotency_store",
    completed_at: "idempotency_store",
  },
  "tenant-context": {
    tenant_id: "tenant_service",
    derived_from: "tenant_service",
    client_application_id: "tenant_service",
    principal_id: "tenant_service",
    acting_identity_id: "tenant_service",
    role: "tenant_service",
    authorization_scope_ids: "tenant_service",
  },
};

/** 所有权核查规则说明（与 OWN1.0 一致）。 */
export const FIELD_OWNERSHIP_RULE =
  "every field of every envelope maps to exactly one owning module; derived reads (e.g. result artifact " +
  "lineage derived from attempt-owned candidate versions) are not dual writes; cross-aggregate coordination " +
  "uses IDs, outbox events and explicit transitions only";

export function ownersOf(envelope: EnvelopeId): Record<string, OwningModule> {
  return FIELD_OWNERSHIP[envelope];
}
