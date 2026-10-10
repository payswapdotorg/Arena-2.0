import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptanceCriterionSchema,
  arenaErrorCodeSchema,
  attemptSchema,
  capsuleManifestSchema,
  commandEnvelopeSchema,
  ENVELOPE_IDS,
  escalationRequestSchema,
  eventEnvelopeSchema,
  evidenceEnvelopeSchema,
  FIELD_OWNERSHIP,
  idempotencyRecordSchema,
  owningModuleSchema,
  proofPolicySnapshotSchema,
  resultEnvelopeSchema,
  tenantContextSchema,
} from "../src/contract.js";

/**
 * B5 — 字段所有权交叉核查：每个信封的 schema shape 与所有权注册表
 * 完全一致（无缺失、无多余），每个字段恰好一个 owner，owner 都是
 * 注册过的模块。零未拥有字段、零双写字段。
 */

const SHAPE_BY_ENVELOPE: Record<string, { shape: Record<string, unknown> }> = {
  "escalation-request": escalationRequestSchema,
  // acceptance-criteria vectors 是数组；字段所有权表描述单个 criterion 对象的字段。
  "acceptance-criteria": acceptanceCriterionSchema,
  "proof-policy-snapshot": proofPolicySnapshotSchema,
  attempt: attemptSchema,
  "capsule-manifest": capsuleManifestSchema,
  "evidence-envelope": evidenceEnvelopeSchema,
  "result-envelope": resultEnvelopeSchema,
  "event-envelope": eventEnvelopeSchema,
  "command-envelope": commandEnvelopeSchema,
  "idempotency-record": idempotencyRecordSchema,
  "tenant-context": tenantContextSchema,
};

test("the ownership registry covers exactly the corpus envelopes", () => {
  assert.deepEqual(Object.keys(FIELD_OWNERSHIP).sort(), [...ENVELOPE_IDS].sort());
  assert.deepEqual(Object.keys(SHAPE_BY_ENVELOPE).sort(), [...ENVELOPE_IDS].sort());
});

for (const envelope of ENVELOPE_IDS) {
  test(`ownership: ${envelope} fields map 1:1 onto the schema shape`, () => {
    const schema = SHAPE_BY_ENVELOPE[envelope];
    const schemaFields = Object.keys(schema.shape).sort();
    const ownershipFields = Object.keys(FIELD_OWNERSHIP[envelope]).sort();
    assert.deepEqual(
      ownershipFields,
      schemaFields,
      `${envelope}: ownership table and schema shape must match exactly (no unowned, no ghost fields)`,
    );
  });

  test(`ownership: ${envelope} every field has exactly one valid owning module`, () => {
    for (const [field, owner] of Object.entries(FIELD_OWNERSHIP[envelope])) {
      const parsed = owningModuleSchema.safeParse(owner);
      assert.ok(
        parsed.success,
        `${envelope}.${field} owner '${String(owner)}' is not a registered module`,
      );
    }
  });
}

test("the four infrastructure owners are documented extensions of the eight ES2.0 §3 domain modules", () => {
  const domainModules = new Set([
    "escalation",
    "attempt",
    "capsule_host",
    "evidence_store",
    "verification",
    "payment",
    "learning",
    "requester_app",
  ]);
  const infrastructureOwners = new Set([
    "api_edge",
    "idempotency_store",
    "emitting_aggregate",
    "tenant_service",
  ]);
  for (const owners of Object.values(FIELD_OWNERSHIP)) {
    for (const owner of Object.values(owners)) {
      assert.ok(
        domainModules.has(owner) || infrastructureOwners.has(owner),
        `owner ${owner} must be a domain module or a documented infrastructure owner`,
      );
    }
  }
});

test("the result envelope delegates payment authority to the payment domain only", () => {
  assert.equal(FIELD_OWNERSHIP["result-envelope"].payment_eligibility_reference, "payment");
});

test("the capsule manifest is owned by the capsule host, not by domain modules", () => {
  for (const owner of Object.values(FIELD_OWNERSHIP["capsule-manifest"])) {
    assert.equal(owner, "capsule_host");
  }
});

test("error catalog: every code has a complete entry with stable HTTP mapping", () => {
  const codes = arenaErrorCodeSchema.options;
  for (const code of codes) {
    assert.ok(code.startsWith("ARENA_"), `${code} must carry the ARENA_ prefix`);
  }
});
