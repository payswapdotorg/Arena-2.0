import type {
  ApiConnectorDescriptor,
  ConnectorCallOutcome,
  ConnectorCallRequest,
  ExternalApiConnectorPort,
  ReconcileOutcome,
  SecretResolver,
} from "./connector.js";
import { checkApiConnectorDescriptor } from "./connector.js";
import { fetchApifyRun, runIdOfOperation, runStateOf, startApifyRun } from "./apify/run-client.js";
import { datasetResponseIsValid, fetchApifyDatasetItems } from "./apify/store-client.js";
export { verifyConnectorWebhook } from "./apify/store-client.js";

/**
 * AR2-017 — OPTIONAL Apify adapter for the ExternalApiConnectorPort
 * (issue #33; spec §5 — Apify REST API v2). Composition root over the two
 * client planes in ./apify/: the async run lifecycle (run-client.ts) and
 * the dataset-store/HMAC verification (store-client.ts), which share the
 * retrying transport (transport.ts).
 *
 * Runs ONLY when explicitly configured (an unconfigured adapter is INERT and
 * fails closed with SCRP_CONNECTOR_NOT_CONFIGURED). Tests use a LOCAL mock
 * server — never the live paid API. The API token is resolved from a secret
 * REFERENCE through the injected SecretResolver and is used in-flight only:
 * it never appears in descriptors, logs, records or outcomes. A timeout
 * mid-run is an UNKNOWN outcome carrying the operation identity (the Apify
 * run id) which `reconcile` uses to poll the run and complete without
 * duplicate paid work. Cost ceilings fail closed before further spend.
 */

export interface ApifyAdapterConfig {
  adapter_version: string;
  /** Secret REFERENCE for the Apify API token (resolved server-side). */
  api_token_secret_ref: string;
  /** Default https://api.apify.com/v2 — tests inject the local mock server. */
  base_url: string;
}

export interface ApifyAdapterOptions {
  config: ApifyAdapterConfig | null;
  secretResolver: SecretResolver;
  nowMs: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Response schema check hook (declared response_schema is honored). */
  validateResponse?: (body: unknown) => boolean;
}

export class ApifyAdapter implements ExternalApiConnectorPort {
  private readonly options: ApifyAdapterOptions;
  private readonly lastCallAtMs = new Map<string, number>();
  private readonly inFlight = new Set<string>();
  private callsMade = 0;
  private costSpent = 0;

  constructor(options: ApifyAdapterOptions) {
    this.options = options;
  }

  /** Adapter identity disclosure (spec §5: adapter/provider ID + version). */
  get adapterId(): string {
    return "apify-adapter";
  }

  get adapterVersion(): string {
    return this.options.config?.adapter_version ?? "0.0.0";
  }

