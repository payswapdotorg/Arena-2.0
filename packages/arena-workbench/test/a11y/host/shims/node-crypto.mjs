import { sha256Hex } from "./sha256.mjs";

/**
 * AR2-021 render host — node:crypto browser shim.
 *
 * The esbuild plugin in build-host.mjs resolves the specifier "node:crypto"
 * to this module. Only createHash("sha256").update(string).digest("hex")
 * is emulated — the exact surface the workbench form layers use. Any other
 * algorithm or API fails closed (loud error, never a wrong digest).
 */

export function createHash(algorithm) {
  if (algorithm !== "sha256") {
    throw new Error(`arena render host node:crypto shim: unsupported algorithm "${algorithm}"`);
  }
  return {
    update(payload) {
      if (typeof payload !== "string") {
        throw new Error("arena render host node:crypto shim: only string payloads are supported");
      }
      return {
        digest(encoding) {
          if (encoding !== "hex") {
            throw new Error(
              `arena render host node:crypto shim: unsupported digest encoding "${encoding}"`,
            );
          }
          return sha256Hex(payload);
        },
      };
    },
  };
}
