export {
  evaluateTransition,
  reachableStates,
  checkCompleteness,
  isAllowedEdge,
  assertTransitionThrows,
  transitionCommandSchema,
  type StateMachineDefinition,
  type TransitionRule,
  type StateDoc,
  type GuardFacts,
  type GuardId,
  type TransitionEvaluation,
  type TransitionCommand,
  type CompletenessIssue,
} from "./machine.js";

export { ES20_INVARIANTS, ALL_MACHINES, type InvariantSpec } from "./invariants.js";
