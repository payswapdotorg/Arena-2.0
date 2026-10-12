import { accessSync, constants } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CapsuleManifest } from "@arena/contracts";
import {
  CapsuleBindingRegistry,
  ScopedCredentialLedger,
  bindingOfManifest,
  capsuleLifecycleAllows,
  capsuleLifecycleIsTerminal,
  checkCapsuleManifest,
} from "@arena/capsule";
import type {
  ArtifactTransferRequest,
  CapsuleProviderPort,
  CapsuleRef,
  CapsuleRuntimeState,
  CapsuleSnapshot,
  HeartbeatOutcome,
  ProvisionOutcome,
  TeardownOutcome,
  TransferOutcome,
} from "@arena/capsule";
import {
  probeIsolationEnvironment,
  type IsolationEnvironmentReport,
} from "./capability.js";
import type { IsolationMode } from "./evidence.js";
import {
  runIsolationExecution,
  type IsolationExecutionOutcome,
  type IsolationExecutionRequest,
} from "./isolation-execution.js";
import type { ChildProcess } from "node:child_process";

/**
 * AR2-019 — Linux namespace isolation provider (bubblewrap runtime).
 *
 * Implements the engine-neutral CapsuleProviderPort behind the AR2-004 seam
 * with REAL OS-level isolation: unprivileged user + mount (pivot-root style
 * tmpfs root, read-only /usr) + PID + IPC + UTS + empty net (deny-by-default
 * egress) namespaces, a seccomp denylist (SIGSYS kill), tmpfs-only writable
 * scratch, rlimit ceilings and parent-enforced wall clock.
 *
 * Fail-closed policy (CAPSULE_FAIL_CLOSED_RULE):
 * - strict mode: provision fails unless the environment probes FULL_ISOLATION;
 * - auto mode: provision fails when isolation is NOT_SUPPORTED at all (no
 *   ENVIRONMENT_READY without recorded isolation assurance);
 * - a pinned bwrap path that disappears fails closed at execution time with
 *   the typed ISOLATION_NOT_SUPPORTED outcome — never a silent fallback.
 */

export interface IsolationProviderIdentity {
  provider_id: string;
  name: string;
  disclosure: string;
  /** Literal type: flipping requires release-gate evidence + recorded owner
   * decision (AR2-015 gate report / AR2-023 instrument). */
  production_enabled: false;
  engine: "bwrap";
}

export const ISOLATION_PROVIDER_IDENTITY: IsolationProviderIdentity = {
  provider_id: "prv_linux_namespace_bwrap",
  name: "arena-isolation LINUX NAMESPACE PROVIDER (bubblewrap)",
  disclosure:
    "LINUX NAMESPACE PROVIDER: executes capsule work inside user/mount/pid/ipc/uts/net " +
    "namespaces with a seccomp denylist, tmpfs-only writable scratch, rlimit ceilings and " +
    "deny-by-default network egress. Results are isolation evidence only when produced by " +
    "the strict-mode conformance battery on the release-gate station; production enablement " +
    "of untrusted execution still requires the recorded owner decision (CAPSULE_FAIL_CLOSED_RULE).",
  production_enabled: false,
  engine: "bwrap",
};

export interface IsolationProviderOptions {
  /** strict = require FULL capability (release-gate evidence runs);
   * auto = fail closed on NOT_SUPPORTED, accept PARTIAL (CI portability). */
  mode?: IsolationMode;
  /** Pinned bwrap binary; missing pinned binary fails closed (no PATH fallback). */
  bwrapPath?: string;
  prlimitPath?: string;
  /** Host directory bound read-only as the sandbox runtime tree. */
  hostUsrPath?: string;
  /** Root of tenant-scoped capsule workspaces. */
  workspaceRoot?: string;
  now?: () => Date;
  ledger?: ScopedCredentialLedger;
  registry?: CapsuleBindingRegistry;
  /** Dependency injection for tests / alternative probe sources. */
  probeEnvironment?: () => Promise<IsolationEnvironmentReport>;
}

export interface IsolationSessionEnvironment {
  mode: IsolationMode;
  environment: IsolationEnvironmentReport;
  assurance_basis: string;
}

