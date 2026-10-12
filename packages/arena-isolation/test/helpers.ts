import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import type { CapsuleManifest } from "@arena/contracts";
import { LinuxNamespaceIsolationProvider } from "../src/provider.js";
import type { IsolationExecutionRequest, IsolationExecutionOutcome } from "../src/isolation-execution.js";
import { probeIsolationEnvironment, type IsolationEnvironmentReport } from "../src/capability.js";

/**
 * AR2-019 test helpers: manifest fixtures, workspace bootstrap, the C escape
 * helper (compiled once per run), provider factories, and shared battery
 * conditions (real bwrap present or honest NOT_SUPPORTED skip).
 */

const HEX64 = "ab".repeat(32);

/** Location where this sandbox stages bubblewrap (CI finds it in /usr/bin). */
const BWRAP_FALLBACK_DIRS = ["/home/z/.local/bin", "/usr/bin", "/usr/local/bin"];

function ensureBwrapDiscoverable(): void {
  for (const dir of BWRAP_FALLBACK_DIRS) {
    if (existsSync(path.join(dir, "bwrap"))) {
      if (!(process.env.PATH ?? "").split(":").includes(dir)) {
        process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;
      }
      return;
    }
  }
}

ensureBwrapDiscoverable();

/** Shared probe for the battery (cached per process). */
let environmentReport: IsolationEnvironmentReport | null = null;

export async function batteryEnvironment(): Promise<IsolationEnvironmentReport> {
  if (environmentReport === null) {
    environmentReport = await probeIsolationEnvironment();
  }
  return environmentReport;
}

export const realIsolationAvailable = async (): Promise<boolean> => {
  const env = await batteryEnvironment();
  return env.userns_empirically_available === true;
};

export function validIsolationManifest(overrides: Record<string, unknown> = {}): CapsuleManifest {
  const raw = {
    manifest_id: "csm_00000001",
    capsule_id: "cap_00000001",
    manifest_version: 1,
    tenant_id: "tnt_00000001",
    escalation_id: "esc_00000001",
    attempt_id: "att_00000001",
    environment: {
      environment_ref: "fsenv://debian-usr@read-only",
      toolchain_pins: ["sh", "coreutils"],
      workspace_init: "tmpfs scratch only — no host workspace",
    },
    permitted_actions: [
      {
        action_id: "act_00000001",
        tool: "shell",
        scope: "sandbox scratch only",
        command_allowlist: ["sh", "cat", "ls", "id", "hostname", "/workspace/helper", "helper"],
      },
    ],
    resource_policy: {
      cpu_limit: 1,
      memory_limit_mb: 256,
      disk_limit_mb: 64,
      max_duration_seconds: 120,
    },
    egress_policy: {
      denied_default: true,
      allowed_hosts: [],
      allow_ingress: false,
    },
    credentials: [
      {
        credential_id: "crd_00000001",
        scope: "artifact-pull:attempt-1",
        ttl_seconds: 3600,
        rotation_policy: "rotate every 30m",
      },
    ],
    lifecycle: {
      provisioning_timeout_seconds: 300,
      heartbeat_interval_seconds: 30,
      teardown_timeout_seconds: 120,
    },
    assurance: {
      isolation_class: "container",
      conformance_suite_digest: HEX64,
      conformance_suite_version: "1.0.0",
      verified_at: "2026-10-12T18:00:00Z",
      provider_id: "prv_00000001",
    },
    artifact_transfer: { transfer: "pull_only", max_artifact_bytes: 104857600 },
    content_digest: HEX64,
    ...overrides,
  };
  return raw as CapsuleManifest;
}

export interface SessionFixture {
  provider: LinuxNamespaceIsolationProvider;
  manifest: CapsuleManifest;
  ref: {
    capsule_id: string;
    tenant_id: string;
    escalation_id: string;
    attempt_id: string;
  };
  sessionDir: string;
  workspaceRoot: string;
}

export async function provisionedSession(
  options: {
    tenantId?: string;
    capsuleId?: string;
    manifestOverrides?: Record<string, unknown>;
    mode?: "strict" | "auto";
  } = {},
): Promise<SessionFixture> {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "arena-iso-test-"));
  const tenantId = options.tenantId ?? "tnt_00000001";
  const capsuleId = options.capsuleId ?? "cap_00000001";
  const manifest = validIsolationManifest({
    tenant_id: tenantId,
    capsule_id: capsuleId,
    ...options.manifestOverrides,
  });
  const provider = new LinuxNamespaceIsolationProvider({
    mode: options.mode ?? "auto",
    workspaceRoot,
  });
  const outcome = await provider.provision(manifest);
  assert.equal(outcome.kind, "PROVISIONED", `fixture provision failed: ${JSON.stringify(outcome)}`);
  return {
    provider,
    manifest,
    ref: {
      capsule_id: capsuleId,
      tenant_id: tenantId,
      escalation_id: "esc_00000001",
      attempt_id: "att_00000001",
    },
    sessionDir: path.join(workspaceRoot, `tenant-${tenantId}`, `cap-${capsuleId}`),
    workspaceRoot,
  };
}

