import { createHash } from "node:crypto";

/**
 * AR2-016 — canonical serialization and digests.
 *
 * Route decisions and idempotency records must be byte-stable: the same inputs
 * produce the same canonical bytes, so digests (and therefore replays and audit
 * comparisons) never depend on object key order. Pure computation only — no
 * clock, no randomness, no network.
 */

/**
 * Canonical JSON: object keys sorted lexicographically (UTF-16 code-unit
 * order), arrays order-preserving. Zod-validated payloads contain no
 * undefined functions or exotic values; numbers serialize via JSON number
 * formatting, which is deterministic for the same computed double.
 */
export function canonicalJsonStringify(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value) ?? "null";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonical JSON cannot serialize non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serialize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${serialize(v)}`).join(",")}}`;
  }
  throw new Error(`canonical JSON cannot serialize values of type ${typeof value}`);
}

/** Canonical sha256 digest (lowercase hex) of the canonical JSON form. */
export function computeCanonicalDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJsonStringify(value), "utf8").digest("hex");
}
