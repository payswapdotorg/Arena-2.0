import type { ApiConnectorDescriptor } from "../connector.js";
import { connectorHttpRequest } from "../connector.js";

/**
 * AR2-017 — Apify dataset-store and HMAC-verification client (issue #33;
 * spec §5).
 *
 * Plane 2 of the adapter: collecting a finished run's dataset items from
 * the dataset store (single-shot GET, byte-capped by the descriptor —
 * null keeps the outcome UNKNOWN, never a guess) and verifying webhook
 * signatures (HMAC over the declared payload, re-exported from the
 * connector plane). Store responses are untrusted remote data: they are
 * size-checked here and schema-checked by the caller before use.
 */

export { verifyConnectorWebhook } from "../connector.js";

export interface ApifyDatasetPage {
  body: unknown;
  bytes: number;
}

/** Collect a run's dataset items; a null result keeps the outcome UNKNOWN. */
export async function fetchApifyDatasetItems(
  baseUrl: string,
  descriptor: ApiConnectorDescriptor,
  token: string,
  datasetId: string | null,
): Promise<ApifyDatasetPage | null> {
  if (datasetId === null) return null;
  const response = await connectorHttpRequest(baseUrl, `/v2/datasets/${datasetId}/items`, {
    method: "GET",
    token,
    timeout_ms: descriptor.retry.timeout_ms,
  });
  if (response.status !== 200) return null;
  if (response.bytes > descriptor.max_response_bytes) return null;
  return { body: response.json, bytes: response.bytes };
}

/** The declared response schema check (no hook declared -> accept). */
export function datasetResponseIsValid(
  validateResponse: ((body: unknown) => boolean) | undefined,
  body: unknown,
): boolean {
  return validateResponse === undefined || validateResponse(body);
}
