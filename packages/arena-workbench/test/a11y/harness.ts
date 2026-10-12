import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";

/**
 * AR2-021 — browser a11y harness.
 *
 * Owns the render-host lifecycle for the a11y suite:
 *  - builds the esbuild bundle (build-host.mjs, fail-closed shim verification)
 *  - serves dist/ over a local HTTP server (ephemeral 127.0.0.1 port)
 *  - launches the bundled Chromium and creates pages (desktop + mobile)
 *  - injects axe-core and runs tagged audits on RENDERED, interacted states
 *  - writes JSON evidence transcripts under docs/evidence/accessibility/transcripts/
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST_DIR = join(HERE, "host");
const DIST_DIR = join(HOST_DIR, "dist");
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");
const TRANSCRIPTS_DIR = join(REPO_ROOT, "docs", "evidence", "accessibility", "transcripts");

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

export interface EnvironmentProbe {
  playwrightVersion: string | null;
  chromiumExecutable: string;
  chromiumPresent: boolean;
  axeCoreVersion: string | null;
  axeCorePath: string | null;
  esbuildVersion: string | null;
  bundleBuildable: boolean;
  bundleBuildError: string | null;
}

/** Probe the a11y toolchain (honest NOT_SUPPORTED inputs — never faked). */
export async function probeEnvironment(): Promise<EnvironmentProbe> {
  const chromiumExecutable = chromium.executablePath();
  const probe: EnvironmentProbe = {
    playwrightVersion: packageVersion("playwright"),
    chromiumExecutable,
    chromiumPresent: existsSync(chromiumExecutable),
    axeCoreVersion: packageVersion("axe-core"),
    axeCorePath: null,
    esbuildVersion: packageVersion("esbuild"),
    bundleBuildable: false,
    bundleBuildError: null,
  };
  try {
    probe.axeCorePath = resolveAxeCore();
  } catch {
    probe.axeCorePath = null;
  }
  if (probe.chromiumPresent && probe.axeCorePath !== null) {
    const build = await buildBundle();
    probe.bundleBuildable = build.ok;
    probe.bundleBuildError = build.ok ? null : build.stderr;
  }
  return probe;
}

/** Build the render-host bundle (esbuild + shim verification). */
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

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

/** Minimal static server for the render-host dist directory. */
export async function startHostServer(): Promise<{ url: string; server: Server }> {
  const server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    const file = path === "/" ? "index.html" : path.replace(/^\//, "");
    const safe = join(DIST_DIR, file);
    if (!safe.startsWith(DIST_DIR) || !existsSync(safe)) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }
    response.setHeader(
      "content-type",
      CONTENT_TYPES[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream",
    );
    response.end(readFileSync(safe));
  });
  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      accept();
    });
  });
  const address = server.address() as { port: number };
  return { url: `http://127.0.0.1:${address.port}/`, server };
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

/** A Playwright page bound to the render host with error collection. */
export class HostPage {
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

  /** Load the host root and wait for the deterministic ready marker. */
  async load(url: string): Promise<void> {
    await this.page.goto(url);
    await this.page.waitForSelector("html[data-arena-host-ready='true']", { timeout: 10_000 });
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

  /** Text of a live region (role=status) matched by selector. */
  async liveRegionText(selector: string): Promise<string> {
    const text = await this.page.locator(selector).textContent();
    return text ?? "";
  }
}

export class A11yHarness {
  private browserInstance: Browser | null = null;
  private server: Server | null = null;
  private urlValue: string | null = null;
  private readonly axePath: string;
  readonly scans: Array<{
    journey: string;
    state: string;
    viewport: string;
    violations: number;
  }> = [];

  constructor(axePath: string) {
    this.axePath = axePath;
  }

  get url(): string {
    if (this.urlValue === null) {
      throw new Error("harness not started");
    }
    return this.urlValue;
  }

  async start(): Promise<void> {
    const build = await buildBundle();
    if (!build.ok) {
      throw new Error(`render host bundle build failed: ${build.stderr}`);
    }
    const served = await startHostServer();
    this.server = served.server;
    this.urlValue = served.url;
    this.browserInstance = await chromium.launch();
  }

  async newPage(viewport?: { width: number; height: number }): Promise<HostPage> {
    if (this.browserInstance === null) {
      throw new Error("harness not started");
    }
    const context = await this.browserInstance.newContext({ viewport });
    const page = await context.newPage();
    return new HostPage(page);
  }

  /**
   * Inject axe-core and audit the CURRENT rendered state (the caller drives
   * the state through real interactions first). Full violations are kept for
   * the evidence transcript.
   */
  async runAxe(
    hostPage: HostPage,
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

  /** Chromium build in use (recorded in the environment transcript). */
  chromiumVersion(): string {
    if (this.browserInstance === null) {
      throw new Error("harness not started");
    }
    return this.browserInstance.version();
  }

  async stop(): Promise<void> {
    if (this.browserInstance !== null) {
      await this.browserInstance.close();
    }
    if (this.server !== null) {
      await new Promise<void>((accept) => {
        this.server?.close(() => accept());
      });
    }
  }
}

/** Write a JSON evidence transcript (committed under docs/evidence/accessibility). */
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
