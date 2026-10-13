# Release decision record — LIMITED SCOPE (TEMPLATE)

> ⚠️ **TEMPLATE — NOT A DECISION.** This file is an **unsigned, watermarked example**
> produced by AR2-023 (issue [#55](https://github.com/payswapdotorg/Arena-2.0/issues/55)).
> It demonstrates the limited-scope release basis **already recorded** in the AR2-015
> gate report (Linux, test-mode finance, no untrusted execution). It authorizes
> **nothing**: no production release, no limited-scope release, no capability
> enablement. Only a record committed per
> [the AR2-023 authorization workflow](./AR2-023-authorization-workflow-2026-10-14.md)
> by the verified release owner, with `status: "RECORDED"`, is a decision. The
> signer block below carries placeholders and must never be committed as-is.

## What this example demonstrates

1. **The RDR1.0 decision-record schema** — every mandatory field filled: decision id
   (`rdr_` family), decision class (`LIMITED_SCOPE_GO`), decision date, scope
   boundaries (each from the typed allow-list), evidence manifest (typed links with
   exact SHAs), residual risks with per-risk dispositions, signer block
   (placeholder — mechanism only), review/expiry conditions, amendment reference
   (`null` here — a first record), and the human statement.
2. **The attached gate recomputation (RGR1.0)** — the deterministic machine output of
   `recomputeGates` over the AR2-015 canonical G0–G8 registry rows and the recorded
   AR2-015 evidence set. It reproduces the recorded verdicts exactly: 15 rows across
   9 sections, machine decision `NOT_GO` / `blocked_core_gate`, the three recorded
   blockers, zero unresolved critical/high findings.
3. **Scope consistency** — `LIMITED_SCOPE_GO` over a `NOT_GO` machine basis is valid
   only because each `BLOCKED` core gate is outside this scope's boundaries
   (`grg_00000002` cross-platform install — Linux-only scope; `grg_00000008` OS-level
   capsule isolation — untrusted execution disabled; `grg_00000013` accessibility E2E
   — owner-accepted limitation) **and** each is recorded as an owner-accepted residual
   risk with controls. The demo-auth identity seam is likewise recorded as a risk.
4. **No silent enablement** — the review conditions carry the live-money
   `enablement_precondition` (payments stay disabled; enablement requires a separately
   registered work order created only after a recorded owner decision) and a dated
   expiry.

## How this example was produced

Deterministically, from the package machinery (no hand-editing of the machine basis):

```ts
import { buildCanonicalGateRows, recomputeGates, validateDecisionRecord } from "@arena/release-gate";

const rows = buildCanonicalGateRows({
  head_sha: "df621a6a176f186be49a110cbe9c09a44b8b078a",   // AR2-015 evidence SHA (recorded in the report)
  base_sha: "d89182619a995710361883015e53e741eb9eedfa",   // AR2-015 dispatch base (recorded in the report)
  environment: "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)",
});
// evidence set: manifest = the AR2-015 gate report doc @ its recorded evidence SHA,
// plus the AR2-015 acceptance PR #47, the AR2-023 registration issue #55 and the
// WO3.0 release plan; submissions = one per canonical row carrying the recorded
// classification/evidence; then:
const recomputation = recomputeGates({ registry_rows: rows, evidence_set });
// record.gate_recomputation = recomputation.result  (VALID)
// validateDecisionRecord(record)  ⇒  { kind: "VALID" }
```

`test/decision-template.test.ts` proves this document stays honest: it extracts the
JSON block below, validates it as a `TEMPLATE_UNSIGNED` record, and asserts the
attached recomputation is identical to a fresh `recomputeGates` run over the AR2-015
canonical rows and evidence set.

## The record (unsigned)

```json
{
  "schema_version": "RDR1.0",
  "status": "TEMPLATE_UNSIGNED",
  "decision_id": "rdr_00000000",
  "decision_class": "LIMITED_SCOPE_GO",
  "decision_date": "2026-10-14T00:00:00Z",
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
      "description": "AR2-015 classified release-gate report — the recorded NOT_GO basis and limited-scope template case"
    },
    {
      "entry_id": "evd_00000002",
      "kind": "pull_request",
      "link": "https://github.com/payswapdotorg/Arena-2.0/pull/47",
      "sha": "7d117f1d1b2bc4adbd7e38b6048737f19167da55",
      "description": "AR2-015 acceptance merge (squash) — the tree the adversarial profiles and gate report were accepted on"
    },
    {
      "entry_id": "evd_00000003",
      "kind": "issue",
      "link": "https://github.com/payswapdotorg/Arena-2.0/issues/55",
      "sha": "c9b86d199d9fe95180de0e817b9af4c0b2d0055b",
      "description": "AR2-023 registration (WO3.0 release-plan registration commit)"
    },
    {
      "entry_id": "evd_00000004",
      "kind": "evidence_doc",
      "link": "spec/work-orders/release-plan.md",
      "sha": "c9b86d199d9fe95180de0e817b9af4c0b2d0055b",
      "description": "WO3.0 production-readiness release plan — sequencing and disabled-capability boundaries"
    }
  ],
  "gate_recomputation": {
    "schema_version": "RGR1.0",
    "evidence_set_id": "evs_ar2015gate",
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
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a",
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
            "entry_id": "evd_00000001",
            "kind": "evidence_doc",
            "link": "docs/evidence/release/AR2-015-gate-report-2026-10-11.md",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a"
          }
        ],
        "gaps": [
          "blocks cross-platform release claims, not the Linux-scoped core posture; scheduled before any such claim",
          "fnr_00000001 (medium, unresolved): macOS/Windows fresh-install proof not yet executed",
          "classified BLOCKED: Linux-only install evidence at AR2-000 baseline; cross-platform proofs outstanding"
        ],
        "findings": [
          {
            "finding_id": "fnr_00000001",
            "severity": "medium",
            "description": "macOS/Windows fresh-install proof not yet executed",
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
            "command": "(not executed — no macOS/Windows runner in the current battery)",
            "environment": "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a",
            "result": "Linux-only install evidence at AR2-000 baseline; cross-platform proofs outstanding",
            "limitations": "blocks cross-platform release claims, not the Linux-scoped core posture; scheduled before any such claim",
            "reviewer": "arena-tl"
          },
          "waiver_authorization": null,
          "findings": [
            {
              "finding_id": "fnr_00000001",
              "severity": "medium",
              "description": "macOS/Windows fresh-install proof not yet executed",
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
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a",
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
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a",
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
            "entry_id": "evd_00000001",
            "kind": "evidence_doc",
            "link": "docs/evidence/release/AR2-015-gate-report-2026-10-11.md",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a"
          }
        ],
        "gaps": [
          "DEMO auth adapter surface (deterministic token registry); production identity adapter is a declared future seam"
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
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a",
            "result": "full guessing sweep on escalation/timeline/result/payment-status/command routes returns identical typed 404s for cross-tenant and non-existent IDs (no existence oracle); cross-tenant list is empty; request-body tenant fields schema-rejected",
            "limitations": "DEMO auth adapter surface (deterministic token registry); production identity adapter is a declared future seam",
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
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a",
            "result": "valid delivery APPLIED once; tampered body/wrong secret/old-header-new-body ⇒ BAD_SIGNATURE 401; stale ⇒ STALE_TIMESTAMP 401; wrong scheme/malformed ⇒ 400; verbatim replay and attempt-bumped retry ⇒ DUPLICATE with effect still applied once (delivery-id dedup)",
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
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a",
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
        "verdict": "BLOCKED",
        "basis": [
          {
            "entry_id": "evd_00000001",
            "kind": "evidence_doc",
            "link": "docs/evidence/release/AR2-015-gate-report-2026-10-11.md",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a"
          }
        ],
        "gaps": [
          "untrusted expert/scraper execution stays DISABLED; production release NOT_GO until a real isolation provider is approved and evidenced (M4)",
          "classified BLOCKED: tenant-refusal matrix PASS on the real port surface (cross-tenant/unknown ⇒ indistinguishable ARENA_CAPSULE_UNAVAILABLE; escalation/attempt mismatch ⇒ ARENA_TENANT_MISMATCH; all four port ops refuse; teardown verified) — BUT the synthetic provider is explicitly NOT OS-level isolation evidence; production capsule provider remains NOT APPROVED / NOT VERIFIED"
        ],
        "findings": [],
        "recomputed_row": {
          "gate_id": "grg_00000008",
          "section": "G2-security-tenant-boundaries",
          "scope": "core",
          "requirement": "Capsule filesystem/process/network/credential boundaries tested at the ACTUAL OS/runtime isolation layer; capsule tenant mismatch fails closed and is indistinguishable from not-found",
          "classification": "BLOCKED",
          "evidence": {
            "evidence_class": "automated_unit_suite",
            "command": "tsx --test test/capsule-tenant-refusal.test.ts (packages/arena-release-gate; REAL CapsuleProviderPort via SyntheticLocalProvider)",
            "environment": "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a",
            "result": "tenant-refusal matrix PASS on the real port surface (cross-tenant/unknown ⇒ indistinguishable ARENA_CAPSULE_UNAVAILABLE; escalation/attempt mismatch ⇒ ARENA_TENANT_MISMATCH; all four port ops refuse; teardown verified) — BUT the synthetic provider is explicitly NOT OS-level isolation evidence; production capsule provider remains NOT APPROVED / NOT VERIFIED",
            "limitations": "untrusted expert/scraper execution stays DISABLED; production release NOT_GO until a real isolation provider is approved and evidenced (M4)",
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
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a",
            "result": "durable sqlite/WAL suites green; two REAL API processes on one durable file with cross-instance canonical state; process-group SIGKILL mid-flight ⇒ restart with zero state loss and exactly-once outbox delivery",
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
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a",
            "result": "P0 baseline-fail⇒intervention-pass with exactly ONE test payout; failed first attempt never pays; P2 INCONCLUSIVE payout gate NOT_READY (disclosed, never bypassed); duplicate release/ledger replay proven single-operation; live payment mode DISABLED",
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
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a",
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
          }
        ],
        "gaps": [
          "integration claims within tested scope only — see report header"
        ],
        "findings": [],
        "recomputed_row": {
          "gate_id": "grg_00000012",
          "section": "G6-product-end-to-end",
          "scope": "core",
          "requirement": "Real external client → real API → expert attempt → validator → result; demo mode visibly labelled; second-expert path with attribution",
          "classification": "PASS",
          "evidence": {
            "evidence_class": "automated_unit_suite",
            "command": "tsx --test test/vertical-p0.test.ts test/next-expert.test.ts test/p2-review.test.ts test/two-instance-recovery.test.ts (arena-harness) + test/e2e-real-api.test.ts (arena-workbench)",
            "environment": "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a",
            "result": "four REAL-process acceptance profiles green (exactly-one payout; signed webhooks apply-once; stable-ID trace; failed-attempt routing with attribution; P2 independent review; SIGKILL recovery); workbench binds the real API with labelled demo preset",
            "limitations": "integration claims within tested scope only — see report header",
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
            "entry_id": "evd_00000001",
            "kind": "evidence_doc",
            "link": "docs/evidence/release/AR2-015-gate-report-2026-10-11.md",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a"
          }
        ],
        "gaps": [
          "recorded as a release limitation; accessibility hardening remains open work before customer-facing claims",
          "fnr_00000002 (medium, unresolved): accessibility E2E coverage (keyboard/screen-reader across all flows) not yet evidenced",
          "classified BLOCKED: workbench render/review suites green for the cockpit and reviewer decks; full keyboard/screen-reader E2E across all five flows is not yet evidenced"
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
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a",
            "result": "workbench render/review suites green for the cockpit and reviewer decks; full keyboard/screen-reader E2E across all five flows is not yet evidenced",
            "limitations": "recorded as a release limitation; accessibility hardening remains open work before customer-facing claims",
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
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a",
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
            "entry_id": "evd_00000001",
            "kind": "evidence_doc",
            "link": "docs/evidence/release/AR2-015-gate-report-2026-10-11.md",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a"
          }
        ],
        "gaps": [
          "extension planned post-core; TL re-checks worker capacity/dependencies/SHAs before any dispatch",
          "classified BLOCKED: ACR-0002 merged (PR #35 e3091fe) with canonical spec; zero extension runtime exists; this row is the separate extension gate and does not block the core release decision; it becomes a hard gate for the extension release and for any first-production scope that includes scrapers"
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
            "command": "(not implemented — AR2-016/017/018 remain planned and not dispatched)",
            "environment": "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)",
            "sha": "df621a6a176f186be49a110cbe9c09a44b8b078a",
            "result": "ACR-0002 merged (PR #35 e3091fe) with canonical spec; zero extension runtime exists; this row is the separate extension gate and does not block the core release decision; it becomes a hard gate for the extension release and for any first-production scope that includes scrapers",
            "limitations": "extension planned post-core; TL re-checks worker capacity/dependencies/SHAs before any dispatch",
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
      "detail": "grg_00000002 (G0-fork-baseline): macOS/Windows install proof (required before any cross-platform release claim) | grg_00000008 (G2-security-tenant-boundaries): Capsule filesystem/process/network/credential boundaries tested at the ACTUAL OS/runtime isolation layer; capsule tenant mismatch fails closed and is indistinguishable from not-found | grg_00000013 (G6-product-end-to-end): Responsive, keyboard-accessible E2E coverage across requester/expert/reviewer/developer/operations flows"
    }
  },
  "residual_risks": [
    {
      "risk_id": "rsk_00000001",
      "description": "Cross-platform install proof outstanding (macOS/Windows) — limited scope is Linux-only",
      "severity": "medium",
      "linked_gates": [
        "grg_00000002"
      ],
      "disposition": "ACCEPTED_WITH_CONTROLS",
      "mitigation": "Scope bounded to linux; no cross-platform distribution or claim is made; AR2-020 harness evidence is tracked before any platform expansion."
    },
    {
      "risk_id": "rsk_00000002",
      "description": "OS-level capsule isolation unproven — untrusted expert/scraper execution stays disabled",
      "severity": "high",
      "linked_gates": [
        "grg_00000008"
      ],
      "disposition": "ACCEPTED_WITH_CONTROLS",
      "mitigation": "Untrusted execution DISABLED in this scope; only trusted in-process execution paths run; enablement requires AR2-019-passing evidence plus a new recorded owner decision."
    },
    {
      "risk_id": "rsk_00000003",
      "description": "Accessibility E2E coverage incomplete (keyboard/screen-reader across all five flows)",
      "severity": "medium",
      "linked_gates": [
        "grg_00000013"
      ],
      "disposition": "ACCEPTED_WITH_CONTROLS",
      "mitigation": "No customer-facing accessibility claim; operator/lab use with the limitation recorded; AR2-021 evidence is tracked before any customer-facing expansion."
    },
    {
      "risk_id": "rsk_00000004",
      "description": "Demo-auth identity adapter in use — production identity seam recorded (AR2-022 in flight)",
      "severity": "medium",
      "linked_gates": [
        "grg_00000005"
      ],
      "disposition": "ACCEPTED_WITH_CONTROLS",
      "mitigation": "Deployment bounded to recorded demo tenants; no external tenant onboarding; the production identity adapter is required before multi-tenant exposure."
    }
  ],
  "signer": {
    "name": "TEMPLATE PLACEHOLDER — release owner (this example is not signed)",
    "role": "release_owner",
    "method": "github_identity_docs_commit",
    "github_identity": "TEMPLATE-PLACEHOLDER"
  },
  "review_conditions": [
    {
      "kind": "expires_on",
      "description": "This limited-scope authorization expires on this date unless re-recorded or amended",
      "date": "2027-01-31"
    },
    {
      "kind": "re_review_on_event",
      "description": "Re-review when any new G0–G8 gate evidence lands on main (AR2-019/020/021/022 outcomes)",
      "date": null
    },
    {
      "kind": "enablement_precondition",
      "description": "Live-money payments stay DISABLED; enabling requires a separately registered work order created only after a recorded owner decision",
      "date": null
    }
  ],
  "supersedes": null,
  "statement": "TEMPLATE EXAMPLE (NOT A DECISION): a filled LIMITED_SCOPE_GO record demonstrating the limited-scope release basis already recorded in the AR2-015 gate report — Linux only, test-mode finance, no untrusted execution. The attached gate recomputation is the machine output over the AR2-015 recorded evidence set and reproduces the recorded NOT_GO machine decision; each BLOCKED core gate is outside this scope's boundaries and is recorded as an owner-accepted residual risk with controls. To turn this into a decision, the release owner follows docs/evidence/release/AR2-023-authorization-workflow-2026-10-14.md: replace the placeholder signer block with the verified owner identity, re-attach a freshly recomputed gate basis, set status to RECORDED, and commit it to main per the workflow."
}
```

## Validation status of this template

- `validateDecisionRecord` accepts the JSON block above as a valid **`TEMPLATE_UNSIGNED`** record (proven in `test/decision-template.test.ts`); it would be **invalid** as a `RECORDED` decision until the signer placeholders are replaced by the verified owner identity and the record is committed per the workflow.
- The attached recomputation is byte-identical to `recomputeGates` over the AR2-015 canonical rows and recorded evidence set — i.e. this template is the standing instrument for a limited-scope signature **on that recorded basis**. A real signature may attach a fresher recomputation (for example over post-AR2-019/020/021/022 evidence) as long as it is produced by the same machinery and satisfies the same class consistency.

## Not a signature

The `signer` block contains placeholders (`TEMPLATE PLACEHOLDER — release owner`, `TEMPLATE-PLACEHOLDER`). The decision id `rdr_00000000` is reserved for this template. Turning this into a decision requires the full procedure in the [authorization workflow](./AR2-023-authorization-workflow-2026-10-14.md) — including a fresh evidence set, a verified owner identity in the signer block, `status: "RECORDED"`, and a docs commit on `main` referencing the evidence SHAs.
