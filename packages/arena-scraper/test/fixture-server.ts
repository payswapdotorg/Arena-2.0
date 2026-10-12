import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * AR2-017 本地 fixture server —— node:http on 127.0.0.1 with a random port,
 * started per-test(-file)。无外部网络；所有请求（含 robots.txt、重定向、
 * 5xx 重试、慢页面）都由本地路由表决定，并记录到达时间戳供速率/重试断言。
 */

export interface RecordedRequest {
  method: string;
  url: string;
  at: number;
  authorization: string | null;
}

export interface FixtureServerOptions {
  /** robots.txt body；null（默认）返回 404。 */
  robots?: string | null;
  /** path → html body。 */
  pages?: Record<string, string>;
  /** path → Location（默认 302）。 */
  redirects?: Record<string, string | { location: string; status: number }>;
  /** path → 响应前延迟 ms。 */
  slowPaths?: Record<string, number>;
  /** path → 前 N 次 500，之后按 pages/served 服务。 */
  failFirstN?: Record<string, number>;
  /** path → 原始状态码（如 404）。 */
  statuses?: Record<string, number>;
  /** path → 额外/覆盖响应头（如 content-type）。 */
  headers?: Record<string, Record<string, string>>;
}

export interface FixtureServer {
  port: number;
  baseUrl: string;
  requests: RecordedRequest[];
  requestsFor(path: string): RecordedRequest[];
  close(): Promise<void>;
}