  async call(
    descriptor: ApiConnectorDescriptor,
    request: ConnectorCallRequest,
  ): Promise<ConnectorCallOutcome> {
    const check = checkApiConnectorDescriptor(descriptor);
    if (!check.ok) {
      return { kind: "FAILED", operation_id: request.operation_id, code: check.code, detail: "descriptor failed validation", retryable: false };
    }
    const config = this.options.config;
    if (config === null) {
      return {
        kind: "FAILED",
        operation_id: request.operation_id,
        code: "SCRP_CONNECTOR_NOT_CONFIGURED",
        detail: "apify adapter is inert: explicit configuration is required (fail closed)",
        retryable: false,
      };
    }
    if (descriptor.credential_reference === null || descriptor.credential_reference.secret_ref !== config.api_token_secret_ref) {
      return {
        kind: "FAILED",
        operation_id: request.operation_id,
        code: "SCRP_CONNECTOR_CREDENTIAL_MISSING",
        detail: "credential reference missing or not aligned with the adapter configuration",
        retryable: false,
      };
    }
    if (!hostApproved(request.host, descriptor)) {
      return {
        kind: "FAILED",
        operation_id: request.operation_id,
        code: "SCRP_CONNECTOR_HOST_NOT_APPROVED",
        detail: `host ${request.host} is not in the descriptor's approved host patterns`,
        retryable: false,
      };
    }
    if (!descriptor.approved_methods.includes(request.method)) {
      return {
        kind: "FAILED",
        operation_id: request.operation_id,
        code: "SCRP_CONNECTOR_METHOD_NOT_ALLOWED",
        detail: `method ${request.method} is not approved`,
        retryable: false,
      };
    }
    if (this.callsMade >= descriptor.quota.max_calls_total) {
      return {
        kind: "FAILED",
        operation_id: request.operation_id,
        code: "SCRP_CONNECTOR_QUOTA_EXCEEDED",
        detail: `call quota ${descriptor.quota.max_calls_total} exhausted`,
        retryable: false,
      };
    }
    const budgetCeiling = descriptor.cost.ceiling_amount;
    if (this.costSpent >= budgetCeiling) {
      return {
        kind: "FAILED",
        operation_id: request.operation_id,
        code: "SCRP_CONNECTOR_COST_CEILING_EXCEEDED",
        detail: `cost ceiling ${budgetCeiling} ${descriptor.cost.currency} already spent (fail closed)`,
        retryable: false,
      };
    }
    const rate = await this.awaitRateSlot(descriptor, request.host);
    if (!rate.ok) return rate.failure;
    if (this.inFlight.size >= descriptor.rate.max_concurrency) {
      return {
        kind: "FAILED",
        operation_id: request.operation_id,
        code: "SCRP_CONNECTOR_RATE_LIMITED",
        detail: "concurrency limit reached",
        retryable: true,
      };
    }
    this.callsMade += 1;
    this.inFlight.add(request.operation_id);
    try {
      return await this.callApproved(descriptor, config, request);
    } finally {
      this.inFlight.delete(request.operation_id);
    }
  }

  async reconcile(
    descriptor: ApiConnectorDescriptor,
    operationId: string,
    request: ConnectorCallRequest,
  ): Promise<ReconcileOutcome> {
    const config = this.options.config;
    if (config === null) {
      return { kind: "RECONCILE_UNSUPPORTED", operation_id: operationId, detail: "adapter inert" };
    }
    if (descriptor.retry.ambiguity === "RECONCILE_UNSUPPORTED") {
      return { kind: "RECONCILE_UNSUPPORTED", operation_id: operationId, detail: "descriptor declares no reconciliation" };
    }
    const token = await this.resolveToken(descriptor, operationId);
    if (typeof token !== "string") {
      return { kind: "RECONCILE_UNSUPPORTED", operation_id: operationId, detail: "credential resolution failed (fail closed)" };
    }
    const runId = runIdOfOperation(operationId);
    const run = await fetchApifyRun(config.base_url, descriptor, token, request.endpoint, runId);
    if (run === null) {
      return { kind: "STILL_UNKNOWN", operation_id: operationId, detail: "run state is not resolvable yet" };
    }
    if (run.status === "SUCCEEDED") {
      const items = await fetchApifyDatasetItems(config.base_url, descriptor, token, run.defaultDatasetId);
      if (items === null) {
        return { kind: "STILL_UNKNOWN", operation_id: operationId, detail: "dataset items are not available yet" };
      }
      return { kind: "RECONCILED_SUCCEEDED", operation_id: operationId, body: items.body, cost_amount: run.usageTotalUsd };
    }
    if (run.status === "FAILED" || run.status === "ABORTED" || run.status === "TIMED_OUT") {
      return { kind: "RECONCILED_FAILED", operation_id: operationId, detail: `apify run ${runId} ended ${run.status}` };
    }
    return { kind: "STILL_UNKNOWN", operation_id: operationId, detail: `apify run ${runId} is ${run.status}` };
  }