/** Execute a fixed shell script through the sandbox (battery probe style). */
export async function runShell(
  fixture: SessionFixture,
  script: string,
  options: Partial<IsolationExecutionRequest> = {},
): Promise<IsolationExecutionOutcome> {
  return await fixture.provider.executeCommand(fixture.ref, {
    action_id: "act_00000001",
    command: ["sh", "-c", script],
    ...options,
  });
}

/**
 * C escape helper — compiled once per test run (gcc present on the CI
 * battery and on the gate station; absent gcc degrades probes to honest
 * NOT_SUPPORTED markers). Static when possible so the sandbox needs nothing
 * beyond the read-only /usr bind.
 */
const HELPER_SOURCE = `
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <fcntl.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <sys/syscall.h>

static int usage(void) { fprintf(stderr, "usage: helper <keyctl|hog|forkbomb|spin|connect|readfile|statfile|envdump|getpid> [args]\\n"); return 2; }

int main(int argc, char **argv) {
  if (argc < 2) return usage();
  if (strcmp(argv[1], "keyctl") == 0) {
    long r = syscall(SYS_keyctl, 0, 0, 0, 0, 0);
    printf("keyctl returned %ld errno=%d\\n", r, errno);
    return 0;
  }
  if (strcmp(argv[1], "hog") == 0) {
    size_t sz = 64 * 1024 * 1024;
    for (int i = 0; i < 64; i++) {
      void *p = malloc(sz);
      if (!p) { printf("malloc failed at chunk %d errno=%d\\n", i, errno); return 1; }
      memset(p, 1, sz);
    }
    printf("hog allocated all\\n"); return 0;
  }
  if (strcmp(argv[1], "forkbomb") == 0) {
    int n = 0;
    for (;;) {
      pid_t pid = fork();
      if (pid < 0) { printf("fork failed after %d errno=%d\\n", n, errno); return 1; }
      if (pid == 0) { sleep(30); _exit(0); }
      n++;
    }
  }
  if (strcmp(argv[1], "spin") == 0) {
    volatile unsigned long x = 0;
    for (;;) { x++; }
  }
  if (strcmp(argv[1], "connect") == 0) {
    if (argc < 4) return usage();
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) { printf("socket failed errno=%d\\n", errno); return 1; }
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons((unsigned short)atoi(argv[3]));
    if (inet_pton(AF_INET, argv[2], &addr.sin_addr) != 1) { printf("bad ip\\n"); return 1; }
    alarm(3);
    int r = connect(fd, (struct sockaddr *)&addr, sizeof(addr));
    if (r != 0) { printf("connect failed errno=%d (%s)\\n", errno, strerror(errno)); return 1; }
    printf("connect SUCCEEDED\\n"); return 0;
  }
  if (strcmp(argv[1], "readfile") == 0 || strcmp(argv[1], "statfile") == 0) {
    if (argc < 3) return usage();
    if (strcmp(argv[1], "statfile") == 0) {
      int r = access(argv[2], F_OK);
      printf("%s access errno=%d\\n", argv[2], r == 0 ? 0 : errno);
      return r == 0 ? 0 : 1;
    }
    int fd = open(argv[2], O_RDONLY);
    if (fd < 0) { printf("%s open errno=%d\\n", argv[2], errno); return 1; }
    char buf[512];
    ssize_t n = read(fd, buf, sizeof(buf) - 1);
    if (n < 0) { printf("%s read errno=%d\\n", argv[2], errno); close(fd); return 1; }
    buf[n > 0 ? n : 0] = 0;
    printf("%s content=%.64s\\n", argv[2], buf);
    close(fd);
    return 0;
  }
  if (strcmp(argv[1], "envdump") == 0) {
    extern char **environ;
    for (char **e = environ; *e; e++) puts(*e);
    return 0;
  }
  if (strcmp(argv[1], "getpid") == 0) {
    printf("pid=%d\\n", (int)getpid());
    return 0;
  }
  return usage();
}
`;

let helperBinary: string | null | undefined;

export function escapeHelperBinary(): string | null {
  if (helperBinary !== undefined) {
    return helperBinary;
  }
  const dir = mkdtempSync(path.join(tmpdir(), "arena-iso-helper-"));
  const source = path.join(dir, "helper.c");
  writeFileSync(source, HELPER_SOURCE);
  const bin = path.join(dir, "helper");
  for (const flags of ["-static", ""]) {
    try {
      execFileSync("gcc", ["-O2", ...flags.split(" ").filter(Boolean), "-o", bin, source], {
        stdio: "pipe",
        timeout: 30_000,
      });
      helperBinary = bin;
      return bin;
    } catch {
      continue;
    }
  }
  helperBinary = null;
  return null;
}

/** Stage the helper inside a capsule's tenant-scoped inputs dir. */
export function stageHelperInSession(fixture: SessionFixture): string | null {
  const bin = escapeHelperBinary();
  if (bin === null) {
    return null;
  }
  const inputs = path.join(fixture.sessionDir, "inputs");
  mkdirSync(inputs, { recursive: true });
  const staged = path.join(inputs, "helper");
  copyFileSync(bin, staged);
  return staged;
}

/** Current HEAD sha for the evidence record ("unknown" outside a repo). */
export function batteryHeadSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: path.resolve(import.meta.dirname, "..", ".."),
      stdio: "pipe",
    })
      .toString("utf8")
      .trim();
  } catch {
    return "unknown-not-a-git-repo";
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
