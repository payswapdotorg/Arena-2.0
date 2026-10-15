import assert from "node:assert/strict";
import test from "node:test";
import { ARENA_SCREEN_IDS } from "../../src/contract.js";
import {
  firstScreen,
  hashForScreen,
  lastScreen,
  nextScreen,
  refusalText,
  screenAt,
  screenFromHash,
} from "../../src/nav/model.js";

test("roving next/prev wrap around the closed vocabulary", () => {
  assert.equal(nextScreen("requester", 1), "expert");
  assert.equal(nextScreen("operations", 1), "requester");
  assert.equal(nextScreen("requester", -1), "operations");
  assert.equal(nextScreen("expert", -1), "requester");
});

test("home/end map to the vocabulary endpoints", () => {
  assert.equal(firstScreen(), ARENA_SCREEN_IDS[0]);
  assert.equal(lastScreen(), ARENA_SCREEN_IDS[ARENA_SCREEN_IDS.length - 1]);
  assert.equal(screenAt(0), firstScreen());
  assert.equal(screenAt(-1), lastScreen());
  assert.equal(screenAt(7), ARENA_SCREEN_IDS[2]);
});

test("refusal text renders typed refusals verbatim (never softened)", () => {
  assert.equal(
    refusalText({ kind: "unregistered_screen", screenId: "coding-agent-workspace" }),
    'Navigation refused — screen "coding-agent-workspace" is not registered in this shell.',
  );
  assert.equal(
    refusalText({ kind: "navigation_unavailable", reason: "shell not mounted" }),
    "Navigation refused — shell not mounted.",
  );
});

test("hash round-trips for known screens; unknown hashes are null (no guessing)", () => {
  for (const screen of ARENA_SCREEN_IDS) {
    assert.equal(screenFromHash(hashForScreen(screen)), screen);
  }
  assert.equal(screenFromHash("#/coding-agent"), null);
  assert.equal(screenFromHash(""), null);
  assert.equal(screenFromHash("#/requester?extra=1"), null);
});
