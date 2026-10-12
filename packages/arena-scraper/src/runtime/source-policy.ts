import { domainMatchesAllowlist } from "./egress.js";

/**
 * AR2-017 — Source policy: robots.txt coordination + per-domain limits
 * (issue #33; spec §6).
 *
 * Fetches and parses robots.txt per origin, respecting Disallow for the
 * declared user agent and Crawl-delay. Per-domain request limits are enforced
 * independently of robots. robots.txt is a COORDINATION mechanism, NOT
 * authorization: a robots-allowed source still requires a rights posture on
 * the definition (the factory policy gate checks that separately).
 */

export interface RobotsRules {
  readonly origin: string;
  readonly groups: ReadonlyArray<{
    user_agents: readonly string[];
    disallow: readonly string[];
    allow: readonly string[];
    crawl_delay_ms: number | null;
  }>;
  readonly fetched_at: string;
  readonly unavailable: boolean;
}

export const ROBOTS_IS_NOT_AUTHORIZATION_RULE =
  "robots.txt is a crawler coordination mechanism, not authorization by itself: robots-allowed " +
  "still requires a recorded rights posture and license assessment on the scraper definition";

export interface RobotsFetcher {
  /** Returns the robots.txt body for an origin, or null when absent/unfetchable. */
  fetchRobots(origin: string): Promise<string | null>;
}

/**
 * Compact robots.txt parser (REP): User-agent groups with Disallow/Allow
 * prefix rules and Crawl-delay. Longest matching prefix wins; Disallow wins
 * ties (conservative). Unknown directives are ignored.
 */
export function parseRobots(origin: string, body: string, fetchedAt: string): RobotsRules {
  const groups: Array<{ user_agents: string[]; disallow: string[]; allow: string[]; crawl_delay_ms: number | null }> = [];
  let current: (typeof groups)[number] | null = null;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0] ?? "";
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const directive = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (directive === "user-agent") {
      if (current === null || current.disallow.length > 0 || current.allow.length > 0 || current.crawl_delay_ms !== null) {
        current = { user_agents: [], disallow: [], allow: [], crawl_delay_ms: null };
        groups.push(current);
      }
      current.user_agents.push(value.toLowerCase());
    } else if (current !== null && directive === "disallow" && value !== "") {
      current.disallow.push(value);
    } else if (current !== null && directive === "allow" && value !== "") {
      current.allow.push(value);
    } else if (current !== null && directive === "crawl-delay") {
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds) && seconds >= 0) {
        current.crawl_delay_ms = Math.round(seconds * 1000);
      }
    }
  }
  return { origin, groups, fetched_at: fetchedAt, unavailable: false };
}

export function robotsForMissing(origin: string, fetchedAt: string): RobotsRules {
  return { origin, groups: [], fetched_at: fetchedAt, unavailable: true };
}

/** Select the most specific applicable group for the user agent (prefix token match). */
function selectGroup(rules: RobotsRules, userAgent: string): RobotsRules["groups"][number] | null {
  const ua = userAgent.toLowerCase();
  let star: RobotsRules["groups"][number] | null = null;
  for (const group of rules.groups) {
    if (group.user_agents.some((candidate) => ua.startsWith(candidate))) return group;
    if (group.user_agents.includes("*")) star = group;
  }
  return star;
}

function longestMatch(path: string, prefixes: readonly string[]): number {
  let best = -1;
  for (const prefix of prefixes) {
    if (prefix === "/" || path.startsWith(prefix)) {
      if (prefix.length > best) best = prefix.length;
    }
  }
  return best;
}

/** robots verdict for one path: allowed unless a longer/equal Disallow matches. */
export function isAllowedByRobots(rules: RobotsRules, userAgent: string, path: string): boolean {
  const group = selectGroup(rules, userAgent);
  if (group === null) return true;
  const disallow = longestMatch(path, group.disallow);
  const allow = longestMatch(path, group.allow);
  if (disallow === -1) return true;
  if (allow > disallow) return true;
  return false;
}

