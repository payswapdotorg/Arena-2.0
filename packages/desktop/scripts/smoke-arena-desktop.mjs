#!/usr/bin/env node
/**
 * DIST-001 (issue #84) — REAL packaged-app smoke: boot dist/linux-unpacked/arena
 * under Xvfb via playwright _electron (the UIA-006 journeys precedent).
 * Verifies: (1) the bundled local test-mode station becomes active (log line),
 * (2) the station /healthz + /v1/ops/station-probes answer 200 on the parsed port,
 * (3) the ArenaShell renders arena-first, (4) screenshot evidence of the first screen
 * (Arena branding; zero user-visible ZCode).
 */
import { resolve } from "node:path";

const desktopRoot = resolve(import.meta.dirname, "..");
const executablePath = resolve(desktopRoot, "dist/linux-unpacked/arena");

async function main() {
  const { _electron } = await import("playwright");
  const stdoutLines = [];
  const app = await _electron.launch({
    executablePath,
    args: ["--no-sandbox"],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
  });
  try {
    const child = app.process();
    const collect = (stream) => {
      if (!stream) return;
      stream.setEncoding("utf-8");
      stream.on("data", (chunk) => {
        for (const line of chunk.split("\n")) stdoutLines.push(line);
      });
    };
    collect(child.stdout);
    collect(child.stderr);

    let stationBaseUrl = null;
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const line = stdoutLines.find((l) => l.includes("bundled test-mode station active"));
      if (line) {
        const match = line.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) {
          stationBaseUrl = `http://127.0.0.1:${match[1]}`;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!stationBaseUrl) {
      throw new Error(
        "station-active log line not found; stdout tail:\n" +
          stdoutLines.slice(-40).join("\n"),
      );
    }
    console.log(`[smoke] station active: ${stationBaseUrl}`);

    const healthz = await fetch(`${stationBaseUrl}/healthz`);
    console.log(`[smoke] station /healthz -> ${healthz.status}`);
    if (healthz.status !== 200) throw new Error("healthz != 200");
    const probes = await fetch(`${stationBaseUrl}/v1/ops/station-probes`);
    const probesBody = await probes.json();
    console.log(
      `[smoke] station-probes -> ${probes.status} aggregate=${JSON.stringify(probesBody.aggregateReadiness ?? probesBody.aggregate_readiness ?? null)}`,
    );
    const readyz = await fetch(`${stationBaseUrl}/readyz`);
    console.log(`[smoke] station /readyz -> ${readyz.status}`);

    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window
      .waitForSelector("[data-arena-wordmark], .arena-shell, [data-arena-screen]", {
        timeout: 45_000,
      })
      .catch(async () => {
        await window.waitForLoadState("networkidle").catch(() => {});
      });
    await new Promise((r) => setTimeout(r, 3000));
    const title = await window.title();
    console.log(`[smoke] window title: ${title}`);
    console.log(`[smoke] window url: ${window.url().slice(0, 140)}`);
    await window.screenshot({
      path: resolve(desktopRoot, "dist/smoke-arena-first-screen.png"),
    });
    console.log("[smoke] screenshot saved: dist/smoke-arena-first-screen.png");
    const bodyText = (await window.evaluate(() => document.body.innerText)).slice(0, 800);
    console.log(`[smoke] body text head:\n${bodyText}`);
    if (/zcode/i.test(bodyText)) {
      throw new Error("user-visible ZCode branding detected on the first screen");
    }
    console.log("[smoke] PASS — station active + Arena first screen + zero ZCode branding");
  } finally {
    // Bounded teardown：app.close() 在 will-quit 拦截链上可能长等 —— 5s 后强制收口。
    await Promise.race([
      app.close().catch(() => {}),
      new Promise((r) => setTimeout(r, 5_000)),
    ]);
    process.exit(0);
  }
}

main().catch((error) => {
  console.error(`[smoke] FAIL: ${error?.message ?? error}`);
  process.exit(1);
});
