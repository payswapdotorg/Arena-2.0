#!/usr/bin/env node
/**
 * DIST-001 (issue #84) — generate Arena desktop icon PNGs from the identity-kit
 * wordmark geometry (three-layer progressive A, brand #3f6df4 — spec/ux/arena-native-ui.md §2.1).
 * Rendered headlessly via Playwright chromium (transparent background for hicolor).
 */
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(scriptDir, "../build/arena");

// The A symbol from packages/arena-shell/src/identity/wordmark.tsx, scaled into a
// 512 canvas with a dark rounded-square plate (icon surface, not marketing art).
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect x="0" y="0" width="512" height="512" rx="112" fill="#0d1220"/>
  <g aria-hidden="true">
    <path d="M8 92 L34 20 L60 92 M16 68 L52 68"
      fill="none" stroke="#3f6df4" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M8 92 L34 20 L60 92"
      fill="none" stroke="#3f6df4" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"
      opacity="0.35" transform="translate(0 -6)"/>
  </g>
</svg>`;

async function main() {
  const { chromium } = await import("playwright");
  await mkdir(resolve(outDir, "icons"), { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setContent(
    `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style></head><body>${ICON_SVG}</body></html>`,
  );
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(outDir, "icon.png"), omitBackground: true });
  await page.screenshot({ path: resolve(outDir, "icons", "512x512.png"), omitBackground: true });
  await browser.close();
  process.stdout.write(`[arena-icon] wrote ${outDir}/icon.png + icons/512x512.png\n`);
}

main().catch((error) => {
  process.stderr.write(`[arena-icon] failed: ${error?.stack ?? error}\n`);
  process.exit(1);
});
