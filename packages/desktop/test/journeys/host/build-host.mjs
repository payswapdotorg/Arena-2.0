#!/usr/bin/env node
/**
 * UIA-006 — desktop browser-journey render-host bundler (esbuild), the desktop
 * analog of packages/arena-shell/test/a11y/host/build-host.mjs.
 *
 * Bundles the host page that mounts the REAL desktop composition
 * (buildArenaDesktopComposition + REAL ArenaShell + the real theme law) into a
 * single browser IIFE served by the harness's local HTTP server.
 *
 * The node:crypto seam: the composition's transitive imports
 * (@arena/workbench form layers, @arena/ops observability, @arena/acquisition
 * canonical digest) import node:crypto — in the REAL renderer bundle this is
 * aliased by packages/desktop/vite.config.ts to the pure-TS renderer shim
 * (src/renderer/src/arenaNodeCryptoShim.ts). This bundler applies the SAME
 * treatment: node:crypto → the REAL renderer shim source (fail-closed parity
 * against node:crypto is verified by the runner BEFORE spawning this build —
 * see test/journeys/shim-parity.ts).
 */
import { build } from "esbuild";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "dist");
// host → journeys → test → desktop → packages → repo root (five levels).
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..", "..");
const RENDERER_CRYPTO_SHIM = resolve(
  REPO_ROOT,
  "packages",
  "desktop",
  "src",
  "renderer",
  "src",
  "arenaNodeCryptoShim.ts",
);

const nodeCryptoShim = {
  name: "arena-desktop-node-crypto-shim",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^node:crypto$/ }, () => ({
      path: RENDERER_CRYPTO_SHIM,
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

// CSS: the shell's real style barrel (tokens + shell + the lanes' screen
// styles) — resolved through the package public export, the same specifier the
// real desktop renderer imports.
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
  `arena desktop journey host bundled (esbuild ${esbuildVersion}): dist/host.js ${artifact.size} bytes + index.html + host.css`,
);
