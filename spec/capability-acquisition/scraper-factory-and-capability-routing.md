# Capability-gap Acquisition, Scraper Factory and Provider Routing

Status: owner-requested product extension; implementation NOT STARTED.
Canonical work orders: AR2-016, AR2-017, AR2-018.
Change control: `spec/decisions/ACR-0002-capability-acquisition.md`.
Current frozen core contract: CF1.0 remains immutable; this feature adds versioned acquisition contracts and must not append fields to frozen schemas silently.

## 1. Product intent

Arena can fill capability gaps in client agents through more than human escalation. The available sources are:

1. A specifically selected, compatible scraper/capability provider.
2. Any eligible registered scraper/provider that meets the requested capability and output contract.
3. An external API/data provider, including an explicitly configured Apify Actor/task API.
4. A qualified human expert.
5. An explicitly permitted composite plan, such as a scraper gathering a dataset and a human expert validating/structuring it.

The client agent may report a capability gap (for example, it cannot find current Blender procedural-material references). Arena turns that into a versioned acquisition request, finds or creates a suitable data acquisition capability, gathers and validates data, and proposes a bounded capability upgrade. The client agent evaluates the upgrade and may adopt it through its own integration policy.

**Arena does not promise that raw scraped data automatically trains or improves a model.** The result can be a retrieval corpus, structured knowledge pack, tool/connector, examples/rules, or—only when separately approved and supported—training/fine-tuning data. Gap closure is claimed only after a repeatable before/after evaluation passes.

## 2. Core contracts and records

The acquisition feature is a separate versioned contract family. Do not change CF1.0's strict envelopes or add unknown fields to its frozen request schema. Where an existing escalation is used to commission a scraper build, link the two aggregates by immutable IDs and explicit causation; each keeps its own lifecycle and authoritative writer.

Introduce at minimum:

- `CapabilityGapReport`: target agent/body composition and version; capability statement; observed task/criteria; minimal reproducible failure/evaluation case; expected behavior; domain/environment; deadline/budget; privacy, rights and retention constraints. It must not require private model chain-of-thought.
- `CapabilityAcquisitionRequest`: tenant/principal derived from authentication, request digest, gap reference, desired output schema, scope, budget, deadline, attempt limit, risk tier, acceptance criteria, data-use/retention policy and preferred routing mode.
- `AcquisitionRouteMode`: `PINNED_PROVIDER`, `ANY_COMPATIBLE_PROVIDER`, `AUTO`.
- `CapabilityProviderDescriptor`: immutable provider/version ID, kind (`SCRAPER`, `EXTERNAL_API`, `HUMAN_EXPERT`), supported capability/input/output schemas, source rights posture, available regions, cost/quota, latency/SLA, requirements, provenance/evidence quality, status and allowed use.
- `RouteDecision`: eligible candidates, hard policy filters, selected provider/plan, rejected alternatives with reason codes, estimated budget/latency, policy version and fallback constraints.
- `ScraperDefinition` / `ScraperVersion`: source/domain scope, approved acquisition method, inputs, output schema, build source and digest, runtime, resource/egress rules, dependency lock, rights/safety profile and immutable release version.
- `AcquisitionRun`: request/provider/scraper-version IDs, durable attempt and lease, cancellation/deadline, quotas, event trail, run output references and terminal reason.
- `DatasetArtifact`: immutable records, item/object hashes, source URL or API reference, retrieval timestamp, method/version, rights/licence assessment, redaction class, transformations and provenance lineage.
- `CapabilityUpgradeProposal`: dataset and transformation lineage, chosen strategy (retrieval/index, knowledge pack, tool/connector, examples/rules, or approved fine-tune), target body/composition/version, evaluation suite, result, rollback pointer and publication rights.
- `AcquisitionEvaluation`: baseline and post-upgrade cases, metrics, hard-stop/refusal tests, confidence/limits and the exact composition/policy/data/version tested.

