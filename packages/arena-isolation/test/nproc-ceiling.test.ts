import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import {
  computeNprocCeiling,
  readVisibleUidProcessCount,
  NPROC_MARGIN,
  NPROC_CEILING_FLOOR,
  NPROC_HARD_CEILING,
  NPROC_PROBE_LADDER,
} from "../src/nproc-ceiling.js";
import {
  buildBwrapArgs,
  buildPrlimitArgs,
  type ResourceCeilings,
  type SandboxSpec,
} from "../src/execution-argv.js";
import { batteryEnvironment, provisionedSession, realIsolationAvailable, runShell, stageHelperInSession } from "./helpers.js";

/**
 * MAINT-002 (issue #64) — ambient-count collision unit + argv-posture tests.
 *
 * The pure ceiling computation covers below-floor / above-ceiling / between
 * boundaries; the argv tests pin the NEW nproc posture (parent-side prlimit
 * prefix carries NO --nproc; RLIMIT_NPROC is applied child-side after the
 * user-namespace transition via the in-sandbox prlimit wrapper); the probe
 * tests ground the ambient calibration in a probe that actually ran.
 */

const CEILINGS: ResourceCeilings = {
  cpu_seconds: 30,
  as_bytes: 268435456,
  fsize_bytes: 67108864,
  nproc: 192,
  nofile: 256,
};

function specFixture(
  overrides: Partial<SandboxSpec> = {},
): SandboxSpec {
  return {
    bwrapPath: "/usr/bin/bwrap",
    hostUsrPath: "/usr",
    hostname: "arena-cap-test",
    scratchPath: "/workspace",
    scratchSizeBytes: 67108864,
    inputMounts: [],
    childEnv: { PATH: "/usr/bin:/bin" },
    command: ["sh", "-c", "true"],
    procfsStrategy: "masked-proc",
    seccompFilter: null,
    ceilings: CEILINGS,
    bwrapMajor: 0,
    bwrapMinor: 12,
    infoFd: 3,
    seccompFd: null,
    nprocWrapper: { sandboxPath: "/usr/bin/prlimit", ceiling: CEILINGS.nproc },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure ceiling computation: ambient count -> clamped ceiling.
// ---------------------------------------------------------------------------

test("nproc ceiling: between boundaries passes the sum through unchanged", () => {
  // ambient 45 + margin 128 = 173 — strictly inside [floor=128, hard=4096].
  const result = computeNprocCeiling(45);
  assert.equal(result.computed_ceiling, 173);
  assert.equal(result.ambient_count, 45);
  assert.equal(result.margin, NPROC_MARGIN);
  assert.equal(result.floor, NPROC_CEILING_FLOOR);
  assert.equal(result.hard_ceiling, NPROC_HARD_CEILING);
});

test("nproc ceiling: below the floor clamps up (never below the sane floor)", () => {
  // ambient 0 + budget 5 = 5 -> floor.
  assert.equal(computeNprocCeiling(0, 5).computed_ceiling, NPROC_CEILING_FLOOR);
  // null ambient (unreadable) falls back with the budget only -> floor.
  assert.equal(computeNprocCeiling(null, 5).computed_ceiling, NPROC_CEILING_FLOOR);
  // null ambient + default margin lands exactly on the floor (historical default).
  assert.equal(computeNprocCeiling(null).computed_ceiling, NPROC_CEILING_FLOOR);
  // The null fallback is recorded honestly — never fabricated as a number.
  assert.equal(computeNprocCeiling(null).ambient_count, null);
});

test("nproc ceiling: above the hard ceiling clamps down (never above the constant)", () => {
  // ambient 5000 + margin 128 -> hard ceiling.
  assert.equal(computeNprocCeiling(5000).computed_ceiling, NPROC_HARD_CEILING);
  // Explicit budget cannot escape the hard ceiling either.
  assert.equal(computeNprocCeiling(3900, 4096).computed_ceiling, NPROC_HARD_CEILING);
});

test("nproc ceiling: exact boundary values are honored without clamping", () => {
  // ambient 0 + margin 128 == floor exactly (healthy station, historical default).
  assert.equal(computeNprocCeiling(0).computed_ceiling, NPROC_CEILING_FLOOR);
  // ambient 3968 + margin 128 == hard ceiling exactly.
  assert.equal(computeNprocCeiling(NPROC_HARD_CEILING - NPROC_MARGIN).computed_ceiling, NPROC_HARD_CEILING);
  // TL-station shape (issue #64): ambient ~170-199 + margin 128 -> ~298-327.
  const tl = computeNprocCeiling(199);
  assert.equal(tl.computed_ceiling, 199 + NPROC_MARGIN);
  assert.ok(tl.computed_ceiling < NPROC_HARD_CEILING);
});

test("nproc ceiling: an explicit profile budget rides on top of the ambient count", () => {
  assert.equal(computeNprocCeiling(45, 256).computed_ceiling, 301);
  // Budget below the margin tightens the sum, but the floor still protects
  // a usable sandbox (recorded: process_budget vs computed_ceiling).
  const tight = computeNprocCeiling(45, 8);
  assert.equal(tight.computed_ceiling, 128);
});

test("nproc ceiling: invalid budgets fail closed (throw), never silently clamp", () => {
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER * 2]) {
    assert.throws(() => computeNprocCeiling(10, bad), /invalid nproc process budget/);
  }
});

