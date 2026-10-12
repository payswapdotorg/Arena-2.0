import type { ApiConnectorDescriptor, ConnectorCallRequest, ConnectorCallOutcome } from "../connector.js";
import { connectorHttpRequest } from "../connector.js";
import { apifyRequestJson } from "./transport.js";

/**
 * AR2-017 — Apify async run-lifecycle client (issue #33; spec §5).
 *
 * Plane 1 of the adapter: starting an actor run (POST, through the
 * retrying transport) and observing its lifecycle (GET /runs/:id,
 * single-shot — a non-200 observation returns null and keeps the outcome
 * UNKNOWN; it is never retried here because run observation is an
 * idempotent read the orchestrator re-issues on its own cadence). Run
 * payloads are untrusted remote data and are parsed defensively. The
 * run id doubles as the operation identity tail for reconciliation.
 */

export interface ApifyRunState {
  runId: string;
  status: string;
  defaultDatasetId: string | null;
  usageTotalUsd: number;
}

export function runStateOf(body: unknown): ApifyRunState {
  const record = (body ?? {}) as { data?: Record<string, unknown> };
  const data = record.data ?? (record as Record<string, unknown>);
  return {
    runId: String(data.id ?? ""),
    status: String(data.status ?? "UNKNOWN"),
    defaultDatasetId: data.defaultDatasetId === undefined ? null : String(data.defaultDatasetId),
    usageTotalUsd: typeof data.usageTotalUsd === "number" ? data.usageTotalUsd : 0,
  };
}

/** The Apify run id is the tail of the qualified operation identity. */
export function runIdOfOperation(operationId: string): string {
  return operationId.split(":").pop() ?? operationId;
}

/** Start an actor run; failures surface the raw (unqualified) operation id. */
export async function startApifyRun(
  baseUrl: string,
  descriptor: ApiConnectorDescriptor,
  token: string,
  request: ConnectorCallRequest,
  sleep: (ms: number) => Promise<void>,
): Promise<ConnectorCallOutcome> {
  return apifyRequestJson(baseUrl, descriptor, token, request, "POST", sleep);
}

/** Observe run state once; null keeps the outcome UNKNOWN (never a guess). */
export async function fetchApifyRun(
  baseUrl: string,
  descriptor: ApiConnectorDescriptor,
  token: string,
  endpoint: string,
  runId: string,
): Promise<ApifyRunState | null> {
  const actorPath = endpoint.split("?")[0] ?? endpoint;
  const runsPath = actorPath.replace(/\/runs\/.*$/, "").replace(/\/(run-sync|run-sync-get-dataset-items|runs)$/m, "");
  const response = await connectorHttpRequest(baseUrl, `${runsPath}/runs/${runId}`, {
    method: "GET",
    token,
    timeout_ms: descriptor.retry.timeout_ms,
  });
  if (response.status !== 200) return null;
  return runStateOf(response.json);
}
