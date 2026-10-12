import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CapsuleManifest } from "@arena/contracts";
import { CapsuleBindingRegistry, ScopedCredentialLedger } from "@arena/capsule";
import { LinuxNamespaceIsolationProvider } from "../src/provider.js";
import { validIsolationManifest, provisionedPortLogicSession, batteryEnvironment } from "./helpers.js";

/**
 * Port-level discipline (the same fail-closed matrix the release gate runs
 * against the synthetic provider in grg_00000008, now against the REAL
 * isolation runtime): manifest gate, isolation-class gate, strict/auto
 * modes, tenant binding indistinguishability, teardown verification, and the
 * honest NOT_SUPPORTED paths.
 */

test("provision rejects an invalid manifest (fail closed, typed issues)", async () => {
  const provider = new LinuxNamespaceIsolationProvider({
    workspaceRoot: mkdtempSync(path.join(tmpdir(), "arena-iso-test-")),
  });
  const broken = validIsolationManifest({ manifest_version: 0 });
  const outcome = await provider.provision(broken);
  assert.equal(outcome.kind, "REJECTED");
  if (outcome.kind === "REJECTED") {
    assert.equal(outcome.code, "ARENA_CAPSULE_MANIFEST_INVALID");
    assert.ok(outcome.issues.length > 0);
  }
});

test("provision rejects isolation classes this runtime cannot provide", async () => {
  const provider = new LinuxNamespaceIsolationProvider({
    workspaceRoot: mkdtempSync(path.join(tmpdir(), "arena-iso-test-")),
  });
  const microvm = validIsolationManifest({
    assurance: {
      isolation_class: "microvm",
      conformance_suite_digest: "ab".repeat(32),
      conformance_suite_version: "1.0.0",
      verified_at: "2026-10-12T18:00:00Z",
      provider_id: "prv_00000001",
    },
  });
  const outcome = await provider.provision(microvm);
  assert.equal(outcome.kind, "PROVISION_FAILED");
  if (outcome.kind === "PROVISION_FAILED") {
    assert.match(outcome.reason, /ARENA_ISOLATION_CLASS_NOT_PROVIDED/);
  }
});

test("auto mode fails closed (no ENVIRONMENT_READY) when isolation is NOT_SUPPORTED", async () => {
  const provider = new LinuxNamespaceIsolationProvider({
    bwrapPath: "/nonexistent/bwrap-definitely-absent",
    workspaceRoot: mkdtempSync(path.join(tmpdir(), "arena-iso-test-")),
  });
  const outcome = await provider.provision(validIsolationManifest());
  assert.equal(outcome.kind, "PROVISION_FAILED");
  if (outcome.kind === "PROVISION_FAILED") {
    assert.match(outcome.reason, /ARENA_ISOLATION_NOT_SUPPORTED/);
  }
  // The exact probe results ride along for the evidence record.
  const report = provider.lastEnvironmentReport();
  assert.ok(report !== null);
  assert.equal(report.capability, "NOT_SUPPORTED");
  assert.ok(report.limitations.length > 0);
});

test("strict mode fails closed unless the environment probes FULL_ISOLATION", async () => {
  const environment = await batteryEnvironment();
  const provider = new LinuxNamespaceIsolationProvider({
    mode: "strict",
    workspaceRoot: mkdtempSync(path.join(tmpdir(), "arena-iso-test-")),
    probeEnvironment: async () => ({
      ...environment,
      capability: "PARTIAL_ISOLATION",
      limitations: [...environment.limitations, "injected: simulated partial capability"],
    }),
  });
  const outcome = await provider.provision(validIsolationManifest());
  assert.equal(outcome.kind, "PROVISION_FAILED");
  if (outcome.kind === "PROVISION_FAILED") {
    assert.match(outcome.reason, /strict mode requires FULL_ISOLATION/);
  }
});

