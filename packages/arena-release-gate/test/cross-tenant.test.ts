import assert from "node:assert/strict";
import test from "node:test";
import { ArenaSdkClient, buildGenericEscalationRequest } from "@arena/sdk";
import { ALPHA, BETA, probe, startRealApi } from "./support.js";

/**
 * AR2-015 — 对抗剖面 1（issue #17：cross-tenant attacks）：
 * 真实 arena-api 进程上的跨租户对象 ID 猜测扫描。
 *
 * 断言（G2 门行为）：
 * - 受害租户对象（escalation/timeline/result/payment-status/command）
 *   对第二租户全部 fail-closed 404，且与「不存在的 ID」逐字节不可区分
 *   （无存在性 oracle）；
 * - 跨租户列表为空（枚举安全）；ID 枚举对攻击者与受害者无差别收益；
 * - 请求体携带 tenant 字段 ⇒ ARENA_UNKNOWN_FIELD（租户上下文只从凭据
 *   派生 —— 冻结行为）；
 * - 未知令牌 ⇒ 401。
 */

test("cross-tenant ID-guessing sweep: every object route fails closed, indistinguishable from not-found", async () => {
  const api = await startRealApi();
  try {
    // 1) 受害者（租户 A = tnt_00000001）真实创建一个 escalation（真实 HTTP）。
    const client = new ArenaSdkClient({ baseUrl: api.baseUrl });
    const submitted = await client.submitEscalation(
      buildGenericEscalationRequest({
        title: "Cross-tenant sweep fixture escalation",
        outcome_description: "Fixture escalation for the release-gate tenant-boundary sweep.",
        output_schema_id: "sch_release_gate_sweep",
        caller_idempotency_key: `release-gate-sweep-${Date.now()}`,
        client_application_id: "app_00000001",
      }),
      ALPHA,
    );
    assert.equal(submitted.kind, "CREATED");
    const escalationId = submitted.kind === "CREATED" ? submitted.escalation_id : "";

    // 2) 攻击者（租户 B = tnt_00000002）对每个对象路由探测受害者的真实 ID。
    const routes = [
      `/v1/escalations/${escalationId}`,
      `/v1/escalations/${escalationId}/timeline`,
      `/v1/escalations/${escalationId}/result`,
      `/v1/escalations/${escalationId}/payment-status`,
    ];
    for (const route of routes) {
      const crossTenant = await probe(api.baseUrl, route, { token: BETA.bearerToken });
      assert.equal(crossTenant.status, 404, `${route}: cross-tenant access must fail closed`);
      const code = typeof crossTenant.json.code === "string" ? crossTenant.json.code : "";
      assert.ok(code.startsWith("ARENA_"), `${route}: typed error code required`);
    }

    // 3) 不可区分性：攻击者探测真实 ID vs 受害者探测幽灵 ID —— status、
    //    code 与响应键集合完全一致（值中仅 correlation/request id 逐请求
    //    派生）—— 不存在存在性 oracle。
    for (const route of routes) {
      const attackerReal = await probe(api.baseUrl, route, { token: BETA.bearerToken });
      const ownerGhost = await probe(api.baseUrl, route.replace(escalationId, "esc_00000099"), {
        token: ALPHA.bearerToken,
      });
      assert.equal(attackerReal.status, ownerGhost.status, route);
      assert.equal(attackerReal.json.code, ownerGhost.json.code, route);
      assert.deepEqual(
        Object.keys(attackerReal.json).sort(),
        Object.keys(ownerGhost.json).sort(),
        route,
      );
    }

    // 4) 猜测邻居 ID：攻击者与受害者同样一律 404 + 同码（ID 枚举无差别）。
    for (const id of ["esc_00000002", "esc_00000003", "esc_99999999", "not-an-id"]) {
      const attacker = await probe(api.baseUrl, `/v1/escalations/${id}`, {
        token: BETA.bearerToken,
      });
      const owner = await probe(api.baseUrl, `/v1/escalations/${id}`, {
        token: ALPHA.bearerToken,
      });
      assert.equal(attacker.status, 404);
      assert.equal(owner.status, 404);
      assert.equal(attacker.json.code, owner.json.code);
    }

    // 5) 租户列表隔离：攻击者列表为空；受害者列表恰含该对象。
    const attackerList = await probe(api.baseUrl, "/v1/escalations", { token: BETA.bearerToken });
    assert.equal(attackerList.status, 200);
    assert.equal(attackerList.json.tenant_scope, "tnt_00000002");
    assert.deepEqual(attackerList.json.items, []);
    const ownerList = await probe(api.baseUrl, "/v1/escalations", { token: ALPHA.bearerToken });
    assert.equal(ownerList.json.tenant_scope, "tnt_00000001");
    const items = Array.isArray(ownerList.json.items) ? ownerList.json.items : [];
    assert.equal(items.length, 1);

    // 6) 请求体 tenant 字段注入：strict schema 拒绝未知字段（ARENA_UNKNOWN_FIELD）
    //    —— 租户上下文永远服务端派生（冻结行为）。
    const injected = await probe(api.baseUrl, "/v1/escalations", {
      method: "POST",
      token: ALPHA.bearerToken,
      body: {
        title: "tenant field injection attempt",
        outcome_description: "Attempting to declare a tenant in the request body.",
        output_schema_id: "sch_release_gate_sweep",
        caller_idempotency_key: `injection-${Date.now()}`,
        client_application_id: "app_00000001",
        tenant_id: "tnt_00000002",
      },
    });
    assert.equal(injected.status, 400);
    assert.equal(injected.json.code, "ARENA_UNKNOWN_FIELD");

    // 7) 跨租户命令：攻击者用合法命令名对受害者 escalation 发命令
    //    ⇒ getEscalation 租户作用域 ⇒ 404 fail-closed（而非执行）。
    const crossCommand = await probe(
      api.baseUrl,
      `/v1/escalations/${escalationId}/commands/AcceptOffer`,
      { method: "POST", token: BETA.bearerToken, body: { facts: {} } },
    );
    assert.equal(crossCommand.status, 404);
    const crossCode = typeof crossCommand.json.code === "string" ? crossCommand.json.code : "";
    assert.ok(crossCode.startsWith("ARENA_"));

    // 8) 未知令牌 ⇒ 401（认证边界）。
    const unknownToken = await probe(api.baseUrl, "/v1/escalations", {
      token: "demo-token-attacker-forged",
    });
    assert.equal(unknownToken.status, 401);
  } finally {
    await api.stop();
  }
});
