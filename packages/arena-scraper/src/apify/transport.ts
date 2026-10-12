import type { ApiConnectorDescriptor, ConnectorCallRequest, ConnectorCallOutcome } from "../connector.js";
import { connectorHttpRequest } from "../connector.js";

/**
 * AR2-017 — Apify transport plane (issue #33; spec §5).
 *
 * The descriptor-driven retrying HTTP client shared by the adapter's two
 * client planes (run lifecycle and dataset store): 401 fails closed as a
 * credential problem, a first 429 backs off once, 5xx and network errors
 * retry up to the descriptor budget with linear backoff, and oversize or
 * non-2xx responses fail typed. Every outcome carries the raw operation
 * id and never the token. This module is transport ONLY — policy gates
 * (quota, cost, rate, host approval) stay in the composition root.
 */

export async function apifyRequestJson(
  baseUrl: string,
  descriptor: ApiConnectorDescriptor,
  token: string,
  request: ConnectorCallRequest,
  method: "GET" | "POST",
  sleep: (ms: number) => Promise<void>,
): Promise<ConnectorCallOutcome> {
  let attempt = 0;
  let lastDetail = "unknown";
  for (;;) {
    attempt += 1;
    try {
      const response = await connectorHttpRequest(baseUrl, request.endpoint, {
        method,
        query: request.query,
        body: request.body,
        token,
        timeout_ms: descriptor.retry.timeout_ms,
      });
      if (response.status === 401) {
        return { kind: "FAILED", operation_id: request.operation_id, code: "SCRP_CONNECTOR_CREDENTIAL_MISSING", detail: "apify rejected the token (401)", retryable: false };
      }
      if (response.status === 429 && attempt <= 1) {
        await sleep(descriptor.retry.backoff_base_ms || 10);
        continue;
      }
      if (response.status >= 500) {
        if (attempt > descriptor.retry.max_retries) {
          return {
            kind: "FAILED",
            operation_id: request.operation_id,
            code: "SCRP_CONNECTOR_RETRY_EXCEEDED",
            detail: `persistent 5xx (${response.status}) after ${attempt} attempt(s)`,
            retryable: true,
          };
        }
        await sleep(descriptor.retry.backoff_base_ms * attempt);
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        return { kind: "FAILED", operation_id: request.operation_id, code: "SCRP_CONNECTOR_RESPONSE_INVALID", detail: `unexpected status ${response.status}`, retryable: false };
      }
      if (response.bytes > descriptor.max_response_bytes) {
        return { kind: "FAILED", operation_id: request.operation_id, code: "SCRP_CONNECTOR_RESPONSE_INVALID", detail: "response exceeded max bytes", retryable: false };
      }
      return { kind: "SUCCEEDED", operation_id: request.operation_id, status: response.status, body: response.json, bytes: response.bytes, cost_amount: null };
    } catch (error) {
      lastDetail = String(error);
      if (attempt > descriptor.retry.max_retries) {
        return { kind: "FAILED", operation_id: request.operation_id, code: "SCRP_CONNECTOR_RETRY_EXCEEDED", detail: lastDetail, retryable: true };
      }
      await sleep(descriptor.retry.backoff_base_ms * attempt);
    }
  }
}
