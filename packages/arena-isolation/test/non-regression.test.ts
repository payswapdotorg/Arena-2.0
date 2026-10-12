import assert from "node:assert/strict";
import test from "node:test";
import { checkCapsuleManifest, PRODUCTION_ENABLED } from "@arena/capsule";
import { CAPSULE_FAIL_CLOSED_RULE, capsuleManifestSchema } from "@arena/contracts";
import { arenaIsolationModule } from "../src/module.js";
import { validIsolationManifest } from "./helpers.js";

/**
 * Non-regression: importing @arena/isolation (and running its real provider
 * surface) must not disturb the frozen families — the capsule seam stays
 * intact, its fail-closed gate still works, PRODUCTION_ENABLED stays false,
 * and the CF1.0 schema still round-trips a capsule manifest.
 */

test("importing the isolation package leaves the capsule seam intact", () => {
  assert.equal(PRODUCTION_ENABLED, false);
  const check = checkCapsuleManifest(validIsolationManifest());
  assert.equal(check.kind, "VALID");
  assert.equal(typeof CAPSULE_FAIL_CLOSED_RULE, "string");
});

test("the capsule manifest schema still rejects unknown fields (strict CF1.0)", () => {
  const raw = validIsolationManifest() as unknown as Record<string, unknown>;
  raw.surprise_field = true;
  const parsed = capsuleManifestSchema.safeParse(raw);
  assert.equal(parsed.success, false);
});

test("the isolation module manifest declares its fence and providers", () => {
  assert.equal(arenaIsolationModule.id, "arena-isolation");
  assert.deepEqual(arenaIsolationModule.requires, ["arena-contracts", "arena-capsule"]);
  assert.equal(arenaIsolationModule.publicEntrypoints[0], "contract.ts");
  for (const provided of arenaIsolationModule.provides) {
    assert.equal(typeof provided, "string");
  }
});

test("both frozen packages stay loadable together with the isolation package", async () => {
  const capsule = await import("@arena/capsule");
  const contracts = await import("@arena/contracts");
  const isolation = await import("../src/contract.js");
  assert.equal(typeof capsule.LinuxNamespaceIsolationProvider, "undefined");
  assert.equal(typeof capsule.SyntheticLocalProvider, "function");
  assert.equal(typeof contracts.capsuleManifestSchema, "object");
  assert.equal(typeof isolation.LinuxNamespaceIsolationProvider, "function");
  assert.equal(typeof isolation.probeIsolationEnvironment, "function");
});