test("execution fails closed with typed NOT_SUPPORTED when a pinned bwrap vanishes", async () => {
  const environment = await batteryEnvironment();
  const fakeRoot = mkdtempSync(path.join(tmpdir(), "arena-iso-vanish-"));
  const pinned = path.join(fakeRoot, "bwrap-copy");
  if (environment.bwrap.path !== null) {
    copyFileSync(environment.bwrap.path, pinned);
  } else {
    // No bwrap anywhere: simulate a previously-working environment instead.
    execFileSync("touch", [pinned]);
  }
  const provider = new LinuxNamespaceIsolationProvider({
    bwrapPath: pinned,
    workspaceRoot: mkdtempSync(path.join(tmpdir(), "arena-iso-test-")),
    probeEnvironment: async () => ({
      ...environment,
      capability: environment.capability === "NOT_SUPPORTED" ? "PARTIAL_ISOLATION" : environment.capability,
      userns_empirically_available: true,
      bwrap: { path: pinned, version: "0.12.0", major: 0, minor: 12 },
    }),
  });
  const provisioned = await provider.provision(validIsolationManifest());
  assert.equal(provisioned.kind, "PROVISIONED");
  rmSync(pinned, { force: true });
  const executed = await provider.executeCommand(
    {
      capsule_id: "cap_00000001",
      tenant_id: "tnt_00000001",
      escalation_id: "esc_00000001",
      attempt_id: "att_00000001",
    },
    { action_id: "act_00000001", command: ["sh", "-c", "true"] },
  );
  // A pinned binary that disappeared NEVER falls back to PATH silently.
  assert.equal(executed.kind, "ISOLATION_NOT_SUPPORTED");
  if (executed.kind === "ISOLATION_NOT_SUPPORTED") {
    assert.ok(executed.environment !== null);
  }
});

test("cross-tenant references are refused indistinguishably on every port op", async () => {
  // Port-logic fixture: the provider is constructed directly with the labeled
  // synthetic environment (probeEnvironment seam) so this typed-refusal test
  // runs identically on bwrap-less stations (CI, integration). All refusals
  // below are decided by the session/binding registries before any spawn.
  const fixture = await provisionedPortLogicSession();
  const attackerRef = {
    capsule_id: "cap_00000001",
    tenant_id: "tnt_00000099",
    escalation_id: "esc_00000001",
    attempt_id: "att_00000001",
  };
  const unknownRef = {
    capsule_id: "cap_00000099",
    tenant_id: "tnt_00000099",
    escalation_id: "esc_00000001",
    attempt_id: "att_00000001",
  };
  for (const ref of [attackerRef, unknownRef]) {
    const beat = await fixture.provider.heartbeat(ref);
    assert.equal(beat.kind, "REFUSED");
    if (beat.kind === "REFUSED") {
      assert.equal(beat.code, "ARENA_CAPSULE_UNAVAILABLE");
      assert.equal(beat.detail, "capsule not visible in tenant scope");
    }
    const transfer = await fixture.provider.transferArtifact(ref, {
      direction: "pull_only",
      artifact_id: "art_00000001",
      content_digest: "ab".repeat(32),
      size_bytes: 16,
    });
    assert.equal(transfer.kind, "REFUSED");
    const torn = await fixture.provider.teardown(ref);
    assert.equal(torn.kind, "REFUSED");
    const executed = await fixture.provider.executeCommand(ref, {
      action_id: "act_00000001",
      command: ["sh", "-c", "true"],
    });
    assert.equal(executed.kind, "REFUSED");
  }
});

test("aggregate (escalation/attempt) mismatch is a typed TENANT_MISMATCH", async () => {
  const fixture = await provisionedPortLogicSession();
  const mismatched = {
    capsule_id: "cap_00000001",
    tenant_id: "tnt_00000001",
    escalation_id: "esc_00000042",
    attempt_id: "att_00000001",
  };
  const beat = await fixture.provider.heartbeat(mismatched);
  assert.equal(beat.kind, "REFUSED");
  if (beat.kind === "REFUSED") {
    assert.equal(beat.code, "ARENA_TENANT_MISMATCH");
  }
});

test("lifecycle: heartbeat beats, teardown is verified and terminal", async () => {
  const fixture = await provisionedPortLogicSession();
  const beat = await fixture.provider.heartbeat(fixture.ref);
  assert.equal(beat.kind, "BEAT");
  if (beat.kind === "BEAT") {
    assert.equal(beat.snapshot.state, "ENVIRONMENT_READY");
    // assurance_recorded must MIRROR the environment the session was
    // provisioned against (real probe result, or the labeled synthetic in
    // the port-logic fixture) — the propagation invariant under test.
    assert.equal(
      beat.snapshot.assurance_recorded,
      fixture.environment.userns_empirically_available === true,
    );
  }
  const torn = await fixture.provider.teardown(fixture.ref);
  assert.equal(torn.kind, "TORN_DOWN");
  if (torn.kind === "TORN_DOWN") {
    assert.deepEqual(torn.revoked_credentials, ["crd_00000001"]);
    assert.equal(torn.verified, true);
  }
  const after = await fixture.provider.heartbeat(fixture.ref);
  assert.equal(after.kind, "REFUSED");
});

