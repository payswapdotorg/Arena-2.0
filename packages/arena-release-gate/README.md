# @arena/release-gate

Release-gate machinery for Arena 2.0: the typed G0–G8 gate registry and classified
gate report (AR2-015), plus the release-decision instrument (AR2-023) — gate
recomputation, the versioned decision-record schema and the amendment chain.

## What this package provides

- **Typed gate registry (AR2-015, `RDR`-independent)** — `gateRowSchema` /
  `validateGateRegistry` / `decideRelease`: four-state explicit classification
  (PASS / FAIL / BLOCKED / WAIVED), recorded evidence per row (class, command,
  environment, SHA, result, limitations, reviewer), core vs extension scope
  (G8 is the separate extension gate), WAIVED-requires-owner-authorization,
  unresolved critical/high findings force NOT_GO, and the explicit machine
  release decision ("a green build is never a release decision").
- **Canonical gate rows + rendered report** — `buildCanonicalGateRows(meta)`
  produces the typed source of `docs/evidence/release/AR2-015-gate-report-2026-10-11.md`;
  `renderGateReport` renders it; `coreReleaseDecision` returns the machine decision.
- **Adversarial profiles (AR2-015)** — real-surface tests: cross-tenant ID-guessing
  sweep (spawns a real `arena-api`), webhook signature matrix (real HTTP receiver),
  prompt-injection-as-data (real evidence store + proof evaluator), capsule
  tenant-refusal matrix (real `CapsuleProviderPort`).
- **Gate recomputation (AR2-023, `GATE_RECOMPUTATION_SCHEMA_VERSION` = `RGR1.0`)** —
  `recomputeGates({ registry_rows, evidence_set })`: re-evaluates the typed G0–G8
  registry against a supplied evidence set (typed manifest entries with exact SHAs +
  one submission per gate), reuses the AR2-015 machinery for validation and the
  machine decision, and produces a typed, inspectable per-gate result
  (`{ gate_id, verdict, basis, gaps }` + the full recomputed row). Deterministic and
  pure (no network, no clock, no randomness). A gate with no submission recomputes
  `BLOCKED` — missing evidence is never an assumed `PASS`. Malformed evidence sets
  (dangling basis references, duplicate or unknown submissions, unauthorized WAIVED)
  fail closed with typed issues.
- **Release decision record (AR2-023, `RELEASE_DECISION_SCHEMA_VERSION` = `RDR1.0`)** —
  `releaseDecisionRecordSchema` / `validateDecisionRecord`: the machine-readable,
  versioned, fail-closed decision instrument. Decision classes are exactly
  `PRODUCTION_GO | LIMITED_SCOPE_GO | NOT_GO_HOLD`; scope boundaries are typed
  allow-lists (platform matrix, finance mode, untrusted-execution mode, identity
  mode, isolation mode); the evidence manifest requires exact SHAs; residual risks
  carry per-risk dispositions; the signer block is a mechanism (name / role /
  method — `github_identity_docs_commit`, verified by the workflow, not
  cryptography); review/expiry conditions are mandatory for GO classes; and the
  attached recomputation is re-derived (`decideRelease`) and cross-checked against
  the manifest — tampering anywhere fails closed. Class consistency: `PRODUCTION_GO`
  requires an all-green machine basis (plus G8 for scraper scope, approved isolation
  for untrusted execution, recorded G4 risk + enablement precondition for live
  money); `LIMITED_SCOPE_GO` is bounded to the AR2-015 recorded basis (Linux,
  test-mode finance, untrusted execution disabled, synthetic provider) with only the
  three recorded scope-excusable gates allowed `BLOCKED`, each as an owner-accepted
  residual risk; `NOT_GO_HOLD` requires every open blocker listed as an `OPEN`
  residual risk.
- **Amendment chain (AR2-023)** — `validateDecisionChain`: decisions are amended or
  revoked only by supersession; cycles, self-references, forks, orphans, duplicate
  ids and date regressions fail closed.

## The authorization workflow

This package is the **instrument, not the authorization**. Who may sign, how identity
is verified, how a record is committed and announced, and how decisions are revoked
or amended are defined in
[`docs/evidence/release/AR2-023-authorization-workflow-2026-10-14.md`](../../docs/evidence/release/AR2-023-authorization-workflow-2026-10-14.md).
An unsigned, watermarked filled example of the limited-scope case (Linux, test-mode
finance, no untrusted execution, on the recorded AR2-015 basis) lives at
[`docs/evidence/release/decision-record-template-limited-scope.md`](../../docs/evidence/release/decision-record-template-limited-scope.md).

Live-money payments and untrusted execution stay disabled by default; enabling
either requires a recorded owner decision **and then** a separately registered work
order — there is no silent enablement path in code or docs.

## Tests

```bash
# from the repository root
node_modules/.bin/tsc -b packages/arena-release-gate
node_modules/.bin/oxlint packages/arena-release-gate
cd packages/arena-release-gate && ../../node_modules/.bin/tsx --test test/*.test.ts
```

The suite covers the gate-registry semantics and adversarial profiles (AR2-015) and,
for AR2-023: positive/negative schema vectors; recomputation determinism and
non-regression against the recorded AR2-015 verdicts; recomputation-vs-class
consistency for all three decision classes; amendment-chain validation and cycle
rejection; and the template example parsing as a valid unsigned record.
