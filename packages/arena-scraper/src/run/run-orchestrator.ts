import type { CapsuleRef } from "@arena/capsule";
import type { ScrpErrorCode } from "../errors.js";
import type { AcquisitionRun } from "../acquisition-run.js";
import type { ScraperDefinition, ScraperVersion } from "../scraper-definition.js";
import { CrawlerEngine, type CrawlEventKind, type CrawlResult } from "../runtime/crawler.js";
import { CrawlBudget } from "../runtime/budget.js";
import { EgressGuard } from "../runtime/egress.js";
import { QuarantineLayer } from "../runtime/quarantine.js";
import { SourcePolicy, type RobotsFetcher } from "../runtime/source-policy.js";
import { assembleDataset } from "../runtime/assembly.js";
import { guardedRobotsRequest } from "../runtime/fetch.js";
import type { DatasetArtifact } from "../dataset-artifact.js";
import { buildScraperCapsuleManifest } from "./capsule-manifest.js";
import { decideTerminalState } from "./crawl-support.js";
import { RunBookkeeping, type ExecuteOutcome, type RunServiceConfig } from "./run-lifecycle.js";

/**
 * AR2-017 — run orchestration plane (issue #33; spec §3/§4): the execution
 * half of the ScraperRunService split.
 *
 * Execute a PENDING run to a terminal state: lease acquisition ->
 * pinned-version resolution -> capsule execution manifest build (runtime +
 * egress policy + dependency lock + budget) -> CapsuleProvider execution
 * -> crawl under budget -> quarantine/normalize/deduplicate/validate ->
 * immutable DatasetArtifact emission -> teardown -> terminal event with
 * reason. Ambiguous outcomes (timeout mid-crawl) persist operation
 * identity and land in UNKNOWN, never silently-failed. Cancellation is
 * cooperative (checked between pages) plus a hard deadline. The SYNTHETIC
 * provider is acceptable for tests; production isolation is NOT claimed
 * here. All record mutation goes through the injected RunBookkeeping.
 */

type CrawlOutcome = { run: AcquisitionRun; crawl: CrawlResult; dataset: DatasetArtifact | null };

export class RunOrchestrator {
  private readonly config: RunServiceConfig;
  private readonly bookkeeping: RunBookkeeping;

  constructor(config: RunServiceConfig, bookkeeping: RunBookkeeping) {
    this.config = config;
    this.bookkeeping = bookkeeping;
  }