test("nproc ceiling constants are internally consistent", () => {
  // The ladder is strictly increasing, bounded by the hard ceiling, and its
  // smallest rung still yields a usable ceiling above the floor with margin.
  for (let i = 1; i < NPROC_PROBE_LADDER.length; i += 1) {
    assert.ok(NPROC_PROBE_LADDER[i] > NPROC_PROBE_LADDER[i - 1]);
  }
  assert.equal(NPROC_PROBE_LADDER[NPROC_PROBE_LADDER.length - 1], NPROC_HARD_CEILING);
  assert.ok(NPROC_PROBE_LADDER[0] + NPROC_MARGIN > NPROC_CEILING_FLOOR);
  // Historical default budget preserved by the margin constant.
  assert.equal(NPROC_MARGIN, 128);
  assert.equal(NPROC_CEILING_FLOOR, 128);
});

// ---------------------------------------------------------------------------
// /proc visible-count scan (lower-bound disclosure input).
// ---------------------------------------------------------------------------

test("readVisibleUidProcessCount counts this process's uid via /proc status", () => {
  if (typeof process.getuid !== "function") {
    assert.equal(readVisibleUidProcessCount(), null);
    return;
  }
  const count = readVisibleUidProcessCount();
  assert.ok(count !== null, "/proc scan must be readable on this platform");
  // At minimum: this test runner itself.
  assert.ok((count as number) >= 1);
  // An explicit uid nobody runs as yields 0 (honest, not null).
  assert.equal(readVisibleUidProcessCount(2147483000), 0);
});

test("readVisibleUidProcessCount parses Uid lines and skips non-pid entries", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-nproc-proc-"));
  mkdirSync(join(root, "100"));
  mkdirSync(join(root, "101"));
  mkdirSync(join(root, "notapid"));
  writeFileSync(join(root, "100", "status"), "Name:\tsh\nUid:\t1001\t1001\t1001\t1001\n");
  writeFileSync(join(root, "101", "status"), "Name:\tnode\nUid:\t0\t0\t0\t0\n");
  // real uid (2nd field) decides the count, not effective.
  assert.equal(readVisibleUidProcessCount(1001, root), 1);
  assert.equal(readVisibleUidProcessCount(0, root), 1);
  // Unreadable proc root -> null (recorded honestly).
  assert.equal(readVisibleUidProcessCount(1001, join(root, "does-not-exist")), null);
});

// ---------------------------------------------------------------------------
// argv posture: parent-side prefix has no --nproc; child-side wrapper applies
// RLIMIT_NPROC after the user-namespace transition (issue #64 direction 2).
// ---------------------------------------------------------------------------

test("buildPrlimitArgs: the parent-side prefix carries NO --nproc", () => {
  const prefix = buildPrlimitArgs(CEILINGS);
  // The defect mechanism (issue #64): a parent-side --nproc below the
  // kernel-level ambient uid process count makes bwrap's own clone() fail
  // with EAGAIN. The prefix must never reintroduce it.
  for (const element of prefix) {
    assert.ok(!element.startsWith("--nproc"), `parent prefix must not carry --nproc: ${element}`);
  }
  assert.deepEqual(prefix, [
    `--cpu=${CEILINGS.cpu_seconds}`,
    `--as=${CEILINGS.as_bytes}`,
    `--fsize=${CEILINGS.fsize_bytes}`,
    `--nofile=${CEILINGS.nofile}`,
    "--",
  ]);
});

