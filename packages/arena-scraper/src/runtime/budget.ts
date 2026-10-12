/**
 * AR2-017 — CrawlBudget (issue #33; spec §6).
 *
 * Enforces max pages/items/bytes/depth/wall-time, per-origin rate limiting
 * with backoff, retry caps, cancellation/kill honoring the run lease, and a
 * provider/source stop switch. All decisions are cooperative (checked between
 * pages) plus a hard wall-clock deadline the caller arms separately.
 */

export type BudgetStopReason =
  | "MAX_PAGES"
  | "MAX_ITEMS"
  | "MAX_BYTES"
  | "MAX_DEPTH"
  | "WALL_TIME"
  | "CANCELLED"
  | "PROVIDER_STOPPED"
  | "SOURCE_STOPPED";

export type BudgetVerdict = { proceed: true } | { proceed: false; reason: BudgetStopReason; detail: string };

export interface CrawlBudgetSpec {
  max_pages: number;
  max_items: number;
  max_bytes: number;
  max_depth: number;
  wall_time_ms: number;
  max_retries_per_request: number;
  retry_backoff_base_ms: number;
  max_redirect_hops: number;
}

export class CrawlBudget {
  readonly spec: CrawlBudgetSpec;
  private readonly nowMs: () => number;
  private pagesFetched = 0;
  private itemsAccepted = 0;
  private bytesFetched = 0;
  private startedAtMs: number | null = null;
  private cancelled = false;
  private cancelReason: BudgetStopReason | null = null;
  private readonly stoppedOrigins = new Set<string>();

  constructor(spec: CrawlBudgetSpec, nowMs: () => number) {
    this.spec = spec;
    this.nowMs = nowMs;
  }

  /** Start the wall clock (called once when the crawl starts). */
  start(): void {
    if (this.startedAtMs === null) this.startedAtMs = this.nowMs();
  }

  /** Cooperative cancellation / kill switch (run-lease honoring is upstream). */
  cancel(reason: BudgetStopReason = "CANCELLED"): void {
    this.cancelled = true;
    this.cancelReason = reason;
  }

  /** Provider/source stop switch for one origin (e.g. source asked to stop). */
  stopOrigin(origin: string): void {
    this.stoppedOrigins.add(origin);
  }

  isOriginStopped(origin: string): boolean {
    return this.stoppedOrigins.has(origin);
  }

  /** Verdict BEFORE issuing a request (page slot, depth, wall time, stops). */
  beforeRequest(url: string, depth: number): BudgetVerdict {
    if (this.cancelled) {
      return { proceed: false, reason: this.cancelReason ?? "CANCELLED", detail: "stop switch is engaged" };
    }
    const origin = new URL(url).origin;
    if (this.stoppedOrigins.has(origin)) {
      return { proceed: false, reason: "SOURCE_STOPPED", detail: `origin ${origin} is stopped by policy` };
    }
    if (depth > this.spec.max_depth) {
      return { proceed: false, reason: "MAX_DEPTH", detail: `depth ${depth} exceeds max_depth ${this.spec.max_depth}` };
    }
    if (this.pagesFetched >= this.spec.max_pages) {
      return { proceed: false, reason: "MAX_PAGES", detail: `page budget exhausted (${this.spec.max_pages})` };
    }
    const overTime = this.wallTimeExceeded();
    if (overTime !== null) return overTime;
    return { proceed: true };
  }

  /** Wall-clock check (also called between redirect hops). */
  wallTimeExceeded(): BudgetVerdict | null {
    if (this.startedAtMs !== null && this.nowMs() - this.startedAtMs > this.spec.wall_time_ms) {
      return {
        proceed: false,
        reason: "WALL_TIME",
        detail: `wall time exceeded ${this.spec.wall_time_ms}ms`,
      };
    }
    return null;
  }

  /** Whether a response of `bytes` still fits the byte budget. */
  bytesWouldFit(bytes: number): boolean {
    return this.bytesFetched + bytes <= this.spec.max_bytes;
  }

  /** Record a fetched page (pages + bytes counters). */
  recordPage(bytes: number): BudgetVerdict {
    this.pagesFetched += 1;
    this.bytesFetched += bytes;
    if (this.bytesFetched > this.spec.max_bytes) {
      return { proceed: false, reason: "MAX_BYTES", detail: `byte budget exhausted (${this.spec.max_bytes})` };
    }
    return { proceed: true };
  }

  /** Record an accepted dataset item. */
  recordItem(): BudgetVerdict {
    this.itemsAccepted += 1;
    if (this.itemsAccepted > this.spec.max_items) {
      return { proceed: false, reason: "MAX_ITEMS", detail: `item budget exhausted (${this.spec.max_items})` };
    }
    return { proceed: true };
  }

  /** Exponential backoff (bounded) for retry attempt N (1-based). */
  retryBackoffMs(attempt: number): number {
    const capped = Math.min(attempt, 10);
    return Math.min(this.spec.retry_backoff_base_ms * 2 ** (capped - 1), 30000);
  }

  canRetry(attempt: number): boolean {
    return attempt <= this.spec.max_retries_per_request;
  }

  stats(): { pages: number; items: number; bytes: number } {
    return { pages: this.pagesFetched, items: this.itemsAccepted, bytes: this.bytesFetched };
  }
}
