import { z } from "zod";
import { arenaIdSchema, digestSchema, isoTimestampSchema } from "@arena/contracts";
import {
  SCRAPER_SCHEMA_FAMILY,
  nonEmptyMedium,
  nonEmptyShort,
  type SemanticIssue,
} from "./primitives.js";
import { classifyShapeIssues, type ScrpErrorCode } from "./errors.js";

/**
 * AR2-017 — AcquisitionRun record (issue #33; spec §2/§3 end-to-end flow).
 *
 * request/provider/scraper-version IDs, durable attempt counter and lease,
 * cancellation/deadline, quotas, append-only event trail, output references and
 * a terminal reason. Idempotent command semantics; fenced retries. Ambiguous
 * outcomes (timeout mid-crawl) persist operation identity and land in UNKNOWN —
 * never silently-failed.
 */

export const runStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "UNKNOWN",
]);

export type RunStatus = z.infer<typeof runStatusSchema>;

export const runQuotaSchema = z
  .object({
    max_pages: z.number().int().min(1),
    max_items: z.number().int().min(1),
    max_bytes: z.number().int().min(1),
    wall_time_seconds: z.number().int().min(1).max(86400),
    max_cost_usd: z.number().min(0).finite(),
  })
  .strict();

export type RunQuota = z.infer<typeof runQuotaSchema>;

export const runEventSchema = z
  .object({
    event_seq: z.number().int().min(1),
    at: isoTimestampSchema,
    kind: z.enum([
      "RUN_CREATED",
      "IDEMPOTENCY_REPLAY",
      "LEASE_ACQUIRED",
      "LEASE_RELEASED",
      "CAPSULE_PROVISIONED",
      "CRAWL_STARTED",
      "PAGE_FETCHED",
      "PAGE_QUARANTINED",
      "EGRESS_DENIED",
      "ROBOTS_DISALLOWED",
      "BUDGET_STOP",
      "CANCEL_REQUESTED",
      "DATASET_EMITTED",
      "UNKNOWN_OUTCOME_RECORDED",
      "RUN_TERMINATED",
    ]),
    detail: nonEmptyMedium.nullable(),
  })
  .strict();

export type RunEvent = z.infer<typeof runEventSchema>;

export const runLeaseSchema = z
  .object({
    lease_id: arenaIdSchema,
    attempt: z.number().int().min(1).max(64),
    holder: nonEmptyShort,
    acquired_at: isoTimestampSchema,
    expires_at: isoTimestampSchema,
  })
  .strict();

export type RunLease = z.infer<typeof runLeaseSchema>;

export const acquisitionRunSchema = z
  .object({
    schema_version: z.literal(SCRAPER_SCHEMA_FAMILY),
    run_id: arenaIdSchema,
    tenant_id: arenaIdSchema,
    request_id: arenaIdSchema,
    provider_id: arenaIdSchema,
    scraper_version_id: arenaIdSchema,
    /** Version pinning: the exact digests the run must execute. */
    scraper_version_digest: digestSchema,
    idempotency_key: nonEmptyShort,
    correlation_id: arenaIdSchema,
    causation_id: arenaIdSchema.nullable(),
    status: runStatusSchema,
    attempt_counter: z.number().int().min(0).max(64),
    lease: runLeaseSchema.nullable(),
    deadline: isoTimestampSchema,
    quotas: runQuotaSchema,
    events: z.array(runEventSchema).max(4096),
    output_dataset_id: arenaIdSchema.nullable(),
    /** Terminal reason (typed code; null while non-terminal). */
    terminal_reason: nonEmptyShort.nullable(),
    /** Persisted operation identity for ambiguous outcomes. */
    operation_identity: nonEmptyMedium.nullable(),
  })
  .strict();

export type AcquisitionRun = z.infer<typeof acquisitionRunSchema>;

export type AcquisitionRunCheck =
  | { ok: true; run: AcquisitionRun }
  | { ok: false; code: ScrpErrorCode; issues: SemanticIssue[] };

export function checkAcquisitionRun(input: unknown): AcquisitionRunCheck {
  const parsed = acquisitionRunSchema.safeParse(input);
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
  return { ok: true, run: parsed.data };
}

export function runStatusIsTerminal(status: RunStatus): boolean {
  return (
    status === "COMPLETED" || status === "FAILED" || status === "CANCELLED" || status === "UNKNOWN"
  );
}

/** Ambiguous outcomes are UNKNOWN, never silently-failed (spec §5). */
export const UNKNOWN_NOT_FAILURE_RULE =
  "an external provider or wall-clock timeout is an UNKNOWN outcome, not a failure: persist the " +
  "operation identity, reconcile when the provider supports it, and never silently reinterpret it";

/** Idempotent-command semantics for run creation (same key+digest => replay). */
export const RUN_IDEMPOTENCY_RULE =
  "run creation is idempotency-keyed: the same key with the same command digest replays the stored " +
  "run handle, and a different digest under the same key is a typed conflict — never a second run";

/** Fenced-retry rule. */
export const RUN_LEASE_FENCING_RULE =
  "execution attempts are fenced by lease: a retry must hold (or re-acquire after expiry of) the " +
  "current lease and increment the durable attempt counter; stale writers fail closed";
