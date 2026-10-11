# @arena/matching

AR2-008 — Expert identity, capability matching, qualification and conflict
checks. This package compiles the **capability demand** from a frozen
`EscalationRequest`, screens expert candidates with **explainable per-dimension
verdicts**, and routes the **next eligible expert** inside hard budget/deadline
guardrails.

> **QUALIFICATION IS NOT AUTHORIZATION.** Match rows are policy-screening
> decisions only; the authority to act comes from the server-derived tenant
> context, never from a match. No assignment happens before every policy check
> (capability level + evidence backing, qualification evidence/jurisdiction,
> jurisdiction coverage, availability/capacity, conflict-of-interest) passes.

## Surface

| Area     | Export                       | Semantics                                                                                                                                                    |
| -------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Profiles | `checkExpertProfile`         | strict schema (unknown fields rejected); qualifications require ≥1 evidence ref                                                                              |
| Levels   | `levelSatisfies`             | ordered vocabulary with fail-closed unknown-level handling                                                                                                   |
| Conflict | `evaluateConflictOfInterest` | typed reasons (`same_expert_as_failed_attempt`, `prior_involvement_disclosed`, `tenant_relationship_conflict`)                                               |
| Demand   | `compileCapabilityDemand`    | capabilities + qualifications + jurisdiction + budget/attempt/deadline guards mirrored from the frozen request                                               |
| Matching | `matchExperts`               | per-dimension verdicts + the three decision digests anchoring into the frozen `expertAssignmentSchema`; evidence-backed claims only (empty refs fail closed) |
| Routing  | `routeNextExpert`            | hard boundaries first (attempt count, aggregate spend, deadline), then first eligible; failed attempts retain attribution and exclude the same expert        |

## Disclosures

See `MATCHING_DISCLOSURES` (exported). Candidate order is caller-supplied
(matching ranks eligibility, not reputation — popularity never appears as a
dimension); routing guards are hard boundaries evaluated before eligibility.

## Tests

`test/matching.test.ts` — profile validation, level ordering, explainable
rows with digests, each policy-check gate (evidence/level/jurisdiction/
capacity/conflict), the qualification-is-not-authorization structural
assertion, routing stops, attribution-preserving exclusion, and the typed
no-eligible outcome.
