# Escalation Lifecycle Contract

Contract version: ES2.0 draft for implementation freeze.
Normative sources: spec/architecture-lock.md and spec/verification/proof-and-payment-policy.md.

## 1. Request envelope

Every request requires:

- contract_version;
- client_application_id and tenant derived from authenticated context;
- caller_idempotency_key and a canonical request digest;
- task title and outcome description;
- versioned task type/domain, required capabilities and qualifications;
- immutable acceptance criteria with criterion IDs, measurement definitions and hard-stop rules;
- proof class proposal and required evidence policy;
- constraints, risk tier, privacy and retention profile;
- budget limit/currency, allowed attempts, deadline and escalation modes;
- input artifact references with rights/provenance and hashes;
- result schema/version and delivery preferences;
- callback/webhook references where authorized.

The server derives tenant ownership from authenticated credentials; a caller-provided tenant field must not override it. Unknown fields are rejected or explicitly versioned, not silently interpreted.

## 2. Commands and queries

Initial commands: CreateEscalation, AmendEscalation, CancelEscalation, RespondToClarification, AcceptOffer, DeclineOffer, StartAttempt, SubmitIntervention, RequestRevision, SubmitSelfEvaluation, SubmitReviewerEvaluation, SubmitAppeal, AcknowledgeResult.

Initial queries: GetEscalation, ListEscalations, GetTimeline, GetAttempt, GetEvidence, GetResult, GetPaymentStatus and GetLearningProposals.

Each command requires actor and authorization policy, request ID, idempotency key, correlation ID and optional causation ID. Side-effecting commands persist their idempotent result. Read APIs enforce object-level tenant scope.

## 3. State ownership

- Escalation aggregate owns task lifecycle and versioned acceptance criteria.
- Attempt aggregate owns assignment, attempt budget consumption, capsule link and submitted candidate versions.
- Capsule host owns runtime provisioning, resource/egress controls and verified teardown; Arena stores manifests and references.
- Evidence store owns immutable evidence objects and trusted provenance metadata.
- Verification service owns validator invocations, reviews, adjudication and proof decisions.
- Payment domain owns eligibility decision, ledger and unique payout operations; provider adapter reports external facts.
- Learning service owns proposal/right/version/publication status.
- Requester application owns whether a returned result is applied to its live state.

No two modules can independently write the same authoritative state field. Cross-aggregate work coordinates with IDs, outbox events and explicit transitions.

## 4. Result envelope

A final result contains:

- result_id, escalation_id, attempt_id and tenant binding;
- status: ACCEPTED, PARTIALLY_ACCEPTED, REJECTED, INCONCLUSIVE, EXPIRED or FAILED;
- structured outputs conforming to the frozen schema;
- criterion-level decisions and proof class;
- evidence references and integrity digests;
- validator/reviewer/adjudicator versions, outcomes and policy version;
- limitations, assumptions, residual risk and follow-up recommendations;
- artifact version and lineage;
- payment eligibility reference, not a claim of actual settlement;
- correlation ID, timestamps and contract version.

Never return hidden chain-of-thought as required evidence. Sensitive fields and reviewer-private rationale use separate authorization scopes.

## 5. Event envelope

Domain events record event_id, schema_version, tenant_id, aggregate_type/id/version, event_type, occurred_at, recorded_at, actor_type/id, correlation_id, causation_id, request_id, policy_version, payload schema and redaction class. Events are immutable after acceptance. Correction emits a new event linked to the superseded fact; it never changes history invisibly.

An event becomes externally observable only after its authoritative state transaction commits. Webhook delivery uses a durable outbox and has a unique provider/event delivery identity, signature, timestamp, retry schedule and delivery attempts.

## 6. Required transition invariants

- No ASSIGNED state unless capability, qualification, conflict, privacy, budget and availability checks pass.
- No ENVIRONMENT_READY until a capsule manifest and isolation assurance are recorded.
- No SUBMITTED state without an immutable candidate version and artifact manifest.
- No VERIFYING state without a frozen acceptance and proof policy version.
- No ACCEPTED_RESULT unless the required P0/P1 validator conjunction or P2/P3 adjudication succeeds.
- No payment eligibility while evidence is inconclusive, disputed, self-approved or bound to the wrong tenant, attempt or revision.
- No customer result delivery before the final result record commits.
- No learning publication before rights, provenance, validation, scope and consent checks pass.
- No cancellation claim that conceals an already-performed external side effect.
- No retry beyond authorized aggregate budget or attempt count.
