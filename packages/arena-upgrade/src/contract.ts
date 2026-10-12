/**
 * arena-upgrade 公开契约（AR2-018，issue #34）。
 *
 * 版本族决策：UPG1.0 是独立版本化的契约族 —— 冻结的 CF1.0（@arena/contracts）、
 * ACQ1.0（@arena/acquisition）、SCRP1.0（@arena/scraper）与 AR2-014 学习平面
 * （@arena/learning）在本包内绝不被编辑或扩展；家族之间仅通过不可变
 * correlation/causation ID 与公开导出的复用形状（DatasetArtifact、
 * RightsGrantRegistry、Certification 绑定、canonical digest）关联。
 *
 * 包外只允许从本文件 import（deep import 被禁止）；语义规则常量与 schema
 * 一起导出，因为它们同属 UPG1.0 契约。
 */

export { UPGRADE_SCHEMA_FAMILY, UPG_FAMILY_SEPARATION_RULE, actorRefSchema, type ActorRef, type SemanticIssue } from "./primitives.js";

export {
  upgErrorCodeSchema,
  upgErrorEnvelopeSchema,
  upgError,
  upgHttpStatusFor,
  isUpgRetryable,
  classifyShapeIssues,
  describeShapeIssues,
  UpgradeTypedError,
  UPG_ERROR_CATALOG,
  UPG_ERROR_CATALOG_STABILITY_RULE,
  type UpgErrorCode,
  type UpgErrorEnvelope,
  type ShapeIssue,
} from "./errors.js";

export {
  intakePolicySchema,
  intakeProvenanceCheckSchema,
  intakeRightsStateSchema,
  datasetQualityMetricsSchema,
  datasetIntakeRecordSchema,
  validateDatasetIntake,
  evaluateIntakeRights,
  hostMatchesPattern,
  INTAKE_IS_NOT_CAPABILITY_RULE,
  type IntakePolicy,
  type IntakeProvenanceCheck,
  type IntakeRightsState,
  type DatasetQualityMetrics,
  type DatasetIntakeRecord,
  type IntakeInput,
} from "./intake.js";

export {
  transformationOperationIdSchema,
  transformationOperationSchema,
  transformedEntrySchema,
  datasetTransformationManifestSchema,
  initialEntries,
  entriesDigest,
  executeTransformationOperation,
  buildTransformationManifest,
  replayManifest,
  computeManifestDigest,
  TRANSFORMATION_REPLAY_RULE,
  type TransformationOperationId,
  type TransformationOperation,
  type TransformedEntry,
  type DatasetTransformationManifest,
  type TransformationOutcome,
  type ManifestBuildInput,
} from "./manifest.js";

export {
  deliveryStrategyIdSchema,
  strategyApplicabilitySchema,
  strategySelectionSchema,
  upgradePolicySnapshotSchema,
  proposalSourceReferenceSchema,
  proposalTargetCapabilitySchema,
  evaluationSuiteReferenceSchema,
  proposalEventSchema,
  proposalStateSchema,
  capabilityUpgradeProposalSchema,
  PROPOSAL_TRANSITIONS,
  proposalStateIsTerminal,
  evaluateProposalTransition,
  computeProposalDigest,
  computePolicySnapshotDigest,
  validateProposalSemantics,
  PROPOSAL_IMMUTABILITY_RULE,
  type DeliveryStrategyId,
  type StrategyApplicability,
  type StrategySelection,
  type UpgradePolicySnapshot,
  type ProposalSourceReference,
  type ProposalTargetCapability,
  type EvaluationSuiteReference,
  type ProposalEvent,
  type ProposalState,
  type CapabilityUpgradeProposal,
  type TransitionCheck,
} from "./proposal.js";

export {
  packScopeSchema,
  retrievalIndexEntrySchema,
  scopedRetrievalIndexPayloadSchema,
  knowledgePackEntrySchema,
  structuredKnowledgePackPayloadSchema,
  toolAdapterPayloadSchema,
  rulesExamplesPayloadSchema,
  capabilityPackPayloadSchema,
  capabilityPackSchema,
  PACKABLE_STRATEGIES,
  computePackContentDigest,
  CAPABILITY_PACK_IMMUTABILITY_RULE,
  type PackScope,
  type PackCitation,
  type CapabilityPackPayload,
  type CapabilityPack,
} from "./pack.js";

