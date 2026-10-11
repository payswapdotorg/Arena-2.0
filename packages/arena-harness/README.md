# @arena/harness

AR2-012 — integrated vertical end-to-end acceptance harness and next-expert
path (issue #14; canonical acceptance gates:
[spec/testing/acceptance-gates.md](../../spec/testing/acceptance-gates.md)).

Write fence held: **integration harness, test apps and evidence only — no
parallel fake module implementations.** Every scenario composes REAL
components:

- real `arena-api` child processes (tsx `main.ts`, durable sqlite runtime,
  demo tokens, real HTTP);
- AR2-007 `evaluateProof` (the predeclared validator pipeline);
- AR2-010 `PaymentFlow` + `PaymentLedger` + `InMemoryTestProvider`
  (test-mode payment domain, disclosed);
- AR2-008 `matchExperts` / `routeNextExpert` (conflict-checked routing);
- AR2-009 Expert Arena machinery (machines, candidate registry, reviewer
  eligibility, rubric, quorum, adjudication, round outcome);
- AR2-011 SDK + signed webhook dispatcher/receiver (real HTTP);
- AR2-013 `assembleCorrelationTrace` (request → events → payment).

## Acceptance profiles (tests)

| Profile                           | File                                 | Proves                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — P0 vertical                   | `test/vertical-p0.test.ts`           | baseline failing software task → real lifecycle commands → predeclared validator proof (SATISFIED) → exactly ONE test payment operation → full event stream via signed webhooks (apply-once) → stable-ID trace request → events → payment                                                                                                          |
| B — next-expert path              | `test/next-expert.test.ts`           | first expert attempt FAILED → payment gate BLOCKED (failed attempt never pays) → AR2-008 routes the next eligible expert within budget (failed expert excluded, attribution retained) → second attempt pays exactly once                                                                                                                           |
| C — P2 independent review         | `test/p2-review.test.ts`             | P2 proof fail-closed (INCONCLUSIVE → independent_review) → automated payout gate NOT_READY (frozen fail-closed, disclosed — never bypassed) → Expert Arena: immutable candidates with never-a-vote self-evaluations, conflict-checked reviewers, frozen rubric, quorum, disagreement adjudication → round outcome with payment operation reference |
| D — two-instance + crash recovery | `test/two-instance-recovery.test.ts` | two real API processes share one durable sqlite file (WAL) — cross-process canonical state; SIGKILL one instance mid-flight → restart → no state lost, outbox still delivers every event exactly once (no double delivery/double payment)                                                                                                          |

Public commands flow through the real API edge (SDK); system-autonomous
triggers (`SystemProposeOffer`, `SystemRecordProofDecision`, …) are driven by
the orchestrator through the real application executor on a second durable
connection — the documented multi-connection topology (AR2-005 acceptance
scenario 3 basis).

## Disclosures

- DEMO auth registry, test-mode payment provider, synthetic fixtures —
  production adapters are commercial-gated swaps (per-package disclosures).
- The frozen P2 payout gate in `@arena/payment` remains fail-closed exactly as
  recorded in the AR2-010 ledger; the harness **discloses** this and composes
  the AR2-009 independent-review path around it — it never bypasses frozen
  semantics.
- `scenarioP0Policy` / `scenarioP2Policy` are complete CF1.0
  `ProofPolicySnapshot`s (P0 deterministic fixture-table; P2 rubric +
  independent review with a frozen `review_policy`).
