# AR2-021 — Accessibility evidence: how to reproduce the run

This directory holds the AR2-021 (issue #53) deliverable: rendered-state
accessibility evidence for the Arena workbench surfaces, produced to turn
the AR2-015 gate finding `grg_00000013` ("Responsive, keyboard-accessible
E2E coverage … BLOCKED") into inspectable evidence.

- `AR2-021-accessibility-evidence-2026-10-12.md` — the evidence report
  (toolchain, journeys/states, per-finding table, keyboard results,
  battery, limitations)
- `transcripts/` — machine evidence of the recorded run: `environment.json`
  (versions), `axe-*.json` (full violation detail + pass/incomplete counts
  per scanned state), `keyboard-*.json` (step-by-step focus descriptors +
  announcements), `summary.json` (aggregate)

## What the suite does (in one paragraph)

A minimal render host (`packages/arena-workbench/test/a11y/host/`) bundles
the workbench's PUBLIC entry (`src/contract.ts`) with esbuild — the real
React screens, the typed `MockArenaClient` and the frozen demo fixtures run
in a real Chromium (Playwright) — and the suite
(`packages/arena-workbench/test/a11y/`) drives the four journeys through
real interactions, injects axe-core into each rendered state (20 scans:
16 desktop + 4 mobile), and runs four keyboard-only journeys asserting
observable focus and live-region announcements at every step. No
static-markup scanning; no faked results.

## Reproduction (release owner)

```bash
# 1. checkout
git clone https://github.com/payswapdotorg/Arena-2.0.git arena && cd arena
git checkout work/AR2-021-accessibility-e2e

# 2. install workspace deps (after TL lockfile integration a plain frozen
#    install works; before that, materialize this package's devDeps):
pnpm install            # or: pnpm install --no-frozen-lockfile

# 3. install the bundled Chromium (one-time; ~150MB into ~/.cache/ms-playwright)
pnpm --filter @arena/workbench a11y:install-browser
#    (equivalent to: cd packages/arena-workbench && npx playwright install chromium)

# 4. run the a11y suite (re-writes the transcripts in this directory)
cd packages/arena-workbench
../../node_modules/.bin/tsx --test test/a11y.test.ts
# expected: 12 subtests pass — environment, 4 axe journeys (16 states),
# 4 keyboard journeys, responsive pass, summary; 0 violations.

# 5. full workbench battery (the exact gate battery form)
cd ../..
node_modules/.bin/tsc -b packages/arena-workbench
node_modules/.bin/oxlint packages/arena-workbench
(cd packages/arena-workbench && ../../node_modules/.bin/tsx --test test/*.test.ts)
(cd packages/arena-workbench && ../../node_modules/.bin/tsx --test test/*.test.tsx)
(cd packages/arena-contracts && ../../node_modules/.bin/tsx --test test/vectors.test.ts test/transitions.test.ts test/completeness.test.ts test/ownership.test.ts test/contracts.test.ts)

# 6. rebuild the render host alone (optional; the suite builds it automatically)
pnpm --filter @arena/workbench a11y:bundle
```

## Honest failure/skip posture

If the browser toolchain cannot be materialized (e.g. frozen lockfile
before integration, or a network-restricted runner), `test/a11y.test.ts`
records **one typed skipped test** with the exact environment probe
results and never fakes a pass — the battery stays green, and the gap is
visible. Chromium-executable absence is probed the same way (skip message
includes the executable path and the install command).

## Integration notes for the TL (out of this WO's fence)

- `pnpm-lock.yaml` was NOT committed on this branch (TL-owned): regenerate
  it on integration to materialize the `arena-workbench` devDependencies
  (`playwright`, `axe-core`, `esbuild`).
- CI wiring: add `test/a11y.test.ts` to the arena-workbench CI step (the
  suite needs `playwright install chromium` on the runner; without it, the
  typed skip keeps CI green).
- Findings D-1..D-5 in the evidence report carry the open remediation
  ownership (product stylesheet, terminal-outcome fixtures, payout screen
  scope, CI wiring, manual screen-reader audit).