test("buildBwrapArgs: the in-sandbox prlimit wrapper applies --nproc child-side", () => {
  const argv = buildBwrapArgs(specFixture());
  const wrapperIdx = argv.indexOf("/usr/bin/prlimit");
  assert.ok(wrapperIdx > 0, "child-side wrapper must be present in the bwrap argv");
  // prlimit(1) resource options require the equals form; a space-separated
  // value would be exec'd as the command ("failed to execute <value>").
  assert.equal(argv[wrapperIdx + 1], `--nproc=${CEILINGS.nproc}`);
  assert.equal(argv[wrapperIdx + 2], "--");
  // The real command follows the wrapper verbatim (argv arrays only).
  assert.deepEqual(argv.slice(wrapperIdx + 3), ["sh", "-c", "true"]);
  // The wrapper sits AFTER bwrap's own "--" separator: it is exec'd inside
  // the sandbox, i.e. after the user-namespace transition.
  const bwrapSeparator = argv.indexOf("--");
  assert.ok(bwrapSeparator >= 0 && bwrapSeparator < wrapperIdx);
});

test("buildBwrapArgs: without a wrapper the command runs bare and the posture records it", () => {
  const argv = buildBwrapArgs(specFixture({ nprocWrapper: null }));
  assert.ok(!argv.includes("/usr/bin/prlimit"));
  for (const element of argv) {
    assert.ok(!element.startsWith("--nproc"));
  }
  // Command is the argv tail after the single bwrap separator.
  const separator = argv.indexOf("--");
  assert.deepEqual(argv.slice(separator + 1), ["sh", "-c", "true"]);
});

// ---------------------------------------------------------------------------
// Probe-grounded calibration (real bwrap) — typed skip where absent.
// ---------------------------------------------------------------------------

test("probe records the ambient uid process count and the computed ceiling", async (t) => {
  const report = await batteryEnvironment();
  if (report.bwrap.path === null || report.prlimit_path === null) {
    t.skip("bwrap/prlimit unavailable — ambient calibration typed skip (honest NOT_SUPPORTED)");
    return;
  }
  if (report.capability === "NOT_SUPPORTED") {
    t.skip("bwrap present but userns refused — calibration not run");
    return;
  }
  // The kernel-level estimate comes from the calibration ladder (or null
  // when the count exceeds it — recorded, never fabricated).
  assert.ok(
    report.ambient_uid_process_count === null ||
      (NPROC_PROBE_LADDER as readonly number[]).includes(report.ambient_uid_process_count),
  );
  assert.ok(report.nproc_ceiling !== null);
  assert.equal(report.nproc_ceiling.margin, NPROC_MARGIN);
  assert.equal(report.nproc_ceiling.floor, NPROC_CEILING_FLOOR);
  assert.equal(report.nproc_ceiling.hard_ceiling, NPROC_HARD_CEILING);
  if (report.ambient_uid_process_count !== null) {
    assert.equal(
      report.nproc_ceiling.computed_ceiling,
      Math.min(
        NPROC_HARD_CEILING,
        Math.max(NPROC_CEILING_FLOOR, report.ambient_uid_process_count + NPROC_MARGIN),
      ),
    );
    // The kernel-level count dominates the visible pidns slice on shared
    // hosts (issue #64: ~36 visible vs ~170-199 kernel-level).
    assert.ok(report.visible_uid_process_count !== null);
    assert.ok(report.ambient_uid_process_count >= (report.visible_uid_process_count as number));
  }
  assert.ok(report.nproc_posture_detail.includes("child-side"));
  assert.ok(report.nproc_posture_detail.includes("no --nproc"));
});

