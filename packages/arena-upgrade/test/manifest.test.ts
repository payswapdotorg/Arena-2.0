import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTransformationManifest,
  executeTransformationOperation,
  initialEntries,
  replayManifest,
  computeManifestDigest,
  entriesDigest,
  type TransformationOperation,
} from "../src/manifest.js";
import { blenderDataset, ACTOR_AUTHOR, manifestOps, NOW } from "./fixtures.js";

/**
 * AR2-018 验收（issue #34）组 3：transformation manifest —— 重放确定性
 * （同源摘要 + 同 manifest → 同输出摘要）、未知操作版本 fail-closed、
 * manifest 不可变性、操作语义（normalize/filter/redact/deduplicate/reshape）。
 */

function build(ops: TransformationOperation[] = manifestOps(), dataset = blenderDataset()) {
  return buildTransformationManifest({
    dataset,
    intake_id: "itk_00000001",
    manifest_id: "mfs_00000001",
    ops,
    now: NOW,
    created_by: ACTOR_AUTHOR,
  });
}

test("manifest: a valid manifest builds and replays deterministically", () => {
  const built = build();
  assert.equal(built.outcome.kind, "OK");
  const manifest = built.manifest!;
  const first = replayManifest(blenderDataset(), manifest);
  assert.equal(first.outcome.kind, "OK");
  const second = replayManifest(blenderDataset(), manifest);
  assert.equal(second.outcome.kind, "OK");
  assert.equal(entriesDigest(second.entries), entriesDigest(first.entries));
  assert.equal(entriesDigest(first.entries), manifest.output_digest);
});

test("manifest: replaying twice from the same source digest yields identical entries", () => {
  const manifest = build().manifest!;
  const a = replayManifest(blenderDataset(), manifest).entries;
  const b = replayManifest(blenderDataset(), manifest).entries;
  assert.deepEqual(a, b);
});

test("manifest: an unknown operation version fails closed", () => {
  const future: TransformationOperation = {
    op_id: "normalize",
    op_version: "2",
    parameters: {},
    output_digest: "0".repeat(64),
  };
  const outcome = executeTransformationOperation(future, initialEntries(blenderDataset()));
  assert.equal(outcome.kind, "FAILED");
  if (!outcome.kind || outcome.kind === "FAILED") {
    assert.equal(outcome.code, "UPG_TRANSFORMATION_UNKNOWN_OPERATION");
  }
  const bad = build([future]);
  assert.equal(bad.outcome.kind, "FAILED");
});

test("manifest: a tampered recorded digest is caught on replay (mismatch, not silent pass)", () => {
  const manifest = build().manifest!;
  const tampered = {
    ...manifest,
    operations: manifest.operations.map((op, index) =>
      index === 1 ? { ...op, output_digest: "f".repeat(64) } : op,
    ),
  };
  const { outcome } = replayManifest(blenderDataset(), tampered);
  assert.equal(outcome.kind, "FAILED");
  if (outcome.kind === "FAILED") {
    assert.equal(outcome.code, "UPG_TRANSFORMATION_REPLAY_MISMATCH");
  }
  const finalOutcome = replayManifest(blenderDataset(), { ...manifest, output_digest: "e".repeat(64) }).outcome;
  assert.equal(finalOutcome.kind, "FAILED");
});

test("manifest: replaying against a different source fails the digest pin", () => {
  const manifest = build().manifest!;
  const drifted = blenderDataset();
  drifted.items[0]!.content = "material: Brushed Metal\nnode: bsdf_principled\nroughness: 0.36";
  const { outcome } = replayManifest(drifted, manifest);
  assert.equal(outcome.kind, "FAILED");
  if (outcome.kind === "FAILED") assert.equal(outcome.code, "UPG_INTEGRITY_MISMATCH");
});

test("manifest: manifests are immutable records — any edit changes the manifest digest", () => {
  const manifest = build().manifest!;
  const digest = computeManifestDigest(manifest);
  const edited = {
    ...manifest,
    operations: [...manifest.operations.slice(0, 2), ...manifest.operations.slice(3)],
  };
  assert.notEqual(computeManifestDigest(edited), digest);
  assert.equal(computeManifestDigest(manifest), digest);
});

