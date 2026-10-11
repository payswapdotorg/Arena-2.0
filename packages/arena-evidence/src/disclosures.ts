/**
 * AR2-007 显式披露（诚实边界 —— 与 AR2-002/004 的披露纪律一致）。
 * 任何组合根（main/测试）使用本包时必须携带这些披露。
 */
export const EVIDENCE_PIPELINE_DISCLOSURES = {
  runtime:
    "AR2-007 evidence pipeline: the EvidenceStore is the in-memory reference implementation behind the frozen AR2-001 envelope schemas; durable wiring rides the AR2-005 ports when the composition root adopts it",
  validator_execution:
    "BoundedValidatorRunner is a deterministic in-memory adapter honoring allowed_commands and timeout_seconds; real OS-isolated validator execution belongs to the AR2-004 capsule seam (UPSTREAM_RUNTIME_NOT_A_BOUNDARY_RULE) and replaces the adapter without changing this port",
  p2_p3:
    "P2/P3 decisions are fail-closed pending AR2-009 independent-review and observation records; the author self-evaluation is never an independent vote and never satisfies a payout gate",
  payout:
    "ProofDecision is decision-only: this package never writes payment eligibility or payout state (AR2-007 write fence; payment belongs to AR2-010)",
} as const;

export type EvidencePipelineDisclosures = typeof EVIDENCE_PIPELINE_DISCLOSURES;
