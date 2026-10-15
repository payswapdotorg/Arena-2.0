import assert from "node:assert/strict";
import test from "node:test";
import { parseDesktopEntryMode } from "../../src/renderer/src/arenaDesktopMount.js";

/**
 * UIA-002 —— 入口模式谓词（与 web 的 isLegacyWorkspaceEntry 同一语义，
 * 按 entry 复制一份；spec §1.2「桌面：Arena 外壳是主窗口面」+ 显式回退入口）。
 */
test("plain query → arena-first（Arena 外壳是默认主窗口面）", () => {
  assert.equal(parseDesktopEntryMode(""), "arena-first");
  assert.equal(parseDesktopEntryMode("?foo=bar"), "arena-first");
  assert.equal(parseDesktopEntryMode("?restoreSession=true&locale=zh-CN"), "arena-first");
});

test("?workspace=1 → workspace-fallback（显式回退入口）", () => {
  assert.equal(parseDesktopEntryMode("?workspace=1"), "workspace-fallback");
  assert.equal(parseDesktopEntryMode("?workspace=1&foo=bar"), "workspace-fallback");
});

test("?app=workspace → workspace-fallback（回退入口的第二拼写）", () => {
  assert.equal(parseDesktopEntryMode("?app=workspace"), "workspace-fallback");
  assert.equal(parseDesktopEntryMode("?a=1&app=workspace&b=2"), "workspace-fallback");
});

test("?workspace=0 / ?app=other → arena-first（只有精确回退拼写才回退）", () => {
  assert.equal(parseDesktopEntryMode("?workspace=0"), "arena-first");
  assert.equal(parseDesktopEntryMode("?workspace="), "arena-first");
  assert.equal(parseDesktopEntryMode("?app=other"), "arena-first");
  assert.equal(parseDesktopEntryMode("?app=workspaces"), "arena-first");
});

test("无前导 ? 的 query 串同样按 URLSearchParams 语义解析", () => {
  assert.equal(parseDesktopEntryMode("workspace=1"), "workspace-fallback");
  assert.equal(parseDesktopEntryMode("app=workspace"), "workspace-fallback");
  assert.equal(parseDesktopEntryMode("workspace=0"), "arena-first");
});
