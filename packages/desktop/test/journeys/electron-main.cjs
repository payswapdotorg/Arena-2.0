/**
 * UIA-006 — test-only Electron main (issue #80; the desktop browser-journey harness).
 *
 * Minimal BrowserWindow host with the PRODUCTION renderer security posture
 * (the same webPreferences law the real desktop main uses for its windows):
 *   contextIsolation: true, nodeIntegration: false, sandbox: true,
 *   webviewTag: false — and NO preload (this host exposes nothing extra;
 *   the page lifecycle is IPC-free by design).
 *
 * Configuration comes from the environment (injected by the journey runner,
 * which spawns this binary via Playwright's _electron.launch):
 *   ARENA_JOURNEY_PAGE_URL        the host page URL to load (required)
 *   ARENA_JOURNEY_WINDOW_WIDTH    content width  (default 1440)
 *   ARENA_JOURNEY_WINDOW_HEIGHT   content height (default 900)
 *
 * Runs under Xvfb (DISPLAY injected by the runner). Exits cleanly when the
 * window closes (window-all-closed → app.quit).
 */
"use strict";

const { app, BrowserWindow } = require("electron");

const PAGE_URL = process.env.ARENA_JOURNEY_PAGE_URL || "";
const WIDTH = Number.parseInt(process.env.ARENA_JOURNEY_WINDOW_WIDTH || "1440", 10);
const HEIGHT = Number.parseInt(process.env.ARENA_JOURNEY_WINDOW_HEIGHT || "900", 10);

if (PAGE_URL === "") {
  console.error("[arena-journey-main] ARENA_JOURNEY_PAGE_URL is not set");
  app.exit(1);
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    // width/height describe the web CONTENT area so viewport-sensitive
    // journeys (responsive overflow) measure exactly the requested size.
    useContentSize: true,
    width: WIDTH,
    height: HEIGHT,
    show: true,
    title: "Arena",
    backgroundColor: "#0f1115",
    autoHideMenuBar: true,
    webPreferences: {
      // Production renderer security posture (mirrors the real desktop shell
      // windows: contextIsolation/nodeIntegration/sandbox/webviewTag).
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webviewTag: false,
      // Test-only host: no preload, nothing exposed to the page.
      preload: undefined,
    },
  });

  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`[arena-journey-main] did-fail-load ${code} ${description} ${url}`);
  });

  win
    .loadURL(PAGE_URL)
    .then(() => {
      console.log(`[arena-journey-main] loaded ${PAGE_URL}`);
    })
    .catch((error) => {
      console.error(`[arena-journey-main] load failed: ${String(error)}`);
      app.exit(1);
    });
});

app.on("window-all-closed", () => {
  app.quit();
});
