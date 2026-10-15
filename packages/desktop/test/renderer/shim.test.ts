import assert from "node:assert/strict";
import test from "node:test";
import { createHash as nodeCreateHash } from "node:crypto";
import { createHash, sha256Hex } from "../../src/renderer/src/arenaNodeCryptoShim.js";

/**
 * UIA-002 —— renderer sha256 shim 与 node:crypto 的逐字节对拍
 * （FIPS 180-4 标准向量 + 多字节 UTF-8 + 分块链式 update + 块边界跨度）。
 */

function nodeSha256(input: string): string {
  return nodeCreateHash("sha256").update(input).digest("hex");
}

function shimSha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** FIPS 180-4 标准测试向量（对拍 node:crypto，逐字节断言）。 */
const FIPS_VECTORS: readonly { label: string; input: string }[] = [
  { label: "empty string", input: "" },
  { label: "abc", input: "abc" },
  {
    label: "448-bit two-block message",
    input: "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
  },
  {
    label: "896-bit seven-block message",
    input:
      "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmno" +
      "ijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
  },
  { label: "million 'a' (one-million-block message)", input: "a".repeat(1_000_000) },
];

test("FIPS 180-4 向量与 node:crypto 逐字节一致", () => {
  for (const vector of FIPS_VECTORS) {
    const expected = nodeSha256(vector.input);
    const actual = shimSha256(vector.input);
    assert.equal(actual, expected, `vector: ${vector.label}`);
    // 已知摘要抽查（防 node:crypto 与 shim 同错同漏的独立锚点）。
    if (vector.label === "abc") {
      assert.equal(actual, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
    if (vector.label === "empty string") {
      assert.equal(actual, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }
    if (vector.label === "million 'a' (one-million-block message)") {
      assert.equal(actual, "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
    }
  }
});

test("多字节 UTF-8 输入与 node:crypto 逐字节一致", () => {
  const cases = [
    "Arena — 请求摘要",
    "你好世界。証拠ファースト。",
    "emoji escalation ✓ 🚀 (surrogate pairs)",
    "mixed 中文 with\ttabs\nand newlines ",
    "äöüß àéçù",
  ];
  for (const input of cases) {
    assert.equal(shimSha256(input), nodeSha256(input));
  }
});

test("分块 update 链式 == 一次性 update（与 node:crypto 分块语义一致）", () => {
  const parts = ["Arena ", "escalation ", "request digest ", "— 分块提交"];
  const shimChained = createHash("sha256");
  const nodeChained = nodeCreateHash("sha256");
  for (const part of parts) {
    shimChained.update(part);
    nodeChained.update(part);
  }
  assert.equal(shimChained.digest("hex"), nodeChained.digest("hex"));
  assert.equal(shimChained.digest("hex"), shimSha256(parts.join("")));
});

test("块边界跨度（55/56/63/64/65/128 字节附近）与 node:crypto 一致", () => {
  for (const length of [0, 1, 54, 55, 56, 62, 63, 64, 65, 127, 128, 129, 1000]) {
    const input = `x${"0123456789abcdef".repeat(Math.ceil(length / 16))}`.slice(0, length);
    assert.equal(shimSha256(input), nodeSha256(input), `length: ${length}`);
  }
});

test("sha256Hex 直接暴露面与 createHash 形态一致", () => {
  const input = "arena-desktop-mount digest probe";
  assert.equal(sha256Hex(new TextEncoder().encode(input)), nodeSha256(input));
});

test("shim 兼容面边界：非 sha256 / 非 hex 拒绝（与 workbench 用法一致的窄面）", () => {
  assert.throws(() => createHash("md5" as "sha256"), /only sha256/);
  const hash = createHash("sha256");
  assert.throws(() => hash.digest("base64" as "hex"), /only hex digest/);
});
