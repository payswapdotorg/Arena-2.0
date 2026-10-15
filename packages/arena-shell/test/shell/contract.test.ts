import assert from "node:assert/strict";
import test from "node:test";
import {
  ARENA_DEFAULT_SCREEN,
  ARENA_EVIDENCE_GRADES,
  ARENA_PRODUCT_NAME,
  ARENA_RELEASE_POSTURE,
  ARENA_ROLE_LENSES,
  ARENA_SCREEN_IDS,
  isArenaRoleLens,
  isArenaScreenId,
} from "../../src/contract.js";
import { ArenaScreenRegistry } from "../../src/shell/registry.js";

test("screen vocabulary is the frozen closed set (spec §1.1)", () => {
  assert.deepEqual(ARENA_SCREEN_IDS, [
    "requester",
    "expert",
    "reviewer",
    "developer",
    "operations",
  ]);
  assert.equal(ARENA_DEFAULT_SCREEN, "requester");
});

test("role lens vocabulary is frozen and presentation-only (spec §1.3)", () => {
  assert.deepEqual(ARENA_ROLE_LENSES, ["requester", "expert", "reviewer", "developer", "operator"]);
});

test("vocabulary guards accept members and reject everything else", () => {
  assert.equal(isArenaScreenId("requester"), true);
  assert.equal(isArenaScreenId("chat"), false);
  assert.equal(isArenaScreenId(null), false);
  assert.equal(isArenaRoleLens("operator"), true);
  assert.equal(isArenaRoleLens("admin"), false);
});

test("registry rejects ids outside the frozen vocabulary", () => {
  const registry = new ArenaScreenRegistry();
  assert.throws(() =>
    registry.register({
      // @ts-expect-error deliberately outside the vocabulary
      screen: "coding-agent-workspace",
      title: "ZCode",
      render: () => null,
    }),
  );
});

test("unregistered screens surface a typed refusal, never silence (spec §1.2)", () => {
  const registry = new ArenaScreenRegistry();
  const outcomes: unknown[] = [];
  const port = {
    navigate(screenId: "requester") {
      const refused = !registry.lookup(screenId);
      const outcome = refused
        ? { kind: "refused", refusal: { kind: "unregistered_screen", screenId } }
        : { kind: "navigated", screen: screenId };
      outcomes.push(outcome);
      return outcome;
    },
    activeScreen: () => "requester" as const,
  };
  const outcome = port.navigate("requester");
  assert.deepEqual(outcome, {
    kind: "refused",
    refusal: { kind: "unregistered_screen", screenId: "requester" },
  });
  registry.register({ screen: "requester", title: "Requester", render: () => null });
  assert.deepEqual(port.navigate("requester"), { kind: "navigated", screen: "requester" });
});

test("product identity constants (spec §2.1)", () => {
  assert.equal(ARENA_PRODUCT_NAME, "Arena");
});

test("release posture is the recorded honest basis (spec §2.3)", () => {
  assert.equal(ARENA_RELEASE_POSTURE.releaseDecision, "NOT_GO");
  assert.equal(ARENA_RELEASE_POSTURE.financeMode, "test_mode");
  assert.equal(ARENA_RELEASE_POSTURE.untrustedExecution, "disabled");
  assert.ok(ARENA_RELEASE_POSTURE.decisionBasis.endsWith("AR2-015-gate-report-2026-10-11.md"));
  assert.ok(ARENA_RELEASE_POSTURE.isolationEvidence.includes("AR2-019"));
});

test("evidence grade vocabulary flows verbatim — no inflation (spec §2.2)", () => {
  assert.deepEqual(ARENA_EVIDENCE_GRADES, ["DEMO", "FIXTURE", "REAL"]);
});
