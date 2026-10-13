#!/usr/bin/env node
/**
 * AR2-021 render-host bundler (esbuild).
 *
 * Bundles the workbench host app — which imports the workbench's PUBLIC
 * entry (src/contract.ts) and therefore the real screens, mock client and
 * demo fixtures — into a single browser IIFE served by the a11y harness's
 * local HTTP server. React 19 (automatic JSX runtime), zod and
 * @arena/contracts are bundled as-is.
 *
 * node:crypto (used by the form layers for request digests) is aliased to
 * the browser shim whose SHA-256 is verified against node:crypto on every
 * build (fail closed on mismatch) — the browser host computes byte-identical
 * digests to the Node-side suites.
 */
import { build } from "esbuild";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Hex } from "./shims/sha256.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "dist");

// --- 1) fail-closed shim verification against node:crypto -----------------
const PROBES = [
  "",
  "abc",
  "arena-ar2-021-probe",
  "定价规则 edge ✓",
  "The quick brown fox jumps over the lazy dog",
  "x".repeat(1024),
];
for (const probe of PROBES) {
  const expected = createHash("sha256").update(probe).digest("hex");
  const actual = sha256Hex(probe);
  if (expected !== actual) {
    console.error(`render host: sha256 shim MISMATCH on probe ${JSON.stringify(probe.slice(0, 40))}`);
    console.error(`  node:crypto ${expected}`);
    console.error(`  shim        ${actual}`);
    process.exit(1);
  }
}

// --- 2) bundle the host app ------------------------------------------------
const nodeCryptoShim = {
  name: "arena-node-crypto-shim",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^node:crypto$/ }, () => ({
      path: resolve(HERE, "shims", "node-crypto.mjs"),
      namespace: "file",
    }));
  },
};

mkdirSync(DIST, { recursive: true });
const esbuildVersion = (await import("esbuild")).default?.version ?? "unknown";

await build({
  entryPoints: [join(HERE, "host-app.tsx")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  outfile: join(DIST, "host.js"),
  minify: false,
  sourcemap: false,
  logLevel: "warning",
  plugins: [nodeCryptoShim],
  define: { "process.env.NODE_ENV": '"production"' },
});

copyFileSync(join(HERE, "index.html"), join(DIST, "index.html"));
copyFileSync(join(HERE, "workbench.css"), join(DIST, "workbench.css"));

const artifact = statSync(join(DIST, "host.js"));
console.log(
  `render host bundled (esbuild ${esbuildVersion}): dist/host.js ${artifact.size} bytes + index.html + workbench.css`,
);
