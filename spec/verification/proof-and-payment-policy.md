# Proof Classes, Verification, and Outcome-Linked Payment Policy

Status: OWNER-APPROVED product rule; provider/legal integration remains unimplemented.
Policy version: PVP1.0
Normative source: this file plus spec/architecture-lock.md.

## 1. Core rule

Arena should unlock expert payment when an agreed success condition is demonstrably met. Where the originating application can reliably prove the expert's solution at the application level, the application-level proof is the primary verification mechanism. Where the claimed outcome cannot be demonstrated by trustworthy application evidence, Arena owns the burden of proof and must use stricter independent evaluation and adjudication.

Payment is never triggered by expert confidence, a self-rating, a thumbs-up ratio, a successful upload, a status label supplied without evidence, or an unvalidated webhook.

At request creation, persist the agreed proof class, acceptance criteria, validators, baseline evidence requirements, rerun policy, timeout, dispute conditions, budget ceiling and payment policy version. These cannot be retroactively weakened after the work has begun. Changes require explicit client approval and versioned amendment.

## 2. Proof classes

### P0 — Deterministic application-level proof

Use when a deterministic, independently rerunnable validator establishes the exact required outcome, such as a software project that failed to compile before intervention and compiles/tests successfully afterward.

Examples: build and tests pass in a pinned toolchain; a schema migration passes a defined test suite; a deterministic CAD validation or formal constraint check passes a specified predicate where that predicate is the acceptance criterion.

Required evidence:

- Baseline result and exact environment manifest before intervention.
- Immutable intervention/change manifest, including file/artifact hashes and approved tool action records.
- Post-intervention result from an isolated trusted runner or an authenticated application runner.
- Validator identity/version, inputs, exit status or structured result, timestamps, logs/artifacts and hashes.
- Reproducibility policy: default rerun at least once for payout-critical deterministic checks, or a documented risk-based exception.
- Causal relationship between submitted intervention and validated post-state. Unrelated external changes must be detected or the proof is inconclusive.

Payment may move to READY_TO_RELEASE only when all agreed predicates pass and the caller's proof authenticity and task binding are verified. Failed validation is not success. Inconclusive/flaky validation does not pay automatically; retry within the agreed budget, use independent review, or request the next eligible expert.

### P1 — Application-observable but non-deterministic proof

Use when the application can observe a meaningful outcome but conditions vary or results are probabilistic. Examples may include performance targets under a defined load profile, reliability across repeated test runs, operational workflow completion, or a bounded simulation.

Required evidence: the P0 provenance fields plus prespecified sample size, repetitions, thresholds, confidence/variance handling and a rule for inconclusive outcomes.

Payment requires the predefined aggregate threshold to pass. A single lucky run cannot override the policy. If confidence bounds cross the threshold or evidence is incomplete, send the result to independent review or the next eligible expert; do not silently count it as a pass.

### P2 — Arena-adjudicated expert proof

Use where application-level evidence cannot establish correctness, including many forms of legal analysis, professional judgment, business strategy, design quality, diagnosis/recommendation, and domain-specific work whose true outcome is uncertain or delayed.

Arena is responsible for obtaining enough evidence for the claim. Required controls are:

- Task-specific, versioned rubric established before candidate review.
- Qualification and conflict-of-interest checks for evaluators.
- Structured expert self-evaluation separated from independent reviews.
- Default minimum of two independent blind reviews; raise to three or more for high-impact, disputed, safety-critical or highly subjective tasks.
- Evidence-backed scoring by rubric dimension, not one undifferentiated star score.
- Independent adjudication when reviewers disagree beyond preset thresholds, either required reviewer rejects, or a safety/professional concern is raised.
- Explicit policy for abstention, missing evidence, reviewer replacement, tie-break, revision and appeal.
- Rationale and evidence references retained in the audit record without exposing confidential reviewer notes beyond policy.

A preset rubric threshold plus required independent approval and no unresolved hard-stop concern is required before payment becomes READY_TO_RELEASE. The requester may add a client acceptance requirement but cannot use a late-changing rubric to avoid payment for work that met the versioned criteria.

### P3 — External, delayed, or field outcome

Use when success depends on real-world outcomes or external events beyond immediate application inspection. Examples include construction performance, a commercial outcome, a field inspection, or an intervention with a delayed result.

Define observation period, trusted evidence sources, who attests to the result, risk of confounding, interim/partial payment milestones and dispute process before work starts. If independent field evidence is not yet available, use an agreed holdback or milestone payment; do not mislabel an unobserved real-world result as proven.

High-risk engineering, healthcare, legal, security or other regulated work may require licensed professional review and compliance-specific rules even when an application validator exists. Application-level proof only proves the predicate it actually measures, not every wider safety or professional claim.

