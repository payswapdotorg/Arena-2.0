import assert from "node:assert/strict";
import test from "node:test";
import { probeIsolationEnvironment } from "../src/capability.js";
import { batteryEnvironment } from "./helpers.js";

/**
 * Capability probes: the environment report is an inspectable object whose
 * claims are grounded in probes that actually ran in THIS process tree.
 */

test("environment report records kernel, userns sysctls and tool facts", async () => {
  const report = await probeIsolationEnvironment();
  assert.equal(report.platform, "linux");
  assert.match(report.kernel_release, /^\d+\.\d+/);
  assert.equal(typeof report.max_user_namespaces, "number");
  // max_user_namespaces is recorded raw (null when unreadable); the empirical
  // result below is the load-bearing fact.
  assert.equal(typeof report.userns_empirically_available, "boolean");
  assert.ok(["FULL_ISOLATION", "PARTIAL_ISOLATION", "NOT_SUPPORTED"].includes(report.capability));
  assert.ok(
    ["fresh-proc", "masked-proc", "unavailable", "unprobed"].includes(report.procfs_strategy),
  );
  assert.equal(typeof report.seccomp_filter_supported, "boolean");
  assert.equal(report.probed_at.endsWith("Z"), true);
  assert.ok(Array.isArray(report.limitations));
});

test("explicit missing bwrap path is reported honestly (never faked)", async () => {
  const report = await probeIsolationEnvironment({
    bwrapPath: "/nonexistent/bwrap-definitely-absent",
  });
  assert.equal(report.bwrap.path, null);
  assert.equal(report.capability, "NOT_SUPPORTED");
  assert.equal(report.userns_empirically_available, null);
  assert.ok(report.limitations.some((note) => note.includes("bwrap not found")));
});

test("bwrap version is parsed into major/minor gates", async () => {
  const report = await batteryEnvironment();
  if (report.bwrap.path === null) {
    assert.equal(report.bwrap.version, null);
    return;
  }
  assert.match(report.bwrap.version ?? "", /bubblewrap \d+\.\d+/);
  assert.equal(typeof report.bwrap.major, "number");
  assert.equal(typeof report.bwrap.minor, "number");
});

test("this battery environment is classified (documented in the report)", async () => {
  const report = await batteryEnvironment();
  // The gate battery expects real isolation; the classification itself is
  // environment-driven and recorded verbatim in the completion report.
  if (report.capability === "NOT_SUPPORTED") {
    assert.equal(report.userns_empirically_available, false);
  } else {
    assert.equal(report.userns_empirically_available, true);
    assert.notEqual(report.procfs_strategy, "unavailable");
  }
});
