# NOTICE — @arena/scraper

Copyright (c) 2026 Arena contributors (payswapdotorg/arena-2.0, a fork of
zai-org/ZCode). License: Apache-2.0 (repository root LICENSE).

This package adds Arena's scraper factory, crawler runtime and external API
connector plane (work order AR2-017). It builds on the reused open-source
substrate recorded below; their licenses and notices are preserved and their
usage stays within their terms.

## Third-party components (direct dependencies)

- **crawlee** — Apache-2.0, pinned at exactly `3.18.2`.
  Copyright (c) Apify Technologies s.r.o.
  Used for its HTTP crawling/orchestration plane (`BasicCrawler`, request
  queue, lifecycle) only. Browser-automation driver packages (playwright,
  puppeteer, idcac-playwright) are OPTIONAL peers of crawlee and are NOT
  installed by this package (see SUPPLY-CHAIN.md).
- **cheerio** — MIT, pinned at exactly `1.2.0`.
  Copyright (c) Matt Mueller and contributors. Used for HTML parsing of fetched
  (untrusted) pages.
- **zod** — MIT, pinned at exactly `4.6.5` (same pin as @arena/contracts and
  @arena/acquisition). Copyright (c) Colin McDonnell.

## Upstream attribution

This repository is a fork of zai-org/ZCode; upstream licenses, notices and
security disclosures are retained at the repository root. Arena changes do not
erase inherited terms. The hosted Apify platform/web application is NOT copied
or re-implemented here — only the documented Apify REST API v2 is adapted
behind an explicitly configured, optional connector (spec §4 reuse-first
decision, ACR-0002).
