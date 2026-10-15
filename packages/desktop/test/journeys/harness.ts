import { spawn } from "node:child_process";
import type { Server } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, type ElectronApplication, type Page } from "playwright";
import { probeXDisplay, type XDisplayProbe } from "./xdisplay.js";
import { verifyRendererShimParity } from "./shim-parity.js";

/**
 * UIA-006 — desktop browser-journey harness (issue #80): the desktop analog
 * of packages/arena-shell/test/a11y/harness.ts.
 *
 * Owns the journey lifecycle: fail-closed shim parity probe, esbuild render
 * host bundle, local HTTP host server, REAL Electron renderer windows
 * launched through Playwright's _electron API (the binary from the workspace
 * devDeps; the production renderer security posture lives in
 * electron-main.cjs), axe-core audits on rendered interacted states, JSON
 * transcripts + PNG screenshots under docs/evidence/ui/uia-006-desktop/**.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST_DIR = join(HERE, "host");
const DIST_DIR = join(HOST_DIR, "dist");
const MAIN_SCRIPT = join(HERE, "electron-main.cjs");
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");
const EVIDENCE_DIR = join(REPO_ROOT, "docs", "evidence", "ui", "uia-006-desktop");
const TRANSCRIPTS_DIR = join(EVIDENCE_DIR, "transcripts");
const SCREENSHOTS_DIR = join(EVIDENCE_DIR, "screenshots");

const nodeRequire = createRequire(import.meta.url);

/** axe-core rule tags enforced on every scan (recorded in the evidence). */
export const AXE_RULE_TAGS: readonly string[] = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "best-practice",
];

/** Resolve a package's version through node_modules (hoisted workspace). */
export function packageVersion(name: string): string | null {
  const candidates = [
    nodeRequire.resolve(`${name}/package.json`, { paths: [HERE] }),
    join(REPO_ROOT, "node_modules", name, "package.json"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        return (JSON.parse(readFileSync(candidate, "utf8")) as { version?: string }).version ?? null;
      } catch {
        // fall through to the next candidate
      }
    }
  }
  return null;
}

/** Resolve axe-core's browser bundle (axe.min.js sets window.axe). */
export function resolveAxeCore(): string {
  const candidates = [
    join(REPO_ROOT, "node_modules", "axe-core", "axe.min.js"),
    resolve(HERE, "node_modules", "axe-core", "axe.min.js"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`axe-core browser bundle not found (searched ${candidates.join(", ")})`);
}

/** Resolve the Electron binary from the workspace devDeps (node_modules/electron exports the path). */
function resolveElectronExecutable(): { path: string | null; error: string | null } {
  try {
    const resolved = nodeRequire("electron");
    if (typeof resolved === "string" && resolved.length > 0) {
      return { path: resolved, error: null };
    }
    return { path: null, error: `require("electron") returned ${typeof resolved}` };
  } catch (error) {
    return { path: null, error: String(error).split("\n")[0] ?? String(error) };
  }
}

export interface DesktopEnvironmentProbe {
  playwrightVersion: string | null;
  electronPackageVersion: string | null;
  electronExecutable: string | null;
  electronPresent: boolean;
  electronError: string | null;
  xDisplay: XDisplayProbe;
  axeCoreVersion: string | null;
  axeCorePath: string | null;
  esbuildVersion: string | null;
  shimParityOk: boolean;
  shimParityProbes: number;
  shimParityError: string | null;
  bundleBuildable: boolean;
  bundleBuildError: string | null;
}

/** Probe the journey toolchain (honest NOT_SUPPORTED inputs — never faked). */
export async function probeEnvironment(): Promise<DesktopEnvironmentProbe> {
  const electron = resolveElectronExecutable();
  const shimParity = verifyRendererShimParity();
  const probe: DesktopEnvironmentProbe = {
    playwrightVersion: packageVersion("playwright"),
    electronPackageVersion: packageVersion("electron"),
    electronExecutable: electron.path,
    electronPresent: electron.path !== null && existsSync(electron.path),
    electronError: electron.error,
    xDisplay: await probeXDisplay(),
    axeCoreVersion: packageVersion("axe-core"),
    axeCorePath: null,
    esbuildVersion: packageVersion("esbuild"),
    shimParityOk: shimParity.ok,
    shimParityProbes: shimParity.probes,
    shimParityError: shimParity.mismatch,
    bundleBuildable: false,
    bundleBuildError: null,
  };
  try {
    probe.axeCorePath = resolveAxeCore();
  } catch {
    probe.axeCorePath = null;
  }
  if (!probe.shimParityOk) {
    probe.bundleBuildError = `renderer node:crypto shim parity FAILED (fail-closed; no bundle built): ${probe.shimParityError}`;
    return probe;
  }
  const build = await buildBundle();
  probe.bundleBuildable = build.ok;
  probe.bundleBuildError = build.ok ? null : build.stderr;
  return probe;
}

/** Build the render-host bundle (esbuild; parity already verified fail-closed). */
export async function buildBundle(): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [join(HOST_DIR, "build-host.mjs")], {
    cwd: HOST_DIR,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((accept) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, 120_000);
    child.on("close", (code) => {
      clearTimeout(timeout);
      accept({ ok: code === 0, stdout, stderr });
    });
  });
}

