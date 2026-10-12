# SUPPLY-CHAIN RECORD — @arena/scraper (AR2-017)

Last reconciled: 2026-10-12 (worker delivery; TL re-verifies at the integration station).

## Reuse-first rationale (spec §4, ACR-0002 decision C)

Crawlee is the mandated Node/TypeScript crawling substrate. Arena reuses its
HTTP crawling/orchestration plane instead of hand-rolling a crawler framework,
while keeping authorization, egress control, budgets, evidence, provenance and
learning integration Arena-owned (spec §4 "Keep the Actor-like lifecycle,
registry, manifests, security boundary, policy engine, versioning, durable
scheduling, results and learning integration Arena-owned").

**Substrate selection inside crawlee**: the engine uses `BasicCrawler` (queue,
handler lifecycle, graceful stop) plus `cheerio` parsing. The HTTP request
plane routes through Arena's `HttpValidatedFetcher` (`node:http`/`node:https`)
so that EVERY redirect hop is re-validated by the egress guard and EVERY
socket connection resolves through the guard's connection-time `lookup`
(DNS-rebinding defense). `HttpCrawler`'s got-scraping auto-redirect following
and socket pooling would bypass per-hop/per-connection re-validation, so the
security plane deliberately owns the fetch.

## Pinned direct dependencies

| Package    | Version (exact pin) | License   | Role                                                   |
| ---------- | ------------------- | --------- | ------------------------------------------------------ |
| crawlee    | 3.18.2              | Apache-2.0 | Crawl orchestration substrate (BasicCrawler)            |
| cheerio    | 1.2.0               | MIT       | HTML parsing of fetched (untrusted) pages              |
| zod        | 4.6.5               | MIT       | Schema validation (matches the workspace pin)          |
| @arena/contracts  | workspace:* | —   | Frozen CF1.0 primitives (read-only reuse)              |
| @arena/acquisition | workspace:* | —   | ACQ1.0 family (canonical digests, rights posture; read-only reuse) |
| @arena/capsule     | workspace:* | —   | CapsuleProvider port + synthetic provider (execution seam) |

## Browser binaries: NOT pulled

`playwright`, `puppeteer` and `idcac-playwright` are OPTIONAL peer
dependencies of the crawlee meta-package (declared `optional: true` in
`peerDependenciesMeta`) and are NOT installed for this package. The runtime
uses only `BasicCrawler` + HTTP + cheerio. (A pre-existing
`playwright-core@1.59.1` in the base lockfile belongs to the inherited ZCode
`zcode-cua` workspace, not to this package.)

## Transitive dependency inventory (crawlee 3.18.2 tree, summary)

Direct-of-crawlee packages installed for this workspace (all version `3.18.2`
where crawlee-scoped): `@crawlee/{basic, browser, browser-pool, cheerio, cli,
core, http, jsdom, linkedom, memory-storage, playwright, puppeteer,
templates, types, utils}` (Apache-2.0, Apify) — the browser entries are the
wrapper libraries only, not the browser drivers.

Key lower-level transitive dependencies introduced:
`@apify/{log, consts, timeout, utilities, datastructures, pseudo_url}` (MIT),
`got-scraping`/`got` (MIT), `tough-cookie` (BSD-3-Clause), `tldts` (MIT),
`fs-extra` (MIT), `minimatch` (ISC), `ow` (MIT), `tslib` (0BSD),
`type-fest` (MIT), `stream-json` (BSD-3-Clause), `csv-stringify` (MIT),
`jquery` (MIT, @crawlee/browser), `ml-matrix`/`ml-logistic-regression` (MIT,
ranking helpers of the browser plane), `@sapphire/async-queue` (MIT),
`@vladfrangu/async_event_emitter` (MIT), `json5` (MIT), `cheerio`
1.0.0-rc.12 (MIT, crawlee's own pin), `htmlparser2` (MIT), `jsdom` (MIT).

No copyleft (GPL/AGPL/SSPL) dependency was introduced into this package's
tree. Unknown-license packages would fail the factory's
dependency/source/license review gate (fail closed).

## Verification performed in this sandbox

- `pnpm install --no-frozen-lockfile` was run to materialize the new
  dependencies for LOCAL testing only; `pnpm-lock.yaml` is NOT committed by
  this worker (the TL performs the lockfile/root-manifest wiring at the
  integration station, per the AR2-017 write fence).
- The diff of the locally generated lockfile vs. the base was reviewed: the
  only additions are the @crawlee/@apify families and their transitive
  dependencies listed above, plus the arena workspace links. No
  postinstall/build scripts were added for the new tree (crawlee and its
  @crawlee/* children declare none; `@apify/ps-tree` ships a hasBin script
  without build side effects).
