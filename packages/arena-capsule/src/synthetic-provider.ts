import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CapsuleManifest } from "@arena/contracts";
import {
  type CapsuleProviderPort,
  type CapsuleRef,
  type CapsuleRuntimeState,
  type CapsuleSnapshot,
  type ProvisionOutcome,
  type HeartbeatOutcome,
  type TransferOutcome,
  type TeardownOutcome,
  type ArtifactTransferRequest,
} from "./provider-port.js";
import { bindingOfManifest, CapsuleBindingRegistry } from "./tenant-binding.js";
import { ScopedCredentialLedger } from "./credentials.js";
import { checkCapsuleManifest } from "./manifest-validation.js";
import { capsuleLifecycleAllows, capsuleLifecycleIsTerminal } from "./lifecycle.js";
import type { CommandExecutionRequest, ExecuteOutcome } from "./execution.js";
import {
  SYNTHETIC_PROVIDER_IDENTITY as IDENTITY,
  type CapsuleProviderIdentity,
} from "./execution.js";

export { PRODUCTION_ENABLED } from "./execution.js";
export type { CommandExecutionRequest, ExecuteOutcome } from "./execution.js";

/**
 * AR2-004 slice 2 — SYNTHETIC LOCAL PROVIDER（验收场景 4/6）。
 * 进程/工作区级模拟：不做任何系统隔离声明（上游 runtime 不是边界，
 * UPSTREAM_RUNTIME_NOT_A_BOUNDARY_RULE）；其结果对生产批准是 NON-EVIDENCE
 * （见 docs/conformance-suite-design.md 的证据分类）。
 *
 * 实际强制执行（可负路径证明）：
 * - permitted_actions.command_allowlist（命令不在 allowlist = 拒绝执行）
 * - resource_policy.max_duration_seconds（会话时长上限 + 子进程剩余时间熔断）
 * - artifact_transfer.max_artifact_bytes（工件超限 = OVERSIZE）
 * 不强制（声明但非证据）：egress 网络边界、OS 级隔离 —— 属于真实 provider
 * 的一致性套件范围。生产旗标/身份披露见 execution.ts（PRODUCTION_ENABLED
 * 为 false 字面量类型，不可翻转）。
 */

/** 依赖注入（测试与复用：时钟、台账、绑定注册表、工作区根）。 */
export interface SyntheticProviderOptions {
  now?: () => Date;
  ledger?: ScopedCredentialLedger;
  registry?: CapsuleBindingRegistry;
  workspaceRoot?: string;
}

/** stdout/stderr 捕获上限（合成面不承诺大输出吞吐）。 */
const IO_CAPTURE_LIMIT_BYTES = 65536;
/** 工件物化上限：超界部分只记录声明大小，不真实落盘。 */
const ARTIFACT_MATERIALIZATION_LIMIT_BYTES = 1048576;

interface CapsuleSession {
  manifest: CapsuleManifest;
  ref: CapsuleRef;
  state: CapsuleRuntimeState;
  workspaceDir: string;
  provisionedAtMs: number;
  expiresAtMs: number;
  lastHeartbeatAt: string | null;
  children: Set<ChildProcess>;
}

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** 绑定查找结果：会话，或保留类型化拒绝码的绑定拒绝。 */
type SessionLookup =
  | { session: CapsuleSession }
  | { refusal: { code: "ARENA_TENANT_MISMATCH" | "ARENA_CAPSULE_UNAVAILABLE"; detail: string } };

/**
 * 合成本地 provider —— CapsuleProviderPort 的参考实现（非生产）。
 * 公开方法：port 4 个（provision/heartbeat/transferArtifact/teardown）+
 * provider 扩展 2 个（executeCommand/snapshot）+ 只读身份 1 个。
 */
export class SyntheticLocalProvider implements CapsuleProviderPort {
  readonly identity: CapsuleProviderIdentity = IDENTITY;
  private readonly sessions = new Map<CapsuleSession["ref"]["capsule_id"], CapsuleSession>();
  private readonly now: () => Date;
  private readonly ledger: ScopedCredentialLedger;
  private readonly registry: CapsuleBindingRegistry;
  private readonly workspaceRoot: string;

  constructor(options: SyntheticProviderOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.ledger = options.ledger ?? new ScopedCredentialLedger(this.now);
    this.registry = options.registry ?? new CapsuleBindingRegistry();
    this.workspaceRoot = options.workspaceRoot ?? tmpdir();
  }