export function robotsCrawlDelayMs(rules: RobotsRules, userAgent: string): number {
  const group = selectGroup(rules, userAgent);
  return group?.crawl_delay_ms ?? 0;
}

export type SourcePolicyVerdict =
  | { allowed: true; delay_ms: number }
  | { allowed: false; code: "SCRP_ROBOTS_DISALLOWED" | "SCRP_DOMAIN_LIMIT_EXCEEDED"; detail: string };

export interface SourcePolicyConfig {
  user_agent: string;
  crawl_delay_ms: number;
  per_domain_request_limit: number;
  domains: readonly string[];
  /** Declared min spacing per origin (robots Crawl-delay raises it further). */
  min_interval_ms: number;
}

/**
 * Per-origin state: last request time (for spacing) and request count
 * (for the per-domain limit). robots.txt is fetched once per origin and
 * cached for the policy's lifetime.
 */
export class SourcePolicy {
  private readonly config: SourcePolicyConfig;
  private readonly fetcher: RobotsFetcher;
  private readonly robotsCache = new Map<string, RobotsRules>();
  private readonly lastRequestAtMs = new Map<string, number>();
  private readonly requestCounts = new Map<string, number>();
  private readonly nowMs: () => number;

  constructor(options: { config: SourcePolicyConfig; fetcher: RobotsFetcher; nowMs: () => number }) {
    this.config = options.config;
    this.fetcher = options.fetcher;
    this.nowMs = options.nowMs;
  }

  /** Declared user agent (robots groups are matched against this). */
  get userAgent(): string {
    return this.config.user_agent;
  }

  async robotsForOrigin(origin: string): Promise<RobotsRules> {
    const cached = this.robotsCache.get(origin);
    if (cached !== undefined) return cached;
    const body = await this.fetcher.fetchRobots(origin);
    const rules = body === null ? robotsForMissing(origin, this.isoNow()) : parseRobots(origin, body, this.isoNow());
    this.robotsCache.set(origin, rules);
    return rules;
  }

  /** Verdict for fetching one URL. `mark` records the request when allowed. */
  async checkUrl(url: string, mark: boolean): Promise<SourcePolicyVerdict> {
    const parsed = new URL(url);
    const origin = parsed.origin;
    const host = parsed.hostname.toLowerCase();
    if (!domainMatchesAllowlist(host, this.config.domains)) {
      return { allowed: false, code: "SCRP_DOMAIN_LIMIT_EXCEEDED", detail: `host ${host} is outside the source scope` };
    }
    const count = this.requestCounts.get(origin) ?? 0;
    if (count >= this.config.per_domain_request_limit) {
      return {
        allowed: false,
        code: "SCRP_DOMAIN_LIMIT_EXCEEDED",
        detail: `per-domain request limit ${this.config.per_domain_request_limit} reached for ${origin}`,
      };
    }
    const rules = await this.robotsForOrigin(origin);
    if (!isAllowedByRobots(rules, this.config.user_agent, parsed.pathname)) {
      return {
        allowed: false,
        code: "SCRP_ROBOTS_DISALLOWED",
        detail: `robots.txt on ${origin} disallows ${parsed.pathname} for ${this.config.user_agent}`,
      };
    }
    const spacing = Math.max(
      this.config.min_interval_ms,
      robotsCrawlDelayMs(rules, this.config.user_agent),
      this.config.crawl_delay_ms,
    );
    const last = this.lastRequestAtMs.get(origin) ?? 0;
    const elapsed = this.nowMs() - last;
    const delay = elapsed >= spacing ? 0 : spacing - elapsed;
    if (mark) {
      this.lastRequestAtMs.set(origin, this.nowMs() + delay);
      this.requestCounts.set(origin, count + 1);
    }
    return { allowed: true, delay_ms: delay };
  }

  private isoNow(): string {
    return new Date(this.nowMs()).toISOString().replace(/\.\d{3}Z$/, "Z");
  }
}