test("session duration ceiling produces the typed SESSION_DURATION_EXCEEDED", async () => {
  // The expiry check is the port's FIRST decision in executeCommand — it
  // fires before any tool lookup, so the port-logic fixture exercises it.
  const fixture = await provisionedPortLogicSession({
    manifestOverrides: { resource_policy: { cpu_limit: 1, memory_limit_mb: 256, disk_limit_mb: 64, max_duration_seconds: 1 } },
  });
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const executed = await fixture.provider.executeCommand(fixture.ref, {
    action_id: "act_00000001",
    command: ["sh", "-c", "true"],
  });
  assert.equal(executed.kind, "SESSION_DURATION_EXCEEDED");
  if (executed.kind === "SESSION_DURATION_EXCEEDED") {
    assert.equal(executed.max_duration_seconds, 1);
  }
});

test("command not in the action allowlist is refused before any spawn", async () => {
  // Allowlist refusal is decided before any tool lookup or spawn.
  const fixture = await provisionedPortLogicSession();
  const executed = await fixture.provider.executeCommand(fixture.ref, {
    action_id: "act_00000001",
    command: ["python3", "-c", "print(1)"],
  });
  assert.equal(executed.kind, "COMMAND_NOT_ALLOWLISTED");
  if (executed.kind === "COMMAND_NOT_ALLOWLISTED") {
    assert.equal(executed.action_id, "act_00000001");
    assert.ok(executed.allowlist.includes("sh"));
  }
});

test("manifest granting egress hosts fails closed at execution (empty netns cannot honor)", async () => {
  // Egress fail-closed is decided from the manifest alone, before any spawn.
  const fixture = await provisionedPortLogicSession({
    manifestOverrides: {
      egress_policy: { denied_default: true, allowed_hosts: ["registry.npmjs.org"], allow_ingress: false },
    },
  });
  const executed = await fixture.provider.executeCommand(fixture.ref, {
    action_id: "act_00000001",
    command: ["sh", "-c", "true"],
  });
  assert.equal(executed.kind, "EGRESS_GRANT_NOT_SUPPORTED");
  if (executed.kind === "EGRESS_GRANT_NOT_SUPPORTED") {
    assert.deepEqual(executed.requested_hosts, ["registry.npmjs.org"]);
  }
});

test("transferArtifact enforces flat ids and the manifest byte ceiling", async () => {
  // Artifact transfer never spawns: flat-id and byte-ceiling refusals are
  // pure port logic against the manifest and session state.
  const fixture = await provisionedPortLogicSession();
  const traversal = await fixture.provider.transferArtifact(fixture.ref, {
    direction: "pull_only",
    artifact_id: "../escape",
    content_digest: "ab".repeat(32),
    size_bytes: 16,
  });
  assert.equal(traversal.kind, "REFUSED");
  const oversize = await fixture.provider.transferArtifact(fixture.ref, {
    direction: "pull_only",
    artifact_id: "art_00000001",
    content_digest: "ab".repeat(32),
    size_bytes: 104857601,
  });
  assert.equal(oversize.kind, "OVERSIZE");
  const ok = await fixture.provider.transferArtifact(fixture.ref, {
    direction: "pull_only",
    artifact_id: "art_00000001",
    content_digest: "ab".repeat(32),
    size_bytes: 16,
  });
  assert.equal(ok.kind, "TRANSFERRED");
});

test("registry+ledger are injectable and the port implementation reuses AR2-004 primitives", async () => {
  const registry = new CapsuleBindingRegistry();
  const ledger = new ScopedCredentialLedger();
  const environment = await batteryEnvironment();
  const provider = new LinuxNamespaceIsolationProvider({
    registry,
    ledger,
    workspaceRoot: mkdtempSync(path.join(tmpdir(), "arena-iso-test-")),
    probeEnvironment: async () => ({
      ...environment,
      capability: environment.capability === "NOT_SUPPORTED" ? "PARTIAL_ISOLATION" : environment.capability,
      userns_empirically_available: true,
    }),
  });
  const manifest: CapsuleManifest = validIsolationManifest();
  const provisioned = await provider.provision(manifest);
  assert.equal(provisioned.kind, "PROVISIONED");
  // The manifest's credential was issued into the injected ledger.
  const state = ledger.check("crd_00000001");
  assert.equal(state.kind, "ACTIVE");
  const report = await provider.sessionEnvironmentReport({
    capsule_id: "cap_00000001",
    tenant_id: "tnt_00000001",
    escalation_id: "esc_00000001",
    attempt_id: "att_00000001",
  });
  assert.ok(!("kind" in report && report.kind === "REFUSED"));
});