  async provision(manifest: CapsuleManifest): Promise<ProvisionOutcome> {
    // 失败关闭：入口重校验（类型不代表运行时已通过 gate）。
    const check = checkCapsuleManifest(manifest);
    if (check.kind === "INVALID") {
      return { kind: "REJECTED", code: "ARENA_CAPSULE_MANIFEST_INVALID", issues: check.issues };
    }
    const valid = check.manifest;
    let workspaceDir: string;
    try {
      workspaceDir = await mkdtemp(path.join(this.workspaceRoot, "arena-capsule-synthetic-"));
    } catch (error) {
      return {
        kind: "PROVISION_FAILED",
        reason: `workspace provisioning failed: ${String(error)}`,
      };
    }
    const provisionedAtMs = this.now().getTime();
    const session: CapsuleSession = {
      manifest: valid,
      ref: {
        capsule_id: valid.capsule_id,
        tenant_id: valid.tenant_id,
        escalation_id: valid.escalation_id,
        attempt_id: valid.attempt_id,
      },
      // PROVISIONING 仅存在于供给事务内部；manifest+assurance 已记录 → READY。
      state: "ENVIRONMENT_READY",
      workspaceDir,
      provisionedAtMs,
      expiresAtMs: provisionedAtMs + valid.resource_policy.max_duration_seconds * 1000,
      lastHeartbeatAt: null,
      children: new Set(),
    };
    // 凭证寿命不得长于会话（manifest ceiling = 会话时长上限）。
    for (const spec of valid.credentials) {
      const outcome = this.ledger.issue(spec, valid.resource_policy.max_duration_seconds);
      if (outcome.kind !== "ISSUED") {
        await rm(workspaceDir, { recursive: true, force: true });
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
      return {
        kind: "REFUSED",
        code: "ARENA_CAPSULE_UNAVAILABLE",
        detail: "capsule no longer live",
      };
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
      return {
        kind: "REFUSED",
        code: "ARENA_CAPSULE_UNAVAILABLE",
        detail: "capsule no longer live",
      };
    }
    // 扁平 id 防护：请求侧字段不经 manifest gate，必须运行时重验（防路径注入）。
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
    // 方向语义：pull_only 落在 artifacts/（capsule 拉入），push_scoped 落在 outbox/（capsule 推出）。
    const targetDir = path.join(
      session.workspaceDir,
      request.direction === "pull_only" ? "artifacts" : "outbox",
    );
    await mkdir(targetDir, { recursive: true });
    const materialized = Math.min(request.size_bytes, ARTIFACT_MATERIALIZATION_LIMIT_BYTES);
    await writeFile(path.join(targetDir, request.artifact_id), Buffer.alloc(materialized));
    return {
      kind: "TRANSFERRED",
      artifact_id: request.artifact_id,
      size_bytes: request.size_bytes,
    };
  }

  /** 验收场景 6：allowlist / 时长上限 / 子进程工作区的真实强制执行。 */
  async executeCommand(ref: CapsuleRef, request: CommandExecutionRequest): Promise<ExecuteOutcome> {
    const found = this.sessionFor(ref);
    if ("refusal" in found) {
      return { kind: "REFUSED", ...found.refusal };
    }
    const session = found.session;
    // 时长上限以类型化 SESSION_DURATION_EXCEEDED 拒绝（比 UNAVAILABLE 更精确的拒绝理由）。
    const elapsedSeconds = (this.now().getTime() - session.provisionedAtMs) / 1000;
    if (this.now().getTime() >= session.expiresAtMs) {
      return {
        kind: "SESSION_DURATION_EXCEEDED",
        max_duration_seconds: session.manifest.resource_policy.max_duration_seconds,
        elapsed_seconds: Math.floor(elapsedSeconds),
      };
    }
    const action = session.manifest.permitted_actions.find(
      (a) => a.action_id === request.action_id,
    );
    if (action === undefined || request.command.length === 0) {
      return {
        kind: "COMMAND_NOT_ALLOWLISTED",
        action_id: request.action_id,
        attempted_command: request.command.join(" ") || "(empty)",
        allowlist: action?.command_allowlist ?? [],
      };
    }
    const attempted = request.command[0] ?? "";
    if (!action.command_allowlist.includes(attempted)) {
      return {
        kind: "COMMAND_NOT_ALLOWLISTED",
        action_id: request.action_id,
        attempted_command: request.command.join(" "),
        allowlist: action.command_allowlist,
      };
    }
    const startedAtMs = this.now().getTime();
    const remainingMs = Math.max(1, session.expiresAtMs - startedAtMs);
    return await this.spawnInWorkspace(session, request.command, remainingMs);
  }

  async teardown(ref: CapsuleRef): Promise<TeardownOutcome> {
    const found = this.sessionFor(ref);
    if ("refusal" in found) {
      return { kind: "REFUSED", ...found.refusal };
    }
    const session = found.session;
    if (session.state === "TERMINATED") {
      return {
        kind: "REFUSED",
        code: "ARENA_CAPSULE_UNAVAILABLE",
        detail: "capsule already terminated",
      };
    }
    if (capsuleLifecycleAllows(session.state, "TEARDOWN_REQUESTED")) {
      session.state = "TEARDOWN_REQUESTED";
    }
    // 杀掉存活子进程（合成面的拆除保证：不留 guest 进程）。
    for (const child of session.children) {
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGKILL");
      }
    }
    const unrevoked = this.ledger.revokeAllForManifest(session.manifest);
    if (unrevoked.length > 0) {
      // 失败关闭：工作区保留为证据，绑定不释放，可重试拆除。
      return {
        kind: "TEARDOWN_FAILED",
        code: "ARENA_CAPSULE_TEARDOWN_FAILED",
        detail: "credential revocation incomplete; workspace retained as evidence",
        unrevoked,
      };
    }
    await rm(session.workspaceDir, { recursive: true, force: true });
    this.registry.release(session.ref.capsule_id);
    session.state = "TERMINATED";
    return {
      kind: "TORN_DOWN",
      revoked_credentials: session.manifest.credentials.map((c) => c.credential_id),
      verified: true,
    };
  }

