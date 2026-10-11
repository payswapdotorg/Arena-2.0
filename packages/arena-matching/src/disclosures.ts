/**
 * AR2-008 显式披露（诚实边界 —— 与 evidence/payment 披露纪律一致）。
 */
export const MATCHING_DISCLOSURES = {
  authorization:
    "qualification is not authorization: match results are policy-screening decisions only; the authority to act comes from the server-derived tenant context, never from a match row",
  explainability:
    "every match row carries per-dimension verdicts (capability level + evidence backing, qualification evidence/jurisdiction, jurisdiction coverage, availability) and the three decision digests that anchor into the frozen expertAssignmentSchema",
  ranking:
    "candidate order is caller-supplied (matching ranks eligibility, not reputation); popularity or self-ratings never appear as dimensions",
  routing:
    "routing guards are hard boundaries (attempt count, aggregate spend, deadline) evaluated before eligibility; failed attempts retain attribution and exclude the same expert from the next route",
} as const;

export type MatchingDisclosures = typeof MATCHING_DISCLOSURES;