interface IsolationSession {
  manifest: CapsuleManifest;
  ref: CapsuleRef;
  state: CapsuleRuntimeState;
  sessionDir: string;
  provisionedAtMs: number;
  expiresAtMs: number;
  lastHeartbeatAt: string | null;
  children: Set<ChildProcess>;
  environment: IsolationEnvironmentReport;
}

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

type SessionLookup =
  | { session: IsolationSession }
  | { refusal: { code: "ARENA_TENANT_MISMATCH" | "ARENA_CAPSULE_UNAVAILABLE"; detail: string } };

export class LinuxNamespaceIsolationProvider implements CapsuleProviderPort {
  readonly identity: IsolationProviderIdentity = ISOLATION_PROVIDER_IDENTITY;
  private readonly sessions = new Map<IsolationSession["ref"]["capsule_id"], IsolationSession>();
  private readonly mode: IsolationMode;
  private readonly now: () => Date;
  private readonly ledger: ScopedCredentialLedger;
  private readonly registry: CapsuleBindingRegistry;
  private readonly workspaceRoot: string;
  private readonly options: IsolationProviderOptions;
  private environmentCache: IsolationEnvironmentReport | null = null;

  constructor(options: IsolationProviderOptions = {}) {
    this.options = options;
    this.mode = options.mode ?? "auto";
    this.now = options.now ?? (() => new Date());
    this.ledger = options.ledger ?? new ScopedCredentialLedger(this.now);
    this.registry = options.registry ?? new CapsuleBindingRegistry();
    this.workspaceRoot = options.workspaceRoot ?? path.join(tmpdir(), "arena-isolation");
  }

  async provision(manifest: CapsuleManifest): Promise<ProvisionOutcome> {
    // 失败关闭：入口重校验（类型不代表运行时已通过 gate）。
    const check = checkCapsuleManifest(manifest);
    if (check.kind === "INVALID") {
      return { kind: "REJECTED", code: "ARENA_CAPSULE_MANIFEST_INVALID", issues: check.issues };
    }
    const valid = check.manifest;
    if (valid.assurance.isolation_class !== "container") {
      return {
        kind: "PROVISION_FAILED",
        reason:
          `ARENA_ISOLATION_CLASS_NOT_PROVIDED: this runtime provides container-class ` +
          `isolation (Linux namespaces); manifest declares ${valid.assurance.isolation_class}`,
      };
    }
    const environment = await this.ensureEnvironment();
    if (environment.capability === "NOT_SUPPORTED") {
      return {
        kind: "PROVISION_FAILED",
        reason:
          `ARENA_ISOLATION_NOT_SUPPORTED (mode=${this.mode}): ` +
          environment.limitations.join("; "),
      };
    }
    if (this.mode === "strict" && environment.capability !== "FULL_ISOLATION") {
      return {
        kind: "PROVISION_FAILED",
        reason:
          `ARENA_ISOLATION_NOT_SUPPORTED (strict mode requires FULL_ISOLATION): ` +
          environment.limitations.join("; "),
      };
    }
    const sessionDir = path.join(
      this.workspaceRoot,
      `tenant-${valid.tenant_id}`,
      `cap-${valid.capsule_id}`,
    );
    try {
      await mkdir(path.join(sessionDir, "inputs"), { recursive: true });
      await mkdir(path.join(sessionDir, "artifacts"), { recursive: true });
      await mkdir(path.join(sessionDir, "outbox"), { recursive: true });
    } catch (error) {
      return { kind: "PROVISION_FAILED", reason: `workspace provisioning failed: ${String(error)}` };
    }
    const provisionedAtMs = this.now().getTime();
    const session: IsolationSession = {
      manifest: valid,
      ref: {
        capsule_id: valid.capsule_id,
        tenant_id: valid.tenant_id,
        escalation_id: valid.escalation_id,
        attempt_id: valid.attempt_id,
      },
      state: "ENVIRONMENT_READY",
      sessionDir,
      provisionedAtMs,
      expiresAtMs: provisionedAtMs + valid.resource_policy.max_duration_seconds * 1000,
      lastHeartbeatAt: null,
      children: new Set(),
      environment,
    };
    for (const spec of valid.credentials) {
      const outcome = this.ledger.issue(spec, valid.resource_policy.max_duration_seconds);
      if (outcome.kind !== "ISSUED") {
        await rm(sessionDir, { recursive: true, force: true });
        return { kind: "PROVISION_FAILED", reason: "scoped credential issuance failed" };
      }
    }
    this.registry.register(bindingOfManifest(valid));
    this.sessions.set(session.ref.capsule_id, session);
    return { kind: "PROVISIONED", snapshot: this.snapshotOf(session) };
  }

