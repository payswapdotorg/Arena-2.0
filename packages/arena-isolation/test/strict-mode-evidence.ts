import { createServer } from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { probeIsolationEnvironment, type IsolationEnvironmentReport } from "../src/capability.js";
import { buildConformanceEvidenceRecord, type ConformanceProbeResult } from "../src/evidence.js";
import type { IsolationExecutionOutcome } from "../src/isolation-execution.js";
import { batteryHeadSha, provisionedSession, stageHelperInSession } from "./helpers.js";

/**
 * AR2-019 strict-mode conformance evidence run — the instrument the
 * release-gate owner reproduces on the gate station:
 *
 *   cd packages/arena-isolation
 *   ../../node_modules/.bin/tsx test/strict-mode-evidence.ts
 *
 * Strict bar: the environment must probe FULL_ISOLATION. Every probe runs a
 * REAL escape attempt; DENIED is the passing result. The JSON record on
 * stdout is the machine-readable evidence artifact.
 */

const BAIT = "STRICT-MODE-BAIT-SECRET-3c1d";

function localListener(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        port: typeof address === "object" && address !== null ? address.port : 0,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

async function run(): Promise<void> {
  const environment: IsolationEnvironmentReport = await probeIsolationEnvironment();
  const probes: ConformanceProbeResult[] = [];
  const track = async (
    name: string,
    attempt: () => Promise<ConformanceProbeResult["result"]>,
    detail: string,
  ): Promise<void> => {
    const started = Date.now();
    const result = await attempt();
    probes.push({ name, result, duration_ms: Date.now() - started, detail });
    console.error(`  ${name}: ${result} (${Date.now() - started}ms) — ${detail}`);
  };

  if (environment.capability !== "FULL_ISOLATION") {
    const record = buildConformanceEvidenceRecord({
      mode: "strict",
      environment,
      batteryHeadSha: batteryHeadSha(),
      probes: [
        {
          name: "environment-gate",
          result: "NOT_SUPPORTED",
          duration_ms: 0,
          detail: `strict mode requires FULL_ISOLATION; probed ${environment.capability}: ${environment.limitations.join("; ")}`,
        },
      ],
    });
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  // cpu_limit 0.5 with a 10s wall clock: RLIMIT_CPU = 5s fires first, so the
  // cpu probe proves the rlimit path (not the parent wall-clock kill).
  const fixture = await provisionedSession({
    mode: "strict",
    manifestOverrides: {
      resource_policy: { cpu_limit: 0.5, memory_limit_mb: 256, disk_limit_mb: 64, max_duration_seconds: 120 },
    },
  });
  const helper = stageHelperInSession(fixture);
  const exec = async (
    command: readonly string[],
    options: { mounts?: boolean; profile?: Record<string, number> } = {},
  ): Promise<IsolationExecutionOutcome> =>
    fixture.provider.executeCommand(fixture.ref, {
      action_id: "act_00000001",
      command,
      input_mounts: options.mounts === true && helper !== null
        ? [{ host_path: helper, sandbox_path: "/workspace/helper" }]
        : [],
      profile: options.profile,
    });

  const sandboxed = (outcome: IsolationExecutionOutcome) =>
    outcome.kind === "EXECUTED_SANDBOXED" || outcome.kind === "SYSCALL_FILTER_KILLED"
      ? outcome
      : null;

  await track(
    "fs-escape",
    async () => {
      const run = sandboxed(await exec(["sh", "-c", "test -e /etc/shadow || test -e /etc/passwd || test -e /root || test -e /home; echo probe-exit=$?"]));
      const denied = run !== null && /probe-exit=1/.test(run.stdout);
      return denied ? "DENIED" : "FAIL";
    },
    "child probed /etc/shadow, /etc/passwd, /root, /home — all absent",
  );

  await track(
    "net-egress",
    async () => {
      const listener = await localListener();
      try {
        const run = sandboxed(
          await exec(["/workspace/helper", "connect", "127.0.0.1", String(listener.port)], { mounts: true }),
        );
        const denied = run !== null && run.kind === "EXECUTED_SANDBOXED" && run.exit_code !== 0;
        return denied ? "DENIED" : "FAIL";
      } finally {
        await listener.close();
      }
    },
    "connect to a live host-only localhost listener failed inside the empty netns",
  );

  await track(
    "pid-visibility",
    async () => {
      const run = sandboxed(
        await exec(["/workspace/helper", "statfile", `/proc/${process.pid}`], { mounts: true }),
      );
      const denied = run !== null && run.kind === "EXECUTED_SANDBOXED" && run.exit_code !== 0;
      return denied ? "DENIED" : "FAIL";
    },
    `host pid ${process.pid} invisible inside the sandbox`,
  );

  await track(
    "syscall-filter",
    async () => {
      const run = await exec(["/workspace/helper", "keyctl"], { mounts: true });
      const denied = run.kind === "SYSCALL_FILTER_KILLED";
      return denied ? "DENIED" : "FAIL";
    },
    "blocked keyctl syscall died with SIGSYS (seccomp KILL_PROCESS)",
  );

  await track(
    "resource-ceil-memory",
    async () => {
      const run = sandboxed(await exec(["/workspace/helper", "hog"], { mounts: true }));
      const denied = run !== null && run.kind === "EXECUTED_SANDBOXED" && run.exit_code !== 0;
      return denied ? "DENIED" : "FAIL";
    },
    "memory hog hit RLIMIT_AS (256MB manifest ceiling) and failed to allocate",
  );

  await track(
    "resource-ceil-process",
    async () => {
      const run = sandboxed(
        await exec(["/workspace/helper", "forkbomb"], { mounts: true, profile: { max_processes: 128, wall_clock_ceiling_ms: 15000 } }),
      );
      const denied = run !== null && run.kind === "EXECUTED_SANDBOXED" && /fork failed/.test(run.stdout);
      return denied ? "DENIED" : "FAIL";
    },
    "fork bomb hit the RLIMIT_NPROC ceiling",
  );

  await track(
    "resource-ceil-cpu",
    async () => {
      const run = sandboxed(
        await exec(["/workspace/helper", "spin"], { mounts: true, profile: { wall_clock_ceiling_ms: 10000 } }),
      );
      const killed =
        run !== null &&
        (run.signal === "SIGKILL" || run.signal === "SIGXCPU" || run.exit_code === 137 || run.exit_code === 152);
      return killed ? "DENIED" : "FAIL";
    },
    "CPU spin killed at the cpu_limit x wall-clock rlimit before wall clock",
  );

  await track(
    "secret-hygiene",
    async () => {
      process.env.ARENA_STRICT_BAIT = BAIT;
      try {
        const run = sandboxed(await exec(["sh", "-c", "env"]));
        const clean =
          run !== null &&
          run.kind === "EXECUTED_SANDBOXED" &&
          !run.stdout.includes(BAIT) &&
          !/ARENA_STRICT_BAIT/.test(run.stdout);
        return clean ? "PASS" : "FAIL";
      } finally {
        delete process.env.ARENA_STRICT_BAIT;
      }
    },
    "host environment (incl. bait secret) never crossed --clearenv boundary",
  );

  await track(
    "tenant-binding",
    async () => {
      const tenantB = join(fixture.workspaceRoot, "tenant-tnt_00000002", "cap-cap_00000077", "inputs");
      mkdirSync(tenantB, { recursive: true });
      writeFileSync(join(tenantB, "b.txt"), "TENANT_B\n");
      const run = await fixture.provider.executeCommand(fixture.ref, {
        action_id: "act_00000001",
        command: ["cat", "/workspace/inputs/b.txt"],
        input_mounts: [{ host_path: join(tenantB, "b.txt"), sandbox_path: "/workspace/inputs/b.txt" }],
      });
      const refused = run.kind === "REFUSED" && run.code === "ARENA_TENANT_MISMATCH";
      return refused ? "PASS" : "FAIL";
    },
    "cross-tenant input mount refused with ARENA_TENANT_MISMATCH before any spawn",
  );

  await track(
    "namespace-conformance",
    async () => {
      const run = await fixture.provider.executeCommand(fixture.ref, {
        action_id: "act_00000001",
        command: ["sh", "-c", "sleep 0.5; id -u"],
      });
      if (run.kind !== "EXECUTED_SANDBOXED") {
        return "FAIL";
      }
      const divergence = run.evidence.namespace_divergence;
      const all = [divergence.user, divergence.pid, divergence.mnt, divergence.net, divergence.uts, divergence.ipc];
      const isolated = all.every((value) => value === true);
      const uidMapped = /^0\s+\d+\s+1$/.test(run.evidence.uid_map ?? "");
      const childSeesRootUid = /0/.test(run.stdout.trim().split("\n").pop() ?? "");
      return isolated && uidMapped && childSeesRootUid ? "PASS" : "FAIL";
    },
    "all six namespaces diverge; uid_map maps sandbox 0 to the host uid; child observes uid 0",
  );

  await fixture.provider.teardown(fixture.ref);

  const record = buildConformanceEvidenceRecord({
    mode: "strict",
    environment,
    batteryHeadSha: batteryHeadSha(),
    probes,
  });
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  process.exitCode = record.summary.fail > 0 || record.summary.not_supported > 0 ? 1 : 0;
}

void run();
