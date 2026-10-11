import assert from "node:assert/strict";
import test from "node:test";
import { ArenaSdkClient, canonicalRequestDigest, sdkQuickstart } from "../src/contract.js";
import { buildGenericEscalationRequest } from "../src/contract.js";
import { scriptedFetch } from "./helpers.js";

/**
 * AR2-011 — typed SDK 单元验收（issue #13）：
 * CF1.0 镜像预检（客户端快速失败 + 服务端权威双层同契约）；typed outcome
 * 解析（CREATED/REPLAYED/CONFLICT/REJECTED/UNAUTHENTICATED/TRANSPORT_ERROR）；
 * quickstart 三步报告；幂等键进头；请求路径无 tenant/lens/role。
 */

const REQUEST = buildGenericEscalationRequest({
  title: "Classify the weekly ticket batch",
  outcome_description:
    "Each ticket in the fixture batch gets exactly one primary label from the agreed taxonomy.",
  output_schema_id: "sch_generic_0001",
  caller_idempotency_key: "sdk-unit-key-1",
  client_application_id: "app_00000001",
});

const AUTH = { bearerToken: "demo-token-requester-alpha" };

test("generic builder produces a CF1.0-valid request (frozen mirror parse)", async () => {
  const client = new ArenaSdkClient({
    baseUrl: "http://unit.local",
    fetchImpl: scriptedFetch([201]),
  });
  const outcome = await client.submitEscalation(REQUEST, AUTH);
  // 预检通过才会真正发请求 —— 预检失败也会以 REJECTED 返回（下一用例）。
  assert.equal(outcome.kind, "CREATED");
});

test("pre-validation rejects malformed envelopes client-side (same CF1.0 contract)", async () => {
  const fetchImpl = scriptedFetch([201]);
  const client = new ArenaSdkClient({ baseUrl: "http://unit.local", fetchImpl });
  const outcome = await client.submitEscalation(
    { ...REQUEST, task: { title: "", outcome_description: "x" } },
    AUTH,
  );
  assert.equal(outcome.kind, "REJECTED");
  if (outcome.kind === "REJECTED") {
    assert.ok(outcome.issues.some((issue) => issue.field.startsWith("task.")));
  }
  assert.equal(fetchImpl.calls.length, 0, "no HTTP call after failed mirror validation");
});

test("submit parses CREATED with idempotency header and no tenant/lens/role in path", async () => {
  const fetchImpl = scriptedFetch([
    new Response(JSON.stringify({ escalation_id: "esc_00000001", status: "CREATED", version: 1 }), {
      status: 201,
    }),
  ]);
  const client = new ArenaSdkClient({ baseUrl: "http://unit.local/", fetchImpl });
  const outcome = await client.submitEscalation(REQUEST, AUTH);
  assert.equal(outcome.kind, "CREATED");
  if (outcome.kind === "CREATED") {
    assert.equal(outcome.escalation_id, "esc_00000001");
    assert.equal(outcome.version, 1);
  }
  assert.equal(fetchImpl.calls.length, 1);
  const call = fetchImpl.calls[0];
  assert.ok(call !== undefined);
  assert.equal(call.url, "http://unit.local/v1/escalations");
  assert.equal(call.headers.authorization, "Bearer demo-token-requester-alpha");
  assert.equal(call.headers["x-idempotency-key"], REQUEST.caller_idempotency_key);
  assert.ok(!JSON.stringify(call.body ?? "").includes("tenant_id"));
});

test("replay envelope (200 + replayed) parses as REPLAYED, not a second creation", async () => {
  const fetchImpl = scriptedFetch([
    new Response(
      JSON.stringify({
        replayed: true,
        response: { escalation_id: "esc_00000001", status: "CREATED", version: 1 },
      }),
      { status: 200 },
    ),
  ]);
  const client = new ArenaSdkClient({ baseUrl: "http://unit.local", fetchImpl });
  const outcome = await client.submitEscalation(REQUEST, AUTH);
  assert.equal(outcome.kind, "REPLAYED");
  if (outcome.kind === "REPLAYED") assert.equal(outcome.escalation_id, "esc_00000001");
});

