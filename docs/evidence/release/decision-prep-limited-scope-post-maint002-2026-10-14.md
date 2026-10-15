# Release decision preparation — LIMITED_SCOPE_GO candidate (post-MAINT-002 evidence)

> **PREPARED FOR OWNER SIGNATURE — NOT A DECISION.** This document is a
> Tech-Lead preparation under step 1-4 of the recorded
> [AR2-023 authorization workflow](./AR2-023-authorization-workflow-2026-10-14.md)
> (which explicitly permits *"a worker preparing a record for the owner's
> signature — the owner must still make or explicitly authorize the recording
> commit"*). It authorizes **nothing**: no release, no capability enablement.
> The record below carries `status: "TEMPLATE_UNSIGNED"` and placeholder
> signer blocks. It becomes a decision only when the verified release owner
> records it per the workflow (replace placeholders, set `status: "RECORDED"`,
> commit to `main` as the owner identity).

## What this revision adds over the 2026-10-13 preparation

The prior preparation (`decision-prep-limited-scope-wo30-2026-10-13.md` /
`decision-prep-hold-wo30-2026-10-13.md`) was assembled at main `73118ac5`
with `grg_00000008` BLOCKED — the strict-mode conformance instrument could
not run on any shared-host gate station (the issue #64 nproc collision).
**MAINT-002 closed that gap**:

| Change | Acceptance | Exact SHA |
| --- | --- | --- |
| AR2-019..023 + MAINT-001 (WO3.0 wave) | PRs #58/#56/#59/#61/#62/#60 | see the 2026-10-13 preparation |
| **MAINT-002 ambient-aware child-side RLIMIT_NPROC** | PR #65 (CI green) | `21287c251f6cd18629a220c3ffaabedff6370e6b` |
| **Strict-mode station evidence (post-fix)** | record `cer_mv7r651y` at main `a984ca6` | doc commit `bac7cab6070b9c3cef8cb2f9a40e599075f80541` |

The strict-mode record: **3 PASS + 7 DENIED_EXPECTED, 0 FAIL, 0
NOT_SUPPORTED** on the bwrap-0.13.0 shared-host gate station, with the full
`@arena/isolation` suite **60/60** (every sandboxed-execution test that
failed with EAGAIN at base now passes, including the adversarial escape
battery at the real OS isolation layer). The ambient uid process count
measured 256 kernel-level vs 30 visible; the applied ceiling adapted
(computed 384 = clamp(256+128, floor 128, hard 4096)) and the posture is
disclosed in the environment report.

This re-assembles the evidence set **over those exact SHAs and the current
main tip `a984ca643155eee5fde50fec4a0b986b73182de2**`** (CI battery completed/success on that SHA at
2026-10-14T06:50Z, live-verified) and re-runs the deterministic
`recomputeGates` (RGR1.0) over the canonical G0-G8 registry rows.

## The current machine basis (deterministic output)

Machine decision: **`NOT_GO / blocked_core_gate / blocking_findings=0 / sections=9 / rows=15 (blockers: grg_00000002, grg_00000013)**`** — `grg_00000008` is now **PASS** on real
OS-layer boundary evidence; the remaining core blockers (mac/win install
proof, accessibility scope disposition) are **owner/infrastructure inputs**,
not missing implementation.

| Gate | Section | Scope | Recomputed verdict |
| --- | --- | --- | --- |
| `grg_00000001` | G0-fork-baseline | core | **PASS** |
| `grg_00000002` | G0-fork-baseline | core | **BLOCKED** |
| `grg_00000003` | G1-contracts-architecture | core | **PASS** |
| `grg_00000004` | G1-contracts-architecture | core | **PASS** |
| `grg_00000005` | G2-security-tenant-boundaries | core | **PASS** |
| `grg_00000006` | G2-security-tenant-boundaries | core | **PASS** |
| `grg_00000007` | G2-security-tenant-boundaries | core | **PASS** |
| `grg_00000008` | G2-security-tenant-boundaries | core | **PASS** |
| `grg_00000009` | G3-durability-idempotency-resilience | core | **PASS** |
| `grg_00000010` | G4-proof-payments | core | **PASS** |
| `grg_00000011` | G5-expert-arena | core | **PASS** |
| `grg_00000012` | G6-product-end-to-end | core | **PASS** |
| `grg_00000013` | G6-product-end-to-end | core | **BLOCKED** |
| `grg_00000014` | G7-observability-operations | core | **PASS** |
| `grg_00000015` | G8-capability-acquisition | extension | **BLOCKED** |

Determinism was proven by running `recomputeGates` twice and comparing outputs
byte-for-byte (same discipline as `test/recompute-gates.test.ts`).
`validateDecisionRecord` accepts the record below as a valid
`TEMPLATE_UNSIGNED` preparation; it would be **invalid** as `RECORDED` until
the signer placeholders are replaced by the verified owner identity and the
recording commit is made per the workflow.

## The candidate record (unsigned)

```json
{
  "schema_version": "RDR1.0",
  "status": "TEMPLATE_UNSIGNED",
  "decision_id": "rdr_00000001",
  "decision_class": "LIMITED_SCOPE_GO",
  "decision_date": "2026-10-14T07:01:15Z",
  "scope": {
    "platforms": [
      "linux"
    ],
    "finance_mode": "test_mode",
    "untrusted_execution": "disabled",
    "identity_mode": "demo_auth",
    "isolation_mode": "synthetic_provider_only"
  },
  "evidence_manifest": [
    {
      "entry_id": "evd_00000001",
      "kind": "evidence_doc",
      "link": "docs/evidence/release/AR2-015-gate-report-2026-10-11.md",
      "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a",
      "description": "AR2-015 classified release-gate report \u2014 the recorded NOT_GO machine basis and limited-scope boundary (unchanged record of the AR2-015 evidence)"
    },
    {
      "entry_id": "evd_00000002",
      "kind": "pull_request",
      "link": "https://github.com/payswapdotorg/Arena-2.0/pull/47",
      "sha": "7d117f1d1b2bc4adbd7e38b6048737f19167da55",
      "description": "AR2-015 acceptance merge (squash) \u2014 the tree the adversarial profiles and gate report were accepted on"
    },
    {
      "entry_id": "evd_00000003",
      "kind": "pull_request",
      "link": "https://github.com/payswapdotorg/Arena-2.0/pull/58",
      "sha": "0004d1067d615d4fee73272536936e76353945a9",
      "description": "AR2-019 acceptance (squash) \u2014 LinuxNamespaceIsolationProvider runtime: bwrap namespace/seccomp/prlimit stack, adversarial escape battery 45/45 in the worker environment, strict-mode instrument 10/10; release-target strict-mode conformance now EVIDENCED on the TL shared-host gate station post-MAINT-002 (evd_00000017)"
    },
    {
      "entry_id": "evd_00000004",
      "kind": "pull_request",
      "link": "https://github.com/payswapdotorg/Arena-2.0/pull/56",
      "sha": "8a925dc16f71d0d05603326ff884adaf5e217021",
      "description": "AR2-020 acceptance (squash) \u2014 cross-platform install verification harness (scripts/install-verify) with evidenced platform fixes; macOS/Windows runner wiring lands separately under TL-owned .github/**"
    },
    {
      "entry_id": "evd_00000005",
      "kind": "pull_request",
      "link": "https://github.com/payswapdotorg/Arena-2.0/pull/59",
      "sha": "564d4644b07f9661842b35f7ec6f6a350d0df9f4",
      "description": "AR2-021 acceptance (squash) \u2014 rendered-state axe suite (4 journeys x 20 states) + keyboard journeys (4/4), 6 in-module defects fixed, station full-fidelity re-execution 48/48 a11y + 16 SSR"
    },
    {
      "entry_id": "evd_00000006",
      "kind": "pull_request",
      "link": "https://github.com/payswapdotorg/Arena-2.0/pull/61",
      "sha": "6f3a34f4ae4123a1cd599f2e64ba7738998eebbe",
      "description": "AR2-022 acceptance (squash) \u2014 production identity adapter: IDN1.0 identity contracts + OIDC/JWKS reference adapter, adversarial auth battery 59/59 station-re-executed, cross-tenant denial 5/5 re-closing grg_00000005"
    },
    {
      "entry_id": "evd_00000007",
      "kind": "pull_request",
      "link": "https://github.com/payswapdotorg/Arena-2.0/pull/60",
      "sha": "e1b6ea4fd138533d2f3665049df1ca72e8907a2f",
      "description": "MAINT-001 acceptance (squash) \u2014 hermetic crawler storage fix (scraper test storage race)"
    },
    {
      "entry_id": "evd_00000008",
      "kind": "pull_request",
      "link": "https://github.com/payswapdotorg/Arena-2.0/pull/62",
      "sha": "71c7d63d14dc1e9ffff8cc9554f0e787d0c8e875",
      "description": "AR2-023 acceptance (squash) \u2014 the decision instrument itself: RGR1.0 gate recomputation + RDR1.0 decision record + amendment chain + authorization workflow doc"
    },
    {
      "entry_id": "evd_00000009",
      "kind": "evidence_doc",
      "link": "docs/evidence/release/AR2-023-authorization-workflow-2026-10-14.md",
      "sha": "a984ca643155eee5fde50fec4a0b986b73182de2",
      "description": "AR2-023 authorization workflow \u2014 the standing who-signs/how-recorded/amend/enablement rules this preparation follows"
    },
    {
      "entry_id": "evd_00000010",
      "kind": "commit",
      "link": "https://github.com/payswapdotorg/Arena-2.0/commit/a984ca643155eee5fde50fec4a0b986b73182de2",
      "sha": "a984ca643155eee5fde50fec4a0b986b73182de2",
      "description": "Current main tip (MAINT-002 acceptance + governance reconciliation) \u2014 CI battery completed/success on this SHA at 2026-10-14T06:50Z (live-verified)"
    },
    {
      "entry_id": "evd_00000011",
      "kind": "evidence_doc",
      "link": "spec/work-orders/release-plan.md",
      "sha": "a984ca643155eee5fde50fec4a0b986b73182de2",
      "description": "WO3.0 release plan at the current tip \u2014 exit condition reconciled: implementation COMPLETE, remaining requirements are owner actions"
    },
    {
      "entry_id": "evd_00000012",
      "kind": "evidence_doc",
      "link": "spec/PROJECT-STATE.md",
      "sha": "a984ca643155eee5fde50fec4a0b986b73182de2",
      "description": "PROJECT-STATE at the current tip \u2014 19/19 roadmap + WO3.0 5/5 + MAINT-001 + MAINT-002 accepted; frontier = owner decisions and infrastructure"
    },
    {
      "entry_id": "evd_00000013",
      "kind": "pull_request",
      "link": "https://github.com/payswapdotorg/Arena-2.0/pull/48",
      "sha": "ddea6e48e343f6a21c1c9881c43377f0a0e6eecc",
      "description": "AR2-016 acceptance (squash) \u2014 ACQ1.0 acquisition contracts + provider router (capability-acquisition extension)"
    },
    {
      "entry_id": "evd_00000014",
      "kind": "pull_request",
      "link": "https://github.com/payswapdotorg/Arena-2.0/pull/49",
      "sha": "12043d009ac81599b99ac053aa4521de2499b1eb",
      "description": "AR2-017 acceptance (squash) \u2014 SCRP1.0 scraper factory, crawler runtime, external API adapters (mock-server tested scope)"
    },
    {
      "entry_id": "evd_00000015",
      "kind": "pull_request",
      "link": "https://github.com/payswapdotorg/Arena-2.0/pull/50",
      "sha": "e0eed650c5c4df3b7d30c1da0dcdcde1aa0d75f6",
      "description": "AR2-018 acceptance (squash) \u2014 UPG1.0 evidence-to-capability packaging, evaluation and controlled learning"
    },
    {
      "entry_id": "evd_00000016",
      "kind": "pull_request",
      "link": "https://github.com/payswapdotorg/Arena-2.0/pull/65",
      "sha": "21287c251f6cd18629a220c3ffaabedff6370e6b",
      "description": "MAINT-002 acceptance (squash) \u2014 ambient-aware child-side RLIMIT_NPROC: parent-side prlimit carries no --nproc, ceiling applied child-side after the userns transition, posture disclosed in IsolationEnvironmentReport + SandboxIsolationEvidence; TL station gate parity 29/45-with-16-EAGAIN-fails at base -> 60/60 at head; issue #64 closed"
    },
    {
      "entry_id": "evd_00000017",
      "kind": "evidence_doc",
      "link": "docs/evidence/isolation/AR2-019-strict-mode-station-evidence-2026-10-14.md",
      "sha": "bac7cab6070b9c3cef8cb2f9a40e599075f80541",
      "description": "AR2-019 strict-mode isolation conformance station evidence (post-MAINT-002) \u2014 record cer_mv7r651y at main a984ca6 on the bwrap-0.13.0 shared-host gate station: 3 PASS + 7 DENIED_EXPECTED, 0 FAIL, 0 NOT_SUPPORTED; ambient uid count 256 vs 30 visible with adaptive computed ceiling 384; the full isolation suite 60/60 incl. the adversarial escape battery at the REAL OS layer"
    }
  ],
  "gate_recomputation": {
    "schema_version": "RGR1.0",
    "evidence_set_id": "evs_wo30post",
    "entries": [
      {
        "gate_id": "grg_00000001",
        "section": "G0-fork-baseline",
        "scope": "core",
        "verdict": "PASS",
        "basis": [
          {
            "entry_id": "evd_00000001",
            "kind": "evidence_doc",
            "link": "docs/evidence/release/AR2-015-gate-report-2026-10-11.md",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a"
          },
          {
            "entry_id": "evd_00000010",
            "kind": "commit",
            "link": "https://github.com/payswapdotorg/Arena-2.0/commit/a984ca643155eee5fde50fec4a0b986b73182de2",
            "sha": "a984ca643155eee5fde50fec4a0b986b73182de2"
          }
        ],
        "gaps": [
          "ubuntu-latest/CI sandbox only; upstream base 29628c9 pinned in PROJECT-STATE"
        ],
        "findings": [],
        "recomputed_row": {
          "gate_id": "grg_00000001",
          "section": "G0-fork-baseline",
          "scope": "core",
          "requirement": "Fresh clone/install + clean battery on Linux; upstream base pinned; Apache-2.0/NOTICE preserved",
          "classification": "PASS",
          "evidence": {
            "evidence_class": "automated_unit_suite",
            "command": "pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm architecture:check",
            "environment": "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a,a984ca643155eee5fde50fec4a0b986b73182de2",
            "result": "green on every accepted WO PR (AR2-000 baseline report: PASS WITH EXISTING FAILURES, all pre-existing failures inventoried); CI battery required on main since 2026-10-10",
            "limitations": "ubuntu-latest/CI sandbox only; upstream base 29628c9 pinned in PROJECT-STATE",
            "reviewer": "arena-tl"
          },
          "waiver_authorization": null,
          "findings": []
        }
      },
      {
        "gate_id": "grg_00000002",
        "section": "G0-fork-baseline",
        "scope": "core",
        "verdict": "BLOCKED",
        "basis": [
          {
            "entry_id": "evd_00000004",
            "kind": "pull_request",
            "link": "https://github.com/payswapdotorg/Arena-2.0/pull/56",
            "sha": "8a925dc16f71d0d05603326ff884adaf5e217021"
          },
          {
            "entry_id": "evd_00000010",
            "kind": "commit",
            "link": "https://github.com/payswapdotorg/Arena-2.0/commit/a984ca643155eee5fde50fec4a0b986b73182de2",
            "sha": "a984ca643155eee5fde50fec4a0b986b73182de2"
          }
        ],
        "gaps": [
          "blocks cross-platform release claims, not the Linux-scoped core posture; the harness is ready and the missing input is the mac/win runner execution",
          "fnr_00000001 (medium, unresolved): macOS/Windows fresh-install runner proof not yet executed (AR2-020 harness merged; runners outstanding)",
          "classified BLOCKED: AR2-020 install-verification harness ACCEPTED (PR #56, CI green) with evidenced platform fixes; the macOS/Windows RUNNER runs themselves are still not executed \u2014 runner wiring lands separately under TL-owned .github/**; Linux install evidence remains green in the battery"
        ],
        "findings": [
          {
            "finding_id": "fnr_00000001",
            "severity": "medium",
            "description": "macOS/Windows fresh-install runner proof not yet executed (AR2-020 harness merged; runners outstanding)",
            "resolution": "unresolved",
            "owner_acceptance": null
          }
        ],
        "recomputed_row": {
          "gate_id": "grg_00000002",
          "section": "G0-fork-baseline",
          "scope": "core",
          "requirement": "macOS/Windows install proof (required before any cross-platform release claim)",
          "classification": "BLOCKED",
          "evidence": {
            "evidence_class": "automated_unit_suite",
            "command": "(not executed \u2014 no macOS/Windows runner in the current battery)",
            "environment": "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)",
            "sha": "8a925dc16f71d0d05603326ff884adaf5e217021,a984ca643155eee5fde50fec4a0b986b73182de2",
            "result": "AR2-020 install-verification harness ACCEPTED (PR #56, CI green) with evidenced platform fixes; the macOS/Windows RUNNER runs themselves are still not executed \u2014 runner wiring lands separately under TL-owned .github/**; Linux install evidence remains green in the battery",
            "limitations": "blocks cross-platform release claims, not the Linux-scoped core posture; the harness is ready and the missing input is the mac/win runner execution",
            "reviewer": "arena-tl"
          },
          "waiver_authorization": null,
          "findings": [
            {
              "finding_id": "fnr_00000001",
              "severity": "medium",
              "description": "macOS/Windows fresh-install runner proof not yet executed (AR2-020 harness merged; runners outstanding)",
              "resolution": "unresolved",
              "owner_acceptance": null
            }
          ]
        }
      },
      {
        "gate_id": "grg_00000003",
        "section": "G1-contracts-architecture",
        "scope": "core",
        "verdict": "PASS",
        "basis": [
          {
            "entry_id": "evd_00000001",
            "kind": "evidence_doc",
            "link": "docs/evidence/release/AR2-015-gate-report-2026-10-11.md",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a"
          },
          {
            "entry_id": "evd_00000010",
            "kind": "commit",
            "link": "https://github.com/payswapdotorg/Arena-2.0/commit/a984ca643155eee5fde50fec4a0b986b73182de2",
            "sha": "a984ca643155eee5fde50fec4a0b986b73182de2"
          }
        ],
        "gaps": [
          "contract-unit scope; integration drift covered by per-package suites"
        ],
        "findings": [],
        "recomputed_row": {
          "gate_id": "grg_00000003",
          "section": "G1-contracts-architecture",
          "scope": "core",
          "requirement": "Runtime schema validation; state machines reject invalid transitions; immutable history; no cycles; public exports only",
          "classification": "PASS",
          "evidence": {
            "evidence_class": "automated_unit_suite",
            "command": "pnpm --filter @arena/contracts test-equivalent: tsx --test test/vectors.test.ts test/transitions.test.ts test/completeness.test.ts test/ownership.test.ts test/contracts.test.ts",
            "environment": "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a,a984ca643155eee5fde50fec4a0b986b73182de2",
            "result": "104/104 contract vectors/transitions/ownership green (CF1.0 frozen; strict schemas reject unknown fields)",
            "limitations": "contract-unit scope; integration drift covered by per-package suites",
            "reviewer": "arena-tl"
          },
          "waiver_authorization": null,
          "findings": []
        }
      },
      {
        "gate_id": "grg_00000004",
        "section": "G1-contracts-architecture",
        "scope": "core",
        "verdict": "PASS",
        "basis": [
          {
            "entry_id": "evd_00000001",
            "kind": "evidence_doc",
            "link": "docs/evidence/release/AR2-015-gate-report-2026-10-11.md",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a"
          },
          {
            "entry_id": "evd_00000010",
            "kind": "commit",
            "link": "https://github.com/payswapdotorg/Arena-2.0/commit/a984ca643155eee5fde50fec4a0b986b73182de2",
            "sha": "a984ca643155eee5fde50fec4a0b986b73182de2"
          }
        ],
        "gaps": [
          "static policy check; runtime wiring audited per WO acceptance"
        ],
        "findings": [],
        "recomputed_row": {
          "gate_id": "grg_00000004",
          "section": "G1-contracts-architecture",
          "scope": "core",
          "requirement": "Dependency direction guard; architecture policy; no deep imports",
          "classification": "PASS",
          "evidence": {
            "evidence_class": "automated_unit_suite",
            "command": "pnpm architecture:check",
            "environment": "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a,a984ca643155eee5fde50fec4a0b986b73182de2",
            "result": "0 violations across all registered arena modules (roots/publicEntrypoints/owner fences)",
            "limitations": "static policy check; runtime wiring audited per WO acceptance",
            "reviewer": "arena-tl"
          },
          "waiver_authorization": null,
          "findings": []
        }
      },
      {
        "gate_id": "grg_00000005",
        "section": "G2-security-tenant-boundaries",
        "scope": "core",
        "verdict": "PASS",
        "basis": [
          {
            "entry_id": "evd_00000006",
            "kind": "pull_request",
            "link": "https://github.com/payswapdotorg/Arena-2.0/pull/61",
            "sha": "6f3a34f4ae4123a1cd599f2e64ba7738998eebbe"
          },
          {
            "entry_id": "evd_00000010",
            "kind": "commit",
            "link": "https://github.com/payswapdotorg/Arena-2.0/commit/a984ca643155eee5fde50fec4a0b986b73182de2",
            "sha": "a984ca643155eee5fde50fec4a0b986b73182de2"
          }
        ],
        "gaps": [
          "reference adapter implemented and evidenced; the operator IdP choice + production issuer configuration remain an owner action before multi-tenant exposure"
        ],
        "findings": [],
        "recomputed_row": {
          "gate_id": "grg_00000005",
          "section": "G2-security-tenant-boundaries",
          "scope": "core",
          "requirement": "Tenant-scoped object access: cross-tenant ID guessing fails closed and is indistinguishable from not-found; tenant list isolation; server-derived tenant context",
          "classification": "PASS",
          "evidence": {
            "evidence_class": "automated_unit_suite",
            "command": "tsx --test test/cross-tenant.test.ts (packages/arena-release-gate; spawns a REAL arena-api process)",
            "environment": "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)",
            "sha": "6f3a34f4ae4123a1cd599f2e64ba7738998eebbe,a984ca643155eee5fde50fec4a0b986b73182de2",
            "result": "cross-tenant guessing sweep still returns identical typed 404s with no existence oracle (battery re-run green on every WO3.0 PR and current main); AR2-022 production identity adapter ACCEPTED (PR #61): IDN1.0 + OIDC/JWKS reference adapter, adversarial auth battery 59/59 station-re-executed, cross-tenant denial 5/5 re-closing this gate",
            "limitations": "reference adapter implemented and evidenced; the operator IdP choice + production issuer configuration remain an owner action before multi-tenant exposure",
            "reviewer": "arena-tl"
          },
          "waiver_authorization": null,
          "findings": []
        }
      },
      {
        "gate_id": "grg_00000006",
        "section": "G2-security-tenant-boundaries",
        "scope": "core",
        "verdict": "PASS",
        "basis": [
          {
            "entry_id": "evd_00000001",
            "kind": "evidence_doc",
            "link": "docs/evidence/release/AR2-015-gate-report-2026-10-11.md",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a"
          },
          {
            "entry_id": "evd_00000010",
            "kind": "commit",
            "link": "https://github.com/payswapdotorg/Arena-2.0/commit/a984ca643155eee5fde50fec4a0b986b73182de2",
            "sha": "a984ca643155eee5fde50fec4a0b986b73182de2"
          }
        ],
        "gaps": [
          "HMAC-SHA256 v1 scheme, 300s default tolerance; receiver-side apply-once is consumer contract"
        ],
        "findings": [],
        "recomputed_row": {
          "gate_id": "grg_00000006",
          "section": "G2-security-tenant-boundaries",
          "scope": "core",
          "requirement": "Webhooks reject forged signatures, stale timestamps, wrong schemes, malformed headers; duplicate/replayed deliveries apply exactly once",
          "classification": "PASS",
          "evidence": {
            "evidence_class": "automated_unit_suite",
            "command": "tsx --test test/webhook-signature.test.ts (packages/arena-release-gate; REAL HTTP receiver)",
            "environment": "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a,a984ca643155eee5fde50fec4a0b986b73182de2",
            "result": "valid delivery APPLIED once; tampered body/wrong secret/old-header-new-body \u21d2 BAD_SIGNATURE 401; stale \u21d2 STALE_TIMESTAMP 401; wrong scheme/malformed \u21d2 400; verbatim replay and attempt-bumped retry \u21d2 DUPLICATE with effect still applied once (delivery-id dedup)",
            "limitations": "HMAC-SHA256 v1 scheme, 300s default tolerance; receiver-side apply-once is consumer contract",
            "reviewer": "arena-tl"
          },
          "waiver_authorization": null,
          "findings": []
        }
      },
      {
        "gate_id": "grg_00000007",
        "section": "G2-security-tenant-boundaries",
        "scope": "core",
        "verdict": "PASS",
        "basis": [
          {
            "entry_id": "evd_00000001",
            "kind": "evidence_doc",
            "link": "docs/evidence/release/AR2-015-gate-report-2026-10-11.md",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a"
          },
          {
            "entry_id": "evd_00000010",
            "kind": "commit",
            "link": "https://github.com/payswapdotorg/Arena-2.0/commit/a984ca643155eee5fde50fec4a0b986b73182de2",
            "sha": "a984ca643155eee5fde50fec4a0b986b73182de2"
          }
        ],
        "gaps": [
          "fixture corpus of representative injection payloads; adversarial breadth is unbounded by nature"
        ],
        "findings": [],
        "recomputed_row": {
          "gate_id": "grg_00000007",
          "section": "G2-security-tenant-boundaries",
          "scope": "core",
          "requirement": "Untrusted page/API/evidence content is data, never policy: prompt-injection payloads cannot alter validation outcomes, bindings or proof decisions",
          "classification": "PASS",
          "evidence": {
            "evidence_class": "automated_unit_suite",
            "command": "tsx --test test/prompt-injection-as-data.test.ts (packages/arena-release-gate; REAL @arena/evidence store + evaluateProof)",
            "environment": "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a,a984ca643155eee5fde50fec4a0b986b73182de2",
            "result": "injection-laden storage refs accepted/stored verbatim as data with outcomes identical to benign twins; binding always compared against the server-derived ExpectedBinding (payload text irrelevant); caller/self-evaluation assertions never flip P0/P2 decisions",
            "limitations": "fixture corpus of representative injection payloads; adversarial breadth is unbounded by nature",
            "reviewer": "arena-tl"
          },
          "waiver_authorization": null,
          "findings": []
        }
      },
      {
        "gate_id": "grg_00000008",
        "section": "G2-security-tenant-boundaries",
        "scope": "core",
        "verdict": "PASS",
        "basis": [
          {
            "entry_id": "evd_00000003",
            "kind": "pull_request",
            "link": "https://github.com/payswapdotorg/Arena-2.0/pull/58",
            "sha": "0004d1067d615d4fee73272536936e76353945a9"
          },
          {
            "entry_id": "evd_00000016",
            "kind": "pull_request",
            "link": "https://github.com/payswapdotorg/Arena-2.0/pull/65",
            "sha": "21287c251f6cd18629a220c3ffaabedff6370e6b"
          },
          {
            "entry_id": "evd_00000017",
            "kind": "evidence_doc",
            "link": "docs/evidence/isolation/AR2-019-strict-mode-station-evidence-2026-10-14.md",
            "sha": "bac7cab6070b9c3cef8cb2f9a40e599075f80541"
          },
          {
            "entry_id": "evd_00000010",
            "kind": "commit",
            "link": "https://github.com/payswapdotorg/Arena-2.0/commit/a984ca643155eee5fde50fec4a0b986b73182de2",
            "sha": "a984ca643155eee5fde50fec4a0b986b73182de2"
          }
        ],
        "gaps": [
          "boundary evidence is station-evidenced on a shared-host gate station (the same class the release-target run requires; the ambient count varies with host load and the ceiling adapts by design, recorded per run); untrusted expert/scraper execution stays DISABLED \u2014 enablement remains coupled to a recorded owner decision through the AR2-023 instrument and ISOLATION_PROVIDER_IDENTITY.production_enabled remains the literal type false"
        ],
        "findings": [],
        "recomputed_row": {
          "gate_id": "grg_00000008",
          "section": "G2-security-tenant-boundaries",
          "scope": "core",
          "requirement": "Capsule filesystem/process/network/credential boundaries tested at the ACTUAL OS/runtime isolation layer; capsule tenant mismatch fails closed and is indistinguishable from not-found",
          "classification": "PASS",
          "evidence": {
            "evidence_class": "automated_unit_suite",
            "command": "tsx --test test/capsule-tenant-refusal.test.ts (packages/arena-release-gate; REAL CapsuleProviderPort via SyntheticLocalProvider)",
            "environment": "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)",
            "sha": "0004d1067d615d4fee73272536936e76353945a9,21287c251f6cd18629a220c3ffaabedff6370e6b,bac7cab6070b9c3cef8cb2f9a40e599075f80541,a984ca643155eee5fde50fec4a0b986b73182de2",
            "result": "OS-level capsule boundary evidence at the REAL isolation layer (post-MAINT-002): strict-mode conformance record cer_mv7r651y at main a984ca6 on the bwrap-0.13.0 shared-host gate station \u2014 3 PASS + 7 DENIED_EXPECTED, 0 FAIL, 0 NOT_SUPPORTED (fs-escape/net-egress/pid-visibility/syscall-filter/resource ceilings x3 all DENIED at the boundary; secret-hygiene, tenant-binding fail-closed, namespace-conformance PASS); the full @arena/isolation suite 60/60 incl. the adversarial escape battery EXECUTED_SANDBOXED; capsule tenant mismatch fails closed (tenant-binding probe + the CI-green port-level refusal matrix with identical typed 404s); the ambient uid process count (256 kernel-level vs 30 visible) no longer gates execution \u2014 MAINT-002 (PR #65) applies RLIMIT_NPROC child-side after the userns transition with an ambient-aware ceiling (computed 384 = clamp(256+128, 128, 4096)) disclosed in the environment report",
            "limitations": "boundary evidence is station-evidenced on a shared-host gate station (the same class the release-target run requires; the ambient count varies with host load and the ceiling adapts by design, recorded per run); untrusted expert/scraper execution stays DISABLED \u2014 enablement remains coupled to a recorded owner decision through the AR2-023 instrument and ISOLATION_PROVIDER_IDENTITY.production_enabled remains the literal type false",
            "reviewer": "arena-tl"
          },
          "waiver_authorization": null,
          "findings": []
        }
      },
      {
        "gate_id": "grg_00000009",
        "section": "G3-durability-idempotency-resilience",
        "scope": "core",
        "verdict": "PASS",
        "basis": [
          {
            "entry_id": "evd_00000001",
            "kind": "evidence_doc",
            "link": "docs/evidence/release/AR2-015-gate-report-2026-10-11.md",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a"
          },
          {
            "entry_id": "evd_00000010",
            "kind": "commit",
            "link": "https://github.com/payswapdotorg/Arena-2.0/commit/a984ca643155eee5fde50fec4a0b986b73182de2",
            "sha": "a984ca643155eee5fde50fec4a0b986b73182de2"
          }
        ],
        "gaps": [
          "node:sqlite reference engine; no production-scale DB/hosting claim without its own ADR"
        ],
        "findings": [],
        "recomputed_row": {
          "gate_id": "grg_00000009",
          "section": "G3-durability-idempotency-resilience",
          "scope": "core",
          "requirement": "Same-key replay vs same-key/different-digest conflict; two-instance admission; leases/fencing; SIGKILL crash+restart recovery; outbox exactly-once; no correctness in process memory only",
          "classification": "PASS",
          "evidence": {
            "evidence_class": "automated_unit_suite",
            "command": "tsx --test test/durable.test.ts test/durable-edge.test.ts (arena-api) + test/durable.test.ts test/jobs.test.ts (arena-persistence) + test/two-instance-recovery.test.ts (arena-harness)",
            "environment": "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a,a984ca643155eee5fde50fec4a0b986b73182de2",
            "result": "durable sqlite/WAL suites green; two REAL API processes on one durable file with cross-instance canonical state; process-group SIGKILL mid-flight \u21d2 restart with zero state loss and exactly-once outbox delivery",
            "limitations": "node:sqlite reference engine; no production-scale DB/hosting claim without its own ADR",
            "reviewer": "arena-tl"
          },
          "waiver_authorization": null,
          "findings": []
        }
      },
      {
        "gate_id": "grg_00000010",
        "section": "G4-proof-payments",
        "scope": "core",
        "verdict": "PASS",
        "basis": [
          {
            "entry_id": "evd_00000001",
            "kind": "evidence_doc",
            "link": "docs/evidence/release/AR2-015-gate-report-2026-10-11.md",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a"
          },
          {
            "entry_id": "evd_00000010",
            "kind": "commit",
            "link": "https://github.com/payswapdotorg/Arena-2.0/commit/a984ca643155eee5fde50fec4a0b986b73182de2",
            "sha": "a984ca643155eee5fde50fec4a0b986b73182de2"
          }
        ],
        "gaps": [
          "InMemoryTestProvider test-mode settlement; live-money readiness is a separate commercial/legal gate"
        ],
        "findings": [],
        "recomputed_row": {
          "gate_id": "grg_00000010",
          "section": "G4-proof-payments",
          "scope": "core",
          "requirement": "Failed/inconclusive proof never pays; proof task-bound; duplicate payment commands produce one ledger + one provider operation; live-money unavailable without production configuration",
          "classification": "PASS",
          "evidence": {
            "evidence_class": "automated_unit_suite",
            "command": "tsx --test test/evidence.test.ts test/proof-evaluator.test.ts (arena-evidence) + test/ledger.test.ts test/payment-flow.test.ts (arena-payment) + test/vertical-p0.test.ts test/next-expert.test.ts (arena-harness)",
            "environment": "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a,a984ca643155eee5fde50fec4a0b986b73182de2",
            "result": "P0 baseline-fail\u21d2intervention-pass with exactly ONE test payout; failed first attempt never pays; P2 INCONCLUSIVE payout gate NOT_READY (disclosed, never bypassed); duplicate release/ledger replay proven single-operation; live payment mode DISABLED",
            "limitations": "InMemoryTestProvider test-mode settlement; live-money readiness is a separate commercial/legal gate",
            "reviewer": "arena-tl"
          },
          "waiver_authorization": null,
          "findings": []
        }
      },
      {
        "gate_id": "grg_00000011",
        "section": "G5-expert-arena",
        "scope": "core",
        "verdict": "PASS",
        "basis": [
          {
            "entry_id": "evd_00000001",
            "kind": "evidence_doc",
            "link": "docs/evidence/release/AR2-015-gate-report-2026-10-11.md",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a"
          },
          {
            "entry_id": "evd_00000010",
            "kind": "commit",
            "link": "https://github.com/payswapdotorg/Arena-2.0/commit/a984ca643155eee5fde50fec4a0b986b73182de2",
            "sha": "a984ca643155eee5fde50fec4a0b986b73182de2"
          }
        ],
        "gaps": [
          "in-memory reference registries behind frozen ports (durable wiring at composition root)"
        ],
        "findings": [],
        "recomputed_row": {
          "gate_id": "grg_00000011",
          "section": "G5-expert-arena",
          "scope": "core",
          "requirement": "P2 requires predeclared rubric + independent quorum; self-evaluation never a vote; conflict exclusion; adjudication thresholds; immutable candidates",
          "classification": "PASS",
          "evidence": {
            "evidence_class": "automated_unit_suite",
            "command": "tsx --test test/machines.test.ts test/candidate.test.ts test/review-assignment.test.ts test/rubric-quorum.test.ts test/adjudication-validation.test.ts (arena-expert-arena) + test/p2-review.test.ts (arena-harness)",
            "environment": "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a,a984ca643155eee5fde50fec4a0b986b73182de2",
            "result": "frozen EA machines green; P2 fail-closed proof routed to independent review with never-a-vote self-evals, conflict-checked reviewers, quorum and adjudication; round outcome payment-bound",
            "limitations": "in-memory reference registries behind frozen ports (durable wiring at composition root)",
            "reviewer": "arena-tl"
          },
          "waiver_authorization": null,
          "findings": []
        }
      },
      {
        "gate_id": "grg_00000012",
        "section": "G6-product-end-to-end",
        "scope": "core",
        "verdict": "PASS",
        "basis": [
          {
            "entry_id": "evd_00000001",
            "kind": "evidence_doc",
            "link": "docs/evidence/release/AR2-015-gate-report-2026-10-11.md",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a"
          },
          {
            "entry_id": "evd_00000010",
            "kind": "commit",
            "link": "https://github.com/payswapdotorg/Arena-2.0/commit/a984ca643155eee5fde50fec4a0b986b73182de2",
            "sha": "a984ca643155eee5fde50fec4a0b986b73182de2"
          }
        ],
        "gaps": [
          "integration claims within tested scope only \u2014 see report header"
        ],
        "findings": [],
        "recomputed_row": {
          "gate_id": "grg_00000012",
          "section": "G6-product-end-to-end",
          "scope": "core",
          "requirement": "Real external client \u2192 real API \u2192 expert attempt \u2192 validator \u2192 result; demo mode visibly labelled; second-expert path with attribution",
          "classification": "PASS",
          "evidence": {
            "evidence_class": "automated_unit_suite",
            "command": "tsx --test test/vertical-p0.test.ts test/next-expert.test.ts test/p2-review.test.ts test/two-instance-recovery.test.ts (arena-harness) + test/e2e-real-api.test.ts (arena-workbench)",
            "environment": "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a,a984ca643155eee5fde50fec4a0b986b73182de2",
            "result": "four REAL-process acceptance profiles green (exactly-one payout; signed webhooks apply-once; stable-ID trace; failed-attempt routing with attribution; P2 independent review; SIGKILL recovery); workbench binds the real API with labelled demo preset",
            "limitations": "integration claims within tested scope only \u2014 see report header",
            "reviewer": "arena-tl"
          },
          "waiver_authorization": null,
          "findings": []
        }
      },
      {
        "gate_id": "grg_00000013",
        "section": "G6-product-end-to-end",
        "scope": "core",
        "verdict": "BLOCKED",
        "basis": [
          {
            "entry_id": "evd_00000005",
            "kind": "pull_request",
            "link": "https://github.com/payswapdotorg/Arena-2.0/pull/59",
            "sha": "564d4644b07f9661842b35f7ec6f6a350d0df9f4"
          },
          {
            "entry_id": "evd_00000010",
            "kind": "commit",
            "link": "https://github.com/payswapdotorg/Arena-2.0/commit/a984ca643155eee5fde50fec4a0b986b73182de2",
            "sha": "a984ca643155eee5fde50fec4a0b986b73182de2"
          }
        ],
        "gaps": [
          "requester/expert/reviewer rendered-state coverage is accepted; developer/operations surfaces await the owner scope disposition; no customer-facing accessibility claim is made",
          "fnr_00000002 (medium, unresolved): accessibility E2E coverage (keyboard/screen-reader across all flows) not yet evidenced",
          "classified BLOCKED: AR2-021 accessibility E2E ACCEPTED (PR #59): rendered-state axe suite across 4 journeys x 20 states + keyboard journeys 4/4, six defects fixed in-module, station full-fidelity re-execution 48/48 a11y + 16 SSR with Playwright Chromium; the developer/operations-surface scope disposition (extend coverage, or record the owner-accepted residual risk) remains an owner action"
        ],
        "findings": [
          {
            "finding_id": "fnr_00000002",
            "severity": "medium",
            "description": "accessibility E2E coverage (keyboard/screen-reader across all flows) not yet evidenced",
            "resolution": "unresolved",
            "owner_acceptance": null
          }
        ],
        "recomputed_row": {
          "gate_id": "grg_00000013",
          "section": "G6-product-end-to-end",
          "scope": "core",
          "requirement": "Responsive, keyboard-accessible E2E coverage across requester/expert/reviewer/developer/operations flows",
          "classification": "BLOCKED",
          "evidence": {
            "evidence_class": "automated_unit_suite",
            "command": "tsx --test test/workbench.test.ts test/render.test.tsx test/expert-review.test.tsx (arena-workbench)",
            "environment": "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)",
            "sha": "564d4644b07f9661842b35f7ec6f6a350d0df9f4,a984ca643155eee5fde50fec4a0b986b73182de2",
            "result": "AR2-021 accessibility E2E ACCEPTED (PR #59): rendered-state axe suite across 4 journeys x 20 states + keyboard journeys 4/4, six defects fixed in-module, station full-fidelity re-execution 48/48 a11y + 16 SSR with Playwright Chromium; the developer/operations-surface scope disposition (extend coverage, or record the owner-accepted residual risk) remains an owner action",
            "limitations": "requester/expert/reviewer rendered-state coverage is accepted; developer/operations surfaces await the owner scope disposition; no customer-facing accessibility claim is made",
            "reviewer": "arena-tl"
          },
          "waiver_authorization": null,
          "findings": [
            {
              "finding_id": "fnr_00000002",
              "severity": "medium",
              "description": "accessibility E2E coverage (keyboard/screen-reader across all flows) not yet evidenced",
              "resolution": "unresolved",
              "owner_acceptance": null
            }
          ]
        }
      },
      {
        "gate_id": "grg_00000014",
        "section": "G7-observability-operations",
        "scope": "core",
        "verdict": "PASS",
        "basis": [
          {
            "entry_id": "evd_00000001",
            "kind": "evidence_doc",
            "link": "docs/evidence/release/AR2-015-gate-report-2026-10-11.md",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a"
          },
          {
            "entry_id": "evd_00000010",
            "kind": "commit",
            "link": "https://github.com/payswapdotorg/Arena-2.0/commit/a984ca643155eee5fde50fec4a0b986b73182de2",
            "sha": "a984ca643155eee5fde50fec4a0b986b73182de2"
          }
        ],
        "gaps": [
          "observability reference implementation; production metric backend wiring is deployment scope"
        ],
        "findings": [],
        "recomputed_row": {
          "gate_id": "grg_00000014",
          "section": "G7-observability-operations",
          "scope": "core",
          "requirement": "Quota exhaustion visible and fail-closed; readiness distinguishes API/dependency/queue lag; privacy-safe logs; retention drift detection; runbooks for the required scenarios",
          "classification": "PASS",
          "evidence": {
            "evidence_class": "automated_unit_suite",
            "command": "tsx --test test/health-capacity.test.ts test/custodian.test.ts test/observability-retention.test.ts (arena-ops)",
            "environment": "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a,a984ca643155eee5fde50fec4a0b986b73182de2",
            "result": "fail-closed readiness probes; typed QUOTA_EXHAUSTED; queue-lag gauge; retained dead letters; capsule teardown-drift custodian driving the REAL provider port; sha256 tenant pseudonyms + frozen-enum metrics; retention with zero deletion authority; RUNBOOKS.md RB-1..RB-8",
            "limitations": "observability reference implementation; production metric backend wiring is deployment scope",
            "reviewer": "arena-tl"
          },
          "waiver_authorization": null,
          "findings": []
        }
      },
      {
        "gate_id": "grg_00000015",
        "section": "G8-capability-acquisition",
        "scope": "extension",
        "verdict": "BLOCKED",
        "basis": [
          {
            "entry_id": "evd_00000013",
            "kind": "pull_request",
            "link": "https://github.com/payswapdotorg/Arena-2.0/pull/48",
            "sha": "ddea6e48e343f6a21c1c9881c43377f0a0e6eecc"
          },
          {
            "entry_id": "evd_00000014",
            "kind": "pull_request",
            "link": "https://github.com/payswapdotorg/Arena-2.0/pull/49",
            "sha": "12043d009ac81599b99ac053aa4521de2499b1eb"
          },
          {
            "entry_id": "evd_00000015",
            "kind": "pull_request",
            "link": "https://github.com/payswapdotorg/Arena-2.0/pull/50",
            "sha": "e0eed650c5c4df3b7d30c1da0dcdcde1aa0d75f6"
          },
          {
            "entry_id": "evd_00000010",
            "kind": "commit",
            "link": "https://github.com/payswapdotorg/Arena-2.0/commit/a984ca643155eee5fde50fec4a0b986b73182de2",
            "sha": "a984ca643155eee5fde50fec4a0b986b73182de2"
          }
        ],
        "gaps": [
          "extension scope; untrusted scraper execution disabled; enablement path = recorded owner decision via the AR2-023 instrument over the evidenced isolation mode",
          "classified BLOCKED: capability-acquisition extension runtime IMPLEMENTED AND ACCEPTED (AR2-016 PR #48, AR2-017 PR #49, AR2-018 PR #50; tested scope excludes live external services \u2014 mock-server adapters); this G8 extension gate stays BLOCKED because scraper execution in production requires the owner-recorded enablement decision over the now-evidenced OS-level isolation mode (grg_00000008 strict-mode conformance PASS post-MAINT-002, evd_00000017); it does not block the core release decision and becomes a hard gate for the extension release"
        ],
        "findings": [],
        "recomputed_row": {
          "gate_id": "grg_00000015",
          "section": "G8-capability-acquisition",
          "scope": "extension",
          "requirement": "Capability-acquisition/scraper execution gates: versioned acquisition contracts, provider routing modes, immutable scraper builds, real-isolation execution only, SSRF/egress controls, rights/provenance, before/after capability evaluation",
          "classification": "BLOCKED",
          "evidence": {
            "evidence_class": "automated_unit_suite",
            "command": "(not implemented \u2014 AR2-016/017/018 remain planned and not dispatched)",
            "environment": "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)",
            "sha": "ddea6e48e343f6a21c1c9881c43377f0a0e6eecc,12043d009ac81599b99ac053aa4521de2499b1eb,e0eed650c5c4df3b7d30c1da0dcdcde1aa0d75f6,a984ca643155eee5fde50fec4a0b986b73182de2",
            "result": "capability-acquisition extension runtime IMPLEMENTED AND ACCEPTED (AR2-016 PR #48, AR2-017 PR #49, AR2-018 PR #50; tested scope excludes live external services \u2014 mock-server adapters); this G8 extension gate stays BLOCKED because scraper execution in production requires the owner-recorded enablement decision over the now-evidenced OS-level isolation mode (grg_00000008 strict-mode conformance PASS post-MAINT-002, evd_00000017); it does not block the core release decision and becomes a hard gate for the extension release",
            "limitations": "extension scope; untrusted scraper execution disabled; enablement path = recorded owner decision via the AR2-023 instrument over the evidenced isolation mode",
            "reviewer": "arena-tl"
          },
          "waiver_authorization": null,
          "findings": []
        }
      }
    ],
    "machine_decision": {
      "decision": "NOT_GO",
      "reason": "blocked_core_gate",
      "blocking_findings": 0,
      "sections_covered": 9,
      "rows_classified": 15,
      "detail": "grg_00000002 (G0-fork-baseline): macOS/Windows install proof (required before any cross-platform release claim) | grg_00000013 (G6-product-end-to-end): Responsive, keyboard-accessible E2E coverage across requester/expert/reviewer/developer/operations flows"
    }
  },
  "residual_risks": [
    {
      "risk_id": "rsk_00000001",
      "description": "Cross-platform install proof outstanding (macOS/Windows) \u2014 limited scope is Linux-only; AR2-020 harness merged, runner execution is the missing input",
      "severity": "medium",
      "linked_gates": [
        "grg_00000002"
      ],
      "disposition": "ACCEPTED_WITH_CONTROLS",
      "mitigation": "Scope bounded to linux; no cross-platform distribution or claim is made; the AR2-020 harness executes the runner proofs before any platform expansion."
    },
    {
      "risk_id": "rsk_00000002",
      "description": "Untrusted expert/scraper execution stays disabled by scope \u2014 OS-level isolation is now EVIDENCED (strict-mode conformance PASS on a shared-host gate station post-MAINT-002, record cer_mv7r651y), but production enablement requires a separately recorded owner decision over the approved isolation mode",
      "severity": "medium",
      "linked_gates": [
        "grg_00000008"
      ],
      "disposition": "ACCEPTED_WITH_CONTROLS",
      "mitigation": "Untrusted execution DISABLED in this scope; only trusted in-process execution paths run; the AR2-019 runtime is merged and its strict-mode conformance is evidenced on the gate station class the release-target run requires; enablement requires a new recorded owner decision through the AR2-023 instrument."
    },
    {
      "risk_id": "rsk_00000003",
      "description": "Accessibility E2E coverage accepted for requester/expert/reviewer rendered-state journeys; developer/operations surfaces await the owner scope disposition",
      "severity": "medium",
      "linked_gates": [
        "grg_00000013"
      ],
      "disposition": "ACCEPTED_WITH_CONTROLS",
      "mitigation": "No customer-facing accessibility claim; operator/lab use with the limitation recorded; AR2-021 coverage extends or the residual risk is re-recorded before any customer-facing expansion."
    },
    {
      "risk_id": "rsk_00000004",
      "description": "Demo-auth identity adapter in use \u2014 the AR2-022 production adapter (IDN1.0 + OIDC/JWKS reference) is merged but the operator IdP choice/configuration is outstanding",
      "severity": "medium",
      "linked_gates": [
        "grg_00000005"
      ],
      "disposition": "ACCEPTED_WITH_CONTROLS",
      "mitigation": "Deployment bounded to recorded demo tenants; no external tenant onboarding; production issuer configuration of the AR2-022 adapter is required before multi-tenant exposure."
    }
  ],
  "signer": {
    "name": "PREP PLACEHOLDER \u2014 release owner (TL-prepared, unsigned)",
    "role": "release_owner",
    "method": "github_identity_docs_commit",
    "github_identity": "PREP-PLACEHOLDER"
  },
  "review_conditions": [
    {
      "kind": "expires_on",
      "description": "This limited-scope authorization expires on this date unless re-recorded or amended",
      "date": "2027-01-31"
    },
    {
      "kind": "re_review_on_event",
      "description": "Re-review when any G0-G8 gate evidence lands on main (mac/win runner runs, release-target strict-mode conformance, accessibility scope disposition, IdP configuration)",
      "date": null
    },
    {
      "kind": "enablement_precondition",
      "description": "Live-money payments stay DISABLED; enabling requires a separately registered work order created only after a recorded owner decision",
      "date": null
    }
  ],
  "supersedes": null,
  "statement": "PREPARED FOR OWNER SIGNATURE \u2014 NOT A DECISION. A filled LIMITED_SCOPE_GO record over the CURRENT post-MAINT-002 evidence set (main a984ca6, WO3.0 acceptances PRs #58/#56/#59/#61/#62 + MAINT-001 #60 + MAINT-002 #65): Linux only, test-mode finance, no untrusted execution, synthetic-provider isolation basis, demo-auth identity. The attached RGR1.0 recomputation upgrades grg_00000008 to PASS on real OS-layer boundary evidence (strict-mode station record cer_mv7r651y) \u2014 the two remaining BLOCKED core gates (mac/win install proof, accessibility scope disposition) are outside this scope's boundaries and are recorded as owner-accepted residual risks with controls. To record this decision the release owner follows docs/evidence/release/AR2-023-authorization-workflow-2026-10-14.md: replace the placeholder signer block with the verified owner identity, set decision_date and status to RECORDED, and make the recording docs commit on main."
}
```

## How the release owner records this decision

1. Choose between this candidate and the alternative preparation
   (`decision-prep-hold-post-maint002-2026-10-14.md` for `NOT_GO_HOLD` (the `LIMITED_SCOPE_GO` candidate lives in `decision-prep-limited-scope-post-maint002-2026-10-14.md`)).
2. Replace the `signer` block placeholders with the verified owner identity
   (the org-owner GitHub account), update `decision_date`, and set
   `status: "RECORDED"`.
3. Optionally adjust `review_conditions` / `residual_risks` dispositions to the
   owner's actual acceptance decisions — every edit must keep
   `validateDecisionRecord` green (fail-closed machinery re-checks class/scope/
   verdict consistency, basis-manifest agreement and the machine decision).
4. Commit the final record to `main` as `docs/evidence/release/decision-record-<decision_id>-<date>.md`
   in a docs commit (or PR merging to main) whose committer identity is the
   verified owner identity, referencing the decision id and class.
5. Announce: comment on the WO3.0 issues (minimally #55) and reconcile
   `spec/PROJECT-STATE.md` and the dispatch ledger to the recorded decision in
   the same commit or the required TL reconciliation commit.
6. Re-run the instrument battery before committing:
   `tsc -b packages/arena-release-gate && oxlint packages/arena-release-gate && cd packages/arena-release-gate && tsx --test test/*.test.ts`.

## Station findings recorded during this preparation (Window #38, 2026-10-14)

The 2026-10-13 preparation recorded that the strict-mode battery could not
pass on the shared-host TL station (ambient uid count ~170-199 vs the
`DEFAULT_MAX_PROCESSES = 128` ceiling — bwrap clone EAGAIN, instrument fails
closed) and named two unblock paths: a dedicated low-occupancy station, or a
scoped fix in `@arena/isolation`. **The scoped fix path was taken**: MAINT-002
was registered against issue #64, dispatched to a worker, accepted
(PR #65 — TL station gate parity: isolation suite 29-pass/16-fail at base
`73118ac` → 60/60 at head `e9ef0e8d`), and the strict-mode instrument now
records zero failures on the SAME station class that previously failed. The
interim "dedicated station" guidance is superseded. Untrusted execution
remains disabled: enablement stays coupled to a recorded owner decision
through this instrument, and the production capsule provider approval
remains an owner action.

## Honest limitations of this preparation

- The preparation is a point-in-time artifact: the evidence manifest cites
  exact SHAs live-verified on 2026-10-14; any main movement after
  `a984ca643155eee5fde50fec4a0b986b73182de2` requires a fresh recompute before recording.
- The strict-mode boundary evidence is station evidence (shared-host gate
  station, bwrap 0.13.0, ambient count calibrated per run); it proves the
  OS-layer boundary behavior and instrument reproducibility, not production
  provider approval.
- This document is not, and must never be committed as, a `RECORDED` decision.
