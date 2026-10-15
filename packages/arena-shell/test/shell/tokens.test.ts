import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ARENA_TOKEN_GROUPS,
  ARENA_TOKEN_NAMES,
  EVIDENCE_GRADE_TOKENS,
  cssName,
  tokensByGroup,
} from "../../src/design/tokens.js";
import { ARENA_EVIDENCE_GRADES } from "../../src/contract.js";

const CSS_PATH = new URL("../../src/design/arena-tokens.css", import.meta.url).pathname;

function cssTokenNames(): string[] {
  const css = readFileSync(CSS_PATH, "utf8");
  return [...css.matchAll(/--(arena-[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
}

test("token catalog covers every --arena-* declared in the CSS (no orphan CSS tokens)", () => {
  const cssNames = cssTokenNames();
  const catalog = new Set(ARENA_TOKEN_NAMES);
  const orphans = cssNames.filter((n) => !catalog.has(n));
  assert.deepEqual(orphans, [], `CSS tokens missing from the TS catalog: ${orphans.join(", ")}`);
});

test("every catalog token is declared in the CSS (no dead mirror entries)", () => {
  const css = new Set(cssTokenNames());
  const dead = ARENA_TOKEN_NAMES.filter((n) => !css.has(n));
  assert.deepEqual(dead, [], `Catalog entries missing from CSS: ${dead.join(", ")}`);
});

test("token groups are the frozen set and fully populated", () => {
  assert.deepEqual(ARENA_TOKEN_GROUPS, [
    "brand",
    "surface",
    "text",
    "border",
    "status",
    "evidence",
    "focus",
    "spacing",
    "radius",
    "motion",
  ]);
  for (const group of ARENA_TOKEN_GROUPS) {
    assert.ok(tokensByGroup(group).length > 0, `group ${group} is empty`);
  }
});

test("status token set matches the typed verdict vocabulary (pass/denied/blocked/pending)", () => {
  const statuses = tokensByGroup("status").map((t) => t.name);
  for (const required of [
    "arena-color-status-pass",
    "arena-color-status-denied",
    "arena-color-status-blocked",
    "arena-color-status-pending",
  ]) {
    assert.ok(statuses.includes(required), `missing ${required}`);
  }
});

test("evidence-grade tokens map 1:1 to the frozen grade vocabulary (no inflation)", () => {
  assert.deepEqual(Object.keys(EVIDENCE_GRADE_TOKENS), [...ARENA_EVIDENCE_GRADES]);
  for (const [grade, token] of Object.entries(EVIDENCE_GRADE_TOKENS)) {
    assert.ok(ARENA_TOKEN_NAMES.includes(token.slice(2)), `token for ${grade} exists in catalog`);
    assert.equal(cssName(token.slice(2)), token);
  }
});

test("tokens carry the --arena-* namespace exclusively", () => {
  for (const name of ARENA_TOKEN_NAMES) {
    assert.ok(name.startsWith("arena-"), `token ${name} outside the namespace`);
    assert.ok(!name.startsWith("arena-arena"), `double prefix on ${name}`);
  }
});
