import assert from "node:assert/strict";
import test from "node:test";
import {
  CONFORMANCE_PROBE_NAMES,
  buildConformanceEvidenceRecord,
  type ConformanceProbeResult,
} from "../src/evidence.js";
import { batteryEnvironment, batteryHeadSha, realIsolationAvailable } from "./helpers.js";

/**
 * The ConformanceEvidenceRecord instrument: environment report, per-probe
 * name/result/duration, battery head SHA and strict-vs-auto mode. The
 * release-gate owner reproduces the strict-mode run per README.
 */

test("builder produces a complete, inspectable evidence record", async () => {
  const environment = await batteryEnvironment();
  const probes: ConformanceProbeResult[] = [
    { name: "fs-escape", result: "DENIED", duration_ms: 120, detail: "/etc/shadow absent" },
    { name: "net-egress", result: "DENIED", duration_ms: 95, detail: "connect refused in empty netns" },
    { name: "tenant-binding", result: "PASS", duration_ms: 15, detail: "cross-tenant mount refused" },
  ];
  const record = buildConformanceEvidenceRecord({
    mode: "auto",
    environment,
    batteryHeadSha: batteryHeadSha(),
    probes,
  });
  assert.match(record.record_id, /^cer_/);
  assert.equal(record.mode, "auto");
  assert.equal(record.environment, environment);
  assert.equal(record.battery_head_sha, batteryHeadSha());
  assert.equal(record.probes.length, 3);
  assert.deepEqual(record.summary, { pass: 1, denied_expected: 2, not_supported: 0, fail: 0 });
  assert.equal(record.created_at.endsWith("Z"), true);
});

test("builder fails closed on malformed probe records", async () => {
  const environment = await batteryEnvironment();
  const base = { mode: "auto" as const, environment, batteryHeadSha: "abc123" };
  assert.throws(() =>
    buildConformanceEvidenceRecord({ ...base, probes: [{ name: "Bad Name", result: "PASS", duration_ms: 1, detail: "" }] }));
  assert.throws(() =>
    buildConformanceEvidenceRecord({ ...base, probes: [{ name: "fs-escape", result: "PASS", duration_ms: 1, detail: "x".repeat(3000) }] }));
});

test("builder rejects empty head sha and duplicate probe names", async () => {
  const environment = await batteryEnvironment();
  const probe: ConformanceProbeResult = { name: "fs-escape", result: "PASS", duration_ms: 1, detail: "" };
  assert.throws(() =>
    buildConformanceEvidenceRecord({ mode: "strict", environment, batteryHeadSha: "  ", probes: [probe] }));
  assert.throws(() =>
    buildConformanceEvidenceRecord({ mode: "strict", environment, batteryHeadSha: "abc", probes: [probe, probe] }));
  assert.throws(() =>
    buildConformanceEvidenceRecord({ mode: "strict", environment, batteryHeadSha: "abc", probes: [{ ...probe, duration_ms: -1 }] }));
});

test("the registered probe set covers the adversarial battery", () => {
  for (const required of ["fs-escape", "net-egress", "pid-visibility", "syscall-filter", "secret-hygiene", "tenant-binding"]) {
    assert.ok((CONFORMANCE_PROBE_NAMES as readonly string[]).includes(required));
  }
  assert.ok((CONFORMANCE_PROBE_NAMES as readonly string[]).includes("resource-ceil-cpu"));
});

test("this sandbox's run produces the mode-tagged record with real numbers", async (t) => {
  const environment = await batteryEnvironment();
  const isolation = await realIsolationAvailable();
  if (!isolation) {
    t.skip("no real isolation in this environment — the NOT_SUPPORTED record is the honest output");
  }
  const probes: ConformanceProbeResult[] = CONFORMANCE_PROBE_NAMES.map((name) => ({
    name,
    result: "NOT_SUPPORTED" as const,
    duration_ms: 0,
    detail: "placeholder — real numbers come from the battery run",
  }));
  const record = buildConformanceEvidenceRecord({
    mode: environment.capability === "FULL_ISOLATION" ? "strict" : "auto",
    environment,
    batteryHeadSha: batteryHeadSha(),
    probes,
  });
  assert.equal(record.probes.length, CONFORMANCE_PROBE_NAMES.length);
  assert.equal(record.summary.not_supported, CONFORMANCE_PROBE_NAMES.length);
});
