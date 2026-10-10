import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { AddressInfo } from "node:net";
import { createInMemoryRuntime } from "@arena/application";
import { createArenaServer } from "../src/index.js";

/**
 * AR2-002 验收场景（真实 HTTP 监听器上的端到端）：
 * 1. CreateEscalation 全链路（运行时 zod 校验 + 语义校验 + 类型化错误）
 * 2. 幂等：同键同摘要重放 / 同键异摘要冲突
 * 3. 租户隔离：跨租户对象访问失败关闭
 * 4. 状态机命令：非法迁移与守卫拒绝
 * 5. 健康就绪与契约版本端点
 */

const VALID_REQUEST = {
  contract_version: "ES2.0",
  client_application_id: "app_00000001",
  caller_idempotency_key: "idem-key-0001",
  request_digest: "ab".repeat(32),
  task: {
    title: "Fix failing build",
    outcome_description: "Repo compiles and tests pass on the pinned toolchain.",
  },
  task_type: { domain: "software-engineering", type_id: "typ_00000001", type_version: "1.0.0" },
  required_capabilities: [{ capability_id: "cap_00000001", minimum_level: "senior" }],
  required_qualifications: ["licensed engineer (jurisdiction GH)"],
  acceptance_criteria: [
    {
      criterion_id: "crt_00000001",
      statement: "pnpm install/typecheck/test exit 0 on Node 24.14.0",
      measurement: {
        definition: "exit codes in the capsule runner",
        metric: "exit_code",
        unit: null,
        threshold: 0,
        comparator: "eq",
      },
      hard_stop: true,
      proof_class: "P0",
      weight: 1,
    },
  ],
  proof_policy: {
    policy_version: "PVP1.0",
    content_digest: "1e".repeat(32),
    selected_class: "P0",
    selection_rationale: "deterministic validator establishes the outcome",
    per_criterion_classes: [{ criterion_id: "crt_00000001", proof_class: "P0" }],
    validators: [
      {
        validator_id: "val_00000001",
        validator_version: "1.2.0",
        kind: "deterministic",
        allowed_commands: ["pnpm", "test"],
        timeout_seconds: 1800,
        resource_limits: "2 vCPU / 3 GB",
        evidence_policy: "trusted runner logs and hashes",
      },
    ],
    rerun_policy: { minimum_reruns: 2, risk_exception: null },
    sample_policy: null,
    review_policy: null,
    observation_policy: null,
    payout_gate: {
      release_requires: "all_predicates_pass",
      caller_authenticity_verified: true,
      task_binding_verified: true,
      dispute_blocks_release: true,
    },
    retry_next_expert: {
      max_attempts: 3,
      max_aggregate_spend: 500,
      cooldown_policy: "48h",
      failed_attempt_posture: "isolate_branch",
      next_expert_baseline: "baseline_plus_approved_prior_attempts",
    },
    timeout: "72h",
    dispute_conditions: "logs contradict outcome",
    budget_ceiling: 500,
  },
  constraints: {
    risk_tier: "MEDIUM",
    privacy_profile: "TENANT",
    retention_profile: "STANDARD",
    jurisdiction: "GH",
    professional_requirements: [],
    deadline: "2026-11-10T00:00:00Z",
    escalation_modes: ["next_expert", "budget_stop"],
  },
  budget: { limit_amount: 500, currency: "USD", allowed_attempts: 3, per_attempt_limit: 200 },
  input_artifacts: [],
  result_schema: { schema_id: "sch_00000001", schema_version: "1.0.0" },
  delivery_preferences: { channel: "poll", webhook_reference: null },
};

interface TestServer {
  base: string;
  close(): Promise<void>;
}