test("real execution applies the child-side posture and records it in evidence", async (t) => {
  if (!(await realIsolationAvailable())) {
    t.skip("bwrap/userns unavailable — child-side posture needs a real sandbox");
    return;
  }
  const fixture = await provisionedSession();
  const outcome = await runShell(fixture, "true");
  assert.equal(outcome.kind, "EXECUTED_SANDBOXED");
  if (outcome.kind !== "EXECUTED_SANDBOXED") {
    return;
  }
  assert.equal(outcome.exit_code, 0);
  const posture = outcome.evidence.nproc_posture;
  if (existsSync("/usr/bin/prlimit")) {
    assert.equal(posture.applied, true);
    assert.ok(posture.effective_ceiling !== null);
    assert.ok(
      posture.effective_ceiling as number >= NPROC_CEILING_FLOOR &&
        (posture.effective_ceiling as number) <= NPROC_HARD_CEILING,
    );
    // The wrapper argv is auditable in the recorded bwrap argv (equals form:
    // prlimit resource options do not accept a space-separated value).
    const wrapperIdx = outcome.evidence.bwrap_argv.indexOf("/usr/bin/prlimit");
    assert.ok(wrapperIdx > 0);
    assert.equal(
      outcome.evidence.bwrap_argv[wrapperIdx + 1],
      `--nproc=${posture.effective_ceiling as number}`,
    );
  } else {
    // No wrapper visible inside the sandbox: honestly recorded as not applied.
    assert.equal(posture.applied, false);
    assert.equal(posture.effective_ceiling, null);
    assert.ok(posture.detail.includes("NOT applied"));
  }
  assert.ok(posture.process_budget >= 1);
  assert.equal(posture.margin, NPROC_MARGIN);
  assert.equal(posture.floor, NPROC_CEILING_FLOOR);
  assert.equal(posture.hard_ceiling, NPROC_HARD_CEILING);
  // The ambient basis mirrors the SESSION's environment report (the
  // provider's own probe) — counts drift between separate probe runs.
  const sessionEnv = await fixture.provider.sessionEnvironmentReport(fixture.ref);
  if (!("kind" in sessionEnv) || sessionEnv.kind !== "REFUSED") {
    assert.equal(
      posture.ambient_uid_process_count,
      sessionEnv.environment.ambient_uid_process_count,
    );
    assert.equal(
      posture.visible_uid_process_count,
      sessionEnv.environment.visible_uid_process_count,
    );
  }
  await fixture.provider.teardown(fixture.ref);
});

test("the child-side ceiling still contains forks while the spawn stays immune (issue #64)", async (t) => {
  // Regression guard for BOTH halves of the fix:
  //   - containment: the wrapper-applied ceiling is a real kernel limit — a
  //     workload exceeding it dies with EAGAIN ("fork failed");
  //   - spawn immunity: bwrap's own clone() is no longer gated by that
  //     limit (the old failure signature "Creating new namespace failed"
  //     must never reappear, whatever the ambient count is).
  if (!(await realIsolationAvailable())) {
    t.skip("bwrap/userns unavailable — containment probe needs a real sandbox");
    return;
  }
  if (!existsSync("/usr/bin/prlimit")) {
    t.skip("in-sandbox prlimit wrapper unavailable on this host — child-side nproc not applied");
    return;
  }
  const fixture = await provisionedSession();
  const staged = stageHelperInSession(fixture);
  if (staged === null) {
    t.skip("escape helper could not be compiled (gcc absent) — NOT_SUPPORTED marker");
    return;
  }
  // A tight budget (2) still yields a usable ceiling via the floor
  // (clamp(ambient + 2, floor, hard)); the fork bomb inside must hit
  // EAGAIN at that ceiling and fail honestly.
  const outcome = await fixture.provider.executeCommand(fixture.ref, {
    action_id: "act_00000001",
    command: ["/workspace/helper", "forkbomb"],
    input_mounts: [{ host_path: staged, sandbox_path: "/workspace/helper" }],
    profile: { max_processes: 2, wall_clock_ceiling_ms: 15_000 },
  });
  assert.equal(outcome.kind, "EXECUTED_SANDBOXED");
  if (outcome.kind !== "EXECUTED_SANDBOXED") {
    return;
  }
  assert.notEqual(outcome.exit_code, 0, "fork bomb must be contained at the declared ceiling");
  assert.match(outcome.stdout, /fork failed/);
  assert.ok(
    !outcome.stderr.includes("Creating new namespace failed"),
    "the bwrap spawn itself must never fail with the issue #64 EAGAIN signature",
  );
  const posture = outcome.evidence.nproc_posture;
  assert.equal(posture.applied, true);
  const ambient = posture.ambient_uid_process_count ?? 0;
  const expected = Math.min(NPROC_HARD_CEILING, Math.max(NPROC_CEILING_FLOOR, ambient + 2));
  assert.equal(posture.effective_ceiling, expected);
  await fixture.provider.teardown(fixture.ref);
});
