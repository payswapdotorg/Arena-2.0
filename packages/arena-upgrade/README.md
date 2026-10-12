# @arena/upgrade — AR2-018: Evidence-to-Capability Packaging, Evaluation and Controlled Learning

Issue #34 · spec `spec/capability-acquisition/scraper-factory-and-capability-routing.md` §7/§8/§10 (items 6–7) · ACR-0002.

## THE LAW (spec §7)

Data quality and capability are **separate** acceptance decisions. A dataset passing
schema validation is NOT a capability upgrade. Only a measured before/after delta on a
pinned evaluation suite can claim success — and the claim is scoped to exactly what was
measured. Ingestion alone is never completion.

## What this package provides (UPG1.0 contract family)

- **DatasetIntakeRecord** — stage-1/2 intake validation of a SCRP1.0 `DatasetArtifact`:
  provenance completeness, explicit `RightsGrant` linkage (AR2-014 registry), source-policy
  compliance, tenant scope, privacy/retention class, integrity re-verification (per-item
  and object hashes), schema validation and content-quality metrics. Every rejection class
  carries an exact fail-closed `UPG_*` reason code.
- **DatasetTransformationManifest** — immutable, source-attributed record of every
  transformation (normalize/filter/redact/deduplicate/reshape); replaying it against the
  pinned source digest must reproduce every recorded output digest.
- **CapabilityUpgradeProposal** — the central record: manifest reference, target gap
  (ACQ1.0 `CapabilityGapReport`), target capability (`BodyVersion`), delivery strategy with
  selection reason codes, policy snapshot, suite reference, publication scope and an
  append-only state machine `SUBMITTED → EVALUATED → (PUBLISHED | INCONCLUSIVE | FAILED | REJECTED)`.
- **CapabilityPack** — the versioned immutable artifact with deterministic build provenance
  (same inputs → same content digest), compatibility scope (Body version range) and
  retention/expiry class. Fine-tuning payloads are structurally absent.
- **Delivery strategies** (spec §7 preferred order, first-applicable with reason codes):
  `ScopedRetrievalIndexStrategy`, `StructuredKnowledgePackStrategy`, `ToolAdapterStrategy`,
  `RulesExamplesStrategy`, and the `AuthorizedFineTuningStrategy` **stub** — full
  authorization chain required, then records-not-trains.
- **Evaluation plane** — `CapabilityEvaluationSuite` (target tasks, regression cases,
  leakage probes, guardrail cases, pinned environment, per-suite thresholds),
  `TargetAgentHarness` (deterministic mock; no live model calls), pure graders
  (exact-match, set-overlap P/R/F1, refusal-correctness), `EvaluationRun` +
  `BeforeAfterDelta` and the evidence chain.
- **Publication plane** — `CapabilityPublicationFlow`: threshold gate, rights
  re-verification **at publication time** (fail closed), certification binding
  (`verifyCertificationBinding`, AR2-014), scope clamp, immutable published versions,
  rollback that appends events without rewriting history, and the structural
  `popularityBypassGuard`.

## Family discipline

UPG1.0 is a separate versioned contract family. Frozen CF1.0/ACQ1.0/SCRP1.0 schemas are
never edited or re-exported-modified here; the families link only through immutable
correlation/causation IDs and public exports (`DatasetArtifact`, `RightsGrantRegistry`,
`Certification`, canonical digests, the CF1.0 evidence-object shape for recordability).

## Evidence recordability

Every chain record renders into the frozen CF1.0 `evidenceObjectSchema` shape
(`content_digest`, `size_bytes`, `media_type`, `storage_ref`) — the exact convention
`@arena/evidence`'s `EvidenceStore` accepts for its `object` field. Full envelope
binding (escalation/attempt) is an integration-station concern; this plane keeps its own
append-only, digest-anchored chain so an auditor can walk
source capture → transformation → pack build → evaluation → decision.

## Testing

`node:test` via tsx from the repo root or the package directory; no network, no paid
APIs, no live model calls. See `test/` for the ten acceptance groups mirroring the
work-order battery.

## Known scope limits (disclosed)

- The target-agent harness is a deterministic mock; no live-model evaluation claim is
  made or implied by any record this package emits.
- The fine-tuning strategy is a gate-proving stub: it records authorized requests and
  never trains.
- The store is an in-memory reference implementation; durable wiring belongs to the
  TL-owned integration station (mirrors how arena-scraper staged `RunStore`).
