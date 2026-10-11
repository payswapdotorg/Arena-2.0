/**
 * arena-acquisition 公开契约（AR2-016，issue #32）。
 *
 * 版本族决策：ACQ1.0 是独立版本化的契约族 —— 冻结的 CF1.0 语料
 * （@arena/contracts）在本包内绝不被编辑或扩展；两个家族仅通过不可变
 * correlation/causation ID 关联，共享形状（TenantContext、验收 criterion、
 * 基础 schema）一律复用 @arena/contracts 的公开导出。任何共享信封的变更
 * 都需要新的 ACR 与显式的 schema 迁移/版本化（ACR-0002 §兼容性）。
 *
 * 包外只允许从本文件 import（deep import 被禁止）；语义规则常量与 schema
 * 一起导出，因为它们同属 ACQ1.0 契约。
 */

export { ACQUISITION_SCHEMA_FAMILY } from "./primitives.js";
export { canonicalJsonStringify, computeCanonicalDigest } from "./canonical.js";

export {
  acqErrorCodeSchema,
  acqErrorEnvelopeSchema,
  acqError,
  acqHttpStatusFor,
  isAcqRetryable,
  classifyShapeIssues,
  describeShapeIssues,
  ACQ_ERROR_CATALOG,
  ACQ_ERROR_CATALOG_STABILITY_RULE,
  type AcqErrorCode,
  type AcqErrorEnvelope,
  type AcqErrorCatalogEntry,
  type ShapeIssue,
} from "./errors.js";

export {
  capabilityGapReportSchema,
  reproCaseSchema,
  gapReporterSchema,
  gapTargetSchema,
  gapCapabilityStatementSchema,
  gapConstraintBoundariesSchema,
  gapPrivacyConstraintsSchema,
  checkCapabilityGapReport,
  validateCapabilityGapReportSemantics,
  computeGapReportDigest,
  describeGapReportIssues,
  GAP_REPORT_NO_CHAIN_OF_THOUGHT_RULE,
  GAP_REPORT_IS_NOT_CLOSURE_PROOF_RULE,
  type CapabilityGapReport,
  type ReproCase,
  type GapReporter,
  type GapTarget,
  type GapCapabilityStatement,
  type GapConstraintBoundaries,
  type GapPrivacyConstraints,
  type GapReportCheck,
} from "./gap-report.js";

export {
  capabilityAcquisitionRequestSchema,
  acquisitionRouteModeSchema,
  pinnedProviderReferenceSchema,
  gapReferenceSchema,
  acquisitionScopeSchema,
  dataUsePolicySchema,
  preferredRouteSchema,
  checkCapabilityAcquisitionRequest,
  validateAcquisitionRequestSemantics,
  acquisitionRequestDigestInput,
  computeAcquisitionRequestDigest,
  ACQUISITION_REQUEST_TENANT_RULE,
  ACQUISITION_SCHEMA_FAMILY_RULE,
  FALLBACK_CONSTRAINTS_RULE,
  type CapabilityAcquisitionRequest,
  type AcquisitionRouteMode,
  type PinnedProviderReference,
  type GapReference,
  type AcquisitionScope,
  type DataUsePolicy,
  type PreferredRoute,
  type AcquisitionRequestCheck,
} from "./acquisition-request.js";

export {
  providerKindSchema,
  providerStatusSchema,
  sourceRightsPostureSchema,
  capabilityOfferSchema,
  capabilityProviderDescriptorSchema,
  checkCapabilityProviderDescriptor,
  createProviderRegistry,
  listVisibleProviders,
  findVisibleProviderVersions,
  findVisibleProviderVersion,
  type ProviderKind,
  type ProviderStatus,
  type SourceRightsPosture,
  type CapabilityOffer,
  type CapabilityProviderDescriptor,
  type CapabilityProviderRegistry,
  type DescriptorCheck,
  type RegistryCheck,
} from "./provider-registry.js";

export {
  routeFilterSchema,
  routeOutcomeSchema,
  planKindSchema,
  planStepRoleSchema,
  rejectedCandidateSchema,
  eligibleCandidateSchema,
  selectedPlanSchema,
  routeDecisionSchema,
  validateRouteDecisionSemantics,
  ROUTE_POLICY_VERSION,
  NO_MODEL_ROUTING_RULE,
  ROUTE_DECISION_AUDIT_RULE,
  ROUTE_FALLBACK_AUDIT_RULE,
  type RouteFilterId,
  type RouteOutcome,
  type PlanKind,
  type PlanStepRole,
  type RejectedCandidate,
  type EligibleCandidate,
  type SelectedPlan,
  type RouteDecision,
  type DecisionSemanticIssue,
} from "./route-decision.js";

export {
  routeAcquisitionRequest,
  DEFAULT_ROUTING_POLICY,
  type RoutingPolicy,
  type RoutingState,
  type RoutingInput,
} from "./router.js";

export { arenaAcquisitionModule } from "./module.js";
