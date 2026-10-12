import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { join } from "node:path";
import type { IsolationExecutionOutcome } from "../src/isolation-execution.js";
import {
  batteryEnvironment,
  provisionedSession,
  realIsolationAvailable,
  runShell,
  stageHelperInSession,
} from "./helpers.js";

/**
 * AR2-019 adversarial escape battery — every probe is a REAL attempt from
 * inside the sandbox; DENIED is the passing result. Results feed the
 * ConformanceEvidenceRecord (evidence.test.ts). When bwrap/userns are absent
 * the probes skip with the honest NOT_SUPPORTED marker.
 */

const BAIT_SECRET = "ARENA-BATTERY-BAIT-SECRET-7f3c9a";

/** Simulated tenant-B marker: another tenant's capsule (own root, or under a
 * shared host root when the probe needs the same provider workspace). */
function tenantBWorkspace(workspaceRoot?: string): string {
  const root = workspaceRoot ?? mkdtempSync(path.join(tmpdir(), "arena-iso-tenantb-"));
  const tenantB = join(root, "tenant-tnt_00000002", "cap-cap_00000077", "inputs");
  mkdirSync(tenantB, { recursive: true });
  writeFileSync(join(tenantB, "tenant-b-secret.txt"), "TENANT_B_MARKER\n");
  return join(root, "tenant-tnt_00000002", "cap-cap_00000077");
}

