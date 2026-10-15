/**
 * MAINT-003（issue #73）—— web sha256 shim 的站点对拍脚本。
 *
 * UIA-001 集成记录声称本脚本已被持久化，但仓库里并不存在（记录高估了
 * 工件）—— 且当时的 9 个对拍用例没有覆盖 len ≡ 56 (mod 64) 的块边界，
 * 让 +8 填充缺陷溜了过去。本脚本把它真正落盘：FIPS 180-4 标准向量 +
 * 块边界扫掠 + 已知摘要独立锚点，任何站点可复跑。
 *
 * 运行：../../node_modules/.bin/tsx scripts/verify_sha256_shim.ts（在
 * packages/web 目录下；退出码 0 = 全部逐字节一致）。
 */
import { createHash as nodeCreateHash } from "node:crypto";
import { createHash } from "../packages/web/src/arenaNodeCryptoShim.js";

function nodeSha256(input: string): string {
  return nodeCreateHash("sha256").update(input).digest("hex");
}

function shimSha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

let failures = 0;

/** FIPS 180-4 标准测试向量（对拍 node:crypto，逐字节断言）。 */
const FIPS_VECTORS: readonly { label: string; input: string; known: string }[] = [
  {
    label: "empty string",
    input: "",
    known: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  },
  { label: "abc", input: "abc", known: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" },
  {
    // 56 字节 = 448-bit —— MAINT-003 缺陷的直接回归锚点（+8 会错）。
    label: "448-bit two-block message (MAINT-003 regression anchor)",
    input: "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    known: "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  },
  {
    label: "896-bit seven-block message",
    input:
      "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmno" +
      "ijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
    known: "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
  },
  {
    label: "million 'a'",
    input: "a".repeat(1_000_000),
    known: "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
  },
];

for (const vector of FIPS_VECTORS) {
  const expected = nodeSha256(vector.input);
  const actual = shimSha256(vector.input);
  const okNode = actual === expected;
  const okKnown = actual === vector.known;
  if (okNode && okKnown) {
    console.log(`PASS ${vector.label}`);
  } else {
    failures += 1;
    console.log(`FAIL ${vector.label}`);
    console.log(`  node:   ${expected}`);
    console.log(`  shim:   ${actual}`);
    console.log(`  known:  ${vector.known}`);
  }
}

/** 块边界扫掠（含 len ≡ 56 的缺陷类）。 */
const SWEEP_LENGTHS = [0, 1, 54, 55, 56, 57, 62, 63, 64, 65, 119, 120, 127, 128, 129, 255, 256, 1000];
for (const length of SWEEP_LENGTHS) {
  const input = `x${"0123456789abcdef".repeat(Math.ceil(length / 16))}`.slice(0, length);
  const expected = nodeSha256(input);
  const actual = shimSha256(input);
  if (actual === expected) {
    console.log(`PASS boundary sweep length ${length}`);
  } else {
    failures += 1;
    console.log(`FAIL boundary sweep length ${length}`);
    console.log(`  node:   ${expected}`);
    console.log(`  shim:   ${actual}`);
  }
}

/** 多字节 UTF-8（surrogate pairs 等）。 */
const UTF8_CASES = [
  "Arena — request digest",
  "你好世界。証拠ファースト。",
  "emoji escalation ✓ 🚀 (surrogate pairs)",
  "mixed 中文 with\ttabs\nand newlines ",
];
for (const input of UTF8_CASES) {
  const expected = nodeSha256(input);
  const actual = shimSha256(input);
  if (actual === expected) {
    console.log(`PASS utf8 (${input.length} chars)`);
  } else {
    failures += 1;
    console.log(`FAIL utf8 (${input.length} chars)`);
    console.log(`  node:   ${expected}`);
    console.log(`  shim:   ${actual}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} FAILURE(S) — the shim is NOT byte-identical to node:crypto`);
  process.exit(1);
}
console.log("\nALL PASS — the web sha256 shim is byte-identical to node:crypto (FIPS vectors + boundary sweep + utf8)");
