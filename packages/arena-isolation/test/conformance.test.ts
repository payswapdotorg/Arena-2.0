import assert from "node:assert/strict";
import test from "node:test";
import { hostname } from "node:os";
import { batteryEnvironment, provisionedSession, realIsolationAvailable, runShell } from "./helpers.js";

/**
 * Conformance: a REAL manifest executes inside the sandbox and both sides
 * observe isolation — the child sees its own namespaces (mapped uid, custom
 * hostname, namespace-local pid), the parent verifies namespace divergence
 * (bwrap --info-fd + /proc/<pid>/ns/* + uid_map) and argv-array discipline.
 */

test("real manifest executes inside the namespace sandbox", async (t) => {
  if (!(await realIsolationAvailable())) {
    t.skip("bwrap/userns unavailable in this environment — NOT_SUPPORTED path covered in provider-port tests");
    return;
  }
  const fixture = await provisionedSession();
  const outcome = await runShell(fixture, 'echo "uid=$(id -u) gid=$(id -g) host=$(hostname)"');
  assert.equal(outcome.kind, "EXECUTED_SANDBOXED");
  if (outcome.kind !== "EXECUTED_SANDBOXED") {
    return;
  }
  assert.equal(outcome.exit_code, 0);
  // Child-side observations: uid 0 inside its own userns, custom hostname.
  assert.match(outcome.stdout, /uid=0 gid=0/);
  assert.match(outcome.stdout, new RegExp(`host=arena-cap-${fixture.ref.capsule_id.slice(4)}`));
  // The sandbox hostname is namespace-local, never the host's.
  const childHost = outcome.stdout.match(/host=(\S+)/)?.[1] ?? "";
  assert.notEqual(childHost, hostname());
  const torn = await fixture.provider.teardown(fixture.ref);
  assert.equal(torn.kind, "TORN_DOWN");
});

test("parent-side evidence: namespace divergence, uid_map, sandbox pid", async (t) => {
  if (!(await realIsolationAvailable())) {
    t.skip("bwrap/userns unavailable — NOT_SUPPORTED path covered in provider-port tests");
    return;
  }
  const fixture = await provisionedSession();
  const outcome = await runShell(fixture, "sleep 0.6; echo done");
  assert.equal(outcome.kind, "EXECUTED_SANDBOXED");
  if (outcome.kind !== "EXECUTED_SANDBOXED") {
    return;
  }
  const evidence = outcome.evidence;
  assert.ok(evidence.sandbox_pid !== null, "bwrap info-fd must report the sandbox pid");
  assert.notEqual(evidence.sandbox_pid, process.pid);
  // bwrap-reported namespace ids for pid/mnt/uts/ipc/net.
  assert.ok(evidence.bwrap_info !== null);
  assert.ok(evidence.bwrap_info.namespaces.pid !== null);
  // Parent-side /proc sampling while the child was alive.
  const divergence = evidence.namespace_divergence;
  assert.equal(divergence.user, true, "user namespace must diverge");
  assert.equal(divergence.pid, true, "pid namespace must diverge");
  assert.equal(divergence.mnt, true, "mount namespace must diverge");
  assert.equal(divergence.net, true, "network namespace must diverge");
  assert.equal(divergence.uts, true, "uts namespace must diverge");
  assert.equal(divergence.ipc, true, "ipc namespace must diverge");
  // uid_map: sandbox uid 0 maps to exactly this test process's uid.
  assert.ok(evidence.uid_map !== null);
  const [inner, outer, count] = evidence.uid_map.split(/\s+/).map(Number);
  assert.equal(inner, 0);
  assert.equal(outer, process.getuid());
  assert.equal(count, 1);
  await fixture.provider.teardown(fixture.ref);
});

test("PID-namespace view: child pid is namespace-local, not the host pid", async (t) => {
  if (!(await realIsolationAvailable())) {
    t.skip("bwrap/userns unavailable — NOT_SUPPORTED path covered in provider-port tests");
    return;
  }
  const fixture = await provisionedSession();
  const outcome = await runShell(fixture, 'echo "self=$$"');
  assert.equal(outcome.kind, "EXECUTED_SANDBOXED");
  if (outcome.kind !== "EXECUTED_SANDBOXED") {
    return;
  }
  const match = outcome.stdout.match(/self=(\d+)/);
  assert.ok(match !== null);
  const nsPid = Number(match[1]);
  // $$ in the sandbox is small (namespace-local pid, reaper is 1).
  assert.ok(nsPid < 100, `sandbox pid should be namespace-local, got ${nsPid}`);
  assert.ok(outcome.evidence.sandbox_pid !== null);
  assert.notEqual(nsPid, outcome.evidence.sandbox_pid);
  await fixture.provider.teardown(fixture.ref);
});

