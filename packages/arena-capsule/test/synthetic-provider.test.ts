import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CAPSULE_LIFECYCLE_TRANSITIONS,
  CAPSULE_SYNTHETIC_PROVIDER_DISCLOSURE,
  PRODUCTION_ENABLED,
  ScopedCredentialLedger,
  SyntheticLocalProvider,
  capsuleLifecycleAllows,
  capsuleLifecycleIsTerminal,
} from "../src/contract.js";
import type { CapsuleManifest } from "@arena/contracts";

/**
 * AR2-004 slice 2 验收测试（验收场景 4/5/6）：
 * - 生命周期状态机（显式迁移表、终态、不可跳过拆除）
 * - 合成 provider：供给失败关闭、allowlist/时长/工件上限真实强制执行
 * - 已验证拆除：吊销+验证、工作区清理、失败保留证据
 * - NON-PRODUCTION 披露与不可翻转的生产旗标
 */

const HEX64 = "ab".repeat(32);

function validManifest(overrides: Record<string, unknown> = {}): CapsuleManifest {
  return {
    manifest_id: "csm_00000002",
    capsule_id: "cap_00000002",
    manifest_version: 1,
    tenant_id: "tnt_00000001",
    escalation_id: "esc_00000001",
    attempt_id: "att_00000001",
    environment: {
      environment_ref: "env://node-24@2026-10-01",
      toolchain_pins: ["node 24.14.0"],
      workspace_init: "pnpm install --frozen-lockfile",
    },
    permitted_actions: [
      {
        action_id: "act_00000001",
        tool: "shell",
        scope: "workspace root only",
        command_allowlist: ["node"],
      },
    ],
    resource_policy: {
      cpu_limit: 2,
      memory_limit_mb: 3072,
      disk_limit_mb: 20480,
      max_duration_seconds: 7200,
    },
    egress_policy: {
      denied_default: true,
      allowed_hosts: ["registry.npmjs.org"],
      allow_ingress: false,
    },
    credentials: [
      {
        credential_id: "crd_00000002",
        scope: "artifact-pull:attempt-2",
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
      isolation_class: "process",
      conformance_suite_digest: HEX64,
      conformance_suite_version: "1.0.0",
      verified_at: "2026-10-09T18:00:00Z",
      provider_id: "prv_00000001",
    },
    artifact_transfer: { transfer: "pull_only", max_artifact_bytes: 4096 },
    content_digest: HEX64,
    ...overrides,
  } as CapsuleManifest;
}

async function freshRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "capsule-test-root-"));
}

function onlyDir(root: string): Promise<string> {
  return readdir(root).then((entries) => {
    assert.equal(entries.length, 1, `expected exactly one workspace, got ${entries.join(",")}`);
    return entries[0] as string;
  });
}

test("lifecycle: explicit transition table — no skip over teardown, TERMINATED is terminal", () => {
  assert.deepEqual(CAPSULE_LIFECYCLE_TRANSITIONS.PROVISIONING, ["ENVIRONMENT_READY"]);
  assert.deepEqual(CAPSULE_LIFECYCLE_TRANSITIONS.ENVIRONMENT_READY, ["TEARDOWN_REQUESTED"]);
  assert.deepEqual(CAPSULE_LIFECYCLE_TRANSITIONS.TEARDOWN_REQUESTED, ["TERMINATED"]);
  assert.deepEqual(CAPSULE_LIFECYCLE_TRANSITIONS.TERMINATED, []);
  assert.equal(capsuleLifecycleAllows("PROVISIONING", "ENVIRONMENT_READY"), true);
  assert.equal(capsuleLifecycleAllows("PROVISIONING", "TERMINATED"), false);
  assert.equal(capsuleLifecycleAllows("ENVIRONMENT_READY", "TERMINATED"), false);
  assert.equal(capsuleLifecycleAllows("TERMINATED", "PROVISIONING"), false);
  assert.equal(capsuleLifecycleIsTerminal("TERMINATED"), true);
  assert.equal(capsuleLifecycleIsTerminal("ENVIRONMENT_READY"), false);
});

test("scenario 4: provision reaches ENVIRONMENT_READY with assurance recorded and a real workspace", async () => {
  const root = await freshRoot();
  const provider = new SyntheticLocalProvider({ workspaceRoot: root });
  const outcome = await provider.provision(validManifest());
  assert.equal(outcome.kind, "PROVISIONED");
  if (outcome.kind === "PROVISIONED") {
    assert.equal(outcome.snapshot.state, "ENVIRONMENT_READY");
    assert.equal(outcome.snapshot.assurance_recorded, true);
    assert.equal(outcome.snapshot.ref.capsule_id, "cap_00000002");
  }
  const dir = await onlyDir(root);
  assert.ok(dir.startsWith("arena-capsule-synthetic-"));
  await rm(root, { recursive: true, force: true });
});

