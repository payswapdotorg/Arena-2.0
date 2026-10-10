# ACR-0002: Capability-gap Acquisition, Scraper Factory and Provider Routing

Status: proposed implementation change; requested by product owner on 2026-10-10. Merge this ACR with the accompanying work-order registration before dispatch.
Decision owner: repository owner / TL.
Base SHA: 63b0c9cd4481ea94c4e405322005aa422d64acae.
Linked work orders: AR2-016 (#32), AR2-017 (#33), AR2-018 (#34).
Primary spec: [Capability-gap Acquisition, Scraper Factory and Provider Routing](../capability-acquisition/scraper-factory-and-capability-routing.md).

## Context

Arena currently routes capability demands toward human expertise and supports evidence-gated learning. The product owner wants agents to request targeted web scrapers, reuse compatible scrapers, call external APIs (including optional Apify Actors/tasks), and route a capability gap to a scraper or a human expert according to explicit preference or policy. A resulting dataset may be transformed into an agent capability, but ingestion alone cannot prove learning or competence.

## Proposed change

1. Add a separate, versioned Capability Acquisition contract family and provider registry/router. Do not silently mutate CF1.0 or any frozen schema. Preserve existing lifecycle contracts and reference/link aggregates by immutable IDs; any shared request-envelope change requires a new version and migration plan.
2. Add provider kinds SCRAPER, EXTERNAL_API and HUMAN_EXPERT, with PINNED_PROVIDER, ANY_COMPATIBLE_PROVIDER and AUTO routing. Deterministic policy/budget/authorization filters run before model-assisted candidate ranking. All route decisions and fallbacks are auditable and bounded.
3. Build an Arena-owned Scraper Factory and durable run lifecycle on top of reused open-source crawling libraries. Prefer Crawlee (Apache-2.0) as the Node/TypeScript substrate; evaluate Crawlee Python only if justified. Keep the hosted Actor management/platform plane Arena-owned only where necessary rather than cloning Apify's hosted product.
4. Provide an optional provider-neutral external API connector and optional Apify API adapter. Paid external calls require explicit configuration, budgets and secret isolation.
5. Add data provenance, source-rights checks, prompt-injection treatment, validation, dataset versioning, and an evidence-gated capability upgrade pipeline. Retrieval/knowledge/tool capability delivery is preferred where suitable. Model fine-tuning is not the default.
6. Require a measured before/after evaluation and client adoption/rollback. Rights-denied, unknown-rights, malicious, out-of-scope or unproven results cannot be published as a capability upgrade.

## Compatibility and contract impact

- Existing CF1.0 request/result/event schemas remain immutable.
- New schema IDs/versions have their own examples, negative vectors, runtime validators, state machine, versioning policy, and compatibility tests.
- AR2-016 owns acquisition contracts/router only; AR2-017 owns scraper runtime/provider adapters only; AR2-018 owns dataset-to-capability pipeline/evaluation only.
- AR2-005 shared persistence/migrations and root package/lockfiles remain TL-owned; workers may propose interfaces but cannot modify shared manifests or frozen schemas outside their fence.
- The core Arena vertical slice is independently releasable. Scraper-backed capability acquisition is a separate explicit end-to-end acceptance and is not silently implied by existing AR2-012 completion.

## Security/privacy conditions

Scraper and generated code run only in a validated CapsuleProvider with real process/filesystem/network isolation. Reject prohibited internal/private/metadata destinations and redirect/DNS-rebinding paths. Do not build bypasses for access controls, logins, CAPTCHAs, paywalls, source rate limits or anti-bot defenses. Respect applicable law, publisher terms, robots directives, source rights and retention requirements; robots.txt alone is not authorization. Treat all fetched content/API responses as untrusted data, never as instructions. Keep tokens in secret storage and scoped to the exact API provider/action.

## Alternatives

A. Clone the hosted Apify platform: rejected; unnecessarily duplicates a product and its service layer, licensing must not be assumed, and creates high maintenance/coupling.
B. Use only a hosted Apify API: rejected as the sole architecture; creates vendor/cost dependency and cannot provide provider-agnostic or local/self-hosted operation.
C. Add generic capability providers plus Crawlee and an optional Apify adapter: recommended; reuses a mature Apache-2.0 scraper substrate, keeps Arena control of authorization/routing/evidence/learning, and supports both local and external providers.
D. Treat fetched data as automatically training the model: rejected; data provenance, rights and measurable evaluation are prerequisites.

## Acceptance / implementation gates

- The new contracts and provider route modes have machine-readable schemas and positive/negative vectors.
- Existing CF1.0 vectors and tests remain green.
- Every work order has a disjoint file fence and a dependency-ready dispatch record; maximum three workers across the repo remains in force.
- SSRF, redirect/DNS rebinding, private/metadata egress, token leaks, tenant isolation, untrusted-page prompt injection, retry/idempotency, quotas, cancellation and data deletion are tested.
- A real permitted-fixture crawl yields provenance-preserving structured data and a measured before/after gap evaluation.
- Production/public scraper execution remains disabled until the actual OS-level capsule-provider suite passes. Synthetic tests are not isolation evidence.
- No training/index reuse occurs without explicit rights, policy and retention clearance; no capability-complete claim without evaluation evidence.
- The repo's PROJECT-STATE, dependency graph, work-order registry and dispatch ledger point to issues #32–#34 and this ACR/spec.

## Decision to record at merge

Record reviewer, merge SHA, CI evidence, contract compatibility result, and whether any shared contract version bump is needed. The new feature is not considered implemented by merging this specification alone.
