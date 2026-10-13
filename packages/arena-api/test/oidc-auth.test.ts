import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { AddressInfo } from "node:net";
import { createInMemoryRuntime } from "@arena/application";
import { createOidcIdentityAdapter } from "@arena/identity";
import { createArenaServer, createAuthGateway } from "../src/contract.js";
import {
  AUDIENCE,
  ISSUER,
  TENANT_ALPHA,
  TENANT_BETA,
  generateRsaKeyMaterial,
  mintCompactJws,
  mintValidRs256Token,
  startFakeJwksServer,
  type FakeIdp,
} from "./identity-test-helpers.js";

/**
 * AR2-022 验收：跨租户对象访问拒绝 —— 全程走真实适配器路径
 * （OidcIdentityAdapter：RS256+JWKS+iss/aud+skew），不是 demo 注册表。
 * 真实 arena-api HTTP 监听器 + 本地假 IdP（JWKS）+ 真实 RSA 令牌。
 *
 * 对抗向量沿袭 grg_00000005 纪律：
 * - 跨租户 404 与不存在 404 字节不可区分（无存在性预言机）；
 * - 认证失败（伪造/过期/错受众/错签发者）统一 401 信封（无签名预言机）；
 * - 请求体 tenant 字段仍被冻结 schema 拒绝（租户永远服务端推导）。
 */

const keyA = generateRsaKeyMaterial("kid-auth-1");
const attackerKey = generateRsaKeyMaterial("kid-attacker");
const NOW = Math.floor(Date.now() / 1000);

interface TestServer {
  base: string;
  close(): Promise<void>;
}

async function startOidcServer(idp: FakeIdp): Promise<TestServer> {
  const runtime = createInMemoryRuntime();
  const adapter = createOidcIdentityAdapter({
    issuer: ISSUER,
    audience: AUDIENCE,
    jwksUri: idp.jwksUri,
    clockSkewSeconds: 60,
    jwksCacheTtlMs: 60_000,
  });
  // 与 main.ts 生产组合一致：启动探测（影响 readyz；验证路径 fail-closed 不变）。
  await adapter.probe();
  const server = createArenaServer({ runtime, auth: createAuthGateway(adapter) });
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
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body: json };
}

function validAlphaToken(): string {
  return mintValidRs256Token(keyA, NOW, { arena: TENANT_ALPHA, jti: `alpha-${NOW}` });
}

function validBetaToken(): string {
  return mintValidRs256Token(keyA, NOW, { arena: TENANT_BETA, jti: `beta-${NOW}` });
}

test("cross-tenant denial through the real OIDC adapter path (byte-indistinguishable 404)", async () => {
  const idp = await startFakeJwksServer([keyA.jwk]);
  const server = await startOidcServer(idp);
  try {
    // alpha 令牌创建 escalation（真实命令路径）。
    const created = await call(server.base, "POST", "/v1/escalations", VALID_REQUEST, {
      authorization: `Bearer ${validAlphaToken()}`,
      "x-idempotency-key": "key-oidc-1",
    });
    assert.equal(created.status, 201);
    const escalationId = created.body["escalation_id"];
    assert.ok(typeof escalationId === "string");

    // beta 令牌（完全有效、已验证、不同租户声明）探测 alpha 的对象。
    const crossTenant = await call(
      server.base,
      "GET",
      `/v1/escalations/${escalationId as string}`,
      undefined,
      { authorization: `Bearer ${validBetaToken()}` },
    );
    assert.equal(crossTenant.status, 404);

    // 不存在 ID 的探测（同租户）⇒ 必须与跨租户 404 逐字节一致（无存在性预言机）。
    const nonexistent = await call(server.base, "GET", "/v1/escalations/esc_00000000", undefined, {
      authorization: `Bearer ${validAlphaToken()}`,
    });
    assert.equal(nonexistent.status, 404);
    assert.equal(
      JSON.stringify(crossTenant.body),
      JSON.stringify(nonexistent.body),
      "cross-tenant and not-found 404 bodies must be byte-identical (no existence oracle)",
    );

    // beta 列表视图为空（租户隔离列表面）。
    const list = await call(server.base, "GET", "/v1/escalations", undefined, {
      authorization: `Bearer ${validBetaToken()}`,
    });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body["items"], []);
    assert.equal(list.body["tenant_scope"], TENANT_BETA.tenant_id);

    // timeline 同样跨租户拒绝。
    const timeline = await call(
      server.base,
      "GET",
      `/v1/escalations/${escalationId as string}/timeline`,
      undefined,
      { authorization: `Bearer ${validBetaToken()}` },
    );
    assert.equal(timeline.status, 404);
  } finally {
    await server.close();
    await idp.close();
  }
});

