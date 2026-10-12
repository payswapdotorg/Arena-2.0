import http from "node:http";
import https from "node:https";
import type { EgressGuard } from "./egress.js";
import type { CrawlBudget, BudgetStopReason } from "./budget.js";

/**
 * AR2-017 — Validated HTTP fetch plane (issue #33).
 *
 * Every request — including every redirect hop — is re-validated by the
 * egress guard (URL string + DNS resolution) BEFORE a connection is opened,
 * and every socket connection resolves through the guard's connection-time
 * `lookup` (DNS-rebinding defense). Redirects are followed manually so each
 * hop gets the full validation path. 5xx and network errors retry with
 * bounded exponential backoff; byte caps abort mid-stream.
 */

export interface FetchedResponse {
  final_url: string;
  status: number;
  content_type: string | null;
  headers: Record<string, string>;
  body_text: string;
  bytes: number;
  redirects: ReadonlyArray<{ url: string; status: number }>;
}

export class EgressDeniedError extends Error {
  readonly code = "SCRP_EGRESS_DENIED" as const;
  constructor(detail: string) {
    super(`egress denied (fail closed): ${detail}`);
  }
}

export class FetchBudgetStopError extends Error {
  readonly reason: BudgetStopReason;
  constructor(reason: BudgetStopReason, detail: string) {
    super(`crawl budget stop (${reason}): ${detail}`);
    this.reason = reason;
  }
}

export class FetchRetryExhaustedError extends Error {
  readonly attempts: number;
  readonly lastDetail: string;
  constructor(attempts: number, lastDetail: string) {
    super(`fetch retries exhausted after ${attempts} attempt(s): ${lastDetail}`);
    this.attempts = attempts;
    this.lastDetail = lastDetail;
  }
}

export interface ValidatedFetchOptions {
  timeout_ms: number;
  user_agent: string;
}

interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  location: string | null;
}

export class HttpValidatedFetcher {
  private readonly guard: EgressGuard;
  private readonly budget: CrawlBudget;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: { guard: EgressGuard; budget: CrawlBudget; sleep: (ms: number) => Promise<void> }) {
    this.guard = options.guard;
    this.budget = options.budget;
    this.sleep = options.sleep;
  }

  async fetch(url: string, options: ValidatedFetchOptions): Promise<FetchedResponse> {
    const redirects: Array<{ url: string; status: number }> = [];
    let attempt = 0;
    let lastDetail = "unknown";
    for (;;) {
      attempt += 1;
      try {
        return await this.fetchOnce(url, options, redirects);
      } catch (error) {
        if (error instanceof EgressDeniedError || error instanceof FetchBudgetStopError) throw error;
        lastDetail = String(error);
        if (!this.budget.canRetry(attempt)) {
          throw new FetchRetryExhaustedError(attempt, lastDetail);
        }
        await this.sleep(this.budget.retryBackoffMs(attempt));
      }
    }
  }

  private async fetchOnce(
    url: string,
    options: ValidatedFetchOptions,
    redirects: Array<{ url: string; status: number }>,
  ): Promise<FetchedResponse> {
    let current = url;
    for (let hop = 0; hop <= this.budget.spec.max_redirect_hops; hop += 1) {
      const wall = this.budget.wallTimeExceeded();
      if (wall !== null && !wall.proceed) {
        throw new FetchBudgetStopError(wall.reason, wall.detail);
      }
      const check = await this.guard.validateUrl(current);
      if (!check.ok) throw new EgressDeniedError(check.detail);
      const response = await this.requestOnce(current, options);
      if (response.status >= 300 && response.status < 400 && response.location !== null) {
        const next = new URL(response.location, current).toString();
        redirects.push({ url: current, status: response.status });
        current = next;
        continue;
      }
      return {
        final_url: current,
        status: response.status,
        content_type: response.headers["content-type"] ?? null,
        headers: response.headers,
        body_text: response.body.toString("utf8"),
        bytes: response.body.byteLength,
        redirects: [...redirects],
      };
    }
    throw new FetchRetryExhaustedError(1, `redirect chain exceeded ${this.budget.spec.max_redirect_hops} hops`);
  }

  private requestOnce(url: string, options: ValidatedFetchOptions): Promise<RawResponse> {
    return new Promise<RawResponse>((resolve, reject) => {
      const transport = url.startsWith("https:") ? https : http;
      const request = transport.request(
        url,
        {
          agent: false, // fresh connection per request: connection-time lookup always runs
          lookup: (this.guard.connectionLookup.bind(this.guard) as unknown) as never,
          headers: { "user-agent": options.user_agent, accept: "text/html,application/json,text/plain" },
          timeout: options.timeout_ms,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let total = 0;
          let aborted = false;
          response.on("data", (chunk: Buffer) => {
            total += chunk.byteLength;
            if (!this.budget.bytesWouldFit(total)) {
              aborted = true;
              response.destroy();
              reject(new FetchBudgetStopError("MAX_BYTES", `response stream exceeded the remaining byte budget`));
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            if (aborted) return;
            const headers: Record<string, string> = {};
            for (const [key, value] of Object.entries(response.headers)) {
              headers[key] = Array.isArray(value) ? value.join(", ") : (value ?? "");
            }
            resolve({ status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks), location: response.headers.location ?? null });
          });
          response.on("error", (error) => {
            if (!aborted) reject(error);
          });
        },
      );
      request.on("timeout", () => {
        request.destroy(new Error(`fetch timeout after ${options.timeout_ms}ms`));
      });
      request.on("error", (error) => reject(error));
      request.end();
    });
  }
}

/**
 * One-shot egress-guarded GET for robots.txt coordination fetches: connection
 * happens through the guard's connection-time `lookup` (untrusted content).
 */
export async function guardedRobotsRequest(
  url: string,
  guard: EgressGuard,
): Promise<{ status: number; body: string }> {
  const transport = url.startsWith("https:") ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      {
        agent: false,
        lookup: (guard.connectionLookup.bind(guard) as unknown) as never,
        timeout: 5000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new Error("robots fetch timeout")));
    request.on("error", reject);
    request.end();
  });
}