test("manifest: normalize collapses per-line whitespace without destroying records", () => {
  const entries = initialEntries({
    ...blenderDataset(),
    items: blenderDataset().items.slice(0, 1),
  });
  entries[0]!.content = "material:  Brushed   Metal \n\n node:   bsdf_principled\n";
  const outcome = executeTransformationOperation(
    { op_id: "normalize", op_version: "1", parameters: {}, output_digest: "0".repeat(64) },
    entries,
  );
  assert.equal(outcome.kind, "OK");
  if (outcome.kind === "OK") {
    assert.equal(outcome.entries[0]!.content, "material: Brushed Metal\nnode: bsdf_principled");
  }
});

test("manifest: filter can exclude quarantined entries and short content", () => {
  const entries = initialEntries(blenderDataset());
  const outcome = executeTransformationOperation(
    { op_id: "filter", op_version: "1", parameters: { exclude_quarantined: true, min_content_length: 10 }, output_digest: "0".repeat(64) },
    entries,
  );
  assert.equal(outcome.kind, "OK");
  if (outcome.kind === "OK") {
    assert.equal(outcome.entries.some((entry) => entry.quarantined), false);
    assert.ok(outcome.entries.every((entry) => entry.content.length >= 10));
  }
});

test("manifest: redact replaces the configured literal substrings", () => {
  const entries = initialEntries(blenderDataset());
  const outcome = executeTransformationOperation(
    { op_id: "redact", op_version: "1", parameters: { patterns: ["INTERNAL-ONLY-NOTE: rotate quarterly"] }, output_digest: "0".repeat(64) },
    entries,
  );
  assert.equal(outcome.kind, "OK");
  if (outcome.kind === "OK") {
    assert.ok(outcome.entries.every((entry) => !entry.content.includes("INTERNAL-ONLY-NOTE: rotate quarterly")));
    assert.ok(outcome.entries.some((entry) => entry.content.includes("[REDACTED]")));
  }
});

test("manifest: deduplicate drops content duplicates deterministically (first wins)", () => {
  const base = initialEntries(blenderDataset());
  const synthetic = [base[0]!, { ...base[0]!, entry_id: "itm_dupcopy00001" }, base[2]!];
  const outcome = executeTransformationOperation(
    { op_id: "deduplicate", op_version: "1", parameters: { key: "content" }, output_digest: "0".repeat(64) },
    synthetic,
  );
  assert.equal(outcome.kind, "OK");
  if (outcome.kind === "OK") {
    assert.equal(outcome.entries.length, 2);
    assert.equal(outcome.entries[0]!.entry_id, base[0]!.entry_id);
  }
});

test("manifest: reshape preserves only the requested key fields", () => {
  const entries = initialEntries(blenderDataset());
  const outcome = executeTransformationOperation(
    { op_id: "reshape", op_version: "1", parameters: { preserve_fields: ["material", "roughness"] }, output_digest: "0".repeat(64) },
    entries,
  );
  assert.equal(outcome.kind, "OK");
  if (outcome.kind === "OK") {
    const brushed = outcome.entries.find((entry) => entry.content.includes("Brushed Metal"))!;
    assert.equal(brushed.content, "material: Brushed Metal\nroughness: 0.35");
  }
});

test("manifest: invalid operation parameters fail closed with typed issues", () => {
  const outcome = executeTransformationOperation(
    { op_id: "filter", op_version: "1", parameters: { exclude_quarantined: "yes" }, output_digest: "0".repeat(64) },
    initialEntries(blenderDataset()),
  );
  assert.equal(outcome.kind, "FAILED");
  if (outcome.kind === "FAILED") assert.equal(outcome.code, "UPG_VALIDATION_FAILED");
});

test("manifest: the full fixture pipeline drops the content duplicate via deduplicate", () => {
  const built = build();
  assert.equal(built.outcome.kind, "OK");
  const mirrors = built.entries.filter((entry) => entry.source_url.includes("brushed-metal-mirror"));
  assert.deepEqual(mirrors, [], "the exact content duplicate is dropped");
  assert.equal(built.entries.length, 6);
});
