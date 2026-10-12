import { createHmac } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { z } from "zod";
import { arenaIdSchema, currencyCodeSchema, positiveIntSchema, semverSchema } from "@arena/contracts";
import {
  SCRAPER_SCHEMA_FAMILY,
  hostnameSchema,
  nonEmptyMedium,
  nonEmptyShort,
  schemaReferenceSchema,
  type SemanticIssue,
} from "./primitives.js";
import { classifyShapeIssues, type ScrpErrorCode } from "./errors.js";

/**
 * AR2-017 — provider-neutral external API connector plane (issue #33; spec §5).
 *
 * The descriptor declares: adapter/provider ID+version, approved host and
 * endpoint patterns, HTTP methods, request schemas, a CREDENTIAL REFERENCE
 * (never the secret), rate/concurrency/quota/cost ceiling, retry/timeout/
 * cancellation/ambiguous-outcome semantics, response schema, max bytes/items,
 * retention/provenance requirements and region/entitlements. A scraper may not
 * smuggle an unregistered API call through generic networking: hosts and
 * endpoints are checked against the descriptor before any request is sent.
 */

/** Credential REFERENCE — the secret VALUE lives in a server-side secret store. */
export const credentialReferenceSchema = z
  .object({
    secret_ref: nonEmptyShort,
    scope: nonEmptyMedium,
    /** Secret values must never appear in any record, log or artifact. */
  })
  .strict();

export type CredentialReference = z.infer<typeof credentialReferenceSchema>;

export const connectorAmbiguitySchema = z.enum([
  "TIMEOUT_IS_UNKNOWN",
  "RECONCILE_SUPPORTED",
  "RECONCILE_UNSUPPORTED",
]);

export const apiConnectorDescriptorSchema = z
  .object({
    schema_version: z.literal(SCRAPER_SCHEMA_FAMILY),
    descriptor_id: arenaIdSchema,
    tenant_id: arenaIdSchema,
    adapter_id: nonEmptyShort,
    adapter_version: semverSchema,
    provider_id: arenaIdSchema,
    approved_host_patterns: z.array(hostnameSchema).min(1).max(32),
    approved_endpoint_patterns: z.array(nonEmptyShort).min(1).max(64),
    approved_methods: z.array(z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"])).min(1).max(5),
    request_schema: schemaReferenceSchema,
    credential_reference: credentialReferenceSchema.nullable(),
    rate: z
      .object({
        min_interval_ms: z.number().int().min(0),
        max_concurrency: positiveIntSchema.max(16),
      })
      .strict(),
    quota: z
      .object({
        max_calls_total: positiveIntSchema.max(1000000),
      })
      .strict(),
    cost: z
      .object({
        currency: currencyCodeSchema,
        ceiling_amount: z.number().min(0).finite(),
      })
      .strict(),
    retry: z
      .object({
        max_retries: z.number().int().min(0).max(10),
        backoff_base_ms: z.number().int().min(0),
        timeout_ms: positiveIntSchema,
        ambiguity: connectorAmbiguitySchema,
      })
      .strict(),
    response_schema: schemaReferenceSchema,
    max_response_bytes: positiveIntSchema,
    max_items: positiveIntSchema,
    retention_requirements: nonEmptyMedium,
    provenance_requirements: nonEmptyMedium,
    regions: z.array(nonEmptyShort).min(1).max(32),
    required_entitlements: z.array(nonEmptyShort).max(32),
    webhook: z
      .object({
        used: z.boolean(),
        signature_header: nonEmptyShort,
        algorithm: z.enum(["HMAC-SHA256"]),
        secret_ref: nonEmptyShort.nullable(),
        replay_policy: nonEmptyMedium,
      })
      .strict(),
  })
  .strict();

export type ApiConnectorDescriptor = z.infer<typeof apiConnectorDescriptorSchema>;

export type DescriptorCheck =
  | { ok: true; descriptor: ApiConnectorDescriptor }
  | { ok: false; code: ScrpErrorCode; issues: SemanticIssue[] };

export function checkApiConnectorDescriptor(input: unknown): DescriptorCheck {
  const parsed = apiConnectorDescriptorSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: classifyShapeIssues(parsed.error.issues),
      issues: parsed.error.issues.map((issue) => ({
        field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
        rule: `${issue.code}${issue.message ? ` — ${issue.message}` : ""}`,
      })),
    };
  }
  return { ok: true, descriptor: parsed.data };
}

/** A connector call as seen by the port (durable operation identity included). */
export interface ConnectorCallRequest {
  operation_id: string;
  host: string;
  endpoint: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
}

export type ConnectorCallOutcome =
  | {
      kind: "SUCCEEDED";
      operation_id: string;
      status: number;
      body: unknown;
      bytes: number;
      cost_amount: number | null;
    }
  | { kind: "FAILED"; operation_id: string; code: ScrpErrorCode; detail: string; retryable: boolean }
  | {
      kind: "UNKNOWN";
      operation_id: string;
      code: "SCRP_CONNECTOR_TIMEOUT_UNKNOWN";
      detail: string;
    };