export {
  selectStrategy,
  scopeEntries,
  scrubSecrets,
  redactPii,
  tokenize,
  computeBuildInputsDigest,
  mostRestrictiveClass,
  type CapabilityStrategy,
  type StrategyBuildInput,
  type StrategyBuildOutcome,
  type StrategyBuildLog,
  type StrategyApplicabilityInput,
  type StrategySelectionResult,
  type ScopedEntryExclusion,
  type FineTuningStubRecord,
  type FineTuningAuthorizationChainLike,
} from "./strategy/port.js";

export {
  ScopedRetrievalIndexStrategy,
} from "./strategy/retrieval-index.js";
export { StructuredKnowledgePackStrategy, parseKeyedFields } from "./strategy/knowledge-pack.js";
export { ToolAdapterStrategy } from "./strategy/tool-adapter.js";
export { RulesExamplesStrategy } from "./strategy/rules-examples.js";
export {
  AuthorizedFineTuningStrategy,
  checkFineTuningGates,
  FINE_TUNING_GATES,
  type FineTuningGateCheck,
} from "./strategy/fine-tuning.js";

export {
  createPackConsultation,
  toolQuery,
  type PackConsultation,
  type ConsultationHint,
  type ToolQueryOutcome,
  type ToolQueryOptions,
} from "./runtime.js";

export {
  graderKindSchema,
  graderDescriptorSchema,
  targetTaskSchema,
  regressionCaseSchema,
  leakageProbeSchema,
  guardrailCaseSchema,
  pinnedEnvironmentSchema,
  suiteThresholdsSchema,
  capabilityEvaluationSuiteSchema,
  computeSuiteDigest,
  validateSuiteSemantics,
  gradeExactMatch,
  gradeSetOverlap,
  gradeRefusal,
  graderValidatorDescriptors,
  registerGraderValidators,
  type GraderKind,
  type GraderDescriptor,
  type TargetTask,
  type RegressionCase,
  type LeakageProbe,
  type GuardrailCase,
  type PinnedEnvironment,
  type SuiteThresholds,
  type CapabilityEvaluationSuite,
  type SetOverlapMetrics,
} from "./eval/suite.js";

export {
  HARNESS_VERSION,
  BASELINE_WORLD_MODEL,
  TargetAgentHarness,
  computeEnvironmentDigest,
  extractField,
  extractFieldQuestion,
  type HarnessWorldModel,
  type HarnessAnswer,
  type HarnessOptions,
  type EnvironmentPin,
} from "./eval/harness.js";

export {
  evaluationTaskResultSchema,
  evaluationRunSchema,
  beforeAfterDeltaSchema,
  runCapabilityEvaluation,
  computeEvaluationRunDigest,
  type EvaluationTaskResult,
  type EvaluationRun,
  type BeforeAfterDelta,
  type RunEvaluationInput,
} from "./eval/run.js";

export {
  evidenceStageSchema,
  evidenceChainRecordSchema,
  renderEvidenceObject,
  isRecordableAsEvidence,
  describeEvidenceChain,
  type EvidenceStage,
  type EvidenceChainRecord,
  type RenderedEvidenceObject,
} from "./evidence.js";

export { UpgradeStore } from "./store.js";

export {
  publicationThresholdEvaluationSchema,
  publicationRightsSnapshotSchema,
  publicationDecisionSchema,
  rollbackRecordSchema,
  adoptionRecordSchema,
  CapabilityPublicationFlow,
  POPULARITY_BYPASS_GUARD_RULE,
  type PublicationDecision,
  type RollbackRecord,
  type AdoptionRecord,
  type PublishInput,
  type PublishOutcome,
} from "./publish/publication.js";

export { arenaUpgradeModule } from "./module.js";
