/**
 * AR2-010 显式披露（诚实边界 —— 与 capsule/evidence 披露纪律一致）。
 */
export const PAYMENT_DOMAIN_DISCLOSURES = {
  production:
    "PRODUCTION_ENABLED is a frozen false literal: live transfers stay disabled until a written commercial release decision records ownership, jurisdiction, provider, tax, KYC/AML, refunds/disputes and reconciliation controls (PVP1.0 §4)",
  settlement:
    "eligibility is not settlement: EVIDENCE_ACCEPTED and READY_TO_RELEASE are not SETTLED — provider acknowledgement plus ledger reconciliation establish settlement",
  ledger:
    "the PaymentLedger is the in-memory reference implementation; durable wiring rides the AR2-005 ports at the composition root (interface unchanged)",
  p2_p3:
    "P2/P3 payout gates fail closed: rubric-plus-independent-approval and observation-gated releases require AR2-009 review/observation records and never auto-release here",
} as const;

export type PaymentDomainDisclosures = typeof PAYMENT_DOMAIN_DISCLOSURES;
