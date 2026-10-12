import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { BasicCrawler, log as crawleeLog } from "crawlee";
import { CRAWLEE_PINNED_VERSION } from "../primitives.js";
import type { CrawlBudget, BudgetStopReason } from "./budget.js";
import type { EgressGuard } from "./egress.js";
import { EgressDeniedError, FetchBudgetStopError, HttpValidatedFetcher } from "./fetch.js";
import type { QuarantineLayer } from "./quarantine.js";
import type { SourcePolicy } from "./source-policy.js";
import type { TransformationStep } from "../dataset-artifact.js";

/**
 * AR2-017 — Crawler engine on the Crawlee substrate (issue #33; spec §4).
 *
 * Reuse-first decision: the crawl ORCHESTRATION plane (request queue, handler
 * lifecycle, graceful stop, statistics) is Crawlee's BasicCrawler, pinned at
 * the exact version recorded in SUPPLY-CHAIN.md. The HTTP plane deliberately
 * routes through Arena's validated fetcher so that every hop and every socket
 * is egress-guarded; browser automation (Playwright/Puppeteer) is NOT pulled.
 */

export interface CrawledItem {
  url: string;
  final_url: string;
  retrieved_at: string;
  content: string;
  content_hash: string;
  redactions: string[];
  injection_annotations: string[];
  transformations: TransformationStep[];
  status: number;
  redirects: ReadonlyArray<{ url: string; status: number }>;
}

export interface CrawlResult {
  items: CrawledItem[];
  quarantined: ReadonlyArray<{ url: string; reasons: string[] }>;
  egress_denied: ReadonlyArray<{ url: string; detail: string }>;
  robots_denied: ReadonlyArray<{ url: string; detail: string }>;
  pages_fetched: number;
  bytes_fetched: number;
  stop_reason: BudgetStopReason | "COMPLETED";
  stop_detail: string;
  engine_version: string;
  crawlee_version: string;
}

export type CrawlEventKind =
  | "PAGE_FETCHED"
  | "PAGE_QUARANTINED"
  | "EGRESS_DENIED"
  | "ROBOTS_DISALLOWED"
  | "BUDGET_STOP";

export interface CrawlEngineOptions {
  guard: EgressGuard;
  sourcePolicy: SourcePolicy;
  quarantine: QuarantineLayer;
  budget: CrawlBudget;
  nowIso: () => string;
  sleep: (ms: number) => Promise<void>;
  onEvent?: (event: { kind: CrawlEventKind; detail: string }) => void;
  fetchTimeoutMs?: number;
}

/** HTML link extraction with cheerio (the declared parsing substrate). */
export function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href");
    if (href === undefined || href.startsWith("#") || href.startsWith("javascript:")) return;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") {
        links.push(resolved.toString());
      }
    } catch {
      // unparsable href — skip
    }
  });
  return links;
}