Contracts must carry stable correlation, causation and idempotency identifiers, tenant scope, schema version, typed errors, retention class and canonical digests. Runtime validation is required at trust boundaries. Record corrections as new events; never rewrite prior source or evaluation evidence.

## 3. Routing modes and decision flow

### Pinned provider

The requester specifies a scraper/provider ID and version or a provider family. The system checks tenant access, provider availability, capability compatibility, source/data rights, accepted output schema, policy constraints, budget and deadline. If the requested provider is unavailable or disallowed, return an explainable blocked/inconclusive outcome unless the request explicitly permits fallback.

### Any compatible provider

Arena searches the current, tenant-authorized capability registry for candidates. It first applies hard eligibility filters (authorization, source rights, data policy, region, output schema, budget, quota, deadline and risk constraints), then ranks eligible candidates by capability fit, evidence quality, reliability, expected cost and latency. Popularity alone must never override evidence or policy.

### Automatic routing

Arena chooses among scraper, external API, human expert or a policy-approved composite plan. A model may recommend or rank candidates only after deterministic eligibility filters. The persisted decision records the selected source and why other providers were rejected. No source is silently substituted after a failure; any fallback must be permitted by the caller's policy and stay within the original aggregate budget, deadline and attempt limit.

### End-to-end flow

~~~text
Client agent detects repeatable capability gap
  -> submit CapabilityGapReport / CapabilityAcquisitionRequest
  -> validate schema, tenant, rights, scope, risk, budget and deadline
  -> registry eligibility filters
  -> PINNED_PROVIDER | ANY_COMPATIBLE_PROVIDER | AUTO route decision
  -> reuse compatible released scraper/API or commission a new scraper build
  -> build/review immutable ScraperVersion
  -> durable AcquisitionRun in a validated CapsuleProvider
  -> crawl permitted sources / call approved external APIs
  -> capture source metadata, hashes and provenance
  -> quarantine, normalize, deduplicate and validate against output schema
  -> produce immutable DatasetArtifact
  -> propose retrieval/knowledge/tool/training strategy
  -> rights, privacy, injection and quality gates
  -> baseline vs. upgrade evaluation
  -> publish a versioned, scoped CapabilityUpgradeProposal if accepted
  -> client app evaluates/adopts and records its result
  -> fail/inconclusive => no capability-complete claim; explain next step
~~~

Every arrow is a durable, observable transition with idempotent command semantics and retriable/fenced jobs. The agent's report is enough to state a testable capability gap, not to prove the gap was fixed.

## 4. Scraper Factory

The Factory should create narrow, testable scrapers from a declarative acquisition brief and source-specific extraction requirements. Generated code is a build artifact, never trusted because an LLM generated it.

Required lifecycle: draft -> static validation -> dependency/source/license review -> build -> isolated test fixture run -> source-policy and budget checks -> reviewed release -> bounded run -> post-run dataset validation -> version/deprecation. Every transition has an authorized actor and evidence record. Scraper definition, code/build digest, dependency lock, source policy and output schema are pinned per run. A reused scraper cannot silently change behavior when its version changes.

### Reuse-first technology decision

