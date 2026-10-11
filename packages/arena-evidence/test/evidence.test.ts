import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceEnvelope } from "@arena/contracts";
import { EvidenceStore, type ExpectedBinding } from "../src/contract.js";

/**
 * AR2-007 — append-only 证据存储验收（issue #9）：
 * 接受合法信封；伪造（受信 tier 无签名）/ 重放（同 evidence_id）/
 * 错租户 / 错尝试 / 未知修正链全部类型化拒绝；不可变性 = 无修改入口；
 * schema 与语义违规 fail-closed。
 */

const BINDING: ExpectedBinding = {
  tenant_id: "tnt_00000001",
  escalation_id: "esc_00000001",
  attempt_id: "att_00000001",
};

const ISO = "2026-10-11T00:00:00Z";

function envelope(
  overrides: Partial<EvidenceEnvelope> & { evidence_id: string },
): EvidenceEnvelope {
  return {
    evidence_id: "evd_00000001",
    object: {
      content_digest: "ab".repeat(32),
      size_bytes: 128,
      media_type: "application/json",
      storage_ref: "mem://evidence/1",
    },
    provenance: {
      issuer_tier: "arena_runner",
      issuer_id: "run_00000001",
      signature_algorithm: "ed25519",
      signature: "sig_00000001",
      issued_at: ISO,
      replay_protection: "nonce",
    },
    binding: {
      tenant_id: BINDING.tenant_id,
      escalation_id: BINDING.escalation_id,
      attempt_id: BINDING.attempt_id,
      environment_digest: "cd".repeat(32),
      validator_id: "val_00000001",
      validator_version: "1.2.0",
    },
    redaction_class: "tenant",
    immutable: true,
    correction: null,
    recorded_at: ISO,
    ...overrides,
  };
}

test("accepts a valid trusted-tier envelope and exposes it read-only", () => {
  const store = new EvidenceStore();
  const outcome = store.record(envelope({ evidence_id: "evd_00000001" }), BINDING);
  assert.equal(outcome.kind, "ACCEPTED");
  assert.equal(store.all().length, 1);
  assert.equal(store.has("evd_00000001"), true);
  assert.equal(store.byAttempt(BINDING.attempt_id).length, 1);
});

test("rejects forged evidence: trusted tier without signature (CALLER_PROOF_TRUST_RULE)", () => {
  const store = new EvidenceStore();
  const forged = envelope({
    evidence_id: "evd_00000001",
    provenance: {
      issuer_tier: "arena_runner",
      issuer_id: "run_00000001",
      signature_algorithm: null,
      signature: null,
      issued_at: ISO,
      replay_protection: "nonce",
    },
  });
  const outcome = store.record(forged, BINDING);
  assert.equal(outcome.kind, "REJECTED");
  assert.equal(outcome.rejection.code, "FORGED_UNSIGNED_TRUSTED_TIER");
  assert.equal(store.all().length, 0);
});

test("rejects replayed evidence_id (append-only immutability)", () => {
  const store = new EvidenceStore();
  const first = store.record(envelope({ evidence_id: "evd_00000001" }), BINDING);
  assert.equal(first.kind, "ACCEPTED");
  const replay = store.record(envelope({ evidence_id: "evd_00000001" }), BINDING);
  assert.equal(replay.kind, "REJECTED");
  assert.equal(replay.rejection.code, "REPLAYED_EVIDENCE_ID");
  // 原记录未被动过（不可变）。
  assert.equal(store.all().length, 1);
});

test("rejects wrong-tenant binding (fail-closed write side)", () => {
  const store = new EvidenceStore();
  const cross = envelope({
    evidence_id: "evd_00000001",
    binding: {
      tenant_id: "tnt_00000002",
      escalation_id: BINDING.escalation_id,
      attempt_id: BINDING.attempt_id,
      environment_digest: "cd".repeat(32),
      validator_id: "val_00000001",
      validator_version: "1.2.0",
    },
  });
  const outcome = store.record(cross, BINDING);
  assert.equal(outcome.kind, "REJECTED");
  assert.equal(outcome.rejection.code, "WRONG_TENANT");
});