test("scenario 4: invalid manifest (isolation none) is REJECTED with zero filesystem side effects", async () => {
  const root = await freshRoot();
  const provider = new SyntheticLocalProvider({ workspaceRoot: root });
  const bad = validManifest({
    assurance: {
      isolation_class: "none",
      conformance_suite_digest: HEX64,
      conformance_suite_version: "1.0.0",
      verified_at: "2026-10-09T18:00:00Z",
      provider_id: "prv_00000001",
    },
  });
  const outcome = await provider.provision(bad);
  assert.equal(outcome.kind, "REJECTED");
  if (outcome.kind === "REJECTED") {
    assert.equal(outcome.code, "ARENA_CAPSULE_MANIFEST_INVALID");
    assert.ok(outcome.issues.length > 0);
  }
  assert.deepEqual(await readdir(root), [], "fail-closed gate must not create workspace state");
  await rm(root, { recursive: true, force: true });
});

test("scenario 4: broken workspace root yields typed PROVISION_FAILED", async () => {
  const provider = new SyntheticLocalProvider({
    workspaceRoot: path.join(tmpdir(), "capsule-root-does-not-exist-xyz"),
  });
  const outcome = await provider.provision(validManifest());
  assert.equal(outcome.kind, "PROVISION_FAILED");
});

test("scenario 6: allowlisted command executes in the subprocess workspace", async () => {
  const root = await freshRoot();
  const provider = new SyntheticLocalProvider({ workspaceRoot: root });
  const provisioned = await provider.provision(validManifest());
  assert.equal(provisioned.kind, "PROVISIONED");
  if (provisioned.kind !== "PROVISIONED") {
    return;
  }
  const ref = provisioned.snapshot.ref;
  const outcome = await provider.executeCommand(ref, {
    action_id: "act_00000001",
    command: ["node", "-e", "require('node:fs').writeFileSync('marker.txt','ok')"],
  });
  assert.equal(outcome.kind, "EXECUTED");
  if (outcome.kind === "EXECUTED") {
    assert.equal(outcome.exit_code, 0);
    assert.equal(outcome.killed, false);
  }
  const dir = await onlyDir(root);
  assert.equal(await readFile(path.join(root, dir, "marker.txt"), "utf8"), "ok");
  await rm(root, { recursive: true, force: true });
});

test("scenario 6: non-allowlisted command is refused and never executed", async () => {
  const root = await freshRoot();
  const provider = new SyntheticLocalProvider({ workspaceRoot: root });
  const provisioned = await provider.provision(validManifest());
  if (provisioned.kind !== "PROVISIONED") {
    assert.fail("provision must succeed");
  }
  const ref = provisioned.snapshot.ref;
  const outcome = await provider.executeCommand(ref, {
    action_id: "act_00000001",
    command: ["rm", "-rf", "/"],
  });
  assert.equal(outcome.kind, "COMMAND_NOT_ALLOWLISTED");
  if (outcome.kind === "COMMAND_NOT_ALLOWLISTED") {
    assert.equal(outcome.attempted_command, "rm -rf /");
    assert.deepEqual(outcome.allowlist, ["node"]);
  }
  const dir = await onlyDir(root);
  assert.deepEqual(await readdir(path.join(root, dir)), [], "refused command must leave no trace");
  await rm(root, { recursive: true, force: true });
});

test("scenario 6: unknown action_id is refused (not allowlisted)", async () => {
  const root = await freshRoot();
  const provider = new SyntheticLocalProvider({ workspaceRoot: root });
  const provisioned = await provider.provision(validManifest());
  if (provisioned.kind !== "PROVISIONED") {
    assert.fail("provision must succeed");
  }
  const outcome = await provider.executeCommand(provisioned.snapshot.ref, {
    action_id: "act_99999999",
    command: ["node", "-v"],
  });
  assert.equal(outcome.kind, "COMMAND_NOT_ALLOWLISTED");
  await rm(root, { recursive: true, force: true });
});

