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
  type EscalationSummary,
  type SubmitOutcome,
  type LookupOutcome,
} from "./mock-client.js";

export {
  DemoBanner,
  RoleSwitcher,
  StateBadge,
  FieldErrorList,
  RequesterCockpit,
} from "./screens/requester-cockpit.js";