## 3. Proof-class selection

The requester may propose a class and provide validator capabilities. Arena's proof-policy engine validates the class based on task risk and available evidence. The selected class and rationale are immutable for that task version.

Prefer the strongest trustworthy application-level proof that actually establishes the agreed outcome. Do not choose P0 merely because a program exits with code zero if the acceptance claim is broader than compilation or tests. For mixed tasks, define proof requirements per acceptance criterion; payment is the conjunction of required criteria unless the contract explicitly defines separate milestones.

When proof capability is unavailable, caller evidence is untrusted, the validator is not reproducible, or causal attribution is ambiguous, downgrade to P2/P3 or stop for explicit requester approval. Never silently downgrade and keep automatic release enabled.

## 4. Payout state machine

Proposed payment states:

- NOT_APPLICABLE
- RESERVED
- PENDING_EVIDENCE
- EVIDENCE_ACCEPTED
- READY_TO_RELEASE
- RELEASE_SUBMITTED
- SETTLED
- DISPUTED
- REFUND_PENDING
- REFUNDED
- FAILED_REQUIRES_RECONCILIATION
- CANCELLED

Rules:

- Escalation acceptance, intervention submission, proof evaluation and payment settlement are separate state machines linked by IDs.
- A validation pass records an immutable evidence decision. A retry creates a new attempt; it does not overwrite the failed attempt.
- EVIDENCE_ACCEPTED and READY_TO_RELEASE are not equivalent to SETTLED. The provider acknowledgement and ledger reconciliation establish settlement.
- Release commands are idempotent by payment operation ID; database uniqueness prevents duplicate transfers.
- Webhooks are signature-verified, timestamp/replay checked, event-ID deduplicated and reconciled with provider state.
- If a provider times out after a transfer request, query/reconcile before retrying. Do not issue a new operation blindly.
- A disputed or inconclusive result blocks release pending the documented resolution policy.
- The author-expert cannot approve their own proof, adjudication or payout.
- The caller's maximum budget is enforced durably. Escalating to the next expert must not exceed the authorized aggregate or per-attempt limit without client approval.
- A replacement expert gets the prior history needed to avoid repeated failed attempts but does not inherit another expert's attribution or payment entitlement.
- Live transfers remain disabled until commercial ownership, jurisdiction, provider, tax, KYC/AML, refunds/disputes, reconciliation, controls and a written release decision are recorded.

## 5. Retry / next eligible expert policy

An eligible expert must match required capability, current qualification, jurisdiction/sector constraints, capacity, conflicts, privacy/authorization and budget. A failed validator or explicit inability to solve creates a failed attempt with evidence and reason codes. The router excludes or cools down the prior expert according to policy, then selects the next candidate.

Before reassigning, decide whether the failed attempt's changes must be rolled back, isolated as a branch/version, or retained as a clearly attributed candidate. Never merge conflicting solutions automatically. The next expert works from a known immutable baseline plus approved prior attempts, if policy permits.

Bound retries by the authorized budget, deadline and maximum number of attempts. On exhaustion, return typed failure or request more budget; never spend beyond authorization. Evidence disputes go to adjudication rather than infinite retries.

## 6. Trust model for caller-supplied proof

Trusted runner evidence must be signed or authenticated, bound to tenant, escalation, attempt, environment and validator version, and protected against replay. Do not trust a client-provided boolean such as successful=true by itself.

Support evidence issuers with explicit assurance tiers:

- Arena-controlled runner.
- Registered application runner with registered verifier key and attested configuration.
- External evidence source accepted by named policy.
- Untrusted attachment, which is review input only.

A caller can request a verification profile and register a validator descriptor, but Arena must validate schema, allowed commands/scopes, timeout, resource limits and evidence envelope before executing it. Validators execute inside a bounded environment without unrestricted production secrets.

## 7. Required tests

- Before-fail/after-pass software compile example releases exactly once after evidence passes.
- Before-fail/after-fail does not pay, records a failed attempt and routes to next eligible expert within budget.
- Forged, replayed, stale, wrong-tenant or wrong-attempt evidence is rejected.
- Duplicate callbacks and concurrent release requests produce one ledger outcome and one provider operation.
- A worker crash between evidence acceptance and payment scheduling recovers from durable records.
- Nondeterministic validators use the configured sample/rerun rule; flaky or inconclusive evidence cannot pass by accident.
- A P2 task cannot release with only self-evaluation or a popularity score.
- Reviewer conflict, insufficient quorum, disagreement and appeal routes are tested.
- P3 delayed outcome cannot be auto-settled before its required observation gate.
- Provider timeout is reconciled before retry and never causes duplicate transfer.
