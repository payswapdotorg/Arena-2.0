/**
 * arena-contracts 模块公开契约（AR2-001 冻结语料 CF1.0）。
 * 包外只允许从本文件 import（architecture guard: deep import 被禁止）。
 * 语义规则常量（*_RULE / *_SEMANTICS）与 schema 一起导出，
 * 因为它们同属冻结契约。
 */

export {
  CONTRACT_VERSION,
  CONTRACT_CORPUS_VERSION,
  PROOF_POLICY_VERSION,
  EVENT_SCHEMA_VERSION,
  arenaIdSchema,
  digestSchema,
  isoTimestampSchema,
  isoDateSchema,
  semverSchema,
  currencyCodeSchema,
  positiveIntSchema,
  nonNegativeIntSchema,
  positiveAmountSchema,
  nonNegativeAmountSchema,
  riskTierSchema,
  privacyProfileSchema,
  retentionProfileSchema,
  redactionClassSchema,
  proofClassSchema,
} from "./common.js";

export {
  tenantContextSchema,
  tenantDerivationSchema,
  TENANT_DERIVATION_RULE,
  ROLE_IS_NOT_AUTHORIZATION_RULE,
  validateTenantContextSemantics,
  type TenantContext,
} from "./tenant-context.js";

export {
  escalationRequestSchema,
  taskTypeSchema,
  capabilityRequirementSchema,
  escalationModeSchema,
  inputArtifactSchema,
  resultSchemaReferenceSchema,
  deliveryPreferencesSchema,
  escalationConstraintsSchema,
  budgetSchema,
  UNKNOWN_FIELD_POLICY,
  REQUEST_TENANT_RULE,
  validateEscalationRequestSemantics,
  type EscalationRequest,
} from "./envelope/escalation-request.js";

export {
  acceptanceCriterionSchema,
  acceptanceCriteriaSchema,
  criterionMeasurementSchema,
  criterionComparatorSchema,
  ACCEPTANCE_CRITERIA_IMMUTABILITY_RULE,
  validateAcceptanceCriteriaSemantics,
  type AcceptanceCriterion,
  type AcceptanceCriteria,
} from "./envelope/acceptance-criteria.js";

export {
  proofPolicySnapshotSchema,
  validatorDescriptorSchema,
  validatorKindSchema,
  rerunPolicySchema,
  samplePolicySchema,
  reviewPolicySchema,
  observationPolicySchema,
  payoutGateSchema,
  retryNextExpertPolicySchema,
  PROOF_POLICY_SNAPSHOT_RULE,
  validateProofPolicySemantics,
  type ProofPolicySnapshot,
} from "./envelope/proof-policy-snapshot.js";

export {
  attemptSchema,
  attemptStatusSchema,
  attemptFailureReasonSchema,
  attemptFailureRecordSchema,
  candidateVersionSchema,
  expertAssignmentSchema,
  attemptBudgetSchema,
  attemptCapsuleLinkSchema,
  ATTEMPT_HISTORY_RULE,
  validateAttemptSemantics,
  type Attempt,
} from "./envelope/attempt.js";

export {
  capsuleManifestSchema,
  isolationClassSchema,
  permittedActionSchema,
  resourcePolicySchema,
  egressPolicySchema,
  scopedCredentialSchema,
  capsuleLifecycleSchema,
  isolationAssuranceSchema,
  artifactTransferPolicySchema,
  CAPSULE_FAIL_CLOSED_RULE,
  UPSTREAM_RUNTIME_NOT_A_BOUNDARY_RULE,
  validateCapsuleManifestSemantics,
  type CapsuleManifest,
} from "./envelope/capsule-manifest.js";

export {
  evidenceEnvelopeSchema,
  evidenceIssuerTierSchema,
  evidenceObjectSchema,
  evidenceProvenanceSchema,
  evidenceBindingSchema,
  evidenceCorrectionSchema,
  EVIDENCE_IMMUTABILITY_RULE,
  CALLER_PROOF_TRUST_RULE,
  validateEvidenceEnvelopeSemantics,
  type EvidenceEnvelope,
} from "./envelope/evidence-envelope.js";

