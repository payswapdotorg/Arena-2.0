import type { CapsuleProviderPort } from "@arena/capsule";
import type { ScrpErrorCode } from "../errors.js";
import type { AcquisitionRun, RunEvent, RunLease, RunQuota } from "../acquisition-run.js";
import type { ScraperFactory } from "../factory.js";
import type { ApprovedEndpoint, DnsResolver } from "../runtime/egress.js";
import { DatasetStore, RunStore } from "./store.js";

/**
 * AR2-017 — run lifecycle plane (issue #33; spec §2/§3): the lease/store/
 * bookkeeping half of the ScraperRunService split.
 *
 * RunBookkeeping owns the durable run-record machinery: the run and
 * dataset stores, id generation, the append-only event trail, terminal
 * marking, lease creation and the cancellation/stop/fixture registries.
 * It performs no crawl or capsule I/O of its own — orchestration lives
 * in run-orchestrator.ts and drives this class through its narrow
 * surface. The public command/outcome/config types of the service plane
 * are defined here and re-exported by the composition root
 * (run-service.ts) so the package surface stays import-stable.
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

export class RunBookkeeping {
  readonly runs = new RunStore();
  readonly datasets = new DatasetStore();
  private readonly nowMs: () => number;
  private readonly nowIso: () => string;
  private readonly idFactory?: () => string;
  private readonly cancelledRuns = new Set<string>();
  private readonly activeStops = new Map<string, () => void>();
  private readonly fixtureEndpointsByRun = new Map<string, ApprovedEndpoint[]>();
  private idCounter = 0;

  constructor(config: RunServiceConfig) {
    this.nowMs = config.nowMs;
    this.nowIso = config.nowIso;
    this.idFactory = config.idFactory;
  }

  nextId(prefix: string): string {
    if (this.idFactory) return this.idFactory();
    this.idCounter += 1;
    return `${prefix}_${String(this.idCounter).padStart(12, "0")}`;
  }

  appendEvent(run: AcquisitionRun, kind: RunEvent["kind"], detail: string | null): AcquisitionRun {
    const seq = (run.events[run.events.length - 1]?.event_seq ?? 0) + 1;
    return { ...run, events: [...run.events, { event_seq: seq, at: this.nowIso(), kind, detail }] };
  }

  markTerminal(run: AcquisitionRun, status: AcquisitionRun["status"], reason: string): AcquisitionRun {
    return { ...run, status, terminal_reason: reason, lease: null };
  }

  newLease(attempt: number): RunLease {
    const nowMs = this.nowMs();
    return {
      lease_id: this.nextId("lse"),
      attempt,
      holder: "scraper-run-service",
      acquired_at: new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, "Z"),
      expires_at: new Date(nowMs + 300000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    };
  }

  finishTerminal(
    run: AcquisitionRun,
    status: AcquisitionRun["status"],
    reason: string,
    detail: string,
  ): AcquisitionRun {
    const marked = this.markTerminal(run, status, reason);
    const terminated = this.appendEvent(marked, "RUN_TERMINATED", `${reason}: ${detail}`);
    this.runs.save(terminated);
    return terminated;
  }

  isCancelled(runId: string): boolean {
    return this.cancelledRuns.has(runId);
  }

  setCancelled(runId: string): void {
    this.cancelledRuns.add(runId);
  }

  clearCancelled(runId: string): void {
    this.cancelledRuns.delete(runId);
  }

  stopSwitchOf(runId: string): (() => void) | undefined {
    return this.activeStops.get(runId);
  }

  registerStop(runId: string, stop: () => void): void {
    this.activeStops.set(runId, stop);
  }

  deregisterStop(runId: string): void {
    this.activeStops.delete(runId);
  }

  fixtureEndpointsOf(runId: string): ApprovedEndpoint[] {
    return this.fixtureEndpointsByRun.get(runId) ?? [];
  }

  setFixtureEndpoints(runId: string, endpoints: ApprovedEndpoint[]): void {
    this.fixtureEndpointsByRun.set(runId, endpoints);
  }

  clearFixtureEndpoints(runId: string): void {
    this.fixtureEndpointsByRun.delete(runId);
  }
}
