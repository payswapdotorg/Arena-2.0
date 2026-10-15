import assert from "node:assert/strict";
import test from "node:test";
import { resolveArenaDesktopBaseUrl } from "../../src/renderer/src/arenaDesktopMount.js";

/**
 * UIA-002 —— baseUrl 法则（VITE_ARENA_API_URL，与 web 同名变量）：
 * 去首尾空白、去尾部 `/`；空/全空白 → undefined = 诚实未配置姿态。
 */
test("undefined / 空串 / 全空白 → undefined（诚实未配置）", () => {
  assert.equal(resolveArenaDesktopBaseUrl(undefined), undefined);
  assert.equal(resolveArenaDesktopBaseUrl(""), undefined);
  assert.equal(resolveArenaDesktopBaseUrl("   "), undefined);
  assert.equal(resolveArenaDesktopBaseUrl("\t\n "), undefined);
});

test("首尾空白被剥掉（trim 语义）", () => {
  assert.equal(resolveArenaDesktopBaseUrl(" http://x/ "), "http://x");
  assert.equal(
    resolveArenaDesktopBaseUrl("\thttps://api.example.com\n"),
    "https://api.example.com",
  );
});

test("尾部斜杠（单个/多个）全部剥掉", () => {
  assert.equal(resolveArenaDesktopBaseUrl("http://x/"), "http://x");
  assert.equal(resolveArenaDesktopBaseUrl("http://x///"), "http://x");
  assert.equal(
    resolveArenaDesktopBaseUrl("https://api.example.com/v1/"),
    "https://api.example.com/v1",
  );
});

test("剥完只剩斜杠 → undefined（不产出空 baseUrl）", () => {
  assert.equal(resolveArenaDesktopBaseUrl("///"), undefined);
  assert.equal(resolveArenaDesktopBaseUrl("  //  "), undefined);
});

test("路径与端口保留（只动首尾空白与尾部斜杠）", () => {
  assert.equal(
    resolveArenaDesktopBaseUrl("http://127.0.0.1:8080/api/v1"),
    "http://127.0.0.1:8080/api/v1",
  );
  assert.equal(
    resolveArenaDesktopBaseUrl("https://arena.example.com/base/path///"),
    "https://arena.example.com/base/path",
  );
});