export async function startFixtureServer(options: FixtureServerOptions = {}): Promise<FixtureServer> {
  const requests: RecordedRequest[] = [];
  const failCounts = new Map<string, number>();
  const server = http.createServer((request, response) => {
    const url = request.url ?? "/";
    const path = url.split("?")[0] ?? url;
    requests.push({
      method: request.method ?? "GET",
      url,
      at: Date.now(),
      authorization: request.headers.authorization ?? null,
    });
    const finish = (status: number, body: string, extraHeaders: Record<string, string> = {}): void => {
      response.writeHead(status, { "content-type": "text/html; charset=utf-8", ...extraHeaders });
      response.end(body);
    };
    if (path === "/robots.txt") {
      if (options.robots === null || options.robots === undefined) {
        finish(404, "not found");
      } else {
        finish(200, options.robots, { "content-type": "text/plain; charset=utf-8" });
      }
      return;
    }
    const failBudget = options.failFirstN?.[path];
    if (failBudget !== undefined) {
      const seen = (failCounts.get(path) ?? 0) + 1;
      failCounts.set(path, seen);
      if (seen <= failBudget) {
        finish(500, "temporary failure");
        return;
      }
    }
    const redirect = options.redirects?.[path];
    if (redirect !== undefined) {
      const location = typeof redirect === "string" ? redirect : redirect.location;
      const status = typeof redirect === "string" ? 302 : redirect.status;
      finish(status, "", { location });
      return;
    }
    const slow = options.slowPaths?.[path];
    const serve = (): void => {
      const status = options.statuses?.[path];
      if (status !== undefined) {
        finish(status, "");
        return;
      }
      const page = options.pages?.[path];
      if (page !== undefined) {
        finish(200, page, options.headers?.[path] ?? {});
        return;
      }
      finish(404, "not found");
    };
    if (slow !== undefined) {
      setTimeout(serve, slow);
      return;
    }
    serve();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    requestsFor(path: string): RecordedRequest[] {
      return requests.filter((entry) => (entry.url.split("?")[0] ?? entry.url) === path);
    },
    close(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * 有状态 Apify REST v2 mock —— 只响应本地 127.0.0.1；校验 Bearer token；
 * runs 状态机可编程（用于 timeout→UNKNOWN 与 reconcile 路径）。
 */
export interface ApifyMockOptions {
  token: string;
  /** actor → {pollsToSucceed, usageTotalUsd, datasetItems} */
  actors: Record<string, { pollsToSucceed: number; usageTotalUsd: number; datasetItems: unknown[] }>;
  /** actor → 前 N 次 POST /runs 返回 429。 */
  rateLimitFirstN?: Record<string, number>;
  /** actor → POST /runs 永远 500。 */
  alwaysFail?: Record<string, number>;
  /** actor → run 永不结束（true）或按 wallMs 结束。 */
  succeedAfterMs?: Record<string, number>;
}

export interface ApifyMockServer {
  port: number;
  baseUrl: string;
  postRunCount: number;
  bearerSeen: string | null;
  close(): Promise<void>;
}

export async function startApifyMockServer(options: ApifyMockOptions): Promise<ApifyMockServer> {
  const runs = new Map<string, { actor: string; status: string; startedAt: number }>();
  let runCounter = 0;
  const state = { postRunCount: 0, bearerSeen: null as string | null };
  const rateLimitSeen = new Map<string, number>();
  const server = http.createServer((request, response) => {
    const url = request.url ?? "/";
    const auth = request.headers.authorization ?? null;
    if (auth !== null) state.bearerSeen = auth;
    const send = (status: number, body: unknown): void => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (auth !== `Bearer ${options.token}`) {
      send(401, { error: { type: "INVALID_TOKEN", message: "invalid token" } });
      return;
    }
    const runMatch = url.match(/^\/v2\/acts\/([^/]+)\/runs\/([^/]+)$/);
    if (request.method === "GET" && runMatch !== null) {
      const run = runs.get(runMatch[2] ?? "");
      if (run === undefined) {
        send(404, { error: { type: "RUN_NOT_FOUND" } });
        return;
      }
      const actor = options.actors[run.actor];
      if (actor === undefined) {
        send(404, { error: { type: "ACTOR_NOT_FOUND" } });
        return;
      }
      const status = polledStatus(run, actor, options);
      run.status = status;
      const datasetReady = status === "SUCCEEDED";
      send(200, {
        data: {
          id: runMatch[2],
          status,
          defaultDatasetId: datasetReady ? `ds-${run.actor}` : null,
          usageTotalUsd: status === "SUCCEEDED" ? actor.usageTotalUsd : 0,
        },
      });
      return;
    }
    const startMatch = url.match(/^\/v2\/acts\/([^/]+)\/runs$/);
    if (request.method === "POST" && startMatch !== null) {
      const actorId = startMatch[1] ?? "";
      state.postRunCount += 1;
      const actor = options.actors[actorId];
      if (actor === undefined) {
        send(404, { error: { type: "ACTOR_NOT_FOUND" } });
        return;
      }
      if (options.alwaysFail?.[actorId] !== undefined) {
        send(500, { error: { type: "INTERNAL_ERROR" } });
        return;
      }
      const limitSeen = (rateLimitSeen.get(actorId) ?? 0) + 1;
      rateLimitSeen.set(actorId, limitSeen);
      if ((options.rateLimitFirstN?.[actorId] ?? 0) >= limitSeen) {
        send(429, { error: { type: "RATE_LIMIT" } });
        return;
      }
      runCounter += 1;
      const runId = `run-${String(runCounter).padStart(4, "0")}`;
      runs.set(runId, { actor: actorId, status: "RUNNING", startedAt: Date.now() });
      send(201, { data: { id: runId, status: "RUNNING", defaultDatasetId: null, usageTotalUsd: 0 } });
      return;
    }
    const datasetMatch = url.match(/^\/v2\/datasets\/(.+)\/items$/);
    if (request.method === "GET" && datasetMatch !== null) {
      const actorId = (datasetMatch[1] ?? "").replace(/^ds-/, "");
      const actor = options.actors[actorId];
      send(200, actor === undefined ? [] : actor.datasetItems);
      return;
    }
    send(404, { error: { type: "NOT_FOUND" } });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    get postRunCount(): number {
      return state.postRunCount;
    },
    get bearerSeen(): string | null {
      return state.bearerSeen;
    },
    close(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

function polledStatus(
  run: { actor: string; status: string; startedAt: number },
  actor: { pollsToSucceed: number; usageTotalUsd: number },
  options: ApifyMockOptions,
): string {
  if (run.status === "SUCCEEDED") return "SUCCEEDED";
  const wallMs = options.succeedAfterMs?.[run.actor];
  if (wallMs !== undefined) {
    return Date.now() - run.startedAt >= wallMs ? "SUCCEEDED" : "RUNNING";
  }
  const elapsed = Date.now() - run.startedAt;
  const ready = elapsed >= actor.pollsToSucceed * 5;
  return ready ? "SUCCEEDED" : "RUNNING";
}
