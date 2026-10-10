# Arena 2.0 System Architecture

Version: SA1.0
Status: architecture approved; implementation not yet verified.
Companion normative documents:

- spec/architecture-lock.md
- spec/verification/proof-and-payment-policy.md
- spec/expert-arena/expert-arena.md
- spec/PROJECT-STATE.md

## 1. Goals and non-goals

Arena procures and acquires capability for AI applications. It accepts versioned task and capability-gap contracts, makes capability demand explicit, and can route to an eligible human expert, scraper/data provider, approved external API or policy-permitted composite plan. Bounded execution, source provenance, evidence and evaluation gates govern the result. It returns a structured outcome and optionally settles payment or proposes rights-cleared reusable learning.

V1 is not a general-purpose replacement for customer applications, an autonomous authority over customer systems, a microservice collection, or a marketplace where star ratings alone define correctness.

## 2. System contexts

External clients: third-party applications, agent frameworks, Epoch and the Arena web client.
Control plane: identity/tenancy, public API, escalation orchestration, matching, policy, evidence and result delivery.
Durable execution plane: recoverable workers for matching, capsule provisioning, validators, webhook delivery, reconciliation, retention and cleanup.
Capsule plane: isolated environments and tool adapters, with a strict action policy and bounded credentials.
Human surfaces: requester cockpit, expert workbench, reviewer/adjudicator workbench, developer portal and operations console.
Commercial plane: payment intents/authorizations, fee calculation, transfer/payout intent, ledger, provider adapter and reconciliation.
Learning plane: immutable intervention sources, rights/provenance checks, proposals, evaluation, publication and version management.

## 3. Runtime topology

Start as a modular monolith in one repository. The API and worker should be separately runnable processes because request latency and worker lifetimes differ. The capsule host is a separate trust boundary, not just another service object. Local development may use one process and a synthetic capsule, but it must visibly identify this mode and must never claim production-grade tenant isolation.

```text
Client / SDK / MCP
       |
       v
API edge -> Authentication -> Tenant/policy context
       |
       v
Application use cases -> Domain contracts / state machine
       |                         |
       v                         v
PostgreSQL-compatible store <-> Transactional outbox
       |                              |
       |                              v
       |                      Durable worker loop
       |                              |
       |                    Job + lease + retry records
       |                              |
       +------------------------------+
                                      |
                 +--------------------+------------------+
                 v                    v                  v
           Matching adapter      Capsule provider    Webhook sender
                                      |
                               isolated task runtime
                                      |
                               immutable evidence
                                      |
                         Validator / review / adjudication
                                      |
                     result decision + payment eligibility
                                      |
                   caller notification and ledger reconciliation
```

## 4. Module boundaries and dependency direction

Names below are logical boundaries. Before implementing them, inspect the actual fork and place them in existing workspace conventions; do not create a duplicate workspace or parallel package tree just to match these names.

- arena-contracts: versioned public request/result/event schemas; no provider imports.
- arena-domain: pure business types, invariants, state transitions, proof classes, policy decisions; no UI, database, network or SDK dependencies.
- arena-application: use cases and ports; orchestration over domain rules.
- arena-api: HTTP routes, runtime schema validation, authentication, authorization, error mapping, rate limits and public version negotiation.
- arena-mcp: MCP tools that call the same use cases and authorization path; never a parallel implementation of domain behavior.
- arena-persistence: migrations and adapters for relational records, unique/idempotency keys, ledger, outbox and job state.
- arena-workers: lease claim, retries, timeouts, recovery and external side effects.
- arena-capsule-contracts: environment manifests, permitted action/tool contract, resource policy, evidence contract and lifecycle.
- arena-capsule-host: actual isolation providers and runtime adapters. Never import a UI module.
- arena-verification: validator orchestration, proof evidence envelopes, evidence policy, independent review and adjudication.
- arena-payments: provider-neutral ledger and payout eligibility; provider APIs remain in adapters.
- arena-experts: onboarding, capability profiles, qualification evidence, availability, conflicts and reviewer quality.
- arena-learning: rights-gated artifact proposals, provenance graph, evaluation, publication and version lifecycle.
- arena-capability-acquisition: versioned capability-gap request, provider registry/router, route decisions, budget-aware fallback and capability-upgrade proposals; contracts remain provider-neutral.
- arena-scraper-runtime: versioned scraper definitions/builds and durable acquisition-run orchestration; calls only through the validated capsule and connector ports.
- arena-connectors: provider-specific data/API adapters (including optional Apify Actor/task API) behind provider-neutral ports; tokens remain in secret storage.
- arena-ui: projections of canonical API data. UI role/lens is not an authorization primitive.
- arena-sdk: typed client and examples; generated contracts or shared schemas are the source of type generation, not handwritten duplications.
- adapters/: integrations for database, object storage, queue/coordination, payments, email/notifications, identity and domain tools.

