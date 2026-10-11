import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCapsuleManifest, SyntheticLocalProvider } from "@arena/capsule";
import type { CapsuleManifest, CapsuleRef } from "@arena/capsule";
import { CapsuleCustodian } from "../src/contract.js";
import { identifyDeadLetters } from "../src/contract.js";

/**
 * AR2-013 — capsule 拆除漂移检测 + 孤儿回收（issue #15 验收）：
 * 漂移可见（期限过 + 未验证）；sweep 驱动真实 SyntheticLocalProvider 的
 * teardown（已验证拆除 → 回收）；孤儿（provider 无此 capsule）→ 升级可见；
 * 死信视图：attempts 过阈值被标记但永不删除（retained 字面量）。
 */

const HEX64 = "ab".repeat(32);

function validManifest(): Record<string, unknown> {
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
      workspace_init: "git clean -xfd",
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
  };
}

const NOW = "2026-10-11T12:00:00Z";

test("teardown drift is detected, swept via the REAL provider and recovered", async () => {
  const provider = new SyntheticLocalProvider({ workspaceRoot: tmpdir() });
  const check = checkCapsuleManifest(validManifest());
  assert.equal(check.kind, "VALID");
  if (check.kind !== "VALID") return;
  const manifest = check.manifest as CapsuleManifest;
  const provisioned = await provider.provision(manifest);
  assert.equal(provisioned.kind, "PROVISIONED");
  if (provisioned.kind !== "PROVISIONED") return;
  const capsuleRef = provisioned.snapshot.ref;

  const custodian = new CapsuleCustodian();
  custodian.register({
    capsule_ref: capsuleRef,
    tenant_id: "tnt_00000001",
    provisioned_at: "2026-10-11T10:00:00Z",
    teardown_deadline_at: "2026-10-11T11:00:00Z", // 已过期 → 漂移
    teardown_verified: false,
  });

  // 漂移可见（带 overdue 秒数）。
  const drift = custodian.detectTeardownDrift(NOW);
  assert.equal(drift.length, 1);
  assert.equal(drift[0]?.overdue_seconds, 3600);

  // sweep：驱动真实 provider.teardown → TORN_DOWN(verified) → 回收。
  const sweep = await custodian.sweep({ now: NOW, provider });
  assert.equal(sweep.drift_detected, 1);
  assert.equal(sweep.recoveries.length, 1);
  assert.equal(sweep.recoveries[0]?.kind, "RECOVERED");
  if (sweep.recoveries[0]?.kind === "RECOVERED") {
    assert.equal(sweep.recoveries[0].verified, true);
  }
  assert.equal(sweep.remaining_drift, 0);
  assert.equal(custodian.detectTeardownDrift(NOW).length, 0);
});

test("orphan capsules (unknown to the provider) escalate visibly — never silently collected", async () => {
  const provider = new SyntheticLocalProvider({
    workspaceRoot: join(tmpdir(), "no-such-root-xyz"),
  });
  const orphanRef: CapsuleRef = {
    capsule_id: "cap_09999999",
    tenant_id: "tnt_00000001",
    escalation_id: "esc_00000001",
    attempt_id: "att_00000001",
  };
  const custodian = new CapsuleCustodian();
  custodian.register({
    capsule_ref: orphanRef,
    tenant_id: "tnt_00000001",
    provisioned_at: "2026-10-11T09:00:00Z",
    teardown_deadline_at: "2026-10-11T10:00:00Z",
    teardown_verified: false,
  });
  const sweep = await custodian.sweep({ now: NOW, provider });
  const orphan = sweep.recoveries.find((record) => record.kind === "ORPHAN_ESCALATED");
  assert.ok(orphan !== undefined, "unknown capsule must escalate as orphan");
  if (orphan?.kind === "ORPHAN_ESCALATED") {
    assert.equal(orphan.escalated, true);
    assert.ok(orphan.detail.length > 0);
  }
  // 孤儿条目保留（可见漂移仍在 —— 绝不静默回收）。
  assert.equal(custodian.detectTeardownDrift(NOW).length, 1);
  assert.equal(sweep.remaining_drift, 1);
});

test("dead letters are flagged, visible and retained — never dropped", () => {
  const stats = [
    {
      outbox_id: "obx_00000001",
      attempts: 2,
      next_attempt_at: "2026-10-11T12:00:01Z",
      dispatched_at: null,
      event_type: "EscalationCreated",
    },
    {
      outbox_id: "obx_00000002",
      attempts: 8,
      next_attempt_at: "2026-10-11T12:05:00Z",
      dispatched_at: null,
      event_type: "EscalationCreated",
    },
    {
      outbox_id: "obx_00000003",
      attempts: 1,
      next_attempt_at: "2026-10-11T12:00:02Z",
      dispatched_at: "2026-10-11T12:00:00Z",
      event_type: "EscalationCreated",
    },
  ];
  const report = identifyDeadLetters(stats, { max_attempts: 8 });
  assert.equal(report.retained, true);
  assert.equal(report.dead_lettered.length, 1);
  assert.equal(report.dead_lettered[0]?.outbox_id, "obx_00000002");
  assert.equal(report.dead_lettered[0]?.flagged_reason, "max_attempts_exceeded");
  assert.equal(report.in_flight, 1);
  assert.equal(report.dispatched, 1);
});