export {
  resultEnvelopeSchema,
  resultStatusSchema,
  criterionDecisionSchema,
  criterionOutcomeSchema,
  verificationTrailSchema,
  structuredOutputSchema,
  paymentEligibilityReferenceSchema,
  ELIGIBILITY_IS_NOT_SETTLEMENT_RULE,
  NO_CHAIN_OF_THOUGHT_RULE,
  validateResultEnvelopeSemantics,
  type ResultEnvelope,
} from "./envelope/result-envelope.js";

export {
  eventEnvelopeSchema,
  aggregateTypeSchema,
  actorTypeSchema,
  eventCorrectionSchema,
  EVENT_OBSERVABILITY_RULE,
  EVENT_CORRECTION_RULE,
  validateEventEnvelopeSemantics,
  type EventEnvelope,
} from "./envelope/event-envelope.js";

export {
  commandNameSchema,
  systemCommandNameSchema,
  commandEnvelopeSchema,
  idempotencyRecordSchema,
  idempotencyOutcomeStatusSchema,
  IDEMPOTENCY_SEMANTICS,
  validateCommandEnvelopeSemantics,
  validateIdempotencyRecordSemantics,
  type CommandEnvelope,
  type IdempotencyRecord,
} from "./idempotency.js";

export {
  arenaErrorCodeSchema,
  arenaErrorEnvelopeSchema,
  ARENA_ERROR_CATALOG,
  ERROR_CATALOG_STABILITY_RULE,
  httpStatusFor,
  isRetryable,
  isIdempotentReplaySafe,
  type ArenaErrorCode,
  type ArenaErrorEnvelope,
  type ErrorCatalogEntry,
} from "./errors.js";

export { PORT_NEUTRALITY_RULE } from "./ports.js";

export type {
  AggregateStorePort,
  IdempotencyPort,
  OutboxPort,
  JobPort,
  MigrationPort,
  AggregateRef,
  SaveAggregateInput,
  AggregateRecord,
  ReserveIdempotencyInput,
  ReserveIdempotencyOutcome,
  CompleteIdempotencyInput,
  OutboxMessage,
  JobHandle,
  ClaimJobOutcome,
} from "./ports.js";

export {
  FIELD_OWNERSHIP,
  FIELD_OWNERSHIP_RULE,
  ENVELOPE_IDS,
  owningModuleSchema,
  ownersOf,
  type OwningModule,
  type EnvelopeId,
  type FieldOwnershipTable,
} from "./ownership.js";

export {
  escalationStateMachine,
  ESCALATION_STATES,
  ASSIGNMENT_GUARDS,
  ENVIRONMENT_GUARDS,
  PROOF_SATISFIED_GUARD,
  RESULT_COMMITTED_GUARD,
  SIDE_EFFECTS_DISCLOSED_GUARD,
  type EscalationState,
} from "./state-machine/escalation.js";

export {
  attemptStateMachine,
  ATTEMPT_STATES,
  CANDIDATE_GUARDS,
  RETRY_GUARDS,
  type AttemptState,
} from "./state-machine/attempt.js";

export {
  paymentStateMachine,
  PAYMENT_STATES,
  EVIDENCE_GATE_GUARDS,
  type PaymentState,
} from "./state-machine/payment-eligibility.js";

export {
  learningStateMachine,
  LEARNING_STATES,
  PUBLICATION_GUARDS,
  type LearningState,
} from "./state-machine/learning-publication.js";

export {
  ES20_INVARIANTS,
  ALL_MACHINES,
  evaluateTransition,
  reachableStates,
  checkCompleteness,
  isAllowedEdge,
  transitionCommandSchema,
  type InvariantSpec,
  type StateMachineDefinition,
  type TransitionRule,
  type StateDoc,
  type GuardFacts,
  type TransitionEvaluation,
  type TransitionCommand,
  type GuardId,
} from "./state-machine/index.js";
