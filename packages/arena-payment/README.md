# @arena/payment

AR2-010 — Test-mode payment ledger and outcome-linked payout. This package
implements the append-only **payment ledger**, the **evidence-gate and
payout-gate eligibility** consuming AR2-007 `ProofDecision`s, and the
**payment flow** driving the frozen `paymentStateMachine` from
`@arena/contracts`, plus a scriptable **test-mode provider simulator**.

> **TEST MODE ONLY — LIVE TRANSFERS DISABLED.** `PRODUCTION_ENABLED` is a
> frozen `false` literal (the capsule precedent). Live money stays disabled
> until a written commercial release decision records ownership,
> jurisdiction, provider, tax, KYC/AML, refunds/disputes and reconciliation
> controls (PVP1.0 §4). **Eligibility is not settlement**:
> `EVIDENCE_ACCEPTED` and `READY_TO_RELEASE` are not `SETTLED` — provider
> acknowledgement plus ledger reconciliation establish settlement.

## Frozen rules enforced here

- **Release idempotency by payment operation ID** — the ledger registers
  amount movements (release/refund) under a unique operation id; duplicate
  submissions replay the original entry with zero mutation, so duplicate
  webhooks and concurrent releases produce **one ledger outcome and one
  provider operation**.
- **Invariant 6 (ES2.0 §6)** — `evidence_conclusive`, `not_disputed`,
  `not_self_approved`, `evidence_binding_correct` guard
  `PENDING_EVIDENCE → EVIDENCE_ACCEPTED`; FAILED/INCONCLUSIVE/disputed/
  self-approved evidence never passes the gate (fail-closed).
- **Payout gate (PVP1.0 §3)** — `READY_TO_RELEASE` requires the frozen
  `payout_gate` conjunction; P2/P3 gates fail closed pending AR2-009
  independent-review/observation records.
- **Reconcile before retry** — provider timeouts land in
  `FAILED_REQUIRES_RECONCILIATION`; retry must first query by operation id
  (ledger `providerAcked` + provider reconciliation channel). Never a blind
  retry.
- **Durable reservation** — amount movements reference a `BUDGET_RESERVED`
  ledger entry; no reservation, no payment.

## Surface

| Area        | Export                                        | Semantics                                                                                                                              |
| ----------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Ledger      | `PaymentLedger.append`                        | append-only; typed rejections (`UNKNOWN_RESERVATION`, `NEGATIVE_AMOUNT`, `SUPERSEDES_*`); movement-id uniqueness replays duplicates    |
| Eligibility | `evaluateEvidenceGate` / `evaluatePayoutGate` | guard-fact derivation from `ProofDecision` + frozen `payout_gate`; fail-closed P2/P3                                                   |
| Flow        | `PaymentFlow`                                 | reserve → startAttempt → recordProofDecision → release → reconcile; dispute → refund; cancel — every transition via the frozen machine |
| Simulator   | `InMemoryTestProvider`                        | per-operation scriptable acknowledge/timeout/settled; submit counting for duplicate-callback assertions                                |

## Disclosures

See `PAYMENT_DOMAIN_DISCLOSURES` (exported). The ledger is the in-memory
reference implementation (durable wiring rides the AR2-005 ports at the
composition root); the flow consumes AR2-007 decisions as decision-only
inputs and never re-evaluates proof.

## Tests

`test/ledger.test.ts` (append-only + uniqueness),
`test/payment-flow.test.ts` (issue #12 acceptance scenarios: exactly-one
release on P0 pass; failed/inconclusive never pay; duplicate/concurrent →
one outcome; timeout reconciles before retry; dispute → refund; frozen
`PRODUCTION_ENABLED`).
