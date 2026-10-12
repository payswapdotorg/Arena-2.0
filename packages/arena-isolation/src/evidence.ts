import type { IsolationEnvironmentReport } from "./capability.js";

/**
 * AR2-019 — conformance evidence record.
 *
 * The release-gate owner reproduces the strict-mode battery (README §Repro)
 * and archives the record; the committed evidence DOC is TL-owned at
 * integration — this module is the instrument plus this sandbox's numbers.
 */

export type IsolationMode = "strict" | "auto";

export type ConformanceProbeStatus = "PASS" | "DENIED" | "NOT_SUPPORTED" | "FAIL";

/** One adversarial/conformance probe outcome. DENIED means an escape attempt
 * was correctly denied — that is a PASSING result for the battery. */
export interface ConformanceProbeResult {
  name: string;
  result: ConformanceProbeStatus;
  duration_ms: number;
  detail: string;
}

export interface ConformanceEvidenceRecord {
  record_id: string;
  created_at: string;
  mode: IsolationMode;
  environment: IsolationEnvironmentReport;
  battery_head_sha: string;
  probes: readonly ConformanceProbeResult[];
  summary: {
    pass: number;
    denied_expected: number;
    not_supported: number;
    fail: number;
  };
}

const PROBE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Fail-closed builder: rejects malformed probe records instead of
 * "interpreting" them (architecture lock rule 34). */
export function buildConformanceEvidenceRecord(input: {
  mode: IsolationMode;
  environment: IsolationEnvironmentReport;
  batteryHeadSha: string;
  probes: readonly ConformanceProbeResult[];
  recordId?: string;
}): ConformanceEvidenceRecord {
  if (input.batteryHeadSha.trim().length === 0) {
    throw new Error("conformance evidence requires a non-empty battery head sha");
  }
  const seen = new Set<string>();
  for (const probe of input.probes) {
    if (!PROBE_NAME_PATTERN.test(probe.name)) {
      throw new Error(`invalid probe name: ${probe.name}`);
    }
    if (seen.has(probe.name)) {
      throw new Error(`duplicate probe name: ${probe.name}`);
    }
    seen.add(probe.name);
    if (!Number.isFinite(probe.duration_ms) || probe.duration_ms < 0) {
      throw new Error(`invalid duration for probe ${probe.name}`);
    }
    if (probe.detail.length > 2000) {
      throw new Error(`probe detail too long: ${probe.name}`);
    }
  }
  return {
    record_id: input.recordId ?? `cer_${Date.now().toString(36)}`,
    created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    mode: input.mode,
    environment: input.environment,
    battery_head_sha: input.batteryHeadSha.trim(),
    probes: input.probes.map((probe) => ({ ...probe })),
    summary: {
      pass: input.probes.filter((p) => p.result === "PASS").length,
      denied_expected: input.probes.filter((p) => p.result === "DENIED").length,
      not_supported: input.probes.filter((p) => p.result === "NOT_SUPPORTED").length,
      fail: input.probes.filter((p) => p.result === "FAIL").length,
    },
  };
}

/** Adversarial battery probe names (the registered conformance set). */
export const CONFORMANCE_PROBE_NAMES = [
  "fs-escape",
  "net-egress",
  "pid-visibility",
  "syscall-filter",
  "resource-ceil-memory",
  "resource-ceil-process",
  "resource-ceil-cpu",
  "secret-hygiene",
  "tenant-binding",
  "namespace-conformance",
] as const;