export interface AxeViolationNode {
  target: unknown;
  html: string;
  failureSummary: string;
}

export interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  description: string;
  helpUrl: string;
  tags: string[];
  nodes: AxeViolationNode[];
}

export interface AxeScanResult {
  violations: AxeViolation[];
  passes: string[];
  incomplete: string[];
  inapplicable: string[];
}

/** Minimal typing for the injected axe-core browser global. */
declare global {
  interface Window {
    axe?: {
      run: (
        context: Document,
        options: { runOnly: { type: "tag"; values: readonly string[] } },
      ) => Promise<{
        violations: AxeViolation[];
        passes: Array<{ id: string }>;
        incomplete: Array<{ id: string }>;
        inapplicable: Array<{ id: string }>;
      }>;
    };
  }
}

export interface PageProbe {
  consoleErrors: string[];
  pageErrors: string[];
}

/** An Electron renderer page bound to the render host with error collection. */
export class DesktopHostPage {
  readonly page: Page;
  readonly probe: PageProbe = { consoleErrors: [], pageErrors: [] };

  constructor(page: Page) {
    this.page = page;
    page.on("pageerror", (error) => {
      this.probe.pageErrors.push(String(error));
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        this.probe.consoleErrors.push(message.text());
      }
    });
  }

  /** Wait for the deterministic ready marker set by the host app after mount. */
  async load(): Promise<void> {
    await this.page.waitForSelector("html[data-arena-host-ready='true']", { timeout: 15_000 });
  }

  /** Active-element descriptor for keyboard journey assertions. */
  async activeElement(): Promise<{
    tag: string;
    id: string | null;
    text: string | null;
    role: string | null;
    className: string | null;
  } | null> {
    return this.page.evaluate(() => {
      const element = document.activeElement;
      if (element === null) {
        return null;
      }
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id === "" ? null : element.id,
        text: (element.textContent ?? "").trim().slice(0, 90),
        role: element.getAttribute("role"),
        className: element.getAttribute("class"),
      };
    });
  }
}

export interface LaunchedApp {
  app: ElectronApplication;
  hostPage: DesktopHostPage;
}

export class DesktopJourneyHarness {
  private server: Server | null = null;
  private urlValue: string | null = null;
  private readonly axePath: string;
  private readonly electronPath: string;
  private readonly display: string;
  readonly scans: Array<{
    journey: string;
    state: string;
    viewport: string;
    violations: number;
  }> = [];

  constructor(options: { axePath: string; electronPath: string; display: string }) {
    this.axePath = options.axePath;
    this.electronPath = options.electronPath;
    this.display = options.display;
  }

  get url(): string {
    if (this.urlValue === null) {
      throw new Error("harness not started");
    }
    return this.urlValue;
  }

  async start(distDir: string): Promise<void> {
    const { startHostServer } = await import("./servers.js");
    const served = await startHostServer(distDir);
    this.server = served.server;
    this.urlValue = served.url;
  }

