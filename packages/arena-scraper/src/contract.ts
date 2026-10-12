/**
 * arena-scraper 公开契约（AR2-017，issue #33）。
 *
 * 版本族决策：SCRP1.0 是独立版本化的契约族 —— 冻结的 CF1.0（@arena/contracts）
 * 与 ACQ1.0（@arena/acquisition）在本包内绝不被编辑或扩展；三个家族仅通过
 * 不可变 correlation/causation ID 与对方公开导出的复用形状关联。
 *
 * 包外只允许从本文件 import（deep import 被禁止）；语义规则常量与 schema
 * 一起导出，因为它们同属 SCRP1.0 契约。
 */

export { SCRAPER_SCHEMA_FAMILY, CRAWLEE_PINNED_VERSION, SCRAPER_ENGINE_VERSION, type SemanticIssue } from "./primitives.js";

export {
  scrpErrorCodeSchema,
  scrpErrorEnvelopeSchema,
  scrpError,
  scrpHttpStatusFor,
  isScrpRetryable,
  classifyShapeIssues,
  describeShapeIssues,
  SCRP_ERROR_CATALOG,
  SCRP_ERROR_CATALOG_STABILITY_RULE,
  type ScrpErrorCode,
  type ScrpErrorEnvelope,
  type ShapeIssue,
} from "./errors.js";

export {
  scraperDefinitionSchema,
  checkScraperDefinition,
  validateScraperDefinitionSemantics,
  computeScraperDefinitionDigest,
  seedWithinScope,
  domainMatches,
  scraperVersionSchema,
  checkScraperVersion,
  httpSchemeSchema,
  acquisitionMethodSchema,
  sourceScopeSchema,
  sourceSafetyProfileSchema,
  rightsProfileSchema,
  robotsPolicySchema,
  resourcePolicySchema,
  runtimeRequirementsSchema,
  dependencyLockEntrySchema,
  buildSourceSchema,
  SCRAPER_VERSION_IMMUTABILITY_RULE,
  type ScraperDefinition,
  type ScraperVersion,
  type ScraperDefinitionCheck,
  type ScraperVersionCheck,
} from "./scraper-definition.js";

export {
  scraperBuildSchema,
  checkScraperBuild,
  buildStateSchema,
  buildTransitionSchema,
  buildLifecycleAllows,
  buildStateIsTerminal,
  BUILD_LIFECYCLE_TRANSITIONS,
  GENERATED_CODE_IS_DATA_RULE,
  BUILD_FAIL_CLOSED_RULE,
  type ScraperBuild,
  type BuildState,
  type BuildTransition,
  type GateResult,
} from "./scraper-build.js";

export {
  acquisitionRunSchema,
  checkAcquisitionRun,
  runStatusSchema,
  runEventSchema,
  runQuotaSchema,
  runLeaseSchema,
  runStatusIsTerminal,
  UNKNOWN_NOT_FAILURE_RULE,
  RUN_IDEMPOTENCY_RULE,
  RUN_LEASE_FENCING_RULE,
  type AcquisitionRun,
  type RunStatus,
  type RunEvent,
  type RunQuota,
  type RunLease,
  type AcquisitionRunCheck,
} from "./acquisition-run.js";

export {
  datasetArtifactSchema,
  checkDatasetArtifact,
  datasetItemSchema,
  transformationStepSchema,
  DATASET_IMMUTABILITY_RULE,
  INJECTION_IS_DATA_RULE,
  type DatasetArtifact,
  type DatasetItem,
  type DatasetCheck,
} from "./dataset-artifact.js";

export {
  apiConnectorDescriptorSchema,
  checkApiConnectorDescriptor,
  credentialReferenceSchema,
  connectorAmbiguitySchema,
  verifyConnectorWebhook,
  connectorHttpRequest,
  PAID_PROVIDER_FAIL_CLOSED_RULE,
  CREDENTIAL_IS_REFERENCE_RULE,
  type ApiConnectorDescriptor,
  type CredentialReference,
  type ConnectorCallRequest,
  type ConnectorCallOutcome,
  type ReconcileOutcome,
  type ExternalApiConnectorPort,
  type SecretResolver,
  type DescriptorCheck,
  type WebhookVerification,
} from "./connector.js";
export { ApifyAdapter, type ApifyAdapterConfig, type ApifyAdapterOptions } from "./apify-adapter.js";

export {
  APPROVED_DEPENDENCY_LICENSES,
  GATE_ROLES,
  generateBuildPlan,
  computeBuildDigest,
  runStaticValidationGate,
  runDependencySourceLicenseReviewGate,
  runBuildGate,
  runFixtureGate,
  runSourcePolicyBudgetGate,
  type FixtureRunReport,
  type GateName,
} from "./build-gates.js";

export {
  ScraperFactory,
  type ScraperFactoryConfig,
  type FixtureRunner,
  type FactoryCommandResult,
  type ReleaseResult,
} from "./factory.js";

export {
  EgressGuard,
  prohibitedIpv4Label,
  prohibitedIpv6Label,
  prohibitedAddressLabel,
  domainMatchesAllowlist,
  EGRESS_FAIL_CLOSED_RULE,
  type EgressPolicyConfig,
  type ApprovedEndpoint,
  type DnsResolver,
  type EgressCheck,
} from "./runtime/egress.js";

export {
  parseRobots,
  isAllowedByRobots,
  robotsCrawlDelayMs,
  SourcePolicy,
  ROBOTS_IS_NOT_AUTHORIZATION_RULE,
  type RobotsRules,
  type RobotsFetcher,
  type SourcePolicyConfig,
  type SourcePolicyVerdict,
} from "./runtime/source-policy.js";

export {
  CrawlBudget,
  type CrawlBudgetSpec,
  type BudgetStopReason,
  type BudgetVerdict,
} from "./runtime/budget.js";

export {
  QuarantineLayer,
  QUARANTINE_INVARIANT_RULE,
  type QuarantineConfig,
  type FetchDisposition,
  type SanitizeResult,
} from "./runtime/quarantine.js";

export {
  HttpValidatedFetcher,
  guardedRobotsRequest,
  EgressDeniedError,
  FetchBudgetStopError,
  FetchRetryExhaustedError,
  type FetchedResponse,
  type ValidatedFetchOptions,
} from "./runtime/fetch.js";

export {
  CrawlerEngine,
  extractLinks,
  linkWithinScope,
  contentHashOf,
  type CrawledItem,
  type CrawlResult,
  type CrawlEngineOptions,
  type CrawlEventKind,
} from "./runtime/crawler.js";

export { assembleDataset } from "./runtime/assembly.js";

export {
  ScraperRunService,
  type StartRunCommand,
  type RunCommandOutcome,
  type ExecuteOutcome,
  type RunServiceConfig,
} from "./run/run-service.js";
export { RunStore, DatasetStore, commandDigestOf } from "./run/store.js";
export { decideTerminalState } from "./run/crawl-support.js";
export {
  buildScraperCapsuleManifest,
  SYNTHETIC_ISOLATION_SUITE_DIGEST,
  SYNTHETIC_CAPSULE_DISCLOSURE,
} from "./run/capsule-manifest.js";

export { arenaScraperModule } from "./module.js";
