import { createHash } from "node:crypto";
import { createHash as shimCreateHash } from "../../src/renderer/src/arenaNodeCryptoShim.js";

/**
 * UIA-006 — fail-closed node:crypto parity probe for the render-host bundle.
 *
 * The harness esbuild bundle aliases node:crypto to the REAL renderer shim
 * (src/renderer/src/arenaNodeCryptoShim.ts — the same alias treatment
 * packages/desktop/vite.config.ts applies to the production renderer bundle).
 * Before any bundle is built or trusted, this probe verifies the shim against
 * REAL node:crypto on a vector set that includes the FIPS 180-4 vectors and
 * the block-boundary sweep (the MAINT-003 defect class: message lengths that
 * straddle the 56 mod 64 padding boundary — the +9 padding law).
 */

const PARITY_PROBES: readonly string[] = [
  "",
  "abc",
  // FIPS 180-4 two-block vector (448-bit message — the boundary that caught
  // the web shim's +8 padding bug in MAINT-003).
  "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
  // FIPS 180-4 896-bit vector.
  "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
  "arena-uia-006-desktop-journey-probe",
  "定价规则 edge ✓",
  "The quick brown fox jumps over the lazy dog",
  // Block-boundary sweep around 56 mod 64 (55..66 inclusive).
  ...Array.from({ length: 12 }, (_, index) => "x".repeat(55 + index)),
  "y".repeat(1024),
];

export interface ShimParityResult {
  ok: boolean;
  probes: number;
  mismatch: string | null;
}

/** Verify the REAL renderer shim byte-for-byte against node:crypto. */
export function verifyRendererShimParity(): ShimParityResult {
  for (const probe of PARITY_PROBES) {
    const expected = createHash("sha256").update(probe).digest("hex");
    const actual = shimCreateHash("sha256").update(probe).digest("hex");
    if (expected !== actual) {
      return {
        ok: false,
        probes: PARITY_PROBES.length,
        mismatch: `sha256 mismatch on probe of length ${probe.length}: node:crypto=${expected} shim=${actual}`,
      };
    }
  }
  return { ok: true, probes: PARITY_PROBES.length, mismatch: null };
}