export type ReconcileOutcome =
  | { kind: "RECONCILED_SUCCEEDED"; operation_id: string; body: unknown; cost_amount: number | null }
  | { kind: "RECONCILED_FAILED"; operation_id: string; detail: string }
  | { kind: "STILL_UNKNOWN"; operation_id: string; detail: string }
  | { kind: "RECONCILE_UNSUPPORTED"; operation_id: string; detail: string };

/**
 * ExternalApiConnectorPort — engine-neutral adapter interface. Credentials are
 * resolved server-side from a secret store through SecretResolver and are
 * redacted from logs, records and outputs (spec §5).
 */
export interface SecretResolver {
  resolve(secretRef: string): Promise<string>;
}

export interface ExternalApiConnectorPort {
  call(descriptor: ApiConnectorDescriptor, request: ConnectorCallRequest): Promise<ConnectorCallOutcome>;
  reconcile(
    descriptor: ApiConnectorDescriptor,
    operationId: string,
    request: ConnectorCallRequest,
  ): Promise<ReconcileOutcome>;
}

/** Paid-provider rule (spec §5). */
export const PAID_PROVIDER_FAIL_CLOSED_RULE =
  "paid provider use must be opt-in, budgeted, visible and fail closed when the approved limit or " +
  "configuration is missing: an unconfigured adapter is inert, and a cost-ceiling breach aborts before further spend";

/** Credential-reference rule (spec §5). */
export const CREDENTIAL_IS_REFERENCE_RULE =
  "descriptors and records carry only credential REFERENCES: secret values are retrieved server-side " +
  "from the secret store, scoped to the exact provider/action, and never appear in logs, traces, " +
  "environment variables or outputs";

// ---- Webhook/callback signature verification ---------------------------------

/** Webhook verification needs the port's descriptor + secret resolver shape. */
export interface WebhookVerificationInput {
  descriptor: ApiConnectorDescriptor;
  headers: Record<string, string>;
  rawBody: string;
  /** Secret VALUE resolved server-side from the declared webhook secret_ref. */
  secret: string;
}

export type WebhookVerification =
  | { ok: true }
  | { ok: false; code: "SCRP_CONNECTOR_SIGNATURE_INVALID"; detail: string };

/**
 * Verify a connector webhook/callback signature (HMAC-SHA256 over the raw
 * body with the secret resolved from its REFERENCE; spec §5 "where used").
 * Pure function so both the Apify adapter and future adapters reuse it.
 */
export function verifyConnectorWebhook(
  descriptor: ApiConnectorDescriptor,
  headers: Record<string, string>,
  rawBody: string,
  secret: string,
): WebhookVerification {
  if (!descriptor.webhook.used) {
    return { ok: false, code: "SCRP_CONNECTOR_SIGNATURE_INVALID", detail: "descriptor declares no webhook usage" };
  }
  const provided =
    headers[descriptor.webhook.signature_header] ?? headers[descriptor.webhook.signature_header.toLowerCase()] ?? null;
  if (provided === null) {
    return { ok: false, code: "SCRP_CONNECTOR_SIGNATURE_INVALID", detail: `signature header ${descriptor.webhook.signature_header} is missing` };
  }
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) {
    return { ok: false, code: "SCRP_CONNECTOR_SIGNATURE_INVALID", detail: "webhook signature failed verification" };
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  if (diff !== 0) {
    return { ok: false, code: "SCRP_CONNECTOR_SIGNATURE_INVALID", detail: "webhook signature failed verification" };
  }
  return { ok: true };
}

// ---- Adapter-side HTTP helper -----------------------------------------------
// The connection target is ALWAYS the explicitly configured base_url (the
// approved provider endpoint; tests inject the local mock server). The
// descriptor's approved_host_patterns gate the LOGICAL host before this point.

export interface ConnectorHttpRequestOptions {
  method: "GET" | "POST";
  query?: Record<string, string>;
  body?: unknown;
  token: string;
  timeout_ms: number;
}

export interface ConnectorHttpResponse {
  status: number;
  json: unknown;
  bytes: number;
}

export async function connectorHttpRequest(
  baseUrl: string,
  endpoint: string,
  options: ConnectorHttpRequestOptions,
): Promise<ConnectorHttpResponse> {
  const url = new URL(`${baseUrl}${endpoint}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }
  const transport = url.protocol === "https:" ? https : http;
  const headers: Record<string, string> = {
    authorization: `Bearer ${options.token}`,
    "content-type": "application/json",
  };
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const request = transport.request(url, { method: options.method, headers, timeout: options.timeout_ms }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks);
        let json: unknown = null;
        try {
          json = JSON.parse(body.toString("utf8"));
        } catch {
          json = null;
        }
        resolve({ status: response.statusCode ?? 0, json, bytes: body.byteLength });
      });
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("connector request timeout")));
    request.on("error", reject);
    if (payload !== undefined) request.write(payload);
    request.end();
  });
}
