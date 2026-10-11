import assert from "node:assert/strict";
import test from "node:test";
import {
  ACQUISITION_REQUEST_TENANT_RULE,
  ACQUISITION_SCHEMA_FAMILY,
  ACQUISITION_SCHEMA_FAMILY_RULE,
  FALLBACK_CONSTRAINTS_RULE,
  acquisitionRequestDigestInput,
  acquisitionRouteModeSchema,
  capabilityAcquisitionRequestSchema,
  checkCapabilityAcquisitionRequest,
  computeCanonicalDigest,
  computeAcquisitionRequestDigest,
  validateAcquisitionRequestSemantics,
} from "../src/contract.js";
import { acquisitionRequest, withCanonicalDigest } from "./fixtures.js";

/**
 * AR2-016 验收（issue #32）：CapabilityAcquisitionRequest 契约向量 ——
 * 正/负向量、未知字段拒绝（含租户覆盖尝试）、版本门、幂等 digest 语义、
 * 语义负例（pinned 一致性 / FINE_TUNING 非默认 / 因果自指 / digest 锚定）、
 * 相关规则常量导出。
 */

function semanticsOf(input: ReturnType<typeof acquisitionRequest>) {
  const parsed = checkCapabilityAcquisitionRequest(input);
  assert.equal(parsed.ok, true);
  if (parsed.ok) return validateAcquisitionRequestSemantics(parsed.request);
  return [];
}

test("acquisition request: valid vector parses through the trust-boundary check", () => {
  const check = checkCapabilityAcquisitionRequest(acquisitionRequest());
  assert.equal(check.ok, true);
  if (check.ok) {
    assert.equal(check.request.schema_version, ACQUISITION_SCHEMA_FAMILY);
    assert.equal(check.request.tenant_context.derived_from, "authenticated_credentials");
    assert.deepEqual(validateAcquisitionRequestSemantics(check.request), []);
  }
});

test("acquisition request: ACQ1.0 schema version is pinned (version gate first)", () => {
  for (const bad of ["CF1.0", "ES2.0", "ACQ0.9", "ACQ2.0", ""]) {
    const check = checkCapabilityAcquisitionRequest({
      ...acquisitionRequest(),
      schema_version: bad,
    });
    assert.equal(check.ok, false, bad);
    if (!check.ok) assert.equal(check.code, "ACQ_SCHEMA_VERSION_UNSUPPORTED", bad);
  }
});

test("acquisition request: a caller-settable tenant override is an unknown field", () => {
  for (const smuggle of [{ tenant_id: "tnt_00000009" }, { tenant: "tnt_00000009" }]) {
    const check = checkCapabilityAcquisitionRequest({ ...acquisitionRequest(), ...smuggle });
    assert.equal(check.ok, false);
    if (!check.ok) assert.equal(check.code, "ACQ_UNKNOWN_FIELD");
  }
  assert.ok(ACQUISITION_REQUEST_TENANT_RULE.includes("server-side"));
});

test("acquisition request: unknown fields are rejected with the typed unknown-field code", () => {
  const check = checkCapabilityAcquisitionRequest({
    ...acquisitionRequest(),
    private_chain_of_thought: "step 1: consider ...",
  });
  assert.equal(check.ok, false);
  if (!check.ok) assert.equal(check.code, "ACQ_UNKNOWN_FIELD");
});

test("acquisition request: strict shape negatives use the generic typed code", () => {
  const badBudget = checkCapabilityAcquisitionRequest({
    ...acquisitionRequest(),
    budget: { limit_amount: 0, currency: "USD" },
  });
  assert.equal(badBudget.ok, false);
  if (!badBudget.ok) assert.equal(badBudget.code, "ACQ_VALIDATION_FAILED");

  const noCriteria = { ...acquisitionRequest() };
  delete (noCriteria as Partial<typeof noCriteria>).acceptance_criteria;
  const badCriteria = checkCapabilityAcquisitionRequest(noCriteria);
  assert.equal(badCriteria.ok, false);

  const badDeadline = checkCapabilityAcquisitionRequest({
    ...acquisitionRequest(),
    deadline: "2026-12-01T00:00:00+01:00",
  });
  assert.equal(badDeadline.ok, false);
});

test("acquisition request: route modes and preferred-route shape", () => {
  assert.deepEqual(acquisitionRouteModeSchema.options, [
    "PINNED_PROVIDER",
    "ANY_COMPATIBLE_PROVIDER",
    "AUTO",
  ]);
  const modes = ["PINNED_PROVIDER", "ANY_COMPATIBLE_PROVIDER", "AUTO"] as const;
  for (const mode of modes) {
    const request = acquisitionRequest({
      preferred_route: { mode, pinned_provider: null, fallback_permitted: false },
    });
    assert.equal(checkCapabilityAcquisitionRequest(request).ok, true, mode);
  }
});