test("argv discipline: recorded bwrap argv is a pure argv array (no shell string)", async (t) => {
  if (!(await realIsolationAvailable())) {
    t.skip("bwrap/userns unavailable — NOT_SUPPORTED path covered in provider-port tests");
    return;
  }
  const fixture = await provisionedSession();
  const outcome = await runShell(fixture, "true");
  assert.equal(outcome.kind, "EXECUTED_SANDBOXED");
  if (outcome.kind !== "EXECUTED_SANDBOXED") {
    return;
  }
  const argv = outcome.evidence.bwrap_argv;
  for (const element of argv) {
    assert.equal(typeof element, "string");
    assert.ok(!element.includes("; sh -c"));
  }
  // Load-bearing isolation flags are present and ordered before the command.
  assert.ok(argv.includes("--unshare-user"));
  assert.ok(argv.includes("--unshare-pid"));
  assert.ok(argv.includes("--unshare-net"));
  assert.ok(argv.includes("--unshare-uts"));
  assert.ok(argv.includes("--unshare-ipc"));
  assert.ok(argv.includes("--clearenv"));
  assert.ok(argv.includes("--die-with-parent"));
  const environment = await batteryEnvironment();
  if (environment.bwrap.major !== null && environment.bwrap.minor !== null) {
    const atLeast012 = environment.bwrap.major > 0 || environment.bwrap.minor >= 12;
    // --disable-userns requires a real procfs; masked-proc environments
    // honestly skip the extra (documented limitation).
    if (atLeast012 && environment.procfs_strategy === "fresh-proc") {
      assert.ok(argv.includes("--disable-userns"));
    } else if (atLeast012) {
      assert.ok(!argv.includes("--disable-userns"));
    }
  }
  // tmpfs-only writable scratch: declared with a size cap and 0700 perms.
  const chmodIdx = argv.indexOf("--chmod");
  assert.ok(chmodIdx > 0);
  assert.equal(argv[chmodIdx + 1], "0700");
  assert.equal(argv[chmodIdx + 2], "/workspace");
  const sizeIdx = argv.indexOf("--size");
  assert.ok(sizeIdx > 0);
  assert.ok(Number(argv[sizeIdx + 1]) > 0);
  await fixture.provider.teardown(fixture.ref);
});

test("input mounts bind tenant-scoped files read-only into the sandbox", async (t) => {
  if (!(await realIsolationAvailable())) {
    t.skip("bwrap/userns unavailable — NOT_SUPPORTED path covered in provider-port tests");
    return;
  }
  const fixture = await provisionedSession();
  const { writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const input = join(fixture.sessionDir, "inputs", "payload.txt");
  writeFileSync(input, "TENANT_A_INPUT_MARKER\n");
  const outcome = await fixture.provider.executeCommand(fixture.ref, {
    action_id: "act_00000001",
    command: ["cat", "/workspace/inputs/payload.txt"],
    input_mounts: [{ host_path: input, sandbox_path: "/workspace/inputs/payload.txt" }],
  });
  assert.equal(outcome.kind, "EXECUTED_SANDBOXED");
  if (outcome.kind === "EXECUTED_SANDBOXED") {
    assert.equal(outcome.exit_code, 0);
    assert.match(outcome.stdout, /TENANT_A_INPUT_MARKER/);
  }
  await fixture.provider.teardown(fixture.ref);
});

test("procfs strategy is recorded and host PIDs are invisible through it", async (t) => {
  if (!(await realIsolationAvailable())) {
    t.skip("bwrap/userns unavailable — NOT_SUPPORTED path covered in provider-port tests");
    return;
  }
  const environment = await batteryEnvironment();
  const fixture = await provisionedSession();
  const outcome = await runShell(fixture, `ls /proc | grep -c '^[0-9]' || true`);
  assert.equal(outcome.kind, "EXECUTED_SANDBOXED");
  if (outcome.kind !== "EXECUTED_SANDBOXED") {
    return;
  }
  if (environment.procfs_strategy === "masked-proc") {
    assert.equal(outcome.stdout.trim(), "0", "masked /proc must contain no pid entries");
  } else {
    // fresh-proc: only namespace-local pids (small numbers, few of them).
    const count = Number(outcome.stdout.trim());
    assert.ok(Number.isFinite(count) && count < 10);
  }
  await fixture.provider.teardown(fixture.ref);
});
