#!/usr/bin/env node
/**
 * UIA-001 browser-journey render-host bundler (esbuild) — mirrors the
 * AR2-021 workbench render host.
 *
 * Bundles the arena-shell host app — which mounts the REAL ArenaShell with
 * the five REAL screen registrations (the same composition law as the web
 * integration) — into a single browser IIFE served by the harness's local
 * HTTP server. React 19 (automatic JSX runtime) and @arena/contracts bundle
 * as-is; node:crypto is aliased to the verified shim (fail-closed probe
 * against node:crypto on every build — byte-identical digests).
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
  "arena-uia-001-probe",
  "定价规则 edge ✓",
  "The quick brown fox jumps over the lazy dog",
  "x".repeat(1024),
];
for (const probe of PROBES) {
  const expected = createHash("sha256").update(probe).digest("hex");
  const actual = sha256Hex(probe);
  if (expected !== actual) {
    console.error(`render host: sha256 shim MISMATCH on probe ${JSON.stringify(probe.slice(0, 40))}`);
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

// CSS: the shell's full style barrel (tokens + shell + the three lanes' files).
await build({
  entryPoints: [join(HERE, "host.css")],
  bundle: true,
  outfile: join(DIST, "host.css"),
  minify: false,
  sourcemap: false,
  logLevel: "warning",
});

copyFileSync(join(HERE, "index.html"), join(DIST, "index.html"));

const artifact = statSync(join(DIST, "host.js"));
console.log(
  `render host bundled (esbuild ${esbuildVersion}): dist/host.js ${artifact.size} bytes + index.html + host.css`,
);