  /** 快照查询（binding 校验同 port 操作）。 */
  async snapshot(ref: CapsuleRef): Promise<
    | CapsuleSnapshot
    | {
        kind: "REFUSED";
        code: "ARENA_TENANT_MISMATCH" | "ARENA_CAPSULE_UNAVAILABLE";
        detail: string;
      }
  > {
    const found = this.sessionFor(ref);
    if ("refusal" in found) {
      return { kind: "REFUSED", ...found.refusal };
    }
    return this.snapshotOf(found.session);
  }

  private snapshotOf(session: CapsuleSession): CapsuleSnapshot {
    return {
      ref: session.ref,
      state: session.state,
      assurance_recorded: true,
      provisioned_at: iso(session.provisionedAtMs),
      last_heartbeat_at: session.lastHeartbeatAt,
    };
  }

  /** 绑定 + 会话查找：保留类型化拒绝码（跨租户 UNAVAILABLE / 聚合失配 TENANT_MISMATCH）。 */
  private sessionFor(ref: CapsuleRef): SessionLookup {
    const check = this.registry.check({ ...ref });
    if (check.kind === "REFUSED") {
      return { refusal: { code: check.code, detail: check.detail } };
    }
    const session = this.sessions.get(ref.capsule_id);
    if (session === undefined) {
      return {
        refusal: {
          code: "ARENA_CAPSULE_UNAVAILABLE",
          detail: "capsule not visible in tenant scope",
        },
      };
    }
    return { session };
  }

  private terminatedOrExpired(session: CapsuleSession): boolean {
    return capsuleLifecycleIsTerminal(session.state) || this.now().getTime() >= session.expiresAtMs;
  }

  private spawnInWorkspace(
    session: CapsuleSession,
    command: readonly string[],
    timeoutMs: number,
  ): Promise<ExecuteOutcome> {
    return new Promise((resolve) => {
      const startedWallMs = Date.now();
      // 只给最小环境：不透传宿主环境（合成面的额外硬化，非隔离声明）。
      const child = spawn(command[0] ?? "", command.slice(1), {
        cwd: session.workspaceDir,
        env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin" },
      });
      session.children.add(child);
      let timedOut = false;
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      timer.unref?.();
      const capture = (current: string, chunk: Buffer): string =>
        (current + chunk.toString("utf8")).slice(0, IO_CAPTURE_LIMIT_BYTES);
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout = capture(stdout, chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = capture(stderr, chunk);
      });
      child.on("close", (exitCode, signal) => {
        clearTimeout(timer);
        session.children.delete(child);
        if (timedOut) {
          resolve({ kind: "EXEC_TIMEOUT", timeout_ms: timeoutMs, partial_stdout: stdout });
          return;
        }
        resolve({
          kind: "EXECUTED",
          exit_code: exitCode,
          killed: signal !== null,
          stdout,
          stderr,
          duration_ms: Date.now() - startedWallMs,
        });
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        session.children.delete(child);
        resolve({
          kind: "EXECUTED",
          exit_code: null,
          killed: false,
          stdout,
          stderr: `${stderr}${String(error)}`,
          duration_ms: 0,
        });
      });
    });
  }
}
