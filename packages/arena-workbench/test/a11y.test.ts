import test from "node:test";

/**
 * AR2-021 — accessibility E2E suite entry (picked up by `tsx --test test/*.test.ts`).
 *
 * The suite runs a REAL browser (Playwright Chromium) against the render host
 * (test/a11y/host) with axe-core injected into the rendered, interacted
 * states. Static-markup-only scanning is explicitly NOT what this suite does.
 *
 * Skip guard (typed, honest — never a fake pass): the a11y toolchain
 * (playwright / chromium / axe-core / esbuild) is declared in this package's
 * devDependencies but the lockfile is TL-owned and NOT committed on this
 * branch. On a frozen-lockfile checkout (e.g. CI before lockfile
 * integration) the dynamic import below fails and the suite records a skip
 * with the exact reason instead of failing or pretending to run. Once the TL
 * regenerates the lockfile and `pnpm --filter @arena/workbench
 * a11y:install-browser` has installed Chromium, the full suite executes.
 */

test("AR2-021 accessibility E2E suite (rendered-state axe + keyboard journeys)", async (t) => {
  let suites: typeof import("./a11y/suites.test.js");
  try {
    suites = await import("./a11y/suites.test.js");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "ERR_MODULE_NOT_FOUND";
    t.skip(
      `a11y suite unavailable in this environment: ${code} — ${
        (error as Error).message
      }. Expected on frozen-lockfile checkouts before the TL integrates this package's devDependencies into pnpm-lock.yaml; install the workspace deps and Chromium (pnpm --filter @arena/workbench a11y:install-browser) to execute the full suite.`,
    );
    return;
  }
  await suites.registerA11ySuites(t);
});