- Use [Crawlee](https://github.com/apify/crawlee) as the default Node/TypeScript crawling substrate, after recording a pinned version and its transitive supply-chain/license review. Crawlee is Apache-2.0 and supports HTTP crawling, parsers and browser automation integrations including Playwright/Puppeteer.
- Consider [Crawlee for Python](https://github.com/apify/crawlee-python) only if the first supported scraper catalog or a client workflow has a demonstrated Python requirement; do not add two runtimes by default.
- Keep the Actor-like lifecycle, registry, manifests, security boundary, policy engine, versioning, durable scheduling, results and learning integration Arena-owned.
- Provide a provider-neutral API connector port. An optional [Apify API](https://docs.apify.com/api/v2) adapter may run existing Actors/tasks and collect their datasets/stores. It is a configurable external provider, not the default engine or mandatory SaaS dependency.
- Reuse packages or code only under their actual license; preserve copyright, NOTICE and dependency inventories. Do not copy the hosted Apify web application/platform as if it were all open source. Prefer maintained libraries and API compatibility over a large fork.

## 5. External API connectors

Scrapers/jobs may call configured APIs in addition to retrieving web pages, including Apify Actors/tasks. The connector plane is provider-neutral and declares:

- adapter/provider ID and version;
- approved host and endpoint patterns, HTTP methods and request schemas;
- credential reference and secret scope (never the secret itself);
- rate/concurrency/quota and cost ceiling;
- retry, timeout, cancellation and ambiguous-outcome semantics;
- response schema, maximum bytes/items, retention and provenance requirements;
- region/data residency and tenant entitlements;
- callback/webhook signature and replay policy where used.

Credentials must be retrieved server-side from a secret store, scoped to the exact provider/action and redacted from logs, traces, scraper environment variables and outputs. External API adapters use the same capability eligibility and budget checks as other provider kinds; a scraper may not smuggle an unregistered API call through generic networking.

An external provider timeout is an unknown outcome, not automatically failure. Persist operation identity, reconcile if the provider supports it, and avoid duplicate paid work. Paid provider use must be opt-in, budgeted, visible and fail closed when the approved limit or configuration is missing.

## 6. Security, privacy and source policy

- Execute generated/user-authored scraper code only through a CapsuleProvider whose OS/process/filesystem/network isolation suite has passed. ZCode workspaces, Git worktrees, browser contexts, Node workers and the synthetic capsule are not proof of production isolation.
- Default-deny access to loopback, link-local, private/reserved ranges, cloud metadata endpoints, internal service names and all unapproved egress. Resolve and validate destination addresses at connection time and on redirects; defend against SSRF, DNS rebinding, IPv4/IPv6 edge cases and redirect-to-private-network attacks.
- Apply allowlists for schemes, domains, ports, methods and API hosts. Check every redirect and every resolved destination, not just the submitted URL string.
- Respect applicable law, customer permissions, publisher terms, privacy obligations, source licence/copyright constraints, robots directives and rate/concurrency limits. Robots.txt is a crawler coordination mechanism, not authorization by itself. When permission is unclear or the source requires a disallowed action, fail closed or route to a source that is permitted.
- Do not build bypasses for authentication, paywalls, CAPTCHAs, access controls, source rate limits, or bot defenses. No stealth fingerprint evasion or proxy rotation intended to evade a source's controls. Use documented and authorized APIs where available.
- Treat fetched pages, files, OCR, metadata and API results as untrusted, potentially adversarial content. Prompt-injection text remains data; it cannot override policy, invoke tools, change egress, select a new provider or access secrets.
- Enforce maximum pages/items, bytes, depth, wall time, CPU/memory, per-origin rate and cost. Support cancellation/kill, backoff and a provider/source stop switch.
- Validate content type, size, encoding, schema, record counts and hashes; quarantine malformed outputs, suspicious active content and instructions; redact secrets and policy-prohibited PII.
- Cross-tenant access to scraper definitions, credentials, runs, datasets and capability packs fails closed. Customer data remains private by default.
- Keep immutable evidence of source, retrieval, transformations, license/rights decision, validation, training/indexing and publication. Retention and deletion obligations propagate to derived indexes/capability packs where legally and technically possible.

## 7. Capability upgrade is not raw ingestion

Data quality and capability are separate acceptance decisions. Raw page extraction passing a schema test does not prove an agent capability was improved.

Default delivery strategies, in preferred order when appropriate:

1. Scoped retrieval/search index linked to the source dataset and tenant/rights policy.
2. Structured knowledge pack or normalized reference table.
3. Validated tool/API adapter with limited permissions and explicit interface.
4. Evaluated examples/rules or workflow specialization.
5. Model fine-tuning only where the user/policy explicitly authorizes it, rights are documented, data minimization and privacy review pass, and the training process can record exact dataset/model/config/version plus rollback.

Never train on data whose permission, provenance, retention rights or licence is unknown. A dataset may be useful to one tenant but prohibited from the public marketplace. Reuse/publication needs explicit RightsGrant, scope, rights, provenance, consent where applicable, independent validation and versioning under AR2-014.

The evaluation compares the pre-upgrade agent against a versioned test suite: target tasks, representative hard cases, regressions, hallucination/grounding, source citation, prompt injection, privacy leakage and policy refusal. Pin model/substrate, Body, prompts/tools, dataset/index, policy and runtime. A successful upgrade claims only the measured target scope, not universal expertise. The client app retains authority to adopt/revert the proposed upgrade.

## 8. UX and observability requirements

Requester UI should expose:
- the detected gap and proposed acceptance test;
- source choice: a named scraper/provider, any compatible provider, or automatic routing;
- source scope and permission, output format, quality target, privacy/retention, cost cap, deadline and allowed fallback;
- planned route with estimated cost/time and reasons, with approval when policy requires it;
- live job stages, progress, quotas, retries, source failures, dataset preview, provenance and validation results;
- before/after evaluation, limitations, capability version, adopt/reject/rollback and appeal/escalate action.

Expose explicit source modes in UI, not through a hidden backend default. Human review is available if the requester selects it, the auto-router chooses it within policy, or scraper/API acquisition is unavailable or inconclusive and fallback was authorized.

Operations must be able to see queue age, per-source latency/error/rate-limit, blocked hosts, SSRF rejections, bytes/items/cost, source/tenant quota, retry/dead-letter state, validation failure classes, capability-evaluation delta and data deletion drift. Logs never include API tokens or sensitive page payloads by default.

## 9. Work orders and dependency frontier

- AR2-016 — Capability-gap acquisition contract and provider router. Depends on accepted AR2-002, durable AR2-005, and AR2-008 contracts/implementation.
- AR2-017 — Scraper Factory, crawler runtime and external API adapters. Depends on validated AR2-004 isolation seam, AR2-005 durable jobs, and AR2-016 frozen provider contract.
- AR2-018 — Evidence-to-capability packaging, evaluation and controlled learning. Depends on AR2-007 evidence semantics, AR2-014 rights-gated learning, AR2-016 and AR2-017.

These work orders are planned additions, not active assignments. The TL records exact base SHAs, workers, write fences, versions and acceptance evidence before dispatch. The existing core vertical slice remains independently releasable; scraper-backed capability acquisition requires its own end-to-end acceptance and is not silently included in existing AR2-012 scope.

## 10. Minimum integrated acceptance scenario

1. A seeded client agent reports a reproducible gap about a defined set of Blender-related reference data and supplies a target evaluation.
2. A caller requests a pinned scraper; a second case requests any compatible scraper; a third case uses AUTO with a mock registry containing scraper, external API and human candidates.
3. The router rejects an over-budget, wrong-tenant, disallowed-source or schema-incompatible candidate and records why.
4. Arena executes a version-pinned Crawlee example against a local permitted fixture server in an isolated test provider; a separately gated suite validates the real OS-isolation provider before untrusted/public jobs are enabled.
5. It emits a typed dataset with URL/time/hash/license/rights/provenance metadata, handles malformed/prompt-injection fixtures as untrusted data, and refuses forbidden egress.
6. A capability proposal generates an isolated index/knowledge pack or tool, evaluates before/after, and remains unpublished when rights/evaluation fail.
7. A successful test run improves the target metric; the client explicitly adopts the immutable version. A later regression supports rollback without rewriting historic evidence.
8. Provider retry, job restart, cancellation, quota exhaustion, duplicate idempotency key, API timeout and cleanup are exercised. No secret or cross-tenant artifact leaks.
9. Apify adapter tests run only against fixtures/mock server by default; real paid API use requires explicit user configuration and a ceiling.