test("409 parses as typed CONFLICT (same key, different digest — fail-closed)", async () => {
  const fetchImpl = scriptedFetch([
    new Response(
      JSON.stringify({
        code: "ARENA_IDEMPOTENCY_DIGEST_CONFLICT",
        message: "digest mismatch",
        correlation_id: "cor_00000001",
        request_id: null,
        details: null,
      }),
      { status: 409 },
    ),
  ]);
  const client = new ArenaSdkClient({ baseUrl: "http://unit.local", fetchImpl });
  const outcome = await client.submitEscalation(REQUEST, AUTH);
  assert.equal(outcome.kind, "CONFLICT");
  if (outcome.kind === "CONFLICT") {
    assert.equal(outcome.envelope.code, "ARENA_IDEMPOTENCY_DIGEST_CONFLICT");
  }
});

test("401 parses as UNAUTHENTICATED; network failure as TRANSPORT_ERROR", async () => {
  const unauthenticated = new ArenaSdkClient({
    baseUrl: "http://unit.local",
    fetchImpl: scriptedFetch([401]),
  });
  assert.equal((await unauthenticated.submitEscalation(REQUEST, AUTH)).kind, "UNAUTHENTICATED");

  const unreachable = new ArenaSdkClient({
    baseUrl: "http://unit.local",
    fetchImpl: scriptedFetch(["network-error"]),
  });
  const outcome = await unreachable.submitEscalation(REQUEST, AUTH);
  assert.equal(outcome.kind, "TRANSPORT_ERROR");
  if (outcome.kind === "TRANSPORT_ERROR") assert.match(outcome.message, /network failure/);
});

test("unknown command name is rejected client-side as UNKNOWN_COMMAND", async () => {
  const client = new ArenaSdkClient({
    baseUrl: "http://unit.local",
    fetchImpl: scriptedFetch([200]),
  });
  const outcome = await client.escalationCommand("esc_00000001", "NotACommand", {}, AUTH);
  assert.equal(outcome.kind, "UNKNOWN_COMMAND");
});

test("command outcome parses INVARIANT_VIOLATION with failed_guards", async () => {
  const fetchImpl = scriptedFetch([
    new Response(
      JSON.stringify({
        code: "ARENA_INVARIANT_VIOLATION",
        message: "guard failed",
        correlation_id: "cor_00000001",
        request_id: null,
        details: { failed_guards: ["budget_available"] },
      }),
      { status: 409 },
    ),
  ]);
  const client = new ArenaSdkClient({ baseUrl: "http://unit.local", fetchImpl });
  const outcome = await client.escalationCommand("esc_00000001", "StartAttempt", {}, AUTH);
  assert.equal(outcome.kind, "INVARIANT_VIOLATION");
  if (outcome.kind === "INVARIANT_VIOLATION") {
    assert.deepEqual([...outcome.failed_guards], ["budget_available"]);
  }
});

test("quickstart composes readiness → submit → server projection", async () => {
  const fetchImpl = scriptedFetch([
    new Response(
      JSON.stringify({
        status: "ready",
        dependencies: { persistence: { mode: "sqlite_reference_engine", ready: true } },
      }),
      { status: 200 },
    ),
    new Response(JSON.stringify({ escalation_id: "esc_00000002", status: "CREATED", version: 1 }), {
      status: 201,
    }),
    new Response(
      JSON.stringify({
        escalation_id: "esc_00000002",
        status: "CREATED",
        version: 1,
        contract_version: "CF1.0",
        updated_at: "2026-10-11T00:00:00Z",
      }),
      { status: 200 },
    ),
  ]);
  const report = await sdkQuickstart({ baseUrl: "http://unit.local", fetchImpl }, REQUEST, AUTH);
  assert.equal(report.readiness?.dependencies.persistence.mode, "sqlite_reference_engine");
  assert.equal(report.submit.kind, "CREATED");
  assert.equal(report.projection.kind, "FOUND");
  if (report.projection.kind === "FOUND") {
    assert.equal(report.projection.projection.escalation_id, "esc_00000002");
  }
  assert.equal(fetchImpl.calls.length, 3);
});

test("canonicalRequestDigest is stable sha256 over the canonical subset", () => {
  const first = canonicalRequestDigest(REQUEST);
  const second = canonicalRequestDigest(REQUEST);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
  const mutated = canonicalRequestDigest({
    ...REQUEST,
    task: { ...REQUEST.task, title: "different title" },
  });
  assert.notEqual(first, mutated);
});