test("rejects wrong-attempt binding", () => {
  const store = new EvidenceStore();
  const cross = envelope({
    evidence_id: "evd_00000001",
    binding: {
      tenant_id: BINDING.tenant_id,
      escalation_id: BINDING.escalation_id,
      attempt_id: "att_00000099",
      environment_digest: "cd".repeat(32),
      validator_id: "val_00000001",
      validator_version: "1.2.0",
    },
  });
  const outcome = store.record(cross, BINDING);
  assert.equal(outcome.kind, "REJECTED");
  assert.equal(outcome.rejection.code, "WRONG_ATTEMPT");
});

test("rejects wrong-escalation binding", () => {
  const store = new EvidenceStore();
  const cross = envelope({
    evidence_id: "evd_00000001",
    binding: {
      tenant_id: BINDING.tenant_id,
      escalation_id: "esc_00000099",
      attempt_id: BINDING.attempt_id,
      environment_digest: "cd".repeat(32),
      validator_id: "val_00000001",
      validator_version: "1.2.0",
    },
  });
  const outcome = store.record(cross, BINDING);
  assert.equal(outcome.kind, "REJECTED");
  assert.equal(outcome.rejection.code, "WRONG_ESCALATION");
});

test("rejects schema violations (unknown field / bad digest) with field issues", () => {
  const store = new EvidenceStore();
  const bad = { ...envelope({ evidence_id: "evd_00000001" }), extra_field: "no" };
  const outcome = store.record(bad, BINDING);
  assert.equal(outcome.kind, "REJECTED");
  assert.equal(outcome.rejection.code, "SCHEMA_INVALID");
  assert.ok(outcome.rejection.issues.length > 0);

  const badDigest = envelope({ evidence_id: "evd_00000002" });
  badDigest.object.content_digest = "not-hex";
  const outcome2 = store.record(badDigest, BINDING);
  assert.equal(outcome2.kind, "REJECTED");
  assert.equal(outcome2.rejection.code, "SCHEMA_INVALID");
});

test("rejects semantic violations: untrusted attachment classified public; self-supersession; recorded before issued", () => {
  const store = new EvidenceStore();
  const untrustedPublic = envelope({
    evidence_id: "evd_00000001",
    provenance: {
      issuer_tier: "untrusted_attachment",
      issuer_id: "usr_00000001",
      signature_algorithm: null,
      signature: null,
      issued_at: ISO,
      replay_protection: "nonce",
    },
    redaction_class: "public",
  });
  const r1 = store.record(untrustedPublic, BINDING);
  assert.equal(r1.kind, "REJECTED");
  assert.equal(r1.rejection.code, "SEMANTIC_INVALID");

  const selfSupersede = envelope({
    evidence_id: "evd_00000002",
    correction: { supersedes_evidence_id: "evd_00000002", reason: "self supersede" },
  });
  const r2 = store.record(selfSupersede, BINDING);
  assert.equal(r2.kind, "REJECTED");
  assert.equal(r2.rejection.code, "SEMANTIC_INVALID");

  const early = envelope({
    evidence_id: "evd_00000003",
    recorded_at: "2026-10-10T00:00:00Z",
  });
  const r3 = store.record(early, BINDING);
  assert.equal(r3.kind, "REJECTED");
  assert.equal(r3.rejection.code, "SEMANTIC_INVALID");
});

test("correction flow: new envelope supersedes an accepted one; unknown target rejected; history preserved", () => {
  const store = new EvidenceStore();
  assert.equal(store.record(envelope({ evidence_id: "evd_00000001" }), BINDING).kind, "ACCEPTED");
  const correction = envelope({
    evidence_id: "evd_00000002",
    object: {
      content_digest: "ef".repeat(32),
      size_bytes: 256,
      media_type: "application/json",
      storage_ref: "mem://evidence/2",
    },
    correction: { supersedes_evidence_id: "evd_00000001", reason: "fixed storage reference" },
  });
  const accepted = store.record(correction, BINDING);
  assert.equal(accepted.kind, "ACCEPTED");
  // 两条都在 —— 修正从不抹除历史（EVIDENCE_IMMUTABILITY_RULE）。
  assert.equal(store.all().length, 2);
  assert.notEqual(store.get("evd_00000001"), null);

  const unknown = envelope({
    evidence_id: "evd_00000003",
    correction: { supersedes_evidence_id: "evd_99999999", reason: "unknown target" },
  });
  const r = store.record(unknown, BINDING);
  assert.equal(r.kind, "REJECTED");
  assert.equal(r.rejection.code, "SUPERSEDES_UNKNOWN_EVIDENCE");
});
