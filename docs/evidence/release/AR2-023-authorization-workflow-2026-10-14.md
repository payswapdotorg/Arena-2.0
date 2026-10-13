# AR2-023 — Release-decision authorization workflow

**Date:** 2026-10-14
**Work order:** AR2-023 (issue [#55](https://github.com/payswapdotorg/Arena-2.0/issues/55))
**Instrument:** `@arena/release-gate` — `RELEASE_DECISION_SCHEMA_VERSION` `RDR1.0` + `GATE_RECOMPUTATION_SCHEMA_VERSION` `RGR1.0`
**Status of this document:** mechanism + workflow definition. **It authorizes no release.** The production release decision recorded by AR2-015 remains **NOT_GO** until an owner decision record is committed per this workflow.

---

## 1. Purpose

The AR2-015 gate report records the machine decision (`NOT_GO`, reason `blocked_core_gate`) and one open human item: *"Release owner authorization — not recorded."* This workflow converts that open item into a concrete, recorded, inspectable, revocable decision instrument:

- a **versioned decision-record schema** (`releaseDecisionRecordSchema`, RDR1.0) — machine-readable, fail-closed zod validation mirroring the gate-registry discipline;
- a **gate recomputation** (`recomputeGates`, RGR1.0) — deterministic re-evaluation of the typed G0–G8 registry from the AR2-015 machinery against a supplied evidence set, attached to the record as its machine basis;
- this **authorization workflow** — who may sign, how identity is verified, how a record is committed and announced, and how a decision is amended or revoked.

A decision record is valid **only** with an attached recomputation whose verdicts are consistent with the decision class:

| Decision class | Required machine basis |
| --- | --- |
| `PRODUCTION_GO` | all core gates green (`decideRelease` ⇒ `GO`); zero unresolved critical/high findings; scrapers in scope additionally require the G8 extension gate `PASS`; untrusted execution requires the approved OS-level isolation mode; live-money scope requires the recorded G4 commercial/legal risk and an `enablement_precondition` review condition |
| `LIMITED_SCOPE_GO` | the gate verdicts the AR2-015 report already records as satisfiable under the limited scope: Linux-only platform matrix, test-mode finance, untrusted execution disabled, synthetic-provider basis; only the three recorded scope-excusable gates (`grg_00000002` cross-platform install, `grg_00000008` OS-level capsule isolation, `grg_00000013` accessibility E2E) may be `BLOCKED`, each recorded as an owner-accepted residual risk; a `FAIL`ed core gate is never excusable; zero unresolved critical/high findings |
| `NOT_GO_HOLD` | every `FAIL`/`BLOCKED` core gate in the attached recomputation listed as an `OPEN` residual risk (the recorded hold basis) |

## 2. Who may sign

**The release owner role — and no one else.** The signer block (`decisionSignerSchema`) enforces `role: "release_owner"` as the only permitted role. In this repository's recorded convention (see `spec/work-orders/dispatch-ledger.md`), the organization is a **single-identity org**: the org-owner GitHub identity is the admin identity of record; branch protection on `main` enforces the required `battery` check and blocks force-pushes, with admin bypass allowed only for recorded TL integration commits. The release owner is that recorded org-owner identity (or a role holder the owner has recorded in the ledger in a future TL commit — until then, the single identity is the only signer).

Workers, reviewers and the TL integration role **cannot** sign: the schema accepts exactly one signer, one role value, and one verification method.

## 3. How identity is verified (mechanism, not cryptography)

There is **no cryptographic signature** in v1 of this instrument — this is a recorded limitation, not a hidden one. The mechanism is `github_identity_docs_commit`:

1. The signer block records `github_identity` — the GitHub account that will make the recording commit.
2. The decision record is committed to `main` as a docs commit under `docs/evidence/release/` (see §4). The commit's author/committer identity **is** the signature evidence: in the single-identity org, the account that can merge to protected `main` (satisfying the required `battery` check) is the recorded owner identity.
3. Anyone can verify a recorded decision later by: (a) `git log` on the decision file to find the recording commit, (b) confirming the committer identity matches the record's `github_identity` and the ledger's recorded org-owner identity, and (c) re-running the validation battery (below) on the record at that commit.

If the org later adds real signers or cryptographic signing (e.g. signed commits as a hard requirement, or a KMS-backed signature field), that is a schema-versioned change (`RDR2.0`+), registered as a new work order — never a silent extension of this mechanism.

## 4. How a decision is recorded (commit procedure)

The release owner (or a worker preparing a record **for** the owner's signature — the owner must still make or explicitly authorize the recording commit) proceeds as follows:

1. **Assemble the evidence set.** Build an `evidenceSet` (`evidenceSetSchema`): a manifest of typed entries (issue / pull request / evidence-doc path / commit — each with an **exact 40- or 64-hex SHA**, never a short SHA) plus one submission per G0–G8 gate carrying the classification, evidence class, command, environment, result, limitations, reviewer and the manifest entries it rests on. Every submission must reference at least one manifest entry; a gate with no submission recomputes `BLOCKED` (missing evidence is never an assumed `PASS`).
2. **Recompute the gates.** Run `recomputeGates({ registry_rows, evidence_set })` from `@arena/release-gate` against the canonical AR2-015 registry rows (`buildCanonicalGateRows`) — or the registry rows of record at the current main tip. The function is deterministic and pure (no network, no clock, no randomness): the same evidence set always yields the same typed result. Attach the `VALID` result to the record as `gate_recomputation`.
3. **Author the record.** Fill the RDR1.0 fields: decision id (`rdr_` family), class (`PRODUCTION_GO` / `LIMITED_SCOPE_GO` / `NOT_GO_HOLD` — nothing else validates), scope boundaries (platform matrix, finance mode, untrusted-execution mode, identity mode, isolation mode — each from the typed allow-list), evidence manifest, residual risks with per-risk dispositions, signer block, review/expiry conditions (mandatory and non-empty for both GO classes, with at least one dated expiry/re-review condition), amendment reference (if it supersedes a prior decision), and the human statement.
4. **Validate before committing.** `validateDecisionRecord(record)` must return `VALID` — this re-derives the machine decision over the attached rows, cross-checks the per-gate summaries, the basis references against the manifest, the class/scope/verdict consistency and the review conditions. For an amendment, `validateDecisionChain([...prior records, new record])` must return `VALID` (no cycles, no forks, no orphans, no date regressions). The package test suite (`tsx --test test/*.test.ts` in `packages/arena-release-gate`) must be green on the commit's tree.
5. **Commit to main.** Set `status: "RECORDED"` and commit the record as a markdown file `docs/evidence/release/decision-record-<decision_id>-<date>.md` (the JSON record in a fenced ```json block, plus human context), in a docs commit (or PR merging to main) whose committer identity is the verified owner identity. The commit message references the decision id and class. The evidence SHAs referenced in the manifest must be the exact SHAs the recomputation ran against — the record is the durable link between the decision and its machine basis.
6. **Announce.** In the same commit (or the required TL reconciliation commit): post the decision summary as a comment on the relevant WO3.0 issue(s) (#51–#55; minimally #55), and reconcile `spec/PROJECT-STATE.md` and the work-order ledger to the recorded decision. A decision that is committed but not announced is still a decision (the commit is the record), but the announcement is part of the workflow's honesty contract.

A template demonstrating steps 1–4 for the limited-scope case — unsigned and watermarked `TEMPLATE_UNSIGNED` — is [`decision-record-template-limited-scope.md`](./decision-record-template-limited-scope.md). The template **is not a decision** and must never be committed with `status: "RECORDED"` as-is; its signer block carries placeholders.

## 5. Revocation and amendment (the amendment chain)

Decisions are changed only by supersession, never by editing history:

- **Amendment:** a new record with `supersedes: { decision_id, reason }` pointing at the record it replaces. The chain rules (`validateDecisionChain`) fail closed on cycles, self-reference, forked chains (two records superseding the same decision), orphan references, duplicate ids and amendments dated before the decision they supersede.
- **Revocation:** a `NOT_GO_HOLD` record superseding a `PRODUCTION_GO`/`LIMITED_SCOPE_GO` record is the revocation form — the release authorization is withdrawn and the hold basis (open blockers) is recorded as `OPEN` residual risks.
- The superseded record stays in the repository, byte-for-byte; the operative decision is always the chain tip. Expired records (past their `expires_on` condition without re-recording) are treated as lapsed: any release activity under a lapsed authorization must stop until re-recorded.

## 6. What stays disabled — no silent enablement

- **Live-money payments stay DISABLED by default.** Test-mode finance is the only accepted mode. Enabling live money requires (i) a recorded owner decision (this instrument) whose scope sets `finance_mode: "live_mode"` — which the schema only accepts for `PRODUCTION_GO`, with an `enablement_precondition` review condition and the G4 commercial/legal residual risk recorded — **and then** (ii) a **separately registered work order** that performs the actual enablement in code. There is no path — in code or in docs — by which live money turns on without both steps. No PR may flip a live-money flag by itself; no docs commit may claim live-money readiness without a recorded decision referencing it.
- **Untrusted expert/scraper execution stays DISABLED** until AR2-019-passing isolation evidence exists **and** a recorded owner decision enables it. The schema enforces the coupling: any untrusted-execution mode other than `disabled` requires the approved OS-level isolation mode and (for scrapers) a `PASS`ing G8 extension gate in the attached recomputation.
- **A limited-scope release** (Linux, test-mode finance, no untrusted execution) may be authorized at any time by the release owner using the AR2-015 gate report as the recorded basis — the template in this directory is the standing instrument for that signature.

## 7. Verification battery for this instrument

Run from the repository root:

```bash
node_modules/.bin/tsc -b packages/arena-release-gate
node_modules/.bin/oxlint packages/arena-release-gate
cd packages/arena-release-gate && ../../node_modules/.bin/tsx --test test/*.test.ts; cd ../..
```

The suite includes: positive/negative schema vectors (valid records validate; tampered variants — wrong class, missing evidence SHA, empty review conditions, unknown gate verdict — fail closed); recomputation determinism (same evidence in, same output out, twice); recomputation-vs-class consistency for all three classes; amendment-chain validation and cycle rejection; the template example parsing as a valid unsigned record; and the AR2-015 gate-report evidence set recomputing to its recorded verdicts (non-regression of the recorded NOT_GO basis).

## 8. Honest limitations

- The signer identity mechanism is workflow-documented (`github_identity_docs_commit`), **not cryptographic** — it rests on branch protection, the single-identity org convention and the recorded ledger, as disclosed in §3.
- This instrument records decisions; it does not make them. The actual production GO decision remains pending the owner and the WO3.0 evidence (AR2-019 evidence accepted; AR2-020 macOS/Windows runner proof, AR2-021 accessibility evidence and AR2-022 production identity adapter recorded on main at the time of this document).
- The scope-excusable gate set for `LIMITED_SCOPE_GO` is pinned to the AR2-015 canonical registry ids (`grg_00000002`/`grg_00000008`/`grg_00000013`); if the gate registry is ever renumbered, a schema-versioned update of this instrument is required — never a silent edit.
