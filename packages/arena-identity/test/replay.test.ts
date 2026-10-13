import assert from "node:assert/strict";
import test from "node:test";
import { createReplayGuard } from "../src/contract.js";

/**
 * 重放防线向量（AR2-022）：jti_once 拒绝窗口内重放；none 策略放行；
 * 过期条目清扫；有界记忆淘汰。
 */

const NOW = 1_800_000;

test("policy none accepts repeated presentations (disclosed default)", () => {
  const guard = createReplayGuard({ policy: "none" });
  assert.equal(guard.checkAndRecord("iss::jti-1", NOW + 600, NOW), true);
  assert.equal(guard.checkAndRecord("iss::jti-1", NOW + 600, NOW), true);
  assert.equal(guard.size(), 0);
});

test("policy jti_once rejects the second presentation within validity", () => {
  const guard = createReplayGuard({ policy: "jti_once" });
  assert.equal(guard.checkAndRecord("iss::jti-1", NOW + 600, NOW), true);
  assert.equal(guard.checkAndRecord("iss::jti-1", NOW + 600, NOW), false);
  assert.equal(guard.checkAndRecord("iss::jti-2", NOW + 600, NOW), true);
});

test("expired entries are swept (memory stays bounded by validity windows)", () => {
  const guard = createReplayGuard({ policy: "jti_once" });
  assert.equal(guard.checkAndRecord("iss::jti-1", NOW + 60, NOW), true);
  // 窗口过后：同一 jti 重放不再被记忆命中（原令牌已过期，本就不该再被接受）。
  const later = NOW + 120;
  assert.equal(guard.checkAndRecord("iss::jti-2", later + 60, later), true);
  assert.equal(guard.size(), 1);
});

test("bounded eviction: capacity pressure evicts the earliest-expiring entry", () => {
  const guard = createReplayGuard({ policy: "jti_once", maxEntries: 2 });
  assert.equal(guard.checkAndRecord("iss::jti-early", NOW + 100, NOW), true);
  assert.equal(guard.checkAndRecord("iss::jti-late", NOW + 900, NOW), true);
  // 容量已满：插入第三条 ⇒ 最早过期的（early）被淘汰。
  assert.equal(guard.checkAndRecord("iss::jti-mid", NOW + 500, NOW), true);
  assert.equal(guard.size(), 2);
  assert.equal(guard.checkAndRecord("iss::jti-late", NOW + 900, NOW), false);
  assert.equal(guard.checkAndRecord("iss::jti-mid", NOW + 500, NOW), false);
  // early 已被淘汰（有界记忆的诚实取舍 —— 文档披露）。
  assert.equal(guard.checkAndRecord("iss::jti-early", NOW + 100, NOW), true);
});

test("different issuers with the same jti are distinct keys", () => {
  const guard = createReplayGuard({ policy: "jti_once" });
  assert.equal(guard.checkAndRecord("https://a/::jti-1", NOW + 600, NOW), true);
  assert.equal(guard.checkAndRecord("https://b/::jti-1", NOW + 600, NOW), true);
});
