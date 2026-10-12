import { computeCanonicalDigest } from "@arena/acquisition";
import type { AcquisitionRun } from "../acquisition-run.js";
import type { DatasetArtifact } from "../dataset-artifact.js";

/**
 * AR2-017 — In-memory tenant-fenced run/dataset stores (issue #33).
 *
 * AR2-017 has no persistence work order (durable jobs are AR2-005's plane);
 * these stores give the run service single-writer state with fail-closed
 * tenant fencing: cross-tenant reads and missing reads are indistinguishable
 * (no existence oracle), mirroring arena-acquisition's isolation conventions.
 */

export class RunStore {
  private readonly runs = new Map<string, AcquisitionRun>();
  private readonly byIdempotencyKey = new Map<string, { digest: string; runId: string }>();

  /** Save run state; the idempotency digest is recorded once, at creation. */
  save(run: AcquisitionRun, idempotencyDigest?: string): void {
    this.runs.set(run.run_id, run);
    const key = `${run.tenant_id}::${run.idempotency_key}`;
    if (!this.byIdempotencyKey.has(key)) {
      this.byIdempotencyKey.set(key, { digest: idempotencyDigest ?? "", runId: run.run_id });
    }
  }

  find(runId: string, tenantId: string): AcquisitionRun | null {
    const run = this.runs.get(runId);
    if (run === undefined || run.tenant_id !== tenantId) return null;
    return run;
  }

  findIdempotency(tenantId: string, idempotencyKey: string, digest: string):
    | { kind: "ABSENT" }
    | { kind: "REPLAY"; run: AcquisitionRun }
    | { kind: "MISMATCH" } {
    const record = this.byIdempotencyKey.get(`${tenantId}::${idempotencyKey}`);
    if (record === undefined || record.digest === "") return { kind: "ABSENT" };
    if (record.digest !== digest) return { kind: "MISMATCH" };
    const run = this.runs.get(record.runId);
    if (run === undefined) return { kind: "MISMATCH" };
    return { kind: "REPLAY", run };
  }
}

export class DatasetStore {
  private readonly datasets = new Map<string, DatasetArtifact>();

  save(dataset: DatasetArtifact): void {
    this.datasets.set(dataset.dataset_id, dataset);
  }

  find(datasetId: string, tenantId: string): DatasetArtifact | null {
    const dataset = this.datasets.get(datasetId);
    if (dataset === undefined || dataset.tenant_id !== tenantId) return null;
    return dataset;
  }

  findByRun(runId: string, tenantId: string): DatasetArtifact | null {
    for (const dataset of this.datasets.values()) {
      if (dataset.run_id === runId && dataset.tenant_id === tenantId) return dataset;
    }
    return null;
  }
}

/** Stable command digest for idempotency (canonical over the run's command anchor). */
export function commandDigestOf(tenantId: string, command: unknown): string {
  return computeCanonicalDigest({ tenant: tenantId, command });
}
