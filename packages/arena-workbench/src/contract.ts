export {
  ROLE_IS_NOT_AUTHORIZATION_RULE,
  WORKBENCH_LENSES,
  LENS_VIEWS,
  roleSwitcherModel,
  isWorkbenchLens,
  type WorkbenchLens,
  type LensView,
  type RoleSwitcherModel,
} from "./roles.js";

export {
  WORKBENCH_MACHINES,
  WORKBENCH_STATE_VIEWS,
  stateView,
  isWorkbenchMachine,
  type WorkbenchMachine,
  type StateView,
  type StateViewKind,
  type AttemptState,
  type EscalationState,
  type LearningState,
  type PaymentState,
} from "./states.js";

export {
  WORKBENCH_DEMO_DISCLOSURE,
  DEMO_TAG,
  DEMO_ACCEPTANCE_CRITERIA,
  DEMO_PROOF_POLICY_PRESET,
  DEMO_HEX_DIGEST,
  type DemoTag,
} from "./demo-fixtures.js";

export {
  validateEscalationDraft,
  type EscalationDraft,
  type FieldError,
  type BuildContext,
  type BuildDeps,
  type DraftValidation,
} from "./requester-form.js";

export {
  MockArenaClient,
  type ArenaWorkbenchClient,
  type WorkbenchPrincipal,
  type MockClientDeps,
  type EscalationSummary,
  type AttemptSummary,
  type SubmitOutcome,
  type LookupOutcome,
  type AttemptLookupOutcome,
  type CandidateSubmitOutcome,
  type SelfEvaluationSubmitOutcome,
  type ReviewDeckOutcome,
} from "./mock-client.js";

export {
  SELF_EVALUATION_IS_NOT_A_VOTE_RULE,
  validateCandidateDraft,
  validateSelfEvaluationDraft,
  evaluateExpertTransition,
  evaluateCandidateSubmission,
  evaluateSelfEvaluationSubmission,
  type CandidateDraft,
  type CandidateBuildContext,
  type CandidateValidation,
  type SelfAssessedCriterion,
  type SelfEvaluationDraft,
  type SelfEvaluationContext,
  type SelfEvaluationValidation,
  type StructuredSelfEvaluation,
  type ExpertFlowDeps,
} from "./expert-flow.js";

export {
  buildReviewDeck,
  partitionByRedactionClass,
  adjudicationView,
  type ReviewerCriterionRow,
  type VerificationTrail,
  type RedactionPartition,
  type ReviewDeckView,
  type AdjudicationView,
  type ReviewPolicyLike,
} from "./reviewer-deck.js";

export {
  DEMO_EXPERT_TENANT_ID,
  DEMO_EXPERT_PRINCIPAL,
  DEMO_ATTEMPT_OPEN,
  DEMO_ATTEMPT_SUBMITTED,
  DEMO_ATTEMPT_INCONCLUSIVE,
  DEMO_ATTEMPT_DIVERGENT,
  DEMO_EVIDENCE_RECORDS,
  DEMO_KNOWN_EVIDENCE_IDS,
  DEMO_RESULT,
  DEMO_RESULT_DIVERGENT,
  DEMO_SELF_EVALUATION,
  DEMO_SELF_EVALUATION_ALT,
} from "./demo-fixtures-expert.js";

export {
  DemoBanner,
  RoleSwitcher,
  StateBadge,
  FieldErrorList,
  RequesterCockpit,
} from "./screens/requester-cockpit.js";

export { ExpertQueue, ExpertWorkspace, SelfEvaluationPanel } from "./screens/expert-workbench.js";

export {
  RedactionBoundary,
  VerificationTrailView,
  ReviewerDeckScreen,
  AdjudicatorDeckScreen,
} from "./screens/reviewer-deck.js";