export function contentHashOf(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export class CrawlerEngine {
  private readonly options: CrawlEngineOptions;
  private readonly fetcher: HttpValidatedFetcher;

  constructor(options: CrawlEngineOptions) {
    this.options = options;
    this.fetcher = new HttpValidatedFetcher({
      guard: options.guard,
      budget: options.budget,
      sleep: options.sleep,
    });
    // Silence the substrate's console log (workers emit their own event trail).
    crawleeLog.setLevel(crawleeLog.LEVELS.OFF);
  }

  async crawl(seeds: readonly string[], followLinks: boolean): Promise<CrawlResult> {
    const items: CrawledItem[] = [];
    const quarantined: Array<{ url: string; reasons: string[] }> = [];
    const egressDenied: Array<{ url: string; detail: string }> = [];
    const robotsDenied: Array<{ url: string; detail: string }> = [];
    let stopReason: BudgetStopReason | "COMPLETED" = "COMPLETED";
    let stopDetail = "all queued requests finished within budget";
    let dead = false;
    let crawlerRef: BasicCrawler | null = null;

    this.options.budget.start();
    const markDead = (reason: BudgetStopReason | "COMPLETED", detail: string): void => {
      if (dead) return;
      dead = true;
      stopReason = reason;
      stopDetail = detail;
      this.options.onEvent?.({ kind: "BUDGET_STOP", detail });
      void crawlerRef?.stop();
    };
    // Hard deadline: the substrate is stopped even if a handler hangs.
    const hardTimer = setTimeout(
      () => markDead("WALL_TIME", "hard wall-clock deadline fired"),
      this.options.budget.spec.wall_time_ms + 2000,
    );
    hardTimer.unref?.();

    const options = this.options;
    const fetcher = this.fetcher;
    const crawler = new BasicCrawler({
      maxConcurrency: 1,
      maxRequestRetries: 0,
      requestHandlerTimeoutSecs: Math.max(1, Math.ceil((this.options.fetchTimeoutMs ?? 10000) / 1000) + 10),
      async requestHandler(context) {
        if (dead) return;
        const url = context.request.url;
        const depth = (context.request.userData as { depth?: number } | undefined)?.depth ?? 0;
        const verdict = options.budget.beforeRequest(url, depth);
        if (!verdict.proceed) {
          markDead(verdict.reason, verdict.detail);
          return;
        }
        const policy = await options.sourcePolicy.checkUrl(url, true);
        if (!policy.allowed) {
          if (policy.code === "SCRP_ROBOTS_DISALLOWED") {
            robotsDenied.push({ url, detail: policy.detail });
            options.onEvent?.({ kind: "ROBOTS_DISALLOWED", detail: policy.detail });
          }
          return;
        }
        if (policy.delay_ms > 0) await options.sleep(policy.delay_ms);
        let response;
        try {
          response = await fetcher.fetch(url, {
            timeout_ms: options.fetchTimeoutMs ?? 10000,
            user_agent: options.sourcePolicy.userAgent,
          });
        } catch (error) {
          if (error instanceof EgressDeniedError) {
            egressDenied.push({ url, detail: error.message });
            options.onEvent?.({ kind: "EGRESS_DENIED", detail: error.message });
            return;
          }
          if (error instanceof FetchBudgetStopError) {
            markDead(error.reason, error.message);
            return;
          }
          return; // page-level failure (retries exhausted, network) — crawl continues
        }
        const pageVerdict = options.budget.recordPage(response.bytes);
        if (!pageVerdict.proceed) {
          markDead(pageVerdict.reason, pageVerdict.detail);
          return;
        }
        const headDisposition = options.quarantine.inspectResponse(url, response.content_type, response.bytes);
        const bodyDisposition = options.quarantine.inspectBodyText(url, response.body_text);
        const reasons = [...headDisposition.reasons, ...bodyDisposition.reasons];
        if (reasons.length > 0) {
          quarantined.push({ url, reasons });
          options.onEvent?.({ kind: "PAGE_QUARANTINED", detail: `${url}: ${reasons.join("; ")}` });
        } else {
          const sanitized = options.quarantine.sanitizeContent(response.body_text);
          const transformations: TransformationStep[] = [{ step: "FETCHED", detail: `status ${response.status}` }];
          if (sanitized.redactions.length > 0) {
            transformations.push({ step: "REDACTED", detail: sanitized.redactions.join(",") });
          }
          if (sanitized.injection_annotations.length > 0) {
            transformations.push({ step: "INJECTION_ANNOTATED", detail: sanitized.injection_annotations.join(",") });
          }
          items.push({
            url,
            final_url: response.final_url,
            retrieved_at: options.nowIso(),
            content: sanitized.content,
            content_hash: contentHashOf(response.body_text),
            redactions: sanitized.redactions,
            injection_annotations: sanitized.injection_annotations,
            transformations,
            status: response.status,
            redirects: response.redirects,
          });
          options.onEvent?.({ kind: "PAGE_FETCHED", detail: `${url} -> ${response.status}` });
          const itemVerdict = options.budget.recordItem();
          if (!itemVerdict.proceed) {
            markDead(itemVerdict.reason, itemVerdict.detail);
            return;
          }
          if (followLinks && depth < options.budget.spec.max_depth) {
            for (const link of extractLinks(response.body_text, response.final_url)) {
              if (linkWithinScope(link, options.guard.policy) && link !== url) {
                const queue = context.crawler.requestQueue;
                if (queue !== undefined) {
                  await queue.addRequest(
                    { url: link, userData: { depth: depth + 1 } },
                    { forefront: false },
                  );
                }
              }
            }
          }
        }
      },
      async failedRequestHandler() {
        // Page-level retries/failures live in the validated fetcher; the
        // substrate's failure accounting surfaces through stats only.
      },
    });
    crawlerRef = crawler;

    await crawler.run(seeds.map((seed) => ({ url: seed, userData: { depth: 0 } })));
    clearTimeout(hardTimer);
    const stats = this.options.budget.stats();
    return {
      items,
      quarantined,
      egress_denied: egressDenied,
      robots_denied: robotsDenied,
      pages_fetched: stats.pages,
      bytes_fetched: stats.bytes,
      stop_reason: stopReason,
      stop_detail: stopDetail,
      engine_version: "SCRP-ENGINE1.0",
      crawlee_version: CRAWLEE_PINNED_VERSION,
    };
  }

}

/** Whether an extracted link fits the crawl's scheme/port scope. */
export function linkWithinScope(
  link: string,
  policy: { schemes: readonly ("http" | "https")[]; ports: readonly number[] },
): boolean {
  try {
    const url = new URL(link);
    const scheme = url.protocol.replace(":", "");
    if (!policy.schemes.includes(scheme as "http" | "https")) return false;
    const port = url.port === "" ? (scheme === "https" ? 443 : 80) : Number.parseInt(url.port, 10);
    return policy.ports.includes(port);
  } catch {
    return false;
  }
}
