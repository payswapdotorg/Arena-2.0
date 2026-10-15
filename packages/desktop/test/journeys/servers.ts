import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * UIA-006 — the journey servers (issue #80).
 *
 * 1) startHostServer — a minimal static server for the esbuild render-host
 *    dist directory (the same posture as the shell a11y harness).
 *
 * 2) startArenaApiFixtureServer — a REAL local node:http "arena-api edge"
 *    fixture (mirror of the composition.test.ts fixture shapes) for the
 *    configured-baseUrl journeys: real HTTP + real fetch from the Electron
 *    renderer — including the real cross-origin posture (the renderer origin
 *    is the host server, the API is a different port), so the fixture answers
 *    CORS preflights and stamps access-control-allow-origin. Every observed
 *    request is recorded verbatim for the evidence transcript (method, path,
 *    bearer token, idempotency key, request digest). No fake success shapes.
 */

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
};

/** Minimal static server for the render-host dist directory. */
export async function startHostServer(distDir: string): Promise<{ url: string; server: Server }> {
  const server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    const file = path === "/" ? "index.html" : path.replace(/^\//, "");
    const safe = join(distDir, file);
    if (!safe.startsWith(distDir) || !existsSync(safe)) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }
    response.setHeader(
      "content-type",
      CONTENT_TYPES[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream",
    );
    response.end(readFileSync(safe));
  });
  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      accept();
    });
  });
  const address = server.address() as { port: number };
  return { url: `http://127.0.0.1:${address.port}/`, server };
}

/** A fixture tracking row / escalation projection (composition.test.ts shape). */
export interface FixtureEscalation {
  escalation_id: string;
  status: string;
  updated_at: string;
}

export interface ObservedRequest {
  method: string;
  path: string;
  authorization: string | null;
  idempotencyKey: string | null;
  requestDigest: string | null;
}

export interface ArenaApiFixture {
  url: string;
  server: Server;
  observed: readonly ObservedRequest[];
  stationProbeHits: () => number;
  escalations: () => readonly FixtureEscalation[];
}

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, x-idempotency-key",
  "access-control-max-age": "600",
};

function sendJson(
  response: import("node:http").ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    response.setHeader(name, value);
  }
  response.end(JSON.stringify(payload));
}

const STATION_PROBE_ROWS = {
  ready: false,
  fail_closed: true,
  dependencies: [
    {
      id: "station-persistence-node-sqlite",
      kind: "persistence",
      status: "UP",
      detail:
        "node:sqlite resolvable — the arena-persistence sqlite_reference_engine class (journey fixture row)",
      checked_at: "2026-10-16T00:00:00Z",
    },
    {
      id: "station-isolation-bwrap",
      kind: "capsule_provider",
      status: "DOWN",
      detail: "bwrap not detected (journey fixture row — real measurement lives server-side)",
      checked_at: "2026-10-16T00:00:00Z",
    },
  ],
  not_up: [
    {
      id: "station-isolation-bwrap",
      kind: "capsule_provider",
      status: "DOWN",
      detail: "bwrap not detected (journey fixture row — real measurement lives server-side)",
      checked_at: "2026-10-16T00:00:00Z",
    },
  ],
};

/**
 * The real local arena-api fixture: the requester tracking projection, the
 * timeline/result projections, the station-probes endpoint (fail-closed row
 * set: persistence UP + bwrap DOWN), and the idempotent submit path (201 with
 * the submitted escalation appended to the tracking projection).
 */
export async function startArenaApiFixtureServer(): Promise<ArenaApiFixture> {
  const observed: ObservedRequest[] = [];
  let stationProbeHits = 0;
  const escalations: FixtureEscalation[] = [
    { escalation_id: "esc_journey_0001", status: "CREATED", updated_at: "2026-10-16T08:00:00Z" },
    { escalation_id: "esc_journey_0002", status: "VERIFYING", updated_at: "2026-10-16T08:30:00Z" },
  ];

  const server = createServer((request, response) => {
    const url = request.url ?? "/";
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.setHeader("content-type", "text/plain");
      for (const [name, value] of Object.entries(CORS_HEADERS)) {
        response.setHeader(name, value);
      }
      response.end();
      return;
    }
    const authorization = request.headers.authorization ?? null;
    const idempotencyKey =
      (request.headers["x-idempotency-key"] as string | undefined) ?? null;
    let requestDigest: string | null = null;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = chunks.length > 0 ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>) : {};
      requestDigest = typeof body.request_digest === "string" ? body.request_digest : null;
      observed.push({
        method: request.method ?? "",
        path: url,
        authorization,
        idempotencyKey,
        requestDigest,
      });

      if (url === "/v1/escalations" && request.method === "GET") {
        sendJson(response, 200, {
          items: escalations.map(({ escalation_id, status, updated_at }) => ({
            escalation_id,
            status,
            updated_at,
          })),
          tenant_scope: "tnt_00000001",
        });
        return;
      }
      if (url === "/v1/escalations" && request.method === "POST") {
        const escalation_id = "esc_journey_0003";
        if (!escalations.some((row) => row.escalation_id === escalation_id)) {
          escalations.push({
            escalation_id,
            status: "CREATED",
            updated_at: "2026-10-16T09:00:00Z",
          });
        }
        sendJson(response, 201, { escalation_id, status: "CREATED", version: 1 });
        return;
      }
      const timelineMatch = /^\/v1\/escalations\/([^/]+)\/timeline$/u.exec(url);
      if (timelineMatch !== null && request.method === "GET") {
        sendJson(response, 200, {
          events: [
            {
              event_type: "EscalationCreated",
              occurred_at: "2026-10-16T08:00:00Z",
              actor: "requester",
            },
            {
              event_type: "EscalationAmendEscalation",
              occurred_at: "2026-10-16T08:10:00Z",
              actor: "requester",
            },
            {
              event_type: "EscalationVerifyRequested",
              occurred_at: "2026-10-16T08:30:00Z",
              actor: "system",
            },
          ],
        });
        return;
      }
      const resultMatch = /^\/v1\/escalations\/([^/]+)\/result$/u.exec(url);
      if (resultMatch !== null && request.method === "GET") {
        // The typed stub posture: legible "not yet available" with disclosure.
        sendJson(response, 404, {
          code: "ARENA_RESULT_NOT_AVAILABLE",
          message: "result view not yet available",
          correlation_id: "corr_journey_result_1",
          request_id: null,
          details: {
            disclosure: "result views land with AR2-007 (recorded frontier — legible, not blank)",
          },
        });
        return;
      }
      if (url === "/v1/ops/station-probes" && request.method === "GET") {
        stationProbeHits += 1;
        sendJson(response, 200, STATION_PROBE_ROWS);
        return;
      }
      sendJson(response, 404, {
        code: "ARENA_NOT_FOUND",
        message: `no route for ${request.method ?? ""} ${url} (journey fixture)`,
        correlation_id: "corr_journey_fixture_404",
        request_id: null,
        details: null,
      });
    });
  });

  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      accept();
    });
  });
  const address = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}`,
    server,
    observed,
    stationProbeHits: () => stationProbeHits,
    escalations: () => escalations,
  };
}