test("scenario 6: session duration cap refuses execution past max_duration_seconds", async () => {
  const root = await freshRoot();
  const start = new Date("2026-10-10T08:00:00Z");
  let fakeNow = start;
  const provider = new SyntheticLocalProvider({ workspaceRoot: root, now: () => fakeNow });
  const provisioned = await provider.provision(validManifest());
  assert.equal(provisioned.kind, "PROVISIONED");
  // 推进时钟 7201s > max_duration_seconds=7200 → 类型化拒绝。
  fakeNow = new Date(start.getTime() + 7201_000);
  const outcome = await provider.executeCommand(provisioned.snapshot!.ref, {
    action_id: "act_00000001",
    command: ["node", "-v"],
  });
  assert.equal(outcome.kind, "SESSION_DURATION_EXCEEDED");
  if (outcome.kind === "SESSION_DURATION_EXCEEDED") {
    assert.equal(outcome.max_duration_seconds, 7200);
    assert.equal(outcome.elapsed_seconds, 7201);
  }
  await rm(root, { recursive: true, force: true });
});

test("scenario 6: long-running command is killed at the remaining session budget (EXEC_TIMEOUT)", async () => {
  const root = await freshRoot();
  const provider = new SyntheticLocalProvider({ workspaceRoot: root });
  const provisioned = await provider.provision(
    validManifest({
      resource_policy: {
        cpu_limit: 2,
        memory_limit_mb: 3072,
        disk_limit_mb: 20480,
        max_duration_seconds: 1,
      },
    }),
  );
  assert.equal(provisioned.kind, "PROVISIONED");
  if (provisioned.kind !== "PROVISIONED") {
    return;
  }
  const outcome = await provider.executeCommand(provisioned.snapshot.ref, {
    action_id: "act_00000001",
    command: ["node", "-e", "console.log('alive'); setTimeout(() => {}, 60000)"],
  });
  assert.equal(outcome.kind, "EXEC_TIMEOUT");
  if (outcome.kind === "EXEC_TIMEOUT") {
    assert.ok(outcome.partial_stdout.includes("alive"));
    assert.ok(outcome.timeout_ms <= 1000);
  }
  await rm(root, { recursive: true, force: true });
});

test("scenario 2: tenant binding — cross-tenant indistinguishable, aggregate mismatch typed", async () => {
  const root = await freshRoot();
  const provider = new SyntheticLocalProvider({ workspaceRoot: root });
  const provisioned = await provider.provision(validManifest());
  if (provisioned.kind !== "PROVISIONED") {
    assert.fail("provision must succeed");
  }
  const ref = provisioned.snapshot.ref;
  const crossTenant = await provider.executeCommand(
    { ...ref, tenant_id: "tnt_000099" },
    { action_id: "act_00000001", command: ["node", "-v"] },
  );
  assert.equal(crossTenant.kind, "REFUSED");
  if (crossTenant.kind === "REFUSED") {
    assert.equal(crossTenant.code, "ARENA_CAPSULE_UNAVAILABLE");
  }
  const crossEscalation = await provider.executeCommand(
    { ...ref, escalation_id: "esc_000099" },
    { action_id: "act_00000001", command: ["node", "-v"] },
  );
  assert.equal(crossEscalation.kind, "REFUSED");
  if (crossEscalation.kind === "REFUSED") {
    assert.equal(crossEscalation.code, "ARENA_TENANT_MISMATCH");
  }
  await rm(root, { recursive: true, force: true });
});

test("scenario 1: heartbeat beats while live, records last_heartbeat_at", async () => {
  const root = await freshRoot();
  const provider = new SyntheticLocalProvider({ workspaceRoot: root });
  const provisioned = await provider.provision(validManifest());
  if (provisioned.kind !== "PROVISIONED") {
    assert.fail("provision must succeed");
  }
  const beat = await provider.heartbeat(provisioned.snapshot.ref);
  assert.equal(beat.kind, "BEAT");
  if (beat.kind === "BEAT") {
    assert.ok(beat.snapshot.last_heartbeat_at !== null);
  }
  await rm(root, { recursive: true, force: true });
});

test("scenario 1: artifact transfer within cap lands in the workspace; oversize is typed OVERSIZE", async () => {
  const root = await freshRoot();
  const provider = new SyntheticLocalProvider({ workspaceRoot: root });
  const provisioned = await provider.provision(validManifest());
  if (provisioned.kind !== "PROVISIONED") {
    assert.fail("provision must succeed");
  }
  const ref = provisioned.snapshot.ref;
  const ok = await provider.transferArtifact(ref, {
    direction: "pull_only",
    artifact_id: "art_00000001",
    content_digest: HEX64,
    size_bytes: 512,
  });
  assert.equal(ok.kind, "TRANSFERRED");
  const dir = await onlyDir(root);
  const artifact = await stat(path.join(root, dir, "artifacts", "art_00000001"));
  assert.equal(artifact.size, 512);
  const oversize = await provider.transferArtifact(ref, {
    direction: "pull_only",
    artifact_id: "art_00000002",
    content_digest: HEX64,
    size_bytes: 8192,
  });
  assert.equal(oversize.kind, "OVERSIZE");
  if (oversize.kind === "OVERSIZE") {
    assert.equal(oversize.max_artifact_bytes, 4096);
  }
  await rm(root, { recursive: true, force: true });
});

