# Arena 2.0 Production-Readiness Release Plan (WO3.0)

Registry version: WO3.0 (registered 2026-10-12, post-roadmap-completion)
Status authority: this file + `spec/PROJECT-STATE.md` + the GitHub work-order issues (#51–#55).
Origin: TL progress review 2026-10-12 — directive to turn the NOT_GO blockers into a registered release plan and reconcile repository state documentation.

## Basis

The registered implementation roadmap (AR2-000 through AR2-018, 19/19) is COMPLETE. The production release decision recorded by AR2-015 remains **NOT_GO** per `docs/evidence/release/AR2-015-gate-report-2026-10-11.md`. This plan converts the recorded blockers into new, separately registered work orders. It does not authorize any release, does not enable any disabled capability, and does not silently extend the completed implementation plan: every item below is a new work order under the standing policy — one work order = one issue = one branch = one PR.

## Release plan work orders

| Work order | Issue | Turns which blocker into evidence | Dependencies | Parallelizable |
| --- | --- | --- | --- | --- |
| AR2-019 OS-level capsule isolation conformance and untrusted-execution gate | [#51](https://github.com/payswapdotorg/Arena-2.0/issues/51) | OS-level capsule isolation BLOCKED; untrusted expert/scraper execution DISABLED | AR2-004 seam; AR2-015 findings | Yes (critical path) |
| AR2-020 Cross-platform install evidence (macOS, Windows) | [#52](https://github.com/payswapdotorg/Arena-2.0/issues/52) | Cross-platform install proof BLOCKED | main (19/19) | Yes |
| AR2-021 Accessibility end-to-end coverage | [#53](https://github.com/payswapdotorg/Arena-2.0/issues/53) | Accessibility E2E coverage BLOCKED | main; AR2-003 surfaces | Yes |
| AR2-022 Production identity adapter | [#54](https://github.com/payswapdotorg/Arena-2.0/issues/54) | Demo-auth tenant-isolation seam (recorded in the gate report) | main; AR2-002 edge | Yes (after capacity frees) |
| AR2-023 Release-owner decision record and authorization workflow | [#55](https://github.com/payswapdotorg/Arena-2.0/issues/55) | Owner authorization not recorded | AR2-019/020/021/022 evidence for a production GO; mechanism dispatchable earlier | Final |

## Sequencing and capacity

- Maximum three concurrent workers (standing policy). Recommended first wave: AR2-019 + AR2-020 + AR2-021 (independent write fences, all blockers of the machine decision).
- AR2-022 dispatches when a worker slot frees; it is independent of AR2-019 but its tenant-isolation claims are re-verified against the isolation runtime once AR2-019 lands.
- AR2-023 is last: the production GO decision record requires the recomputed gates over AR2-019/020/021/022 evidence. Its schema/workflow mechanism may be dispatched earlier without producing a decision.

## What stays disabled (no silent enablement)

- **Live-money payments** remain disabled. Enabling them requires a separately registered work order created only after a recorded owner decision (AR2-023 instrument). Test-mode finance is the only accepted mode.
- **Untrusted expert/scraper execution** remains disabled until AR2-019 passes AND a recorded owner decision enables it.
- A **limited-scope release** (Linux, test-mode finance, no untrusted execution) may be authorized at any time by the release owner using the AR2-015 gate report as the recorded basis; AR2-023 provides the standing instrument for that signature.

## Exit condition

The production-readiness extension is complete when AR2-019 through AR2-023 are accepted, the G0–G8 gates recompute green over the new evidence, and a signed release decision record exists (PRODUCTION_GO, LIMITED_SCOPE_GO, or an explicit NOT_GO_HOLD with dispositions). Until then the roadmap state is: implementation roadmap COMPLETE (19/19); production-readiness extension IN REGISTRATION (5 work orders open).
