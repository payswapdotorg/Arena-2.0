import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  acceptanceCriteriaSchema,
  attemptSchema,
  capsuleManifestSchema,
  commandEnvelopeSchema,
  escalationRequestSchema,
  eventEnvelopeSchema,
  evidenceEnvelopeSchema,
  idempotencyRecordSchema,
  proofPolicySnapshotSchema,
  resultEnvelopeSchema,
  tenantContextSchema,
  validateAcceptanceCriteriaSemantics,
  validateAttemptSemantics,
  validateCapsuleManifestSemantics,
  validateCommandEnvelopeSemantics,
  validateEscalationRequestSemantics,
  validateEventEnvelopeSemantics,
  validateEvidenceEnvelopeSemantics,
  validateIdempotencyRecordSemantics,
  validateProofPolicySemantics,
  validateResultEnvelopeSemantics,
  validateTenantContextSemantics,
} from "../src/contract.js";

/**
 * B1/B2 — 契约测试向量套件：每个信封的合法向量必须通过
 * 「运行时」校验（zod parse，非编译期类型），每个负例必须被拒绝；
 * 语义负例必须结构通过但语义校验器拒绝。
 */

const here = dirname(fileURLToPath(import.meta.url));
const vectorsDir = join(here, "..", "vectors");

interface VectorCase {
  id: string;
  kind: "valid" | "negative" | "semantic-negative";
  payload: unknown;
}

interface EnvelopeSuite {
  schema: { safeParse: (input: unknown) => { success: boolean; data?: unknown } };
  semantic?: (input: never) => Array<{ field: string; rule: string }>;
}

const SUITES: Record<string, EnvelopeSuite> = {
  "escalation-request": {
    schema: escalationRequestSchema,
    semantic: validateEscalationRequestSemantics,
  },
  "acceptance-criteria": {
    schema: acceptanceCriteriaSchema,
    semantic: validateAcceptanceCriteriaSemantics,
  },
  "proof-policy-snapshot": {
    schema: proofPolicySnapshotSchema,
    semantic: validateProofPolicySemantics,
  },
  attempt: { schema: attemptSchema, semantic: validateAttemptSemantics },
  "capsule-manifest": { schema: capsuleManifestSchema, semantic: validateCapsuleManifestSemantics },
  "evidence-envelope": {
    schema: evidenceEnvelopeSchema,
    semantic: validateEvidenceEnvelopeSemantics,
  },
  "result-envelope": { schema: resultEnvelopeSchema, semantic: validateResultEnvelopeSemantics },
  "event-envelope": { schema: eventEnvelopeSchema, semantic: validateEventEnvelopeSemantics },
  "command-envelope": { schema: commandEnvelopeSchema, semantic: validateCommandEnvelopeSemantics },
  "idempotency-record": {
    schema: idempotencyRecordSchema,
    semantic: validateIdempotencyRecordSemantics,
  },
  "tenant-context": { schema: tenantContextSchema, semantic: validateTenantContextSemantics },
};

test("every envelope has a vector file and every suite has a vector file", async () => {
  const files = (await readdir(vectorsDir)).filter((f) => f.endsWith(".json")).sort();
  const suiteNames = Object.keys(SUITES).sort();
  assert.deepEqual(
    files.map((f) => f.replace(/\.json$/, "")),
    suiteNames,
    "vector files and envelope suites must match one-to-one",
  );
});

for (const [envelope, suite] of Object.entries(SUITES)) {
  test(`vectors: ${envelope}`, async () => {
    const raw = JSON.parse(await readFile(join(vectorsDir, `${envelope}.json`), "utf8"));
    assert.equal(raw.envelope, envelope, "vector file self-identifies");
    const cases = raw.cases as VectorCase[];
    assert.ok(cases.length >= 5, `${envelope} needs >=1 valid + >=3 negative cases`);
    assert.ok(
      cases.some((c) => c.kind === "valid"),
      `${envelope} needs a valid case`,
    );
    assert.ok(
      cases.filter((c) => c.kind === "negative").length >= 3,
      `${envelope} needs >=3 structural negatives`,
    );
    assert.ok(
      cases.some(
        (c) => c.kind === "negative" && JSON.stringify(c.payload).includes("tnt_99999999"),
      ),
      `${envelope} must exercise the tenant-override attempt (tenant is never caller input on any envelope)`,
    );

    for (const vectorCase of cases) {
      const parsed = suite.schema.safeParse(vectorCase.payload);
      if (vectorCase.kind === "valid") {
        assert.ok(
          parsed.success,
          `${envelope}/${vectorCase.id} must parse: ${JSON.stringify(parsed)}`,
        );
        if (suite.semantic) {
          const issues = (suite.semantic as (input: unknown) => Array<{ field: string }>)(
            (parsed as { data: unknown }).data,
          );
          assert.deepEqual(
            issues,
            [],
            `${envelope}/${vectorCase.id} must pass semantics: ${JSON.stringify(issues)}`,
          );
        }
      } else if (vectorCase.kind === "negative") {
        assert.equal(
          parsed.success,
          false,
          `${envelope}/${vectorCase.id} must be rejected by runtime validation`,
        );
      } else {
        assert.ok(parsed.success, `${envelope}/${vectorCase.id} is structurally valid`);
        assert.ok(suite.semantic !== undefined, `${envelope} must declare a semantic validator`);
        const issues = (suite.semantic as (input: unknown) => Array<{ field: string }>)(
          (parsed as { data: unknown }).data,
        );
        assert.ok(issues.length > 0, `${envelope}/${vectorCase.id} must fail semantics`);
      }
    }
  });
}

test("B2: runtime validation rejects a tenant-override attempt on the request envelope (strict unknown-field)", () => {
  const attemptPayload = JSON.parse(
    JSON.stringify({
      contract_version: "ES2.0",
      client_application_id: "app_00000001",
      caller_idempotency_key: "idem-key-0001",
      request_digest: "ab".repeat(32),
      task: { title: "t", outcome_description: "d" },
      task_type: { domain: "d", type_id: "typ_00000001", type_version: "1.0.0" },
      required_capabilities: [{ capability_id: "cap_00000001", minimum_level: "senior" }],
      required_qualifications: [],
      acceptance_criteria: [],
      proof_policy: {},
      constraints: {},
      budget: {},
      input_artifacts: [],
      result_schema: { schema_id: "sch_00000001", schema_version: "1.0.0" },
      delivery_preferences: { channel: "poll", webhook_reference: null },
    }),
  );
  attemptPayload.tenant = "tnt_99999999";
  const parsed = escalationRequestSchema.safeParse(attemptPayload);
  assert.equal(
    parsed.success,
    false,
    "caller-provided tenant must be rejected as an unknown field",
  );
});
