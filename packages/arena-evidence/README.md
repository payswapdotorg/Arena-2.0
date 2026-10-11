# @arena/evidence

AR2-007 — Evidence capture and proof-class validator pipeline. This package
implements the append-only **EvidenceEnvelope store**, the **validator
registry with bounded invocation**, output normalization, and the
**proof-class evaluator** for P0/P1/P2/P3 per the frozen proof policy
(`PVP1.0` in `@arena/contracts`).

> **DECISION-ONLY — NO PAYOUT AUTHORITY.** `ProofDecision` describes whether
> the proof policy is satisfied; this package **never writes payment
> eligibility or payout state** (AR2-007 write fence — payment belongs to
> AR2-010). P2/P3 decisions are **fail-closed** pending AR2-009 independent
> review and observation records; the author self-evaluation is never an
> independent vote.

## Why this seam exists (frozen rules)

- `EVIDENCE_IMMUTABILITY_RULE` — evidence objects are immutable after
  acceptance; corrections append a new envelope linked to the superseded fact.
- `CALLER_PROOF_TRUST_RULE` — a client-provided success boolean is never
  trusted; trusted-tier evidence must be signed, bound to
  tenant/escalation/attempt/environment/validator and replay-protected.
- `SELF_EVALUATION_IS_NOT_A_VOTE_RULE` — the structured self-evaluation is an
  immutable candidate artifact, not review input for payout.

## Surface

| Area               | Export                                        | Semantics                                                                                                                                                     |
| ------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evidence store     | `EvidenceStore.record`                        | schema (strict) → frozen semantics → binding → replay/correction-chain checks; typed `REJECTED` codes (`FORGED_UNSIGNED_TRUSTED_TIER`, `REPLAYED_EVIDENCE_ID`, `WRONG_TENANT`, `WRONG_ATTEMPT`, …) — zero store mutation on rejection |
| Validator registry | `ValidatorRegistry`                           | frozen `validatorDescriptorSchema` registration; `(validator_id, validator_version)` exact resolution; immutable descriptors (same key re-registration with a different body is refused) |
| Bounded invocation | `BoundedValidatorRunner` / `BoundedValidatorInvocation` | `allowed_commands` allowlist (else `COMMAND_NOT_ALLOWED`), real-timer `timeout_seconds` enforcement (else `TIMEOUT`), thrown errors become typed `EXECUTION_ERROR` — never a silent pass |
| Normalization      | `normalizeRun` / `normalizeFailure`           | typed verdicts per validator kind (deterministic / statistical samples / rubric dimensions); failures carry machine-readable codes                            |
| Proof evaluation   | `evaluateProof`                               | P0: baseline-FAIL → post-PASS with `minimum_reruns`; P1: frozen sample_size × repetitions aggregation, flaky never auto-passes; P2/P3: fail-closed without independent evidence; every decision carries `payout_implication: "decision_only"` |

## Disclosures

See `EVIDENCE_PIPELINE_DISCLOSURES` (exported). In short: the store is the
in-memory reference implementation behind the frozen AR2-001 schemas (durable
wiring rides the AR2-005 ports); `BoundedValidatorRunner` is a deterministic
in-memory adapter — real OS-isolated validator execution belongs to the
AR2-004 capsule seam and replaces the adapter without changing the port.

## Tests

`test/evidence.test.ts` (accept/reject battery),
`test/validator.test.ts` (registry + bounds), `test/proof-evaluator.test.ts`
(P0/P1/P2/P3 acceptance scenarios from issue #9).
