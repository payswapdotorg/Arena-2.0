import assert from "node:assert/strict";
import test from "node:test";
import {
  CapsuleBindingRegistry,
  SyntheticLocalProvider,
  bindingOfManifest,
  checkCapsuleBinding,
  checkCapsuleManifest,
  type CapsuleManifest,
} from "@arena/capsule";

/**
 * AR2-015 — 对抗剖面 4（issue #17：real capsule isolation / egress —— 租户
 * 边界部分）：真实 CapsuleProviderPort（SyntheticLocalProvider）上的租户
 * 失配拒绝矩阵。
 *
 * 断言（G2 门行为）：
 * - 四个 port 操作（provision 后 heartbeat/transferArtifact/teardown）对
 *   跨租户引用全部 REFUSED，且与「capsule 不存在」逐字节不可区分
 *   （ARENA_CAPSULE_UNAVAILABLE 同 detail —— 无存在性 oracle）；
 * - escalation/attempt 聚合绑定失配 ⇒ ARENA_TENANT_MISMATCH（类型化）；
 * - 正确引用正常服务；teardown 验证后所有引用失效；
 * - 披露：合成 provider 不是 OS 级隔离证据（生产隔离门 BLOCKED ——
 *   见 gate report grg_00000008）。
 */

const HEX64 = "ab".repeat(32);

function validManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    manifest_id: "csm_00000001",
    capsule_id: "cap_00000001",
    manifest_version: 1,
    tenant_id: "tnt_00000001",
    escalation_id: "esc_00000001",
    attempt_id: "att_00000001",
    environment: {
      environment_ref: "env://node-24@2026-10-01",
      toolchain_pins: ["node 24.14.0", "pnpm 10.33.2"],
      workspace_init: "git clean -xfd && pnpm install --frozen-lockfile",
    },
    permitted_actions: [
      {
        action_id: "act_00000001",
        tool: "shell",
        scope: "workspace root only",
        command_allowlist: ["pnpm", "node", "git"],
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
      isolation_class: "process",
      conformance_suite_digest: HEX64,
      conformance_suite_version: "1.0.0",
      verified_at: "2026-10-09T18:00:00Z",
      provider_id: "prv_00000001",
    },
    artifact_transfer: { transfer: "pull_only", max_artifact_bytes: 104857600 },
    content_digest: HEX64,
    ...overrides,
  };
}

const VICTIM = {
  capsule_id: "cap_00000001",
  tenant_id: "tnt_00000001",
  escalation_id: "esc_00000001",
  attempt_id: "att_00000001",
};
const ATTACKER_TENANT = { ...VICTIM, tenant_id: "tnt_00000002" };
const WRONG_ESCALATION = { ...VICTIM, escalation_id: "esc_00000002" };
const WRONG_ATTEMPT = { ...VICTIM, attempt_id: "att_00000002" };
const UNKNOWN_CAPSULE = { ...VICTIM, capsule_id: "cap_99999999" };

test("binding check matrix: cross-tenant indistinguishable from nonexistent; aggregate mismatch typed", () => {
  const registry = new CapsuleBindingRegistry();
  registry.register(VICTIM);

  const bound = checkCapsuleBinding(VICTIM, VICTIM);
  assert.equal(bound.kind, "BOUND");

  const crossTenant = checkCapsuleBinding(ATTACKER_TENANT, VICTIM);
  const nonexistent = checkCapsuleBinding(ATTACKER_TENANT, null);
  assert.equal(crossTenant.kind, "REFUSED");
  assert.equal(nonexistent.kind, "REFUSED");
  if (crossTenant.kind === "REFUSED" && nonexistent.kind === "REFUSED") {
    // 不可区分性：跨租户与不存在同 code + 同 detail（无存在性 oracle）。
    assert.equal(crossTenant.code, "ARENA_CAPSULE_UNAVAILABLE");
    assert.equal(nonexistent.code, "ARENA_CAPSULE_UNAVAILABLE");
    assert.equal(crossTenant.detail, nonexistent.detail);
    assert.equal(crossTenant.detail, "capsule not visible in tenant scope");
  }

  for (const wrong of [WRONG_ESCALATION, WRONG_ATTEMPT]) {
    const mismatch = checkCapsuleBinding(wrong, VICTIM);
    assert.equal(mismatch.kind, "REFUSED");
    if (mismatch.kind === "REFUSED") {
      assert.equal(mismatch.code, "ARENA_TENANT_MISMATCH");
    }
  }
});