Dependency direction: UI/SDK/API/worker adapters call application use cases; application depends on domain and abstract ports; provider-specific adapters implement ports. Domain must not import UI, server, filesystem, provider SDK, database clients or payment SDKs. Avoid deep imports and cycles. One state machine has one owner and one write path.

## 5. Canonical data entities

All IDs are opaque stable identifiers; all tenant-owned objects carry a tenant boundary and are authorized on every access. Exact schema/field names are frozen in the contract work order before workers generate migrations or UI code.

- Tenant, Principal, Membership, PermissionGrant, ApiCredential.
- ClientApplication, SigningKey, WebhookEndpoint, WebhookDelivery.
- EscalationRequest, EscalationVersion, CapabilityDemand, AcceptanceCriterion, ProofPolicySnapshot.
- CapabilityGapReport, CapabilityAcquisitionRequest, CapabilityProviderDescriptor, RouteDecision, ScraperDefinition/Version, AcquisitionRun, DatasetArtifact, CapabilityUpgradeProposal, AcquisitionEvaluation.
- ExpertProfile, CapabilityClaim, QualificationEvidence, AvailabilityWindow, ConflictDeclaration.
- MatchDecision, Offer, Assignment, Attempt, Revision, BudgetReservation.
- Capsule, CapsuleManifest, CapsuleAction, Artifact, ArtifactVersion, EvidenceEnvelope, ValidatorRun.
- SelfEvaluation, IndependentReview, Adjudication, VerificationDecision, CertificationRecord.
- ResultEnvelope, ResultAcknowledgment.
- PaymentIntent, LedgerEntry, PayoutOperation, ReconciliationRecord, RefundOrDispute.
- LearningProposal, RightsGrant, ProvenanceEdge, EvaluationAsset, Body, BodyVersion, Possession, MarketplaceListing.
- AuditEvent, OutboxEvent, JobRecord, JobLease, IdempotencyRecord.

## 6. Escalation lifecycle

Request:
DRAFT -> VALIDATING -> ACCEPTED -> MATCHING -> OFFERED -> ASSIGNED -> ENVIRONMENT_READY -> IN_PROGRESS -> SUBMITTED -> VERIFYING -> ACCEPTED_RESULT or REVISION_REQUESTED or FAILED_VALIDATION -> (optional next attempt) -> RESULT_READY -> DELIVERED -> CLOSED.

Exceptional states:
CANCEL_REQUESTED, CANCELLED, EXPIRED, BUDGET_EXHAUSTED, NO_ELIGIBLE_EXPERT, DISPUTED, REQUIRES_HUMAN_REVIEW, FAILED_RETRYABLE and FAILED_FINAL.

Only declared transition commands can change state. Every transition stores actor, tenant, source state, target state, policy/contract version, reason code, correlation, causation, request ID, timestamp and evidence references. Duplicate commands return their recorded outcome. Invalid transitions reject with typed errors. Cancellation stops future work only to the extent each underlying adapter confirms; already completed external side effects remain recorded.

Each attempt has its own immutable work baseline, assigned expert, capsule, candidate revision, validator/review attempts, proof result and payment eligibility decision. Attempt failure is not request closure if budget and deadline permit another eligible expert.

## 7. Tenant isolation, identity and authorization

- Validate issuer, audience, expiration and intended action; bind every command to authenticated principal and tenant membership.
- Resolve tenant scope from trusted identity/API credential, not caller-controlled request fields alone.
- Check object ownership on every query and every referenced artifact. Avoid unscoped get-by-ID repository methods in application surfaces.
- Use resource-specific permissions and server-side policy. Capability qualification and UI role selection never grant authorization.
- Use separate, short-lived credentials per capsule. Never inject platform secrets or unrestricted customer production credentials by default.
- Enforce allowed egress, host allowlists, CPU/memory/time/storage quotas and explicit filesystem mounts at the isolation boundary.
- Redact secrets in logs and event payloads. Retention and deletion are explicit policies with a documented audit exception where lawful.
- Cross-tenant and untrusted requests fail closed.

## 8. Durable commands, jobs, and events

API request handling:

1. Authenticate principal and derive tenant.
2. Validate idempotency key and canonical request digest.
3. In one relational transaction, create or replay the durable idempotency result, write the aggregate change, append audit/event facts and create an outbox record.
4. Commit before responding that the request was accepted.
5. Worker claims outbox/job work with a lease, fencing/ownership token where needed, attempts, heartbeat and expiry.
6. Execute external side effect using a stable operation ID; persist the outcome.
7. Mark the job complete or retryable/dead-letter according to classified failure.
8. Reconciliation repairs ambiguous provider outcomes.