/** A real host-side listener on 127.0.0.1 that the sandbox must NOT reach. */
function localListener(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        port,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

function mustBeSandboxed(t: import("node:test").TestContext, outcome: IsolationExecutionOutcome) {
  if (outcome.kind === "ISOLATION_NOT_SUPPORTED" || outcome.kind === "ISOLATION_SETUP_FAILED") {
    t.skip(`isolation unavailable in this environment (${outcome.kind})`);
    return null;
  }
  return outcome;
}

test("probe fs-escape: /etc/shadow, $HOME-carried secrets and repo root are absent", async (t) => {
  if (!(await realIsolationAvailable())) {
    t.skip("bwrap/userns unavailable — NOT_SUPPORTED recorded in provider-port tests");
    return;
  }
  const fixture = await provisionedSession();
  const outcome = await runShell(
    fixture,
    [
      `for p in /etc/shadow /etc/passwd /root/.ssh /home /var/log /opt /srv /etc/hostname; do`,
      `  if test -e "$p"; then echo "PRESENT:$p"; else echo "absent:$p"; fi;`,
      `done;`,
      `if test -e ${process.env.HOME ?? "/home/z"}; then echo "PRESENT:host-home"; fi;`,
      `if test -e /home/z/my-project; then echo "PRESENT:repo-root"; fi;`,
      `if test -e /home/z/my-project/arena; then echo "PRESENT:arena-repo"; fi;`,
    ].join(" "),
  );
  const sandboxed = mustBeSandboxed(t, outcome);
  if (sandboxed === null || sandboxed.kind !== "EXECUTED_SANDBOXED") {
    if (sandboxed !== null && sandboxed.kind === "SYSCALL_FILTER_KILLED") {
      t.fail("fs-escape probe must not trip the syscall filter");
    }
    return;
  }
  assert.equal(sandboxed.exit_code, 0);
  assert.equal(/PRESENT:/.test(sandboxed.stdout), false, `leaked paths: ${sandboxed.stdout}`);
  // /tmp, /run and the scratch DO exist (tmpfs), /etc and /home do not.
  assert.match(sandboxed.stdout, /absent:\/etc\/shadow/);
  await fixture.provider.teardown(fixture.ref);
});

test("probe fs-escape: sibling tenant scratch and inputs are unreachable", async (t) => {
  if (!(await realIsolationAvailable())) {
    t.skip("bwrap/userns unavailable — NOT_SUPPORTED recorded in provider-port tests");
    return;
  }
  const tenantB = tenantBWorkspace();
  const fixture = await provisionedSession({ tenantId: "tnt_00000001" });
  // A tenant-A input is mounted; tenant-B paths were never declared.
  const helper = stageHelperInSession(fixture);
  if (helper === null) {
    t.skip("escape helper could not be compiled (gcc absent) — NOT_SUPPORTED marker");
    return;
  }
  const outcome = await fixture.provider.executeCommand(fixture.ref, {
    action_id: "act_00000001",
    command: ["/workspace/helper", "statfile", tenantB],
    input_mounts: [{ host_path: helper, sandbox_path: "/workspace/helper" }],
  });
  const sandboxed = mustBeSandboxed(t, outcome);
  if (sandboxed === null || sandboxed.kind !== "EXECUTED_SANDBOXED") {
    return;
  }
  // The host path exists (parent created it) but inside the sandbox it does not.
  assert.notEqual(sandboxed.exit_code, 0);
  assert.match(sandboxed.stdout, /open|access/);
  await fixture.provider.teardown(fixture.ref);
});

test("probe net-egress: empty netns cannot reach a LIVE host listener on localhost", async (t) => {
  if (!(await realIsolationAvailable())) {
    t.skip("bwrap/userns unavailable — NOT_SUPPORTED recorded in provider-port tests");
    return;
  }
  const listener = await localListener();
  try {
    const fixture = await provisionedSession();
    const helper = stageHelperInSession(fixture);
    if (helper === null) {
      t.skip("escape helper could not be compiled (gcc absent) — NOT_SUPPORTED marker");
      return;
    }
    const outcome = await fixture.provider.executeCommand(fixture.ref, {
      action_id: "act_00000001",
      command: ["/workspace/helper", "connect", "127.0.0.1", String(listener.port)],
      input_mounts: [{ host_path: helper, sandbox_path: "/workspace/helper" }],
      profile: { wall_clock_ceiling_ms: 10_000 },
    });
    const sandboxed = mustBeSandboxed(t, outcome);
    if (sandboxed === null || sandboxed.kind !== "EXECUTED_SANDBOXED") {
      return;
    }
    assert.notEqual(sandboxed.exit_code, 0, "sandbox reached a host-only localhost listener");
    assert.match(sandboxed.stdout, /connect failed/);
    await fixture.provider.teardown(fixture.ref);
  } finally {
    await listener.close();
  }
});

test("probe net-egress: private-range and metadata addresses are unreachable", async (t) => {
  if (!(await realIsolationAvailable())) {
    t.skip("bwrap/userns unavailable — NOT_SUPPORTED recorded in provider-port tests");
    return;
  }
  const fixture = await provisionedSession();
  const helper = stageHelperInSession(fixture);
  if (helper === null) {
    t.skip("escape helper could not be compiled (gcc absent) — NOT_SUPPORTED marker");
    return;
  }
  for (const target of ["10.255.255.1", "169.254.169.254", "192.168.1.1"]) {
    const outcome = await fixture.provider.executeCommand(fixture.ref, {
      action_id: "act_00000001",
      command: ["/workspace/helper", "connect", target, "80"],
      input_mounts: [{ host_path: helper, sandbox_path: "/workspace/helper" }],
      profile: { wall_clock_ceiling_ms: 10_000 },
    });
    const sandboxed = mustBeSandboxed(t, outcome);
    if (sandboxed === null || sandboxed.kind !== "EXECUTED_SANDBOXED") {
      return;
    }
    assert.notEqual(sandboxed.exit_code, 0, `egress to ${target} must be denied`);
    assert.match(sandboxed.stdout, /connect failed/);
  }
  await fixture.provider.teardown(fixture.ref);
});

test("probe pid-visibility: host PIDs are not visible inside the sandbox", async (t) => {
  if (!(await realIsolationAvailable())) {
    t.skip("bwrap/userns unavailable — NOT_SUPPORTED recorded in provider-port tests");
    return;
  }
  const fixture = await provisionedSession();
  const helper = stageHelperInSession(fixture);
  if (helper === null) {
    t.skip("escape helper could not be compiled (gcc absent) — NOT_SUPPORTED marker");
    return;
  }
  const outcome = await fixture.provider.executeCommand(fixture.ref, {
    action_id: "act_00000001",
    command: ["/workspace/helper", "statfile", `/proc/${process.pid}`],
    input_mounts: [{ host_path: helper, sandbox_path: "/workspace/helper" }],
  });
  const sandboxed = mustBeSandboxed(t, outcome);
  if (sandboxed === null || sandboxed.kind !== "EXECUTED_SANDBOXED") {
    return;
  }
  assert.notEqual(sandboxed.exit_code, 0, "the sandbox must not see the host parent pid");
  const outcome2 = await fixture.provider.executeCommand(fixture.ref, {
    action_id: "act_00000001",
    command: ["/workspace/helper", "statfile", "/proc/1"],
    input_mounts: [{ host_path: helper, sandbox_path: "/workspace/helper" }],
  });
  const environment = await batteryEnvironment();
  if (outcome2.kind === "EXECUTED_SANDBOXED") {
    if (environment.procfs_strategy === "masked-proc") {
      // Masked /proc is an empty tmpfs: even pid 1 is absent.
      assert.notEqual(outcome2.exit_code, 0);
    } else {
      // fresh-proc: /proc/1 exists and is the namespace-local reaper.
      assert.equal(outcome2.exit_code, 0);
    }
  }
  await fixture.provider.teardown(fixture.ref);
});

test("probe syscall-filter: a blocked keyctl call dies with SIGSYS", async (t) => {
  if (!(await realIsolationAvailable())) {
    t.skip("bwrap/userns unavailable — NOT_SUPPORTED recorded in provider-port tests");
    return;
  }
  const environment = await batteryEnvironment();
  if (environment.seccomp_filter_supported !== true) {
    t.skip("seccomp filter layer unsupported here — honest NOT_SUPPORTED marker");
    return;
  }
  const fixture = await provisionedSession();
  const helper = stageHelperInSession(fixture);
  if (helper === null) {
    t.skip("escape helper could not be compiled (gcc absent) — NOT_SUPPORTED marker");
    return;
  }
  const outcome = await fixture.provider.executeCommand(fixture.ref, {
    action_id: "act_00000001",
    command: ["/workspace/helper", "keyctl"],
    input_mounts: [{ host_path: helper, sandbox_path: "/workspace/helper" }],
  });
  // The typed outcome for a seccomp kill is first-class evidence.
  assert.equal(outcome.kind, "SYSCALL_FILTER_KILLED");
  if (outcome.kind === "SYSCALL_FILTER_KILLED") {
    assert.equal(outcome.signal, "SIGSYS");
    assert.ok(outcome.evidence.seccomp_filter_installed);
  }
  await fixture.provider.teardown(fixture.ref);
});

test("probe resource-ceil-memory: memory hog is killed at the declared ceiling", async (t) => {
  if (!(await realIsolationAvailable())) {
    t.skip("bwrap/userns unavailable — NOT_SUPPORTED recorded in provider-port tests");
    return;
  }
  const fixture = await provisionedSession({
    manifestOverrides: {
      resource_policy: { cpu_limit: 1, memory_limit_mb: 128, disk_limit_mb: 64, max_duration_seconds: 60 },
    },
  });
  const helper = stageHelperInSession(fixture);
  if (helper === null) {
    t.skip("escape helper could not be compiled (gcc absent) — NOT_SUPPORTED marker");
    return;
  }
  const outcome = await fixture.provider.executeCommand(fixture.ref, {
    action_id: "act_00000001",
    command: ["/workspace/helper", "hog"],
    input_mounts: [{ host_path: helper, sandbox_path: "/workspace/helper" }],
    profile: { wall_clock_ceiling_ms: 15_000 },
  });
  const sandboxed = mustBeSandboxed(t, outcome);
  if (sandboxed === null || sandboxed.kind !== "EXECUTED_SANDBOXED") {
    return;
  }
  assert.notEqual(sandboxed.exit_code, 0);
  assert.match(sandboxed.stdout, /malloc failed/);
  await fixture.provider.teardown(fixture.ref);
});

test("probe resource-ceil-process: fork bomb hits the nproc ceiling", async (t) => {
  if (!(await realIsolationAvailable())) {
    t.skip("bwrap/userns unavailable — NOT_SUPPORTED recorded in provider-port tests");
    return;
  }
  const fixture = await provisionedSession();
  const helper = stageHelperInSession(fixture);
  if (helper === null) {
    t.skip("escape helper could not be compiled (gcc absent) — NOT_SUPPORTED marker");
    return;
  }
  const outcome = await fixture.provider.executeCommand(fixture.ref, {
    action_id: "act_00000001",
    command: ["/workspace/helper", "forkbomb"],
    input_mounts: [{ host_path: helper, sandbox_path: "/workspace/helper" }],
    profile: { max_processes: 128, wall_clock_ceiling_ms: 15_000 },
  });
  const sandboxed = mustBeSandboxed(t, outcome);
  if (sandboxed === null || sandboxed.kind !== "EXECUTED_SANDBOXED") {
    return;
  }
  assert.notEqual(sandboxed.exit_code, 0);
  assert.match(sandboxed.stdout, /fork failed/);
  await fixture.provider.teardown(fixture.ref);
});

test("probe resource-ceil-cpu: CPU spin is killed at the cpu ceiling before wall clock", async (t) => {
  if (!(await realIsolationAvailable())) {
    t.skip("bwrap/userns unavailable — NOT_SUPPORTED recorded in provider-port tests");
    return;
  }
  const fixture = await provisionedSession({
    manifestOverrides: {
      resource_policy: { cpu_limit: 0.5, memory_limit_mb: 256, disk_limit_mb: 64, max_duration_seconds: 300 },
    },
  });
  const helper = stageHelperInSession(fixture);
  if (helper === null) {
    t.skip("escape helper could not be compiled (gcc absent) — NOT_SUPPORTED marker");
    return;
  }
  // cpu_seconds = ceil(0.5 cores × 10s wall) = 5s < 10s wall clock.
  const outcome = await fixture.provider.executeCommand(fixture.ref, {
    action_id: "act_00000001",
    command: ["/workspace/helper", "spin"],
    input_mounts: [{ host_path: helper, sandbox_path: "/workspace/helper" }],
    profile: { wall_clock_ceiling_ms: 10_000 },
  });
  if (outcome.kind === "EXEC_TIMEOUT") {
    t.fail("wall clock fired before the rlimit: ceiling mapping regressed");
    return;
  }
  const sandboxed = mustBeSandboxed(t, outcome);
  if (sandboxed === null || sandboxed.kind !== "EXECUTED_SANDBOXED") {
    return;
  }
  // bwrap's supervisor propagates rlimit signal deaths as 128+signum exit
  // codes: SIGKILL=137, SIGXCPU=152.
  assert.ok(
    sandboxed.signal === "SIGKILL" ||
      sandboxed.signal === "SIGXCPU" ||
      sandboxed.exit_code === 137 ||
      sandboxed.exit_code === 152,
  );
  assert.ok(sandboxed.duration_ms < 10_000);
  await fixture.provider.teardown(fixture.ref);
});

test("probe secret-hygiene: host env never crosses the sandbox boundary", async (t) => {
  if (!(await realIsolationAvailable())) {
    t.skip("bwrap/userns unavailable — NOT_SUPPORTED recorded in provider-port tests");
    return;
  }
  const previousBait = process.env.ARENA_BATTERY_BAIT;
  process.env.ARENA_BATTERY_BAIT = BAIT_SECRET;
  process.env.HOME = process.env.HOME ?? "/home/z";
  try {
    const fixture = await provisionedSession();
    const outcome = await runShell(fixture, "env | sort");
    const sandboxed = mustBeSandboxed(t, outcome);
    if (sandboxed === null || sandboxed.kind !== "EXECUTED_SANDBOXED") {
      return;
    }
    assert.equal(sandboxed.exit_code, 0);
    // Only the explicit allowlist (PATH/HOME/TMPDIR) is present. PWD may be
    // set by the shell itself and must point at the sandbox scratch.
    const names = sandboxed.stdout.trim().split("\n").map((line) => line.split("=")[0]);
    for (const name of names) {
      if (name === "PWD") {
        const value = sandboxed.stdout.trim().split("\n").find((line) => line.startsWith("PWD="));
        assert.equal(value, "PWD=/workspace");
        continue;
      }
      assert.ok(
        ["PATH", "HOME", "TMPDIR"].includes(name),
        `unexpected env var inside sandbox: ${name}`,
      );
    }
    assert.equal(sandboxed.stdout.includes(BAIT_SECRET), false);
    // Captured evidence records themselves must not carry the bait either.
    assert.equal(sandboxed.stderr.includes(BAIT_SECRET), false);
    await fixture.provider.teardown(fixture.ref);
  } finally {
    if (previousBait === undefined) {
      delete process.env.ARENA_BATTERY_BAIT;
    } else {
      process.env.ARENA_BATTERY_BAIT = previousBait;
    }
  }
});

test("probe secret-hygiene: credentials never materialize in the sandbox or evidence", async (t) => {
  if (!(await realIsolationAvailable())) {
    t.skip("bwrap/userns unavailable — NOT_SUPPORTED recorded in provider-port tests");
    return;
  }
  const fixture = await provisionedSession();
  const outcome = await runShell(fixture, "ls -la /workspace; find /workspace -type f 2>/dev/null | wc -l");
  const sandboxed = mustBeSandboxed(t, outcome);
  if (sandboxed === null || sandboxed.kind !== "EXECUTED_SANDBOXED") {
    return;
  }
  assert.equal(sandboxed.exit_code, 0);
  assert.equal(/crd_|secret|credential/i.test(sandboxed.stdout), false);
  await fixture.provider.teardown(fixture.ref);
});

test("probe tenant-binding: tenant A cannot mount tenant B paths (fail closed)", async () => {
  const fixture = await provisionedSession({ tenantId: "tnt_00000001" });
  // Tenant B lives in the SAME isolation host (shared workspace root).
  const tenantB = tenantBWorkspace(fixture.workspaceRoot);
  const outcome = await fixture.provider.executeCommand(fixture.ref, {
    action_id: "act_00000001",
    command: ["cat", "/workspace/inputs/tenant-b-secret.txt"],
    input_mounts: [
      { host_path: path.join(tenantB, "inputs", "tenant-b-secret.txt"), sandbox_path: "/workspace/inputs/tenant-b-secret.txt" },
    ],
  });
  assert.equal(outcome.kind, "REFUSED");
  if (outcome.kind === "REFUSED") {
    assert.equal(outcome.code, "ARENA_TENANT_MISMATCH");
  }
  // Positive control: the same session CAN mount its own tenant-A input.
  const helper = stageHelperInSession(fixture);
  if (helper !== null) {
    const ok = await fixture.provider.executeCommand(fixture.ref, {
      action_id: "act_00000001",
      command: ["/workspace/helper", "getpid"],
      input_mounts: [{ host_path: helper, sandbox_path: "/workspace/helper" }],
    });
    assert.notEqual(ok.kind, "REFUSED");
  }
  await fixture.provider.teardown(fixture.ref);
});

test("probe wall-clock: a hanging command is killed with the typed EXEC_TIMEOUT", async (t) => {
  if (!(await realIsolationAvailable())) {
    t.skip("bwrap/userns unavailable — NOT_SUPPORTED recorded in provider-port tests");
    return;
  }
  const fixture = await provisionedSession();
  const outcome = await runShell(fixture, "sleep 30", { profile: { wall_clock_ceiling_ms: 1_500 } });
  assert.equal(outcome.kind, "EXEC_TIMEOUT");
  if (outcome.kind === "EXEC_TIMEOUT") {
    assert.equal(outcome.timeout_ms, 1_500);
  }
  await fixture.provider.teardown(fixture.ref);
});