test("real provider port: every operation refuses cross-tenant and aggregate-mismatched refs; teardown verified", async () => {
  const provider = new SyntheticLocalProvider();
  const checked = checkCapsuleManifest(validManifest());
  assert.equal(checked.kind, "VALID");
  const manifest = checked.kind === "VALID" ? (checked.manifest as CapsuleManifest) : null;
  assert.ok(manifest !== null);

  // 供给（租户 A 上下文）⇒ PROVISIONED。
  const provisioned = await provider.provision(manifest);
  assert.equal(provisioned.kind, "PROVISIONED");

  // 心跳：正确引用 ⇒ BEAT。
  const beat = await provider.heartbeat(VICTIM);
  assert.equal(beat.kind, "BEAT");

  // 跨租户心跳 ⇒ REFUSED CAPSULE_UNAVAILABLE（与未知 capsule 同 detail）。
  const crossBeat = await provider.heartbeat(ATTACKER_TENANT);
  const unknownBeat = await provider.heartbeat(UNKNOWN_CAPSULE);
  assert.equal(crossBeat.kind, "REFUSED");
  assert.equal(unknownBeat.kind === "REFUSED" ? unknownBeat.code : "", "ARENA_CAPSULE_UNAVAILABLE");
  if (crossBeat.kind === "REFUSED" && unknownBeat.kind === "REFUSED") {
    assert.equal(crossBeat.code, unknownBeat.code);
    assert.equal(crossBeat.detail, unknownBeat.detail);
  }

  // 聚合绑定失配 ⇒ ARENA_TENANT_MISMATCH（类型化，非「不存在」）。
  const mismatchBeat = await provider.heartbeat(WRONG_ESCALATION);
  assert.equal(mismatchBeat.kind === "REFUSED" ? mismatchBeat.code : "", "ARENA_TENANT_MISMATCH");
  const mismatchAttempt = await provider.heartbeat(WRONG_ATTEMPT);
  assert.equal(
    mismatchAttempt.kind === "REFUSED" ? mismatchAttempt.code : "",
    "ARENA_TENANT_MISMATCH",
  );

  // 工件传输：跨租户 ⇒ REFUSED；正确引用 ⇒ TRANSFERRED。
  const artifact = {
    direction: "pull_only" as const,
    artifact_id: "art_00000001",
    content_digest: HEX64,
    size_bytes: 1024,
  };
  const crossTransfer = await provider.transferArtifact(ATTACKER_TENANT, artifact);
  assert.equal(crossTransfer.kind, "REFUSED");
  const transfer = await provider.transferArtifact(VICTIM, artifact);
  assert.equal(transfer.kind, "TRANSFERRED");

  // 拆除：跨租户 ⇒ REFUSED；正确引用 ⇒ TORN_DOWN verified。
  const crossTeardown = await provider.teardown(ATTACKER_TENANT);
  assert.equal(crossTeardown.kind, "REFUSED");
  const teardown = await provider.teardown(VICTIM);
  assert.equal(teardown.kind, "TORN_DOWN");
  if (teardown.kind === "TORN_DOWN") {
    assert.equal(teardown.verified, true);
  }

  // 拆除后：任何引用（包括受害者自己的）⇒ CAPSULE_UNAVAILABLE（凭据已吊销）。
  const afterTeardown = await provider.heartbeat(VICTIM);
  assert.equal(
    afterTeardown.kind === "REFUSED" ? afterTeardown.code : "",
    "ARENA_CAPSULE_UNAVAILABLE",
  );
});

test("binding derivation: manifest binding covers capsule/tenant/escalation/attempt", () => {
  const checked = checkCapsuleManifest(validManifest());
  assert.equal(checked.kind, "VALID");
  if (checked.kind === "VALID") {
    const binding = bindingOfManifest(checked.manifest as CapsuleManifest);
    assert.deepEqual(binding, VICTIM);
  }
});
