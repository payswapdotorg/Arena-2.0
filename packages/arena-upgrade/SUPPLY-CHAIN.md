# Supply-Chain Record — @arena/upgrade (AR2-018)

## Runtime dependencies (declared in `packages/arena-upgrade/package.json`)

| Dependency | Version | License | Source | Rationale |
| --- | --- | --- | --- | --- |
| `@arena/contracts` | `workspace:*` | repository-internal (Apache-2.0 base) | this monorepo | frozen CF1.0 primitives: arena ids, digests, timestamps, tenant context, evidence-object schema |
| `@arena/acquisition` | `workspace:*` | repository-internal | this monorepo | ACQ1.0 canonical JSON/digest helpers; gap-report reference conventions |
| `@arena/scraper` | `workspace:*` | repository-internal | this monorepo | SCRP1.0 `DatasetArtifact` shapes, `checkDatasetArtifact`, `contentHashOf` |
| `@arena/learning` | `workspace:*` | repository-internal | this monorepo | AR2-014 `RightsGrantRegistry`, `RightsScope`, `Certification`, `verifyCertificationBinding` |
| `@arena/evidence` | `workspace:*` | repository-internal | this monorepo | AR2-007 `ValidatorRegistry` convention for pinning grader identity |
| `zod` | `4.6.5` (exact pin, matches the workspace family) | MIT | npm | schema validation at trust boundaries — already pinned in the repo lockfile for every arena contract package |

**New external runtime dependencies beyond the existing workspace set: none.**
`zod` and `node:` built-ins (`node:crypto`) already cover this plane (index/pack
building, hashing, manifests). No new transitive supply chain is introduced.

## Dev dependencies

- `typescript` (`^6.0.2`) — same devDependency range used by every sibling arena package.

## Verification

- `tsc -b packages/arena-upgrade` — project-reference typecheck within the workspace.
- `oxlint packages/arena-upgrade` — 0 errors expected.
- `tsx --test test/*.test.ts` — deterministic, no network, no paid APIs, no live model calls.

## Lockfile discipline

`pnpm-lock.yaml` is TL-owned. This work order NEVER commits lockfile changes; the
workspace manifest entry is the only dependency surface this package adds.
