import type { TenantContext } from "@arena/contracts";
import type { CapsuleProviderPort, CapsuleRef } from "@arena/capsule";
import type { ScrpErrorCode } from "../errors.js";
import type { AcquisitionRun, RunEvent, RunQuota } from "../acquisition-run.js";
import type { ScraperDefinition, ScraperVersion } from "../scraper-definition.js";
import type { ScraperFactory } from "../factory.js";
import { CrawlerEngine, type CrawlEventKind, type CrawlResult } from "../runtime/crawler.js";
import { CrawlBudget } from "../runtime/budget.js";
import { EgressGuard, type ApprovedEndpoint, type DnsResolver } from "../runtime/egress.js";
import { QuarantineLayer } from "../runtime/quarantine.js";
import { SourcePolicy, type RobotsFetcher } from "../runtime/source-policy.js";
import { assembleDataset } from "../runtime/assembly.js";
import { guardedRobotsRequest } from "../runtime/fetch.js";
import type { DatasetArtifact } from "../dataset-artifact.js";
import { buildScraperCapsuleManifest } from "./capsule-manifest.js";
import { decideTerminalState } from "./crawl-support.js";
import { DatasetStore, RunStore, commandDigestOf } from "./store.js";

/**
 * AR2-017 — ScraperRunService: the execution plane (issue #33; spec §3/§4).
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

export interface StartRunCommand {
  request_id: string;
  provider_id: string;
  scraper_version_id: string;
  idempotency_key: string;
  correlation_id: string;
  causation_id: string | null;
  deadline: string;
  quotas: RunQuota;
  /** Explicitly approved fixture endpoints (test-only; production passes []). */
  fixture_endpoints?: ApprovedEndpoint[];
}

export type RunCommandOutcome =
  | { ok: true; run: AcquisitionRun; replayed: boolean }
  | { ok: false; code: ScrpErrorCode; detail: string };

export type ExecuteOutcome =
  | { ok: true; run: AcquisitionRun; dataset_id: string | null }
  | { ok: false; code: ScrpErrorCode; detail: string; run: AcquisitionRun | null };

export interface RunServiceConfig {
  provider: CapsuleProviderPort;
  factory: ScraperFactory;
  resolver: DnsResolver;
  nowMs: () => number;
  nowIso: () => string;
  sleep: (ms: number) => Promise<void>;
  idFactory?: () => string;
  fetchTimeoutMs?: number;
  maxQuarantinedRecords?: number;
}

type CrawlOutcome = { run: AcquisitionRun; crawl: CrawlResult; dataset: DatasetArtifact | null };

export class ScraperRunService {
  readonly runs = new RunStore();
  readonly datasets = new DatasetStore();
  private readonly config: RunServiceConfig;
  private readonly activeStops = new Map<string, () => void>();
  private readonly cancelledRuns = new Set<string>();
  private readonly fixtureEndpointsByRun = new Map<string, ApprovedEndpoint[]>();
  private idCounter = 0;

  constructor(config: RunServiceConfig) {
    this.config = config;
  }

  private nextId(prefix: string): string {
    if (this.config.idFactory) return this.config.idFactory();
    this.idCounter += 1;
    return `${prefix}_${String(this.idCounter).padStart(12, "0")}`;
  }

  private withEvent(run: AcquisitionRun, kind: RunEvent["kind"], detail: string | null): AcquisitionRun {
    const seq = (run.events[run.events.length - 1]?.event_seq ?? 0) + 1;
    return { ...run, events: [...run.events, { event_seq: seq, at: this.config.nowIso(), kind, detail }] };
  }

