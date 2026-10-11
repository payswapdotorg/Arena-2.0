export {
  validateGateRegistry,
  decideRelease,
  gateRowSchema,
  gateSectionSchema,
  gateScopeSchema,
  gateClassificationSchema,
  gateEvidenceSchema,
  gateFindingSchema,
  RELEASE_GATE_DISCLOSURE,
  type GateSection,
  type GateScope,
  type GateClassification,
  type GateEvidence,
  type GateFinding,
  type GateRow,
  type ReleaseDecision,
  type RegistryValidation,
} from "./gate-registry.js";

export { buildCanonicalGateRows, type GateReportMeta } from "./canonical-rows.js";

export { coreReleaseDecision, renderGateReport } from "./gate-report.js";

export { arenaReleaseGateModule } from "./module.js";