test("scenario 3+4: verified teardown revokes credentials, removes workspace, closes the capsule", async () => {
  const root = await freshRoot();
  const ledger = new ScopedCredentialLedger();
  const provider = new SyntheticLocalProvider({ workspaceRoot: root, ledger });
  const provisioned = await provider.provision(validManifest());
  if (provisioned.kind !== "PROVISIONED") {
    assert.fail("provision must succeed");
  }
  const ref = provisioned.snapshot.ref;
  const torn = await provider.teardown(ref);
  assert.equal(torn.kind, "TORN_DOWN");
  if (torn.kind === "TORN_DOWN") {
    assert.equal(torn.verified, true);
    assert.deepEqual(torn.revoked_credentials, ["crd_00000002"]);
  }
  assert.deepEqual(await readdir(root), [], "workspace must be removed on verified teardown");
  assert.equal(ledger.check("crd_00000002").kind, "REVOKED");
  const after = await provider.heartbeat(ref);
  assert.equal(after.kind, "REFUSED");
  const again = await provider.teardown(ref);
  assert.equal(again.kind, "REFUSED");
});

test("scenario 3: unrevoked credentials at teardown = TEARDOWN_FAILED, workspace retained as evidence", async () => {
  const root = await freshRoot();
  class SabotagedLedger extends ScopedCredentialLedger {
    revoke(): boolean {
      return false; // 吊销失败 → check() 保持 ACTIVE
    }
  }
  const provider = new SyntheticLocalProvider({
    workspaceRoot: root,
    ledger: new SabotagedLedger(),
  });
  const provisioned = await provider.provision(validManifest());
  if (provisioned.kind !== "PROVISIONED") {
    assert.fail("provision must succeed");
  }
  const torn = await provider.teardown(provisioned.snapshot.ref);
  assert.equal(torn.kind, "TEARDOWN_FAILED");
  if (torn.kind === "TEARDOWN_FAILED") {
    assert.equal(torn.code, "ARENA_CAPSULE_TEARDOWN_FAILED");
    assert.deepEqual(torn.unrevoked, ["crd_00000002"]);
  }
  // 失败关闭：工作区保留为证据。
  const dir = await onlyDir(root);
  assert.ok(dir.startsWith("arena-capsule-synthetic-"));
  await rm(root, { recursive: true, force: true });
});

test("scenario 3: credentials are clipped to the session bound (never outlive the capsule)", async () => {
  const root = await freshRoot();
  const ledger = new ScopedCredentialLedger();
  const provider = new SyntheticLocalProvider({ workspaceRoot: root, ledger });
  // ttl 3600s > max_duration 600s → 签发时被裁剪到 600s。
  const provisioned = await provider.provision(
    validManifest({
      resource_policy: {
        cpu_limit: 2,
        memory_limit_mb: 3072,
        disk_limit_mb: 20480,
        max_duration_seconds: 600,
      },
    }),
  );
  assert.equal(provisioned.kind, "PROVISIONED");
  const check = ledger.check("crd_00000002");
  assert.equal(check.kind, "ACTIVE");
  if (check.kind === "ACTIVE") {
    const expiresAt = Date.parse(check.record.expires_at);
    const provisionedAt = Date.parse(provisioned.snapshot!.provisioned_at);
    assert.ok(expiresAt - provisionedAt <= 600_000, "credential must not outlive the session");
  }
  await rm(root, { recursive: true, force: true });
});

test("scenario 4+5: NON-PRODUCTION disclosure everywhere; production flag frozen false; no secrets in state", async () => {
  assert.equal(PRODUCTION_ENABLED, false);
  const provider = new SyntheticLocalProvider();
  assert.equal(provider.identity.production_enabled, false);
  assert.equal(provider.identity.disclosure, CAPSULE_SYNTHETIC_PROVIDER_DISCLOSURE);
  assert.match(provider.identity.name, /NON-PRODUCTION/);
  const provisioned = await provider.provision(validManifest());
  if (provisioned.kind !== "PROVISIONED") {
    assert.fail("provision must succeed");
  }
  const serialized = JSON.stringify({
    snapshot: provisioned.snapshot,
    identity: provider.identity,
    outcome: await provider.heartbeat(provisioned.snapshot.ref),
  });
  assert.doesNotMatch(
    serialized,
    /cap-[0-9a-f-]{36}/,
    "plaintext secrets must never appear in structured state",
  );
});