  /**
   * Launch a REAL Electron app (the workspace electron binary) whose renderer
   * loads the render host at pageUrl with the production security posture.
   * Window size describes the web content area (responsive journeys).
   */
  async launchApp(options: {
    pageUrl: string;
    width?: number;
    height?: number;
  }): Promise<LaunchedApp> {
    process.env.ARENA_JOURNEY_PAGE_URL = options.pageUrl;
    process.env.ARENA_JOURNEY_WINDOW_WIDTH = String(options.width ?? 1440);
    process.env.ARENA_JOURNEY_WINDOW_HEIGHT = String(options.height ?? 900);
    process.env.DISPLAY = this.display;
    const app = await _electron.launch({
      executablePath: this.electronPath,
      args: [MAIN_SCRIPT],
    });
    const page = await app.firstWindow();
    return { app, hostPage: new DesktopHostPage(page) };
  }

  /** Runtime versions from the launched Electron main process (honest record). */
  async runtimeVersions(app: ElectronApplication): Promise<Record<string, string>> {
    const versions = await app.evaluate(() => ({ ...process.versions }));
    return versions as Record<string, string>;
  }

  /**
   * Inject axe-core and audit the CURRENT rendered state (the caller drives
   * the state through real interactions first).
   */
  async runAxe(
    hostPage: DesktopHostPage,
    scan: { journey: string; state: string; viewport: string },
  ): Promise<AxeScanResult> {
    await hostPage.page.addScriptTag({ path: this.axePath });
    const result = await hostPage.page.evaluate(
      ({ tags }) => {
        if (window.axe === undefined) {
          throw new Error("axe-core not injected");
        }
        return window.axe.run(document, { runOnly: { type: "tag", values: tags } });
      },
      { tags: AXE_RULE_TAGS },
    );
    const compact: AxeScanResult = {
      violations: result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact ?? null,
        help: violation.help,
        description: violation.description,
        helpUrl: violation.helpUrl,
        tags: violation.tags,
        nodes: violation.nodes.map((node) => ({
          target: node.target,
          html: node.html,
          failureSummary: node.failureSummary,
        })),
      })),
      passes: result.passes.map((rule) => rule.id),
      incomplete: result.incomplete.map((rule) => rule.id),
      inapplicable: result.inapplicable.map((rule) => rule.id),
    };
    this.scans.push({
      journey: scan.journey,
      state: scan.state,
      viewport: scan.viewport,
      violations: compact.violations.length,
    });
    writeTranscript(`axe-${scan.viewport}-${scan.journey}-${scan.state}.json`, {
      kind: "axe-scan",
      journey: scan.journey,
      state: scan.state,
      viewport: scan.viewport,
      ruleTags: AXE_RULE_TAGS,
      violations: compact.violations,
      passesCount: compact.passes.length,
      incomplete: compact.incomplete,
      inapplicableCount: compact.inapplicable.length,
      consoleErrors: hostPage.probe.consoleErrors,
      pageErrors: hostPage.probe.pageErrors,
    });
    return compact;
  }

  /** Screenshot evidence (the acceptance artifact: inspectable UI). */
  async screenshot(hostPage: DesktopHostPage, name: string): Promise<void> {
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    await hostPage.page.screenshot({
      path: join(SCREENSHOTS_DIR, `${name}.png`),
      fullPage: true,
    });
  }

  async stop(): Promise<void> {
    if (this.server !== null) {
      await new Promise<void>((accept) => {
        this.server?.close(() => accept());
      });
    }
  }
}

/** Write a JSON evidence transcript (committed under docs/evidence/ui/uia-006-desktop). */
export function writeTranscript(filename: string, payload: unknown): void {
  mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
  writeFileSync(
    join(TRANSCRIPTS_DIR, filename),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

/** Human-readable one-line violation summary for assertion messages. */
export function formatViolations(result: AxeScanResult): string {
  return result.violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? "n/a"}): ${violation.help} — ` +
        violation.nodes.map((node) => node.html.slice(0, 120)).join(" | "),
    )
    .join("\n");
}

export const HOST_DIST_DIR = DIST_DIR;
export const JOURNEY_EVIDENCE = { EVIDENCE_DIR, TRANSCRIPTS_DIR, SCREENSHOTS_DIR } as const;