  async heartbeat(ref: CapsuleRef): Promise<HeartbeatOutcome> {
    const found = this.sessionFor(ref);
    if ("refusal" in found) {
      return { kind: "REFUSED", ...found.refusal };
    }
    const session = found.session;
    if (this.terminatedOrExpired(session)) {
      return { kind: "REFUSED", code: "ARENA_CAPSULE_UNAVAILABLE", detail: "capsule no longer live" };
    }
    session.lastHeartbeatAt = iso(this.now().getTime());
    return { kind: "BEAT", snapshot: this.snapshotOf(session) };
  }

  async transferArtifact(
    ref: CapsuleRef,
    request: ArtifactTransferRequest,
  ): Promise<TransferOutcome> {
    const found = this.sessionFor(ref);
    if ("refusal" in found) {
      return { kind: "REFUSED", ...found.refusal };
    }
    const session = found.session;
    if (this.terminatedOrExpired(session)) {
      return { kind: "REFUSED", code: "ARENA_CAPSULE_UNAVAILABLE", detail: "capsule no longer live" };
    }
    if (
      request.artifact_id.includes("/") ||
      request.artifact_id.includes("\\") ||
      request.artifact_id.includes("..")
    ) {
      return {
        kind: "REFUSED",
        code: "ARENA_CAPSULE_MANIFEST_INVALID",
        detail: "artifact_id must be a flat id (arena id shape)",
      };
    }
    const cap = session.manifest.artifact_transfer.max_artifact_bytes;
    if (request.size_bytes > cap) {
      return { kind: "OVERSIZE", max_artifact_bytes: cap, size_bytes: request.size_bytes };
    }
    const targetDir = path.join(
      session.sessionDir,
      request.direction === "pull_only" ? "artifacts" : "outbox",
    );
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, request.artifact_id), Buffer.alloc(request.size_bytes));
    return { kind: "TRANSFERRED", artifact_id: request.artifact_id, size_bytes: request.size_bytes };
  }

  async teardown(ref: CapsuleRef): Promise<TeardownOutcome> {
    const found = this.sessionFor(ref);
    if ("refusal" in found) {
      return { kind: "REFUSED", ...found.refusal };
    }
    const session = found.session;
    if (session.state === "TERMINATED") {
      return { kind: "REFUSED", code: "ARENA_CAPSULE_UNAVAILABLE", detail: "capsule already terminated" };
    }
    if (capsuleLifecycleAllows(session.state, "TEARDOWN_REQUESTED")) {
      session.state = "TEARDOWN_REQUESTED";
    }
    for (const child of session.children) {
      if (child.exitCode === null && !child.killed) {
        if (child.pid !== undefined) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        } else {
          child.kill("SIGKILL");
        }
      }
    }
    const unrevoked = this.ledger.revokeAllForManifest(session.manifest);
    if (unrevoked.length > 0) {
      return {
        kind: "TEARDOWN_FAILED",
        code: "ARENA_CAPSULE_TEARDOWN_FAILED",
        detail: "credential revocation incomplete; workspace retained as evidence",
        unrevoked,
      };
    }
    await rm(session.sessionDir, { recursive: true, force: true });
    this.registry.release(session.ref.capsule_id);
    session.state = "TERMINATED";
    return {
      kind: "TORN_DOWN",
      revoked_credentials: session.manifest.credentials.map((c) => c.credential_id),
      verified: true,
    };
  }

  /** Provider execution surface (mirrors the synthetic provider's shape). */
  async executeCommand(
    ref: CapsuleRef,
    request: IsolationExecutionRequest,
  ): Promise<IsolationExecutionOutcome> {
    const found = this.sessionFor(ref);
    if ("refusal" in found) {
      return { kind: "REFUSED", ...found.refusal };
    }
    const session = found.session;
    return await runIsolationExecution(
      {
        manifest: session.manifest,
        ref: session.ref,
        sessionDir: session.sessionDir,
        workspaceRoot: this.workspaceRoot,
        environment: session.environment,
        expiresAtMs: session.expiresAtMs,
        now: this.now,
        hostUsrPath: this.options.hostUsrPath ?? "/usr",
        registerChild: (child) => {
          session.children.add(child);
        },
        unregisterChild: (child) => {
          session.children.delete(child);
        },
      },
      request,
      { bwrapPath: this.resolveBwrap(), prlimitPath: this.resolvePrlimit() },
    );
  }

  /** Snapshot query (binding validation identical to port operations). */
  async snapshot(ref: CapsuleRef): Promise<CapsuleSnapshot | { kind: "REFUSED"; code: "ARENA_TENANT_MISMATCH" | "ARENA_CAPSULE_UNAVAILABLE"; detail: string }> {
    const found = this.sessionFor(ref);
    if ("refusal" in found) {
      return { kind: "REFUSED", ...found.refusal };
    }
    return this.snapshotOf(found.session);
  }

  /** Inspectable per-session environment evidence (battery input). */
  async sessionEnvironmentReport(
    ref: CapsuleRef,
  ): Promise<IsolationSessionEnvironment | { kind: "REFUSED"; code: "ARENA_TENANT_MISMATCH" | "ARENA_CAPSULE_UNAVAILABLE"; detail: string }> {
    const found = this.sessionFor(ref);
    if ("refusal" in found) {
      return { kind: "REFUSED", ...found.refusal };
    }
    const environment = found.session.environment;
    return {
      mode: this.mode,
      environment,
      assurance_basis:
        environment.userns_empirically_available === true
          ? `real namespaces verified by unprivileged bwrap exec probes (${environment.procfs_strategy}); capability=${environment.capability}`
          : "no isolation assurance recorded",
    };
  }

  /** Last probed environment (strict-mode failure evidence for the report). */
  lastEnvironmentReport(): IsolationEnvironmentReport | null {
    return this.environmentCache;
  }

  private snapshotOf(session: IsolationSession): CapsuleSnapshot {
    return {
      ref: session.ref,
      state: session.state,
      assurance_recorded: session.environment.userns_empirically_available === true,
      provisioned_at: iso(session.provisionedAtMs),
      last_heartbeat_at: session.lastHeartbeatAt,
    };
  }

  private async ensureEnvironment(): Promise<IsolationEnvironmentReport> {
    if (this.environmentCache === null) {
      const probe =
        this.options.probeEnvironment ??
        (() =>
          probeIsolationEnvironment({
            bwrapPath: this.options.bwrapPath,
            prlimitPath: this.options.prlimitPath,
          }));
      this.environmentCache = await probe();
    }
    return this.environmentCache;
  }

  /** Pinned path fails closed; only unpinned setups fall back to discovery. */
  private resolveBwrap(): string | null {
    const pinned = this.options.bwrapPath ?? process.env.ARENA_ISOLATION_BWRAP_PATH ?? undefined;
    if (pinned !== undefined) {
      return executableOrNull(pinned);
    }
    return scanPathFor("bwrap");
  }

  private resolvePrlimit(): string | null {
    const pinned = this.options.prlimitPath ?? process.env.ARENA_ISOLATION_PRLIMIT_PATH ?? undefined;
    if (pinned !== undefined) {
      return executableOrNull(pinned);
    }
    return scanPathFor("prlimit");
  }

  private sessionFor(ref: CapsuleRef): SessionLookup {
    const check = this.registry.check({ ...ref });
    if (check.kind === "REFUSED") {
      return { refusal: { code: check.code, detail: check.detail } };
    }
    const session = this.sessions.get(ref.capsule_id);
    if (session === undefined) {
      return {
        refusal: { code: "ARENA_CAPSULE_UNAVAILABLE", detail: "capsule not visible in tenant scope" },
      };
    }
    return { session };
  }

  private terminatedOrExpired(session: IsolationSession): boolean {
    return capsuleLifecycleIsTerminal(session.state) || this.now().getTime() >= session.expiresAtMs;
  }
}

function executableOrNull(candidate: string): string | null {
  try {
    accessSync(candidate, constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

function scanPathFor(name: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(":").filter(Boolean)) {
    const candidate = `${dir}/${name}`;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}
