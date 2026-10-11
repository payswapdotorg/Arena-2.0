import assert from "node:assert/strict";
import test from "node:test";
import type { ValidatorDescriptor } from "../src/contract.js";
import {
  BoundedValidatorRunner,
  ValidatorRegistry,
  normalizeFailure,
  normalizeRun,
} from "../src/contract.js";

/**
 * AR2-007 — validator 注册表 + 有界调用验收（issue #9）：
 * descriptor 冻结 schema 校验；(id,version) 精确解析；同键描述符不可变；
 * allowed_commands 之外的命令 COMMAND_NOT_ALLOWED；timeout_seconds 真实
 * 计时器强制（超时 = 类型化 FAIL）；执行异常 = EXECUTION_ERROR；
 * 归一化输出按 kind 携带结构化结果。
 */

const DESCRIPTOR: ValidatorDescriptor = {
  validator_id: "val_00000001",
  validator_version: "1.2.0",
  kind: "deterministic",
  allowed_commands: ["pnpm", "test"],
  timeout_seconds: 2,
  resource_limits: "2 vCPU / 3 GB",
  evidence_policy: "trusted runner logs and hashes",
};

test("registry: accepts a frozen-schema descriptor and resolves by (id, version)", () => {
  const registry = new ValidatorRegistry();
  const check = registry.register(DESCRIPTOR);
  assert.equal(check.ok, true);
  assert.equal(registry.resolve("val_00000001", "1.2.0")?.validator_id, "val_00000001");
  assert.equal(registry.resolve("val_00000001", "1.3.0"), null);
  assert.equal(registry.resolve("val_00000009", "1.2.0"), null);
});

test("registry: rejects schema violations (unknown field, non-positive timeout)", () => {
  const registry = new ValidatorRegistry();
  const bad = { ...DESCRIPTOR, secret_field: "no" };
  const check = registry.register(bad);
  assert.equal(check.ok, false);
  assert.ok(check.issues.length > 0);

  // 冻结 schema 允许空 allowed_commands（.max(128) 无 .min(1)）——
  // 注册表不得比冻结契约更严（不得自创规则）；这里记录该行为而非拒绝。
  const emptyCommands = { ...DESCRIPTOR, validator_id: "val_00000007", allowed_commands: [] };
  const check2 = registry.register(emptyCommands);
  assert.equal(check2.ok, true);

  const badTimeout = { ...DESCRIPTOR, timeout_seconds: 0 };
  const check3 = registry.register(badTimeout);
  assert.equal(check3.ok, false);
});

test("registry: same (id,version) re-registration is idempotent; a different descriptor is refused", () => {
  const registry = new ValidatorRegistry();
  assert.equal(registry.register(DESCRIPTOR).ok, true);
  assert.equal(registry.register(DESCRIPTOR).ok, true);
  const mutated = { ...DESCRIPTOR, timeout_seconds: 99 };
  const check = registry.register(mutated);
  assert.equal(check.ok, false);
});

test("bounded invocation: command outside allowed_commands is rejected, never executed", async () => {
  let executed = false;
  const runner = new BoundedValidatorRunner(DESCRIPTOR, () => {
    executed = true;
    return { ok: true, note: "should not run" };
  });
  const outcome = await runner.execute("curl", {});
  assert.equal(outcome.ok, false);
  assert.match(outcome.note, /COMMAND_NOT_ALLOWED/);
  assert.equal(executed, false);
});

test("bounded invocation: timeout_seconds is enforced with a real timer", async () => {
  const slow = new BoundedValidatorRunner(
    { ...DESCRIPTOR, timeout_seconds: 1 },
    () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, note: "late" }), 4000)),
  );
  const started = Date.now();
  const outcome = await slow.execute("pnpm", {});
  const elapsed = Date.now() - started;
  assert.equal(outcome.ok, false);
  assert.match(outcome.note, /TIMEOUT/);
  assert.ok(elapsed < 3000, `timeout must fire near the 1s bound (elapsed ${elapsed}ms)`);
});

test("bounded invocation: thrown errors become typed EXECUTION_ERROR failures", async () => {
  const throwing = new BoundedValidatorRunner(DESCRIPTOR, () => {
    throw new Error("validator crashed");
  });
  const outcome = await throwing.execute("test", {});
  assert.equal(outcome.ok, false);
  assert.match(outcome.note, /EXECUTION_ERROR: validator crashed/);
});

test("normalization: deterministic PASS/FAIL verdicts carry machine-readable structure", () => {
  const pass = normalizeRun(DESCRIPTOR, { ok: true, note: "exit_code=0" }, 42);
  assert.equal(pass.verdict.kind, "PASS");
  assert.equal(pass.validator_version, "1.2.0");
  assert.equal(pass.duration_ms, 42);
  assert.deepEqual(pass.samples, []);
  assert.deepEqual(pass.dimensions, []);

  const fail = normalizeRun(DESCRIPTOR, { ok: false, note: "exit_code=1" }, 7);
  assert.equal(fail.verdict.kind, "FAIL");
  const v = fail.verdict as { kind: "FAIL"; reason: string };
  assert.equal(v.reason, "exit_code=1");
});

test("normalization: statistical runs expose samples; rubric passes expose dimensions", () => {
  const statistical = normalizeRun(
    { ...DESCRIPTOR, kind: "statistical" },
    { ok: true, note: "sample 1 within threshold" },
    10,
  );
  assert.equal(statistical.samples.length, 1);
  assert.equal(statistical.samples[0]?.passed, true);

  const rubric = normalizeRun(
    { ...DESCRIPTOR, kind: "rubric" },
    { ok: true, note: "all dimensions >= threshold" },
    10,
  );
  assert.equal(rubric.dimensions.length, 1);
  assert.equal(rubric.dimensions[0]?.score, 1);
});

test("normalization: failures never silently pass (typed failure carries code)", () => {
  const failure = normalizeFailure(
    DESCRIPTOR,
    { code: "TIMEOUT", detail: "exceeded 2000ms" },
    2000,
  );
  assert.equal(failure.verdict.kind, "FAIL");
  assert.equal(failure.failure?.code, "TIMEOUT");
  assert.deepEqual(failure.samples, []);
});