test("adversarial tokens through the real adapter path are uniform 401s (no oracle)", async () => {
  const idp = await startFakeJwksServer([keyA.jwk]);
  const server = await startOidcServer(idp);
  try {
    const vectors: Array<[string, string]> = [
      [
        "forged signature",
        `Bearer ${mintCompactJws({ key: attackerKey, claims: { ...alphaClaims() }, headerOverride: { kid: keyA.kid } })}`,
      ],
      [
        "tampered signature",
        `Bearer ${mintCompactJws({ key: keyA, claims: alphaClaims(), tamperSignature: true })}`,
      ],
      [
        "expired",
        `Bearer ${mintValidRs256Token(keyA, NOW, { arena: TENANT_ALPHA, exp: NOW - 600 })}`,
      ],
      [
        "not yet valid",
        `Bearer ${mintValidRs256Token(keyA, NOW, { arena: TENANT_ALPHA, nbf: NOW + 600 })}`,
      ],
      [
        "wrong audience",
        `Bearer ${mintValidRs256Token(keyA, NOW, { arena: TENANT_ALPHA, aud: "other-api" })}`,
      ],
      [
        "wrong issuer",
        `Bearer ${mintValidRs256Token(keyA, NOW, { arena: TENANT_ALPHA, iss: "https://evil.example" })}`,
      ],
      [
        "alg none",
        `Bearer ${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(alphaClaims())).toString("base64url")}.`,
      ],
      ["garbage token", "Bearer not-a-jws-at-all"],
      ["basic scheme", "Basic dXNlcjpwYXNz"],
      ["no header", ""],
    ];
    const bodies: string[] = [];
    for (const [name, header] of vectors) {
      const headers: Record<string, string> = {};
      if (header.length > 0) headers["authorization"] = header;
      const response = await call(server.base, "GET", "/v1/escalations", undefined, headers);
      assert.equal(response.status, 401, name);
      assert.equal(response.body["code"], "ARENA_INTERNAL_ERROR", `${name}: uniform envelope`);
      bodies.push(JSON.stringify(response.body));
    }
    // 全部失败体逐字节一致（无失败原因预言机；correlation/request id 抽出后比对）。
    const normalized = bodies.map((body) =>
      body.replace(/"correlation_id":"[^"]*"/g, "").replace(/"request_id":(null|"[^"]*")/g, ""),
    );
    assert.ok(normalized.every((body) => body === normalized[0]));
  } finally {
    await server.close();
    await idp.close();
  }
});

test("request-body tenant override attempt is rejected through the OIDC path (frozen schema)", async () => {
  const idp = await startFakeJwksServer([keyA.jwk]);
  const server = await startOidcServer(idp);
  try {
    const smuggled = { ...VALID_REQUEST, tenant: "tnt_99999999", request_digest: "cd".repeat(32) };
    const response = await call(server.base, "POST", "/v1/escalations", smuggled, {
      authorization: `Bearer ${validAlphaToken()}`,
      "x-idempotency-key": "key-oidc-2",
    });
    assert.equal(response.status, 400);
    assert.equal(response.body["code"], "ARENA_UNKNOWN_FIELD");
  } finally {
    await server.close();
    await idp.close();
  }
});

test("readyz and /v1/contract disclose the active OIDC identity adapter", async () => {
  const idp = await startFakeJwksServer([keyA.jwk]);
  const server = await startOidcServer(idp);
  try {
    const ready = await call(server.base, "GET", "/readyz");
    assert.equal(ready.status, 200);
    assert.equal(ready.body["status"], "ready");
    const auth = (ready.body["dependencies"] as Record<string, Record<string, unknown>>)["auth"];
    assert.equal(auth["mode"], "oidc_jwks_v1");
    assert.equal(auth["ready"], true);

    const contract = await call(server.base, "GET", "/v1/contract");
    assert.equal(contract.status, 200);
    const disclosures = contract.body["disclosures"] as string[];
    assert.ok(
      disclosures.some((line) =>
        line.includes("active identity adapter: oidc_jwks_v1 (IDN1.0 IDN1.0)"),
      ),
      "contract discloses the active identity adapter",
    );
    assert.ok(disclosures.some((line) => line.includes("identity adapter seam IDN1.0")));
  } finally {
    await server.close();
    await idp.close();
  }
});

test("demo default composition is unchanged (mode disclosure + demo tokens still work)", async () => {
  const runtime = createInMemoryRuntime();
  const server = createArenaServer({ runtime });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  try {
    const ready = await call(base, "GET", "/readyz");
    const auth = (ready.body["dependencies"] as Record<string, Record<string, unknown>>)["auth"];
    assert.equal(auth["mode"], "demo_registry");
    assert.equal(auth["ready"], true);

    const created = await call(base, "POST", "/v1/escalations", VALID_REQUEST, {
      authorization: "Bearer demo-token-requester-alpha",
      "x-idempotency-key": "key-demo-1",
    });
    assert.equal(created.status, 201);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function alphaClaims(): Record<string, unknown> {
  return {
    iss: ISSUER,
    sub: TENANT_ALPHA.principal_id,
    aud: AUDIENCE,
    exp: NOW + 600,
    iat: NOW - 10,
    arena_tenant_context: TENANT_ALPHA,
  };
}

const VALID_REQUEST = {
  contract_version: "ES2.0",
  client_application_id: "app_00000001",
  caller_idempotency_key: "idem-key-oidc-0001",
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
