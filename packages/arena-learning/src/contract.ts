export {
  RightsGrantRegistry,
  rightsGrantSchema,
  rightsScopeSchema,
  RIGHTS_DISCLOSURE,
  type RightsGrant,
  type RightsScope,
  type RightsEvaluation,
} from "./rights.js";

export {
  ProposalRegistry,
  learningProposalSchema,
  provenanceNodeSchema,
  provenanceNodeKindSchema,
  verifyProvenance,
  PROVENANCE_DISCLOSURE,
  type LearningProposal,
  type ProvenanceNode,
  type ProvenanceNodeKind,
  type ProvenanceCheck,
} from "./provenance.js";

export {
  BodyVersionRegistry,
  LearningPublicationFlow,
  bodyVersionSchema,
  compositionPartSchema,
  certificationSchema,
  compositionDigestOf,
  verifyCertificationBinding,
  BODY_MARKETPLACE_DISCLOSURE,
  type BodyVersion,
  type CompositionPart,
  type Certification,
  type CertificationCheck,
  type PublicationStepOutcome,
} from "./body-version.js";

export { arenaLearningModule } from "./module.js";
