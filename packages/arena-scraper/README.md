# @arena/scraper

AR2-017 (issue #33) — Scraper Factory, crawler runtime and external API connector
adapters for the Arena capability-acquisition extension (ACR-0002). Public
surface: `src/contract.ts` only (deep imports are forbidden by the
architecture policy).

## What this package provides

- **SCRP1.0 contract family** (zod, strict envelopes, typed errors, canonical
  digests): `ScraperDefinition` / `ScraperVersion` / `ScraperBuild`,
  `AcquisitionRun`, `DatasetArtifact`, `ApiConnectorDescriptor` +
  `ExternalApiConnectorPort`. The family is versioned SEPARATELY from the
  frozen CF1.0 (`@arena/contracts`) and ACQ1.0 (`@arena/acquisition`) corpora,
  which are consumed read-only through their public entrypoints and never
  edited or re-exported-modified.
- **ScraperFactory** (`src/factory.ts`): the declarative-brief lifecycle —
  draft → static validation → dependency/source/license review → build →
  isolated test-fixture run → source-policy and budget checks → reviewed
  release. Every transition carries an authorized actor, timestamp and
  evidence record; every gate yields a typed result; rejections are terminal
  states with reason codes (fail closed). Generated scraper code is a BUILD
  ARTIFACT and is never trusted or executed.
- **Crawler runtime** (`src/runtime/`):
  - `egress.ts` — the SSRF/DNS-rebinding defense: every requested URL and every
    redirect hop is re-validated, every socket connection resolves through the
    guard's connection-time `lookup`, prohibited IPv4/IPv6 ranges (loopback,
    link-local, private, reserved/zeroconf, CGNAT, cloud metadata,
    IPv4-mapped/NAT64 IPv6) are rejected, and any ambiguity fails closed.
  - `source-policy.ts` — robots.txt coordination (Disallow for the declared UA,
    Crawl-delay) plus per-domain request limits. Robots is coordination, NOT
    authorization.
  - `budget.ts` — max pages/items/bytes/depth/wall-time, per-origin rate
    spacing, retry caps, cooperative cancellation + provider/source stop
    switches.
  - `quarantine.ts` — untrusted-data handling: content-type/size/shape checks,
    prompt-injection ANNOTATION (injection text stays inert data), secret and
    policy-prohibited PII redaction.
  - `fetch.ts` / `crawler.ts` — validated HTTP fetch with manual per-hop
    redirect re-validation on top of `node:http`/`node:https`, orchestrated by
    Crawlee's `BasicCrawler` (pinned; see SUPPLY-CHAIN.md) with cheerio parsing.
  - `assembly.ts` — dedup (URL + content hash) + full provenance → immutable
    `DatasetArtifact`.
- **Execution plane** (`src/run/`): `ScraperRunService` — idempotency-keyed run
  creation, fenced retries under lease, capsule execution manifest, execution
  THROUGH a `CapsuleProvider` (from `@arena/capsule`; the SYNTHETIC provider is
  used by tests — production isolation is a separate release gate and is NOT
  claimed), crawl under budget, dataset emission, terminal event with reason.
  Ambiguous outcomes (timeout mid-crawl) persist operation identity and land in
  UNKNOWN — never silently-failed.
- **External API connectors** (`src/connector.ts`, `src/apify-adapter.ts`):
  provider-neutral port with approved hosts/endpoints/methods, credential
  REFERENCES (never values), rate/quota/cost ceilings, retry/timeout/ambiguous
  semantics, and an OPTIONAL Apify REST v2 adapter that is inert unless
  explicitly configured and is tested against a LOCAL mock server only.

## Reuse-first and supply chain

Crawlee is the mandated crawling substrate (Apache-2.0), pinned at
`3.18.2` — record in [`SUPPLY-CHAIN.md`](./SUPPLY-CHAIN.md). Browser
automation (Playwright/Puppeteer drivers) is deliberately NOT pulled; only the
HTTP crawling plane and cheerio parsing are used.

## Tests

`node:test` via tsx, no live network, no paid APIs:

```bash
cd packages/arena-scraper && ../../node_modules/.bin/tsx --test test/*.test.ts
```

All crawler/connector tests run against a local `node:http` fixture/mock server
bound to `127.0.0.1` on an ephemeral port, declared as an explicitly approved
fixture endpoint (auditable, justification recorded).
