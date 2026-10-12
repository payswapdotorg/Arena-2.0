import type { TenantContext } from "@arena/contracts";
import type { AcquisitionRun } from "../acquisition-run.js";
import { RunBookkeeping } from "./run-lifecycle.js";
import { RunOrchestrator } from "./run-orchestrator.js";
import type { DatasetStore, RunStore } from "./store.js";
import { commandDigestOf } from "./store.js";

export type {
  StartRunCommand,
  RunCommandOutcome,
  ExecuteOutcome,
  RunServiceConfig,
} from "./run-lifecycle.js";
import type {
  StartRunCommand,
  RunCommandOutcome,
  ExecuteOutcome,
  RunServiceConfig,
} from "./run-lifecycle.js";

/**
 * AR2-017 — ScraperRunService: the execution plane (issue #33; spec §3/§4).
 * Composition root over the two planes of the run service: orchestration
 * (capsule execution + crawl, run-orchestrator.ts) and lease/store/
 * bookkeeping (run-lifecycle.ts).
 *
 * AcquisitionRun creation (idempotency-keyed) -> lease acquisition -> capsule
 * execution manifest build (runtime + egress policy + dependency lock + budget)
 * -> CapsuleProvider execution -> crawl under budget -> quarantine/normalize/
 * deduplicate/validate -> immutable DatasetArtifact emission -> terminal event
 * with reason. Ambiguous outcomes (timeout mid-crawl) persist operation
 * identity and land in UNKNOWN, never silently-failed. Cancellation is
 * cooperative (checked between pages) plus a hard deadline. The SYNTHETIC
 * provider is acceptable for tests; production isolation is NOT claimed here.
 */

export class ScraperRunService {
  private readonly config: RunServiceConfig;
  private readonly bookkeeping: RunBookkeeping;
  private readonly orchestrator: RunOrchestrator;

  constructor(config: RunServiceConfig) {
    this.config = config;
    this.bookkeeping = new RunBookkeeping(config);
    this.orchestrator = new RunOrchestrator(config, this.bookkeeping);
  }

  get runs(): RunStore {
    return this.bookkeeping.runs;
  }

  get datasets(): DatasetStore {
    return this.bookkeeping.datasets;
  }

  /** Idempotent run-record creation (same key+digest replays, different digest conflicts). */
  startRun(tenant: TenantContext, command: StartRunCommand): RunCommandOutcome {
    if (tenant.derived_from !== "authenticated_credentials") {
      return {
        ok: false,
        code: "SCRP_TENANT_CONTEXT_INVALID",
        detail: "tenant must be derived from authenticated credentials",
      };
    }
    const version = this.config.factory.findVersion(command.scraper_version_id, tenant.tenant_id);
    if (version === null) {
      return { ok: false, code: "SCRP_VERSION_NOT_FOUND", detail: "scraper version not visible in tenant scope" };
    }
    const digest = commandDigestOf(tenant.tenant_id, command);
    const existing = this.runs.findIdempotency(tenant.tenant_id, command.idempotency_key, digest);
    if (existing.kind === "MISMATCH") {
      return {
        ok: false,
        code: "SCRP_IDEMPOTENCY_DIGEST_MISMATCH",
        detail: `idempotency key ${command.idempotency_key} already used with a different command digest`,
      };
    }
    if (existing.kind === "REPLAY") {
      const replayed = this.bookkeeping.appendEvent(existing.run, "IDEMPOTENCY_REPLAY", `replayed handle for key ${command.idempotency_key}`);
      this.runs.save(replayed);
      return { ok: true, run: replayed, replayed: true };
    }
    const run: AcquisitionRun = {
      schema_version: "SCRP1.0",
      run_id: this.bookkeeping.nextId("run"),
      tenant_id: tenant.tenant_id,
      request_id: command.request_id,
      provider_id: command.provider_id,
      scraper_version_id: version.version_id,
      scraper_version_digest: version.build_digest,
      idempotency_key: command.idempotency_key,
      correlation_id: command.correlation_id,
      causation_id: command.causation_id,
      status: "PENDING",
      attempt_counter: 0,
      lease: null,
      deadline: command.deadline,
      quotas: command.quotas,
      events: [{ event_seq: 1, at: this.config.nowIso(), kind: "RUN_CREATED", detail: `request ${command.request_id}` }],
      output_dataset_id: null,
      terminal_reason: null,
      operation_identity: null,
    };
    this.runs.save(run, digest);
    if (command.fixture_endpoints !== undefined && command.fixture_endpoints.length > 0) {
      this.bookkeeping.setFixtureEndpoints(run.run_id, command.fixture_endpoints);
    }
    return { ok: true, run, replayed: false };
  }

  /** Execute a PENDING run to a terminal state under lease + capsule + budget. */
  async executeRun(tenantId: string, runId: string): Promise<ExecuteOutcome> {
    return this.orchestrator.executeRun(tenantId, runId);
  }

  /** Cooperative cancellation (between pages) + kill switch. */
  cancelRun(tenantId: string, runId: string): RunCommandOutcome {
    const run = this.runs.find(runId, tenantId);
    if (run === null) return { ok: false, code: "SCRP_NOT_FOUND", detail: "run not visible in tenant scope" };
    if (run.status !== "RUNNING" && run.status !== "PENDING") {
      return { ok: false, code: "SCRP_RUN_STATE_INVALID", detail: `run is already ${run.status}` };
    }
    if (run.status === "PENDING") {
      this.bookkeeping.setCancelled(runId);
      const cancelled = this.bookkeeping.finishTerminal(run, "CANCELLED", "SCRP_RUN_CANCELLED", "cancelled before execution started");
      return { ok: true, run: cancelled, replayed: false };
    }
    this.bookkeeping.setCancelled(runId);
    this.bookkeeping.stopSwitchOf(runId)?.();
    const marked = this.bookkeeping.appendEvent(run, "CANCEL_REQUESTED", "cooperative stop engaged; checked between pages");
    this.runs.save(marked);
    return { ok: true, run: marked, replayed: false };
  }

  /** Fenced retry: attempt counter + lease discipline (spec §2). */
  async retryRun(tenantId: string, runId: string): Promise<ExecuteOutcome> {
    const run = this.runs.find(runId, tenantId);
    if (run === null) return { ok: false, code: "SCRP_NOT_FOUND", detail: "run not visible in tenant scope", run: null };
    if (run.status !== "FAILED" && run.status !== "UNKNOWN") {
      return { ok: false, code: "SCRP_RUN_STATE_INVALID", detail: `retry requires FAILED or UNKNOWN, run is ${run.status}`, run };
    }
    if (run.attempt_counter >= 64) {
      return { ok: false, code: "SCRP_RUN_STATE_INVALID", detail: "attempt limit exhausted", run };
    }
    const reset = this.bookkeeping.appendEvent(
      { ...run, status: "PENDING", lease: null, terminal_reason: null, operation_identity: null },
      "RUN_CREATED",
      `fenced retry: attempt ${run.attempt_counter + 1} authorized after terminal ${run.status}`,
    );
    this.runs.save(reset);
    return this.executeRun(tenantId, runId);
  }
}