async function startServer(): Promise<TestServer> {
  const runtime = createInMemoryRuntime();
  const server = createArenaServer({ runtime });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

async function call(
  base: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResponse> {
  const response = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: "Bearer demo-token-requester-alpha",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body: json };
}

test("health, readiness and contract version endpoints", async () => {
  const server = await startServer();
  try {
    const health = await call(server.base, "GET", "/healthz", undefined, {});
    assert.equal(health.status, 200);
    assert.equal(health.body.status, "ok");
    const ready = await call(server.base, "GET", "/readyz", undefined, {});
    assert.equal(ready.status, 200);
    assert.equal(
      (ready.body.dependencies as Record<string, unknown>).persistence !== undefined,
      true,
    );
    const contract = await call(server.base, "GET", "/v1/contract", undefined, {});
    assert.equal(contract.status, 200);
    assert.equal(contract.body.contract_version, "ES2.0");
    assert.equal(contract.body.corpus, "CF1.0");
    assert.ok(String((contract.body.disclosures as string[])[0]).includes("DEMO"));
  } finally {
    await server.close();
  }
});

test("authentication is required (no token -> 401)", async () => {
  const server = await startServer();
  try {
    const response = await fetch(server.base + "/v1/escalations");
    assert.equal(response.status, 401);
  } finally {
    await server.close();
  }
});

test("scenario 1: CreateEscalation end-to-end with runtime validation", async () => {
  const server = await startServer();
  try {
    const created = await call(server.base, "POST", "/v1/escalations", VALID_REQUEST, {
      "x-idempotency-key": "key-create-1",
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.kind, "CREATED");
    const escalationId = String(created.body.escalation_id);
    const fetched = await call(server.base, "GET", `/v1/escalations/${escalationId}`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.status, "CREATED");
    assert.equal(fetched.body.contract_version, "ES2.0");
    const timeline = await call(server.base, "GET", `/v1/escalations/${escalationId}/timeline`);
    assert.equal(timeline.status, 200);
    assert.equal((timeline.body.events as unknown[]).length, 1);
  } finally {
    await server.close();
  }
});

test("unknown field / tenant override attempt is rejected with ARENA_UNKNOWN_FIELD", async () => {
  const server = await startServer();
  try {
    const payload = { ...VALID_REQUEST, tenant: "tnt_99999999", request_digest: "cd".repeat(32) };
    const rejected = await call(server.base, "POST", "/v1/escalations", payload, {
      "x-idempotency-key": "key-override",
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.code, "ARENA_UNKNOWN_FIELD");
  } finally {
    await server.close();
  }
});

test("semantic validation failure returns typed error with issues", async () => {
  const server = await startServer();
  try {
    const payload = JSON.parse(JSON.stringify(VALID_REQUEST)) as typeof VALID_REQUEST;
    payload.delivery_preferences = { channel: "webhook", webhook_reference: null };
    const rejected = await call(server.base, "POST", "/v1/escalations", payload, {
      "x-idempotency-key": "key-semantic",
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.code, "ARENA_VALIDATION_FAILED");
    assert.ok(Array.isArray(rejected.body.details));
  } finally {
    await server.close();
  }
});

test("scenario 2: idempotency — same key+digest replays, same key+different digest conflicts", async () => {
  const server = await startServer();
  try {
    const first = await call(server.base, "POST", "/v1/escalations", VALID_REQUEST, {
      "x-idempotency-key": "key-idem-1",
    });
    assert.equal(first.status, 201);
    const replay = await call(server.base, "POST", "/v1/escalations", VALID_REQUEST, {
      "x-idempotency-key": "key-idem-1",
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.deepEqual(replay.body.response, first.body);
    const mutated = JSON.parse(JSON.stringify(VALID_REQUEST)) as typeof VALID_REQUEST;
    mutated.task = { title: "Different task", outcome_description: "Different outcome." };
    const conflict = await call(server.base, "POST", "/v1/escalations", mutated, {
      "x-idempotency-key": "key-idem-1",
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, "ARENA_IDEMPOTENCY_DIGEST_MISMATCH");
  } finally {
    await server.close();
  }
});

test("scenario 3: tenant isolation — cross-tenant read fails closed as 404", async () => {
  const server = await startServer();
  try {
    const created = await call(server.base, "POST", "/v1/escalations", VALID_REQUEST, {
      "x-idempotency-key": "key-tenant-1",
    });
    const escalationId = String(created.body.escalation_id);
    const other = await fetch(server.base + `/v1/escalations/${escalationId}`, {
      headers: { authorization: "Bearer demo-token-requester-beta" },
    });
    assert.equal(other.status, 404);
    const body = (await other.json()) as Record<string, unknown>;
    assert.equal(body.code, "ARENA_ESCALATION_NOT_FOUND");
    // 同租户列表只见本租户对象。
    const mine = await call(server.base, "GET", "/v1/escalations");
    const theirs = await call(server.base, "GET", "/v1/escalations", undefined, {
      authorization: "Bearer demo-token-requester-beta",
    });
    assert.equal((mine.body.items as unknown[]).length, 1);
    assert.equal((theirs.body.items as unknown[]).length, 0);
  } finally {
    await server.close();
  }
});

test("scenario 4: state-machine commands — invalid transition and guard rejection", async () => {
  const server = await startServer();
  try {
    const created = await call(server.base, "POST", "/v1/escalations", VALID_REQUEST, {
      "x-idempotency-key": "key-cmd-1",
    });
    const escalationId = String(created.body.escalation_id);
    // CREATED 状态下直接 AcknowledgeResult：非法迁移。
    const invalid = await call(
      server.base,
      "POST",
      `/v1/escalations/${escalationId}/commands/AcknowledgeResult`,
      { facts: { result_record_committed: true } },
    );
    assert.equal(invalid.status, 409);
    assert.equal(invalid.body.code, "ARENA_INVALID_TRANSITION");
    // 合法命令（AmendEscalation）但守卫不满足：不变量拒绝 + 失败守卫名。
    const guardFail = await call(
      server.base,
      "POST",
      `/v1/escalations/${escalationId}/commands/AmendEscalation`,
      { facts: { pre_assignment_amendment: false } },
    );
    assert.equal(guardFail.status, 409);
    assert.equal(guardFail.body.code, "ARENA_INVARIANT_VIOLATION");
    assert.deepEqual((guardFail.body.details as { failed_guards: string[] }).failed_guards, [
      "pre_assignment_amendment",
    ]);
    // 守卫满足：迁移成功。
    const ok = await call(
      server.base,
      "POST",
      `/v1/escalations/${escalationId}/commands/AmendEscalation`,
      { facts: { pre_assignment_amendment: true } },
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.body.from, "CREATED");
    assert.equal(ok.body.to, "CREATED");
    // 未定义命令：404。
    const unknownCommand = await call(
      server.base,
      "POST",
      `/v1/escalations/${escalationId}/commands/DoEverything`,
      {},
    );
    assert.equal(unknownCommand.status, 404);
  } finally {
    await server.close();
  }
});

test("route not found returns typed 404", async () => {
  const server = await startServer();
  try {
    const missing = await call(server.base, "GET", "/v1/nothing");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "ARENA_RESOURCE_NOT_FOUND");
  } finally {
    await server.close();
  }
});