  /** Execute a PENDING run to a terminal state under lease + capsule + budget. */
  async executeRun(tenantId: string, runId: string): Promise<ExecuteOutcome> {
    const run = this.bookkeeping.runs.find(runId, tenantId);
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
    let current = this.bookkeeping.appendEvent(
      { ...run, status: "RUNNING", attempt_counter: attempt, lease: this.bookkeeping.newLease(attempt) },
      "LEASE_ACQUIRED",
      `attempt ${attempt} leased`,
    );
    this.bookkeeping.runs.save(current);

    if (this.bookkeeping.isCancelled(runId)) {
      current = this.bookkeeping.finishTerminal(current, "CANCELLED", "SCRP_RUN_CANCELLED", "cancelled before the crawl started");
      return { ok: true, run: current, dataset_id: null };
    }

    const manifest = buildScraperCapsuleManifest({
      run: current,
      definition,
      version,
      manifestId: this.bookkeeping.nextId("csm"),
      capsuleId: this.bookkeeping.nextId("cap"),
    });
    const provisioned = await this.config.provider.provision(manifest);
    if (provisioned.kind !== "PROVISIONED") {
      current = this.bookkeeping.finishTerminal(current, "FAILED", "SCRP_CAPSULE_PROVISION_FAILED", `capsule provisioning failed (${provisioned.kind})`);
      return { ok: false, code: "SCRP_CAPSULE_PROVISION_FAILED", detail: "capsule provider refused provisioning", run: current };
    }
    const ref: CapsuleRef = {
      capsule_id: manifest.capsule_id,
      tenant_id: manifest.tenant_id,
      escalation_id: manifest.escalation_id,
      attempt_id: manifest.attempt_id,
    };
    current = this.bookkeeping.appendEvent(current, "CAPSULE_PROVISIONED", `capsule ${manifest.capsule_id} environment ready`);
    current = this.bookkeeping.appendEvent(current, "CRAWL_STARTED", `crawl of ${definition.seeds.length} seed(s) under the pinned budget`);
    this.bookkeeping.runs.save(current);

    const outcome = await this.crawl(current, definition, version);
    current = outcome.run;
    if (outcome.dataset !== null) {
      this.bookkeeping.datasets.save(outcome.dataset);
      current = this.bookkeeping.appendEvent(current, "DATASET_EMITTED", `dataset ${outcome.dataset.dataset_id} (${outcome.dataset.items.length} items)`);
      current = { ...current, output_dataset_id: outcome.dataset.dataset_id };
    }
    const teardown = await this.config.provider.teardown(ref);
    if (teardown.kind !== "TORN_DOWN") {
      current = this.bookkeeping.finishTerminal(current, "FAILED", "SCRP_CAPSULE_TEARDOWN_FAILED", "verified teardown did not complete (fail closed)");
      return { ok: false, code: "SCRP_CAPSULE_TEARDOWN_FAILED", detail: "teardown failed", run: current };
    }
    current = this.bookkeeping.appendEvent(current, "LEASE_RELEASED", `attempt ${attempt} lease released; capsule torn down and credentials revoked`);
    current = this.bookkeeping.appendEvent(
      current,
      "RUN_TERMINATED",
      `terminal: ${current.terminal_reason ?? current.status}`,
    );
    this.bookkeeping.runs.save(current);
    if (current.status === "FAILED") {
      const reason = current.terminal_reason ?? "SCRP_INTERNAL_ERROR";
      const code = (reason.startsWith("BUDGET_") ? "SCRP_CRAWL_BUDGET_EXCEEDED" : reason) as ScrpErrorCode;
      return { ok: false, code, detail: reason, run: current };
    }
    return { ok: true, run: current, dataset_id: current.output_dataset_id };
  }

  private async crawl(
    run: AcquisitionRun,
    definition: ScraperDefinition,
    version: ScraperVersion,
  ): Promise<CrawlOutcome> {
    if (this.bookkeeping.isCancelled(run.run_id)) {
      // Cancellation arrived before the crawl started — terminate closed.
      const terminated = this.bookkeeping.markTerminal(run, "CANCELLED", "SCRP_RUN_CANCELLED");
      this.bookkeeping.runs.save(terminated);
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
    this.bookkeeping.registerStop(run.run_id, stopSwitch);
    const deadlineTimer = setTimeout(() => budget.cancel("PROVIDER_STOPPED"), Math.max(0, runDeadlineMs - this.config.nowMs()) + 500);
    deadlineTimer.unref?.();
    try {
      const fixtureEndpoints = this.bookkeeping.fixtureEndpointsOf(run.run_id);
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
        const stored = this.bookkeeping.runs.find(run.run_id, run.tenant_id);
        if (stored !== null && stored.events.length > current.events.length) {
          current = stored;
        }
        return current;
      };
      const onEvent = (event: { kind: CrawlEventKind; detail: string }): void => {
        mergeFromStore();
        if (current.events.length >= 1024) return;
        current = this.bookkeeping.appendEvent(current, event.kind, event.detail);
        this.bookkeeping.runs.save(current);
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
        cancelled: this.bookkeeping.isCancelled(run.run_id),
      });
      const status = decision.status;
      const reason = decision.reason;
      mergeFromStore();
      current = {
        ...current,
        operation_identity: status === "UNKNOWN" ? `attempt:${current.attempt_counter}:crawl:${current.run_id}` : current.operation_identity,
      };
      current = this.bookkeeping.markTerminal(current, status, reason);
      let dataset: DatasetArtifact | null = null;
      if (crawlResult.items.length > 0) {
        dataset = assembleDataset({
          run: current,
          definition,
          version,
          crawl: crawlResult,
          datasetId: this.bookkeeping.nextId("dst"),
          nowIso: this.config.nowIso(),
        });
      }
      this.bookkeeping.runs.save(current);
      this.bookkeeping.clearCancelled(run.run_id);
      this.bookkeeping.clearFixtureEndpoints(run.run_id);
      return { run: current, crawl: crawlResult, dataset };
    } finally {
      this.bookkeeping.deregisterStop(run.run_id);
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
}