  private async callApproved(
    descriptor: ApiConnectorDescriptor,
    config: ApifyAdapterConfig,
    request: ConnectorCallRequest,
  ): Promise<ConnectorCallOutcome> {
    const token = await this.resolveToken(descriptor, request.operation_id);
    if (typeof token !== "string") return token;
    // Start the run (operation identity = apify run id).
    const started = await startApifyRun(config.base_url, descriptor, token, request, this.options.sleep);
    if (started.kind !== "SUCCEEDED") return started;
    const run = runStateOf(started.body);
    const operationId = `${request.operation_id}:${run.runId}`;
    const deadlineMs = this.options.nowMs() + descriptor.retry.timeout_ms;
    // Poll until terminal, the timeout (-> UNKNOWN with operation identity) or cost ceiling.
    for (;;) {
      const poll = await fetchApifyRun(config.base_url, descriptor, token, request.endpoint, run.runId);
      if (poll === null) {
        return { kind: "UNKNOWN", operation_id: operationId, code: "SCRP_CONNECTOR_TIMEOUT_UNKNOWN", detail: "run state unavailable" };
      }
      this.costSpent += poll.usageTotalUsd;
      if (this.costSpent > descriptor.cost.ceiling_amount) {
        return {
          kind: "FAILED",
          operation_id: operationId,
          code: "SCRP_CONNECTOR_COST_CEILING_EXCEEDED",
          detail: `estimated cost ${this.costSpent.toFixed(4)} exceeded ceiling ${descriptor.cost.ceiling_amount} (fail closed)`,
          retryable: false,
        };
      }
      if (poll.status === "SUCCEEDED") {
        const items = await fetchApifyDatasetItems(config.base_url, descriptor, token, poll.defaultDatasetId);
        if (items === null) {
          return {
            kind: "FAILED",
            operation_id: operationId,
            code: "SCRP_CONNECTOR_RESPONSE_INVALID",
            detail: "dataset items missing on a SUCCEEDED run",
            retryable: false,
          };
        }
        if (!datasetResponseIsValid(this.options.validateResponse, items.body)) {
          return {
            kind: "FAILED",
            operation_id: operationId,
            code: "SCRP_CONNECTOR_RESPONSE_INVALID",
            detail: "response failed the declared response schema check",
            retryable: false,
          };
        }
        return { kind: "SUCCEEDED", operation_id: operationId, status: 200, body: items.body, bytes: items.bytes, cost_amount: poll.usageTotalUsd };
      }
      if (poll.status === "FAILED" || poll.status === "ABORTED" || poll.status === "TIMED_OUT") {
        return { kind: "FAILED", operation_id: operationId, code: "SCRP_INTERNAL_ERROR", detail: `apify run ended ${poll.status}`, retryable: false };
      }
      if (this.options.nowMs() >= deadlineMs) {
        return {
          kind: "UNKNOWN",
          operation_id: operationId,
          code: "SCRP_CONNECTOR_TIMEOUT_UNKNOWN",
          detail: "timeout while waiting for the apify run (unknown outcome; operation identity persisted)",
        };
      }
      await this.options.sleep(5);
    }
  }

  private async resolveToken(
    descriptor: ApiConnectorDescriptor,
    operationId: string,
  ): Promise<string | ConnectorCallOutcome> {
    if (descriptor.credential_reference === null) {
      return {
        kind: "FAILED",
        operation_id: operationId,
        code: "SCRP_CONNECTOR_CREDENTIAL_MISSING",
        detail: "descriptor carries no credential reference",
        retryable: false,
      };
    }
    try {
      return await this.options.secretResolver.resolve(descriptor.credential_reference.secret_ref);
    } catch {
      return {
        kind: "FAILED",
        operation_id: operationId,
        code: "SCRP_CONNECTOR_CREDENTIAL_MISSING",
        detail: "secret reference could not be resolved (fail closed)",
        retryable: false,
      };
    }
  }

  private async awaitRateSlot(
    descriptor: ApiConnectorDescriptor,
    host: string,
  ): Promise<{ ok: true } | { ok: false; failure: ConnectorCallOutcome }> {
    const interval = descriptor.rate.min_interval_ms;
    if (interval <= 0) return { ok: true };
    const last = this.lastCallAtMs.get(host) ?? 0;
    const wait = last + interval - this.options.nowMs();
    if (wait > 0) await this.options.sleep(wait);
    this.lastCallAtMs.set(host, this.options.nowMs());
    return { ok: true };
  }

  /** Spent so far (for tests and observability; never includes the token). */
  costSpentUsd(): number {
    return this.costSpent;
  }
}

function hostApproved(host: string, descriptor: ApiConnectorDescriptor): boolean {
  const lowered = host.toLowerCase();
  return descriptor.approved_host_patterns.some((pattern) => {
    const rule = pattern.toLowerCase();
    if (rule.startsWith("*.")) {
      return lowered.endsWith(rule.slice(1));
    }
    return lowered === rule;
  });
}