test("acquisition request: digest equals the canonical digest of the payload without the digest field", () => {
  const request = acquisitionRequest();
  const payload = acquisitionRequestDigestInput(request);
  assert.equal("request_digest" in payload, false);
  assert.equal(request.request_digest, computeCanonicalDigest(payload));
});

test("acquisition request: digest is key-order independent and content-sensitive (idempotency basis)", () => {
  const a = acquisitionRequest();
  const b = reorderedCopy(a);
  assert.equal(computeAcquisitionRequestDigest(a), computeAcquisitionRequestDigest(b));
  assert.equal(a.request_digest, withCanonicalDigest(b).request_digest);

  const changed = acquisitionRequest({ budget: { limit_amount: 501, currency: "USD" } });
  assert.notEqual(computeAcquisitionRequestDigest(a), computeAcquisitionRequestDigest(changed));

  const changedDeadline = acquisitionRequest({ deadline: "2026-12-02T00:00:00Z" });
  assert.notEqual(
    computeAcquisitionRequestDigest(a),
    computeAcquisitionRequestDigest(changedDeadline),
  );
});

test("acquisition request: a wrong digest is a semantic failure, not a schema failure", () => {
  // Tamper AFTER the fixture: withCanonicalDigest recomputes the digest, so the
  // override must be applied on the finished request to simulate a bad sender.
  const tampered = { ...acquisitionRequest(), request_digest: "ff".repeat(32) };
  const parsed = checkCapabilityAcquisitionRequest(tampered);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    const issues = validateAcquisitionRequestSemantics(parsed.request);
    assert.ok(issues.some((issue) => issue.field === "request_digest"));
  }
});

test("acquisition request: semantic negatives — route mode consistency", () => {
  const pinnedMissing = acquisitionRequest({
    preferred_route: { mode: "PINNED_PROVIDER", pinned_provider: null, fallback_permitted: false },
  });
  assert.ok(
    semanticsOf(pinnedMissing).some((issue) => issue.field === "preferred_route.pinned_provider"),
  );

  const pinnedInOpenMode = acquisitionRequest({
    preferred_route: {
      mode: "ANY_COMPATIBLE_PROVIDER",
      pinned_provider: { provider_id: "prv_00000001", provider_version: "1.0.0" },
      fallback_permitted: false,
    },
  });
  assert.ok(
    semanticsOf(pinnedInOpenMode).some(
      (issue) => issue.field === "preferred_route.pinned_provider",
    ),
  );
});

test("acquisition request: FINE_TUNING is never the default and requires explicit approval", () => {
  const withoutApproval = acquisitionRequest({
    data_use_policy: {
      use_kinds: ["RETRIEVAL", "FINE_TUNING"],
      retention_profile: "STANDARD",
      privacy_profile: "TENANT",
      redaction_class: "tenant",
      fine_tuning_approval: null,
    },
  });
  const issues = semanticsOf(withoutApproval);
  assert.ok(issues.some((issue) => issue.field === "data_use_policy.fine_tuning_approval"));

  const withApproval = acquisitionRequest({
    data_use_policy: {
      use_kinds: ["RETRIEVAL", "FINE_TUNING"],
      retention_profile: "STANDARD",
      privacy_profile: "TENANT",
      redaction_class: "tenant",
      fine_tuning_approval: "ACR approval record acr-approval-0001",
    },
  });
  assert.deepEqual(semanticsOf(withApproval), []);
});

test("acquisition request: a request cannot cause itself; deadlines must be plausible", () => {
  const selfCaused = acquisitionRequest({ causation_id: "req_00000001" });
  assert.ok(semanticsOf(selfCaused).some((issue) => issue.field === "causation_id"));

  const pastDeadline = acquisitionRequest({ deadline: "1969-01-01T00:00:00Z" });
  assert.ok(semanticsOf(pastDeadline).some((issue) => issue.field === "deadline"));
});

test("acquisition request: family separation and fallback rules are exported contract constants", () => {
  assert.equal(ACQUISITION_SCHEMA_FAMILY, "ACQ1.0");
  assert.ok(ACQUISITION_SCHEMA_FAMILY_RULE.includes("never edited"));
  assert.ok(FALLBACK_CONSTRAINTS_RULE.includes("explicitly permits"));
  assert.ok(
    capabilityAcquisitionRequestSchema.safeParse(acquisitionRequest()).success,
    "schema-level parse of the fixture must succeed",
  );
});

/** Re-insert every property in reverse-sorted key order (canonicalization must not care). */
function reorderedCopy<T extends object>(value: T): T {
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort().reverse()) {
    copy[key] = (value as Record<string, unknown>)[key];
  }
  return copy as T;
}
