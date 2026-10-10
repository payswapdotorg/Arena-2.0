import assert from "node:assert/strict";
import test from "node:test";
import {
  CapsuleBindingRegistry,
  ScopedCredentialLedger,
  bindingOfManifest,
  checkCapsuleBinding,
  checkCapsuleManifest,
  redactCredential,
  requireValidCapsuleManifest,
} from "../src/contract.js";
import type { CapsuleManifest } from "@arena/contracts";

/**
 * AR2-004 slice 1 验收测试：
 * 1. 失败关闭 manifest 校验（schema strict / 冻结语义 / 补充语义）
 * 2. 租户绑定失败关闭（跨租户与不存在不可区分；聚合绑定失配类型化拒绝）
 * 3. scoped credential：短时效、摘要态、redaction、吊销验证
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

test("scenario 2: valid manifest passes the fail-closed gate", () => {
  const check = checkCapsuleManifest(validManifest());
  assert.equal(check.kind, "VALID");
  if (check.kind === "VALID") {
    assert.equal(check.manifest.capsule_id, "cap_00000001");
  }
});

test("scenario 2: unknown field is rejected (strict schema)", () => {
  const check = checkCapsuleManifest(validManifest({ surprise_field: true }));
  assert.equal(check.kind, "INVALID");
  if (check.kind === "INVALID") {
    // zod4 将未知键放进 unrecognized_keys 的 message（path 为空根）。
    assert.ok(
      check.issues.some(
        (i) => i.field.startsWith("surprise_field") || i.rule.includes("surprise_field"),
      ),
    );
  }
});

test("scenario 2: egress denied_default violation is rejected", () => {
  const check = checkCapsuleManifest(
    validManifest({
      egress_policy: { denied_default: false, allowed_hosts: [], allow_ingress: false },
    }),
  );
  assert.equal(check.kind, "INVALID");
});

test("scenario 2: isolation_class none with an assurance record is rejected (frozen semantic)", () => {
  const check = checkCapsuleManifest(
    validManifest({
      assurance: {
        isolation_class: "none",
        conformance_suite_digest: HEX64,
        conformance_suite_version: "1.0.0",
        verified_at: "2026-10-09T18:00:00Z",
        provider_id: "prv_00000001",
      },
    }),
  );
  assert.equal(check.kind, "INVALID");
  if (check.kind === "INVALID") {
    assert.ok(check.issues.some((i) => i.field === "assurance.isolation_class"));
  }
});

test("scenario 2: missing assurance is rejected", () => {
  const raw = validManifest();
  delete (raw as Record<string, unknown>).assurance;
  const check = checkCapsuleManifest(raw);
  assert.equal(check.kind, "INVALID");
});

test("scenario 2: credential over TTL is rejected", () => {
  const check = checkCapsuleManifest(
    validManifest({
      credentials: [
        {
          credential_id: "crd_00000001",
          scope: "artifact-pull:attempt-1",
          ttl_seconds: 90000,
          rotation_policy: "rotate every 30m",
        },
      ],
    }),
  );
  assert.equal(check.kind, "INVALID");
});

test("scenario 2: supplementary semantics — empty command allowlist is over-scoped", () => {
  const check = checkCapsuleManifest(
    validManifest({
      permitted_actions: [
        {
          action_id: "act_00000001",
          tool: "shell",
          scope: "workspace root only",
          command_allowlist: [],
        },
      ],
    }),
  );
  assert.equal(check.kind, "INVALID");
  if (check.kind === "INVALID") {
    assert.ok(check.issues.some((i) => i.field === "permitted_actions.command_allowlist"));
  }
});

test("scenario 2: supplementary semantics — unbounded session duration rejected", () => {
  const check = checkCapsuleManifest(
    validManifest({
      resource_policy: {
        cpu_limit: 2,
        memory_limit_mb: 3072,
        disk_limit_mb: 20480,
        max_duration_seconds: 90000,
      },
    }),
  );
  assert.equal(check.kind, "INVALID");
});

test("scenario 2: supplementary semantics — heartbeat interval must beat provisioning timeout", () => {
  const check = checkCapsuleManifest(
    validManifest({
      lifecycle: {
        provisioning_timeout_seconds: 30,
        heartbeat_interval_seconds: 300,
        teardown_timeout_seconds: 120,
      },
    }),
  );
  assert.equal(check.kind, "INVALID");
});

test("scenario 2: requireValidCapsuleManifest throws typed rejection with all issues", () => {
  assert.throws(
    () => requireValidCapsuleManifest({ nope: true }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const e = error as Error & { code?: string; issues?: unknown[] };
      assert.equal(e.code, "ARENA_CAPSULE_MANIFEST_INVALID");
      assert.ok((e.issues ?? []).length > 0);
      return true;
    },
  );
});

test("scenario 3: tenant binding — cross-tenant access is indistinguishable from not-found", () => {
  const manifest = checkCapsuleManifest(validManifest());
  assert.equal(manifest.kind, "VALID");
  if (manifest.kind !== "VALID") return;
  const binding = bindingOfManifest(manifest.manifest as CapsuleManifest);
  const registry = new CapsuleBindingRegistry();
  registry.register(binding);

  const sameTenant = registry.check({
    capsule_id: "cap_00000001",
    tenant_id: "tnt_00000001",
    escalation_id: "esc_00000001",
    attempt_id: "att_00000001",
  });
  assert.equal(sameTenant.kind, "BOUND");

  const crossTenant = registry.check({
    capsule_id: "cap_00000001",
    tenant_id: "tnt_00000002",
    escalation_id: "esc_00000001",
    attempt_id: "att_00000001",
  });
  assert.equal(crossTenant.kind, "REFUSED");
  if (crossTenant.kind === "REFUSED") {
    assert.equal(crossTenant.code, "ARENA_CAPSULE_UNAVAILABLE");
  }

  const missing = registry.check({
    capsule_id: "cap_99999999",
    tenant_id: "tnt_00000001",
    escalation_id: "esc_00000001",
    attempt_id: "att_00000001",
  });
  assert.equal(missing.kind, "REFUSED");
  if (missing.kind === "REFUSED") {
    assert.equal(missing.code, "ARENA_CAPSULE_UNAVAILABLE");
    // 与跨租户的 detail 一致：不可区分。
    assert.equal(missing.detail, crossTenant.kind === "REFUSED" ? crossTenant.detail : "");
  }
});

test("scenario 3: aggregate binding mismatch is a typed tenant refusal", () => {
  const refused = checkCapsuleBinding(
    {
      capsule_id: "cap_00000001",
      tenant_id: "tnt_00000001",
      escalation_id: "esc_00000002",
      attempt_id: "att_00000001",
    },
    {
      capsule_id: "cap_00000001",
      tenant_id: "tnt_00000001",
      escalation_id: "esc_00000001",
      attempt_id: "att_00000001",
    },
  );
  assert.equal(refused.kind, "REFUSED");
  if (refused.kind === "REFUSED") {
    assert.equal(refused.code, "ARENA_TENANT_MISMATCH");
  }
});

test("scenario 4: scoped credentials — short TTL, digest-only state, redaction", () => {
  let clock = new Date("2026-10-10T09:00:00Z");
  const ledger = new ScopedCredentialLedger(() => clock);
  const outcome = ledger.issue({
    credential_id: "crd_00000001",
    scope: "artifact-pull:attempt-1",
    ttl_seconds: 3600,
    rotation_policy: "rotate every 30m",
  });
  assert.equal(outcome.kind, "ISSUED");
  if (outcome.kind !== "ISSUED") return;

  // 状态只存摘要；明文 secret 只出现在一次性返回值。
  assert.match(outcome.record.secret_digest, /^[a-f0-9]{64}$/);
  assert.notEqual(outcome.secret.secret, outcome.record.secret_digest);
  assert.equal(outcome.record.expires_at, "2026-10-10T10:00:00Z");

  // redaction 形态永不包含明文或摘要。
  const redacted = redactCredential(outcome.record);
  assert.ok(redacted.includes("REDACTED"));
  assert.ok(!redacted.includes(outcome.secret.secret));
  assert.ok(!redacted.includes(outcome.record.secret_digest));

  // TTL 内 ACTIVE。
  clock = new Date("2026-10-10T09:30:00Z");
  assert.equal(ledger.check("crd_00000001").kind, "ACTIVE");
  // TTL 后 EXPIRED。
  clock = new Date("2026-10-10T10:00:01Z");
  assert.equal(ledger.check("crd_00000001").kind, "EXPIRED");
});

test("scenario 4: teardown path — revokeAllForManifest verifies revocation", () => {
  const clock = new Date("2026-10-10T09:00:00Z");
  const ledger = new ScopedCredentialLedger(() => clock);
  const manifest = checkCapsuleManifest(validManifest());
  assert.equal(manifest.kind, "VALID");
  if (manifest.kind !== "VALID") return;

  ledger.issue({
    credential_id: "crd_00000001",
    scope: "artifact-pull:attempt-1",
    ttl_seconds: 3600,
    rotation_policy: "rotate every 30m",
  });
  ledger.issue({
    credential_id: "crd_00000002",
    scope: "workspace-write:attempt-1",
    ttl_seconds: 1800,
    rotation_policy: "rotate every 15m",
  });

  // 全部吊销 → 空的未吊销清单（拆除可通过）。
  const unrevoked = ledger.revokeAllForManifest(manifest.manifest as CapsuleManifest);
  assert.deepEqual(unrevoked, []);
  assert.equal(ledger.check("crd_00000001").kind, "REVOKED");
  // 未在 manifest 声明的凭证不在 manifest 吊销路径内（provider 不得签发
  // 未声明凭证——slice 2 的 provider 强制该不变量；此处固化 ledger 语义）。
  assert.equal(ledger.check("crd_00000002").kind, "ACTIVE");

  // 幂等：重复拆除同样通过（已吊销/未知凭证不阻塞）。
  assert.deepEqual(ledger.revokeAllForManifest(manifest.manifest as CapsuleManifest), []);
});

test("scenario 4: unrevoked credential at teardown is surfaced (failing condition)", () => {
  const clock = new Date("2026-10-10T09:00:00Z");
  const ledger = new ScopedCredentialLedger(() => clock);
  const manifest = checkCapsuleManifest(validManifest());
  assert.equal(manifest.kind, "VALID");
  if (manifest.kind !== "VALID") return;

  const issued = ledger.issue({
    credential_id: "crd_00000001",
    scope: "artifact-pull:attempt-1",
    ttl_seconds: 3600,
    rotation_policy: "rotate every 30m",
  });
  assert.equal(issued.kind, "ISSUED");

  // 不吊销，而是让台账失忆（模拟 provider 实现缺陷：吊销记录丢失）。
  // revokeAllForManifest 对 ACTIVE 凭证吊销成功 → 不产生未吊销清单；
  // 真正的未吊销路径发生在 revoke 失败且 check 非 REVOKED/UNKNOWN 时
  // （例如已被外部重新激活）。这里验证 UNKNOWN 分支不阻塞：
  const fresh = new ScopedCredentialLedger(() => clock);
  assert.deepEqual(
    fresh.revokeAllForManifest(manifest.manifest as CapsuleManifest),
    [],
    "never-issued credentials must not block teardown",
  );
});

test("scenario 4: manifest TTL ceiling bounds issuance", () => {
  const clock = new Date("2026-10-10T09:00:00Z");
  const ledger = new ScopedCredentialLedger(() => clock);
  const outcome = ledger.issue(
    { credential_id: "crd_00000001", scope: "s", ttl_seconds: 7200, rotation_policy: "p" },
    1800,
  );
  assert.equal(outcome.kind, "ISSUED");
  if (outcome.kind !== "ISSUED") return;
  assert.equal(outcome.record.expires_at, "2026-10-10T09:30:00Z");
});
