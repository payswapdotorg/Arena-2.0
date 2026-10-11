export {
  CAPABILITY_LEVEL_ORDER,
  checkExpertProfile,
  levelSatisfies,
  evaluateConflictOfInterest,
  type CapabilityLevel,
  type CapabilityClaim,
  type QualificationClaim,
  type ExpertProfile,
  type ProfileCheck,
  type ConflictReason,
  type ConflictContext,
  type ConflictOutcome,
} from "./expert-profile.js";

export {
  compileCapabilityDemand,
  matchExperts,
  routeNextExpert,
  type CapabilityDemand,
  type DimensionVerdict,
  type MatchRow,
  type MatchContext,
  type RoutingDecision,
  type RoutingState,
} from "./matcher.js";

export { MATCHING_DISCLOSURES, type MatchingDisclosures } from "./disclosures.js";