At-least-once delivery is assumed. Every consumer is idempotent. Exactly-once external effects are not assumed. Redis locks do not replace relational unique constraints or ownership checks. Jobs have timeout, heartbeat, bounded retry, backoff, jitter, cancellation semantics and operator visibility. Long jobs never depend solely on an in-memory Promise or process map.

## 9. Evidence architecture

Evidence is a versioned envelope bound to tenant, escalation, attempt, capsule, intervention version, criterion, validator/reviewer, toolchain and policy. It records origin and trust tier. Hash large files and store them in object storage; keep integrity metadata and ownership in the database. The evidence service ensures immutable references, scoped reads, retention policy and verified downloads.

The system must distinguish:

- Original artifact.
- Validator invocation and raw structured result.
- Normalized validator decision.
- Author self-evaluation.
- Independent review.
- Adjudication decision.
- Final proof decision.
- Payment eligibility and actual settlement.

Evidence is not overwritten. A correction creates a new attempt/version linked to prior evidence. See the proof-and-payment policy.

## 10. Payments and commercial records

Payment eligibility is a deterministic decision over accepted proof/adjudication, contract and budget version, attempt ownership, current dispute state, tenant and provider constraints. It produces a unique payout operation command. Payment provider state is reconciled into append-only ledger entries. A provider response is not inferred from a request timeout.

Keep authorization/reservation, expert payment, platform fee, refund, dispute, chargeback, payout and reconciliation distinct. Use a simulator for development. Do not wire live credentials, move real funds or claim a launch-ready marketplace before explicit commercial approval.

## 11. ZCode reuse and fork policy

Inspect the existing workspace before creating folders. Reuse the existing React/shared UI, Electron shell, server/RPC and CLI/runtime where the boundary is appropriate. Add Arena feature modules behind public exports. Keep Arena domain and APIs independent of internal ZCode agent state and provider configuration.

Do not assume the existing execution runtime is an OS sandbox. Expert execution must run through CapsuleProvider with an enforceable isolation boundary. Do not expose arbitrary host filesystem, shell, plugin, MCP or network operations merely because the upstream workbench supports them.

Preserve the upstream license, third-party manifests, NOTICE disclosures, attributions and security statements. Any change to copied or adapted modules remains subject to inherited terms.

## 12. Operability

Required health and metrics:

- API availability, auth denials, p95/p99 latency and rate-limit actions.
- Accepted job age, queue lag, lease expiry, retry/failure/dead-letter rates.
- Matching time, eligible candidate count, offer acceptance and reassignment reasons.
- Capsule provisioning latency, policy denials, resource use, egress blocks, timeout, teardown and cleanup drift.
- Validator outcomes, inconclusive/flaky rates, reviewer disagreement, adjudication overturns and evidence provenance failures.
- Payment pending age, provider reconciliation drift, duplicate operation prevention, disputes and refunds.
- Learning proposals by rights status, rejected reuse attempts and publication/deprecation outcomes.

Never log credentials, secret-bearing environment variables, private review notes or unrestricted customer payloads as generic diagnostics.

## 13. Initial deployment profiles

Local: synthetic demo data, fake payment provider, clearly labelled local/synthetic capsule, no public binding by default.
Preview: isolated database/schema, strict test credentials, fake payment by default, redacted telemetry, bounded resource/provider quotas.
Production: dedicated configuration and secrets, verified capsule provider, database backups and restore tests, durable worker recovery, webhook signing, object-store lifecycle, monitoring, incident runbooks, commercial/legal approval and live acceptance evidence.

No profile may silently fall back from a failed paid provider to an unapproved paid resource. Capacity exhaustion must be visible and fail closed.

## 14. Capability-acquisition extension (ACR-0002)

The acquisition router and Scraper Factory are specified in `spec/capability-acquisition/scraper-factory-and-capability-routing.md`. They add a separate versioned contract family and do not mutate frozen CF1.0 envelopes. Supported source kinds are SCRAPER, EXTERNAL_API and HUMAN_EXPERT; explicit modes are PINNED_PROVIDER, ANY_COMPATIBLE_PROVIDER and AUTO.

Crawlee (Apache-2.0) is the default reuse-first Node/TypeScript substrate. Apify is an optional external API provider; Arena owns capability routing, policy, quotas, durable run records, evidence and evaluation. Generated/user-authored scraper code runs only inside a genuinely isolated CapsuleProvider, never in the API process or an unverified workspace.

Acquired data is untrusted and is not automatically training data. Source rights, tenant privacy, provenance, schema validation and prompt-injection controls must pass. A capability-upgrade claim requires a reproducible before/after evaluation of the target gap. Retrieval/indexes, structured knowledge packs or bounded tools are preferred when suitable; fine-tuning requires explicit rights/policy approval and a reproducible training record.