  private markTerminal(run: AcquisitionRun, status: AcquisitionRun["status"], reason: string): AcquisitionRun {
    return { ...run, status, terminal_reason: reason, lease: null };
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
      const replayed = this.withEvent(existing.run, "IDEMPOTENCY_REPLAY", `replayed handle for key ${command.idempotency_key}`);
      this.runs.save(replayed);
      return { ok: true, run: replayed, replayed: true };
    }
    const run: AcquisitionRun = {
      schema_version: "SCRP1.0",
      run_id: this.nextId("run"),
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
      this.fixtureEndpointsByRun.set(run.run_id, command.fixture_endpoints);
    }
    return { ok: true, run, replayed: false };
  }

  /** Execute a PENDING run to a terminal state under lease + capsule + budget. */
  async executeRun(tenantId: string, runId: string): Promise<ExecuteOutcome> {
    const run = this.runs.find(runId, tenantId);
    if (run === null) return { ok: false, code: "SCRP_NOT_FOUND", detail: "run not visible in tenant scope", run: null };
    if (run.status !== "PENDING") {
      return { ok: false, code: "SCRP_RUN_STATE_INVALID", detail: `run is ${run.status}, not PENDING`, run };
    }
    const version = this.config.factory.findVersion(run.scraper_version_id, tenantId);
    const definition = this.config.factory.findDefinitionOfVersion(run.scraper_version_id, tenantId);
    if (version === null || definition === null) {
      return { ok: false, code: "SCRP_VERSION_NOT_FOUND", detail: "pinned scraper version is not resolvable", run };
    }
    const attempt = run.attempt_counter + 1;
    let current = this.withEvent(
      { ...run, status: "RUNNING", attempt_counter: attempt, lease: this.newLease(attempt) },
      "LEASE_ACQUIRED",
      `attempt ${attempt} leased`,
    );
    this.runs.save(current);

    if (this.cancelledRuns.has(runId)) {
      current = this.finishTerminal(current, "CANCELLED", "SCRP_RUN_CANCELLED", "cancelled before the crawl started");
      return { ok: true, run: current, dataset_id: null };
    }

    const manifest = buildScraperCapsuleManifest({
      run: current,
      definition,
      version,
      manifestId: this.nextId("csm"),
      capsuleId: this.nextId("cap"),
    });
    const provisioned = await this.config.provider.provision(manifest);
    if (provisioned.kind !== "PROVISIONED") {
      current = this.finishTerminal(current, "FAILED", "SCRP_CAPSULE_PROVISION_FAILED", `capsule provisioning failed (${provisioned.kind})`);
      return { ok: false, code: "SCRP_CAPSULE_PROVISION_FAILED", detail: "capsule provider refused provisioning", run: current };
    }
    const ref: CapsuleRef = {
      capsule_id: manifest.capsule_id,
      tenant_id: manifest.tenant_id,
      escalation_id: manifest.escalation_id,
      attempt_id: manifest.attempt_id,
    };
    current = this.withEvent(current, "CAPSULE_PROVISIONED", `capsule ${manifest.capsule_id} environment ready`);
    current = this.withEvent(current, "CRAWL_STARTED", `crawl of ${definition.seeds.length} seed(s) under the pinned budget`);
    this.runs.save(current);

    const outcome = await this.crawl(current, definition, version);
    current = outcome.run;
    if (outcome.dataset !== null) {
      this.datasets.save(outcome.dataset);
      current = this.withEvent(current, "DATASET_EMITTED", `dataset ${outcome.dataset.dataset_id} (${outcome.dataset.items.length} items)`);
      current = { ...current, output_dataset_id: outcome.dataset.dataset_id };
    }
    const teardown = await this.config.provider.teardown(ref);
    if (teardown.kind !== "TORN_DOWN") {
      current = this.finishTerminal(current, "FAILED", "SCRP_CAPSULE_TEARDOWN_FAILED", "verified teardown did not complete (fail closed)");
      return { ok: false, code: "SCRP_CAPSULE_TEARDOWN_FAILED", detail: "teardown failed", run: current };
    }
    current = this.withEvent(current, "LEASE_RELEASED", `attempt ${attempt} lease released; capsule torn down and credentials revoked`);
    current = this.withEvent(
      current,
      "RUN_TERMINATED",
      `terminal: ${current.terminal_reason ?? current.status}`,
    );
    this.runs.save(current);
    if (current.status === "FAILED") {
      const reason = current.terminal_reason ?? "SCRP_INTERNAL_ERROR";
      const code = (reason.startsWith("BUDGET_") ? "SCRP_CRAWL_BUDGET_EXCEEDED" : reason) as ScrpErrorCode;
      return { ok: false, code, detail: reason, run: current };
    }
    return { ok: true, run: current, dataset_id: current.output_dataset_id };
  }

  /** Cooperative cancellation (between pages) + kill switch. */
  cancelRun(tenantId: string, runId: string): RunCommandOutcome {
    const run = this.runs.find(runId, tenantId);
    if (run === null) return { ok: false, code: "SCRP_NOT_FOUND", detail: "run not visible in tenant scope" };
    if (run.status !== "RUNNING" && run.status !== "PENDING") {
      return { ok: false, code: "SCRP_RUN_STATE_INVALID", detail: `run is already ${run.status}` };
    }
    if (run.status === "PENDING") {
      this.cancelledRuns.add(runId);
      const cancelled = this.finishTerminal(run, "CANCELLED", "SCRP_RUN_CANCELLED", "cancelled before execution started");
      return { ok: true, run: cancelled, replayed: false };
    }
    this.cancelledRuns.add(runId);
    this.activeStops.get(runId)?.();
    const marked = this.withEvent(run, "CANCEL_REQUESTED", "cooperative stop engaged; checked between pages");
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
    const reset = this.withEvent(
      { ...run, status: "PENDING", lease: null, terminal_reason: null, operation_identity: null },
      "RUN_CREATED",
      `fenced retry: attempt ${run.attempt_counter + 1} authorized after terminal ${run.status}`,
    );
    this.runs.save(reset);
    return this.executeRun(tenantId, runId);
  }

  private async crawl(
    run: AcquisitionRun,
    definition: ScraperDefinition,
    version: ScraperVersion,
  ): Promise<CrawlOutcome> {
    if (this.cancelledRuns.has(run.run_id)) {
      // Cancellation arrived before the crawl started — terminate closed.
      const terminated = this.markTerminal(run, "CANCELLED", "SCRP_RUN_CANCELLED");
      this.runs.save(terminated);
      return {
        run: terminated,
        crawl: {
          items: [],
          quarantined: [],
          egress_denied: [],
          robots_denied: [],
          pages_fetched: 0,
          bytes_fetched: 0,
          stop_reason: "CANCELLED",
          stop_detail: "cancelled before the crawl started",
          engine_version: "SCRP-ENGINE1.0",
          crawlee_version: "3.18.2",
        },
        dataset: null,
      };
    }
    const runDeadlineMs = Date.parse(run.deadline);
    const effectiveWallMs = Math.max(
      1000,
      Math.min(definition.resource_policy.wall_time_seconds * 1000, runDeadlineMs - this.config.nowMs()),
    );
    const budget = new CrawlBudget(
      {
        max_pages: Math.min(definition.resource_policy.max_pages, run.quotas.max_pages),
        max_items: Math.min(definition.resource_policy.max_items, run.quotas.max_items),
        max_bytes: Math.min(definition.resource_policy.max_bytes, run.quotas.max_bytes),
        max_depth: definition.resource_policy.max_depth,
        wall_time_ms: effectiveWallMs,
        max_retries_per_request: 2,
        retry_backoff_base_ms: 20,
        max_redirect_hops: 5,
      },
      this.config.nowMs,
    );
    const stopSwitch = (): void => budget.cancel("CANCELLED");
    this.activeStops.set(run.run_id, stopSwitch);
    const deadlineTimer = setTimeout(() => budget.cancel("PROVIDER_STOPPED"), Math.max(0, runDeadlineMs - this.config.nowMs()) + 500);
    deadlineTimer.unref?.();
    try {
      const fixtureEndpoints = this.fixtureEndpointsByRun.get(run.run_id) ?? [];
      const guard = new EgressGuard({
        policy: {
          schemes: definition.source_scope.schemes,
          domains: definition.source_scope.domains,
          ports: definition.source_scope.ports,
          approved_endpoints: fixtureEndpoints,
          max_redirect_hops: 5,
        },
        resolver: this.config.resolver,
      });
      const sourcePolicy = new SourcePolicy({
        config: {
          user_agent: definition.robots_policy.user_agent,
          crawl_delay_ms: definition.robots_policy.crawl_delay_ms,
          per_domain_request_limit: definition.robots_policy.per_domain_request_limit,
          domains: definition.source_scope.domains,
          min_interval_ms: 0,
        },
        fetcher: this.guardedRobotsFetcher(guard),
        nowMs: this.config.nowMs,
      });
      const quarantine = new QuarantineLayer({
        allowed_content_types: ["text/html", "application/json", "text/plain"],
        max_item_bytes: Math.min(1048576, definition.resource_policy.max_bytes),
        max_quarantined_records: this.config.maxQuarantinedRecords ?? 100,
        redact_secrets: true,
        redact_pii: true,
      });
      let current = run;
      const mergeFromStore = (): AcquisitionRun => {
        // Merge with the latest stored record so externally appended events
        // (e.g. CANCEL_REQUESTED) are never clobbered by a stale snapshot.
        const stored = this.runs.find(run.run_id, run.tenant_id);
        if (stored !== null && stored.events.length > current.events.length) {
          current = stored;
        }
        return current;
      };
      const onEvent = (event: { kind: CrawlEventKind; detail: string }): void => {
        mergeFromStore();
        if (current.events.length >= 1024) return;
        current = this.withEvent(current, event.kind, event.detail);
        this.runs.save(current);
      };
      const engine = new CrawlerEngine({
        guard,
        sourcePolicy,
        quarantine,
        budget,
        nowIso: this.config.nowIso,
        sleep: this.config.sleep,
        onEvent,
        fetchTimeoutMs: this.config.fetchTimeoutMs ?? 10000,
      });
      const crawlResult = await engine.crawl(definition.seeds, true);
      const decision = decideTerminalState({
        stopReason: crawlResult.stop_reason,
        deadlineExceeded: this.config.nowMs() > runDeadlineMs,
        quarantineOverflow: quarantine.quarantineOverflow(),
        cancelled: this.cancelledRuns.has(run.run_id),
      });
      const status = decision.status;
      const reason = decision.reason;
      mergeFromStore();
      current = {
        ...current,
        operation_identity: status === "UNKNOWN" ? `attempt:${current.attempt_counter}:crawl:${current.run_id}` : current.operation_identity,
      };
      current = this.markTerminal(current, status, reason);
      let dataset: DatasetArtifact | null = null;
      if (crawlResult.items.length > 0) {
        dataset = assembleDataset({
          run: current,
          definition,
          version,
          crawl: crawlResult,
          datasetId: this.nextId("dst"),
          nowIso: this.config.nowIso(),
        });
      }
      this.runs.save(current);
      this.cancelledRuns.delete(run.run_id);
      this.fixtureEndpointsByRun.delete(run.run_id);
      return { run: current, crawl: crawlResult, dataset };
    } finally {
      this.activeStops.delete(run.run_id);
      clearTimeout(deadlineTimer);
    }
  }

  /** robots.txt fetched through the egress-guarded plane (untrusted content). */
  private guardedRobotsFetcher(guard: EgressGuard): RobotsFetcher {
    return {
      async fetchRobots(origin) {
        const url = `${origin}/robots.txt`;
        const check = await guard.validateUrl(url);
        if (!check.ok) return null;
        try {
          const response = await guardedRobotsRequest(url, guard);
          return response.status === 200 ? response.body : null;
        } catch {
          return null; // absent/unfetchable robots -> permissive coordination
        }
      },
    };
  }

  private newLease(attempt: number) {
    const nowMs = this.config.nowMs();
    return {
      lease_id: this.nextId("lse"),
      attempt,
      holder: "scraper-run-service",
      acquired_at: new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, "Z"),
      expires_at: new Date(nowMs + 300000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    };
  }


  private finishTerminal(
    run: AcquisitionRun,
    status: AcquisitionRun["status"],
    reason: string,
    detail: string,
  ): AcquisitionRun {
    const marked = this.markTerminal(run, status, reason);
    const terminated = this.withEvent(marked, "RUN_TERMINATED", `${reason}: ${detail}`);
    this.runs.save(terminated);
    return terminated;
  }
}
