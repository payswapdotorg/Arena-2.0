# AR2-022 — Production identity adapter evidence report

**Date:** 2026-10-13
**Repository:** payswapdotorg/Arena-2.0
**Work order:** AR2-022 (issue #54) — Production identity adapter (tenant isolation beyond demo auth)
**Base SHA (dispatch record):** `0004d1067d615d4fee73272536936e76353945a9` (proven-green post-AR2-019 tip, per dispatch-ledger entry 2026-10-12 23:47Z)
**Branch:** `work/AR2-022-identity-adapter` (head SHA recorded in the delivery report; this report is committed on that branch)
**Write fence honored:** `packages/arena-identity/**` + arena-api auth wiring + `docs/evidence/identity/**` only. Shared contracts (arena-contracts), root manifests (package.json typecheck list), CI workflow and pnpm-lock.yaml are TL-owned and untouched in this delivery (integration steps listed below).
**Environment:** worker sandbox (Linux x64, Node v24.21.0, pnpm 10.33.2, tsx via workspace devDependencies, network egress to GitHub + npm registry available)

> Every claim below records its exact command, result and scope. A passing unit test proves only the tested unit; the adversarial battery proves the surfaces it actually drives. Nothing here claims a production IdP integration or a release decision (owner scope, AR2-023).

## Scope delivered

1. **IDN1.0 — a new, independently versioned identity-adapter contract family** (`packages/arena-identity`, public entry `src/contract.ts`): claim schemas (strict `arena_tenant_context`; tolerant-but-never-mapped top-level OIDC claims), `IdentityAdapter` port (`verify → AuthnResult`), closed typed failure catalog (`IDN_*`), edge-mapping rule (uniform 401, no oracle), tenant-derivation rule. The frozen CF1.0 corpus is consumed read-only; every mapped `TenantContext` is re-validated against the frozen `tenantContextSchema` (zero-drift guard). **No frozen-contract changes, no ACR required** (new family, not an extension of frozen envelopes).
2. **Production-representative reference implementation** — `OidcIdentityAdapter`: RS256 + JWKS (fetch, TTL cache, kid-driven rotation refresh, single-flight, fail-closed), exact-match issuer/audience validation, clock-skew bounds (default 60s, env-tunable), alg allowlist (default RS256 only; HS256 explicit-only), bounded `jti_once` replay guard (opt-in, disclosed), env-only config with fail-fast errors and a redacted disclosure projection. Zero external runtime deps beyond workspace-pinned `zod`; crypto via `node:crypto`.
3. **Demo adapter marked DEMO-ONLY in code and docs** (`DEMO_IDENTITY_DISCLOSURE`, `mode: "demo"`, `isDemoAdapter()`, README section) — byte-parity with the AR2-002 registry surface.
4. **arena-api auth wiring** — `AuthGateway` seam (`src/auth.ts`), `createArenaServer({ auth })` option, async derivation through the IDN1.0 port, uniform 401 preservation (byte-identical to the AR2-002 envelope), `/readyz` auth dependency projection (mode + readiness + detail), `/v1/contract` identity-seam disclosures, `main.ts` env-driven composition (`ARENA_AUTH_MODE=oidc`, startup probe degraded-not-fatal, verification stays fail-closed), `module.ts` manifest updated, project reference added. Default composition remains the demo registry — all pre-existing behavior preserved.

## Adversarial auth battery (all through the reference adapter path)

`packages/arena-identity/test/` (49 tests, 0 fail) + `packages/arena-api/test/oidc-auth.test.ts` (5 tests, 0 fail):

| Vector class | Representative vectors | Result |
| --- | --- | --- |
| Forged tokens | attacker-key signature under a real `kid`; tampered signature on a genuine token; claim-payload mutation (tenant swap) | IDN_SIGNATURE_INVALID, rejected |
| alg attacks | `alg=none`; HS256 token signed with the RSA public key material (alg confusion); RS256 token under HS256-only allowlist | IDN_ALG_REJECTED, structural |
| Validity window | exp far past (rejected) vs within skew (accepted); nbf future beyond skew (rejected) vs within (accepted) | IDN_TOKEN_EXPIRED / IDN_TOKEN_NOT_YET_VALID |
| Audience / issuer | wrong scalar + wrong array aud; issuer suffix look-alike | IDN_AUDIENCE_MISMATCH / IDN_ISSUER_MISMATCH |
| Tenant confusion | forged top-level `tenant` claim (stripped, never mapped); smuggled unknown field inside `arena_tenant_context` (strict-rejected); malformed arena ids; valid token whose verified claims name another tenant (maps truthfully — IdP-authorized switch, not caller-controlled) | mapping only from signature-verified claims |
| JWKS lifecycle | unknown kid → exactly one refresh; rotation retires old key (old-kid token fails closed); endpoint outage keeps cached TTL keys for known kids but fails closed for new kids; malformed bodies (non-JSON, no keys, duplicate kid, non-signing keys, non-200) | IDN_KEY_UNAVAILABLE, never downgrade-to-allow |
| Replay | verbatim replay under `jti_once` rejected; distinct jti accepted; default `none` disclosed | IDN_REPLAY_DETECTED |
| Header hygiene | missing header, non-Bearer scheme, lowercase `bearer`, garbage token, multi/zero-segment JWS, bad base64url/JSON | typed IDN_AUTH_* / IDN_TOKEN_MALFORMED |
| Contract vectors | positive/negative schema shapes (unknown fields, derived_from smuggle, oversized scopes, malformed ids); failure catalog closed-enum completeness | 12/12 codes catalogued |

## Cross-tenant denial through the REAL adapter path (the grg_00000005 seam closure)

`packages/arena-api/test/oidc-auth.test.ts` — a REAL `createArenaServer` HTTP listener wired with the OIDC reference adapter (RS256 + local fake IdP JWKS, real RSA-2048 tokens), real in-memory runtime, real frozen-schema command path:

1. Tenant-alpha token creates an escalation (201 via the full CF1.0 pipeline).
2. Tenant-beta token (valid, verified, different verified tenant claim) reads it → **404 `ARENA_ESCALATION_NOT_FOUND`**.
3. Same-owner probe of a non-existent ID → **byte-identical 404 body** (no existence oracle).
4. Cross-tenant list view is empty; timeline access cross-tenant → 404.
5. Request-body `tenant` override attempt through the OIDC path → 400 `ARENA_UNKNOWN_FIELD` (frozen schema still rejects; derivation never trusts the body).
6. Ten adversarial 401 vectors (forged/expired/nbf/aud/iss/alg-none/garbage/no-header/…) → uniform 401 envelope, bodies byte-identical after id normalization (no signature/failure oracle).
7. `/readyz` reports `auth.mode: oidc_jwks_v1`, ready true after startup probe; `/v1/contract` discloses the identity seam and the active adapter.

The release-gate `cross-tenant.test.ts` (demo-auth surface, real spawned API process) is unchanged and green — both adapter paths now carry the isolation proof.

## Commands and results (worker sandbox, branch work/AR2-022-identity-adapter)

| Check | Exact command | Result |
| --- | --- | --- |
| Frozen-lockfile install | `pnpm install --frozen-lockfile` | Done (48s; 52 projects, native rebuilds ok) — pre-change |
| Local link for the new package | `pnpm install --no-frozen-lockfile` (workspace link only; lockfile change NOT delivered — TL-owned) | Done |
| Typecheck | `tsc -b packages/arena-identity` and repo `pnpm typecheck` (arena-identity builds via the arena-api reference chain) | 0 errors |
| Lint | `pnpm lint` | 0 errors, **70 warnings = exact pre-change baseline** (4 new warnings introduced mid-work were fixed to zero) |
| Format | `oxfmt --check` on all in-fence files | zero drift in-fence (repo has pre-existing drift outside the fence; untouched) |
| Architecture guard | `pnpm architecture:check` | violations: 0, baseline: 0, new: 0 |
| Identity battery | `tsx --test test/*.test.ts` (arena-identity) | 49 pass / 0 fail |
| API edge battery | `tsx --test test/api.test.ts test/durable.test.ts test/durable-edge.test.ts test/oidc-auth.test.ts` (arena-api) | 23 pass / 0 fail (18 pre-existing + 5 new) |
| Release gate suites | `tsx --test test/gate-registry.test.ts test/gate-report.test.ts test/cross-tenant.test.ts test/webhook-signature.test.ts test/prompt-injection-as-data.test.ts test/capsule-tenant-refusal.test.ts` | 25 pass / 0 fail |
| Harness acceptance profiles (real processes) | `tsx --test test/vertical-p0.test.ts test/next-expert.test.ts test/p2-review.test.ts test/two-instance-recovery.test.ts` | 5 pass / 0 fail |
| SDK E2E (real API + MCP processes) | `tsx --test test/sdk.test.ts test/webhook.test.ts test/mcp.test.ts test/e2e-real-integration.test.ts` | 24 pass / 0 fail |
| Workbench real-API binding | `tsx --test test/e2e-real-api.test.ts` | pass / 0 fail |
| Contracts corpus (frozen surface untouched) | `tsx --test test/vectors.test.ts test/transitions.test.ts test/completeness.test.ts test/ownership.test.ts test/contracts.test.ts` (arena-contracts) | 104 pass / 0 fail |
| Application / capsule / persistence suites | per-CI commands | pass / 0 fail |

## Honest limitations

- The reference adapter is **seam + evidence, not a vendor integration**: no
  discovery/metadata endpoint, no refresh-token/logout flows, no DPoP/mTLS,
  single configured issuer+audience. Choosing the operator's IdP remains an
  owner decision (AR2-023) — explicitly out of scope per issue #54.
- `jti_once` replay defense is single-instance in-memory; multi-instance
  replay defense is an IdP/gateway deployment concern (default `none`,
  disclosed).
- JWKS cache gives known kids one TTL window of availability during an IdP
  outage (rotation-period availability tradeoff); unseen kids and first-load
  failures are fail-closed. TTL should be aligned to the IdP rotation cadence.
- HS256 mode exists but is not the production-representative path (secret
  distribution discipline required).
- Worker sandbox could not run the full GitHub CI battery (no runner push);
  the station battery above is the local equivalent of every CI step
  that touches this change, on Node 24.21.0 (CI pins Node 24).

## TL integration checklist (TL-owned files, not in this delivery's fence)

1. `package.json` root `typecheck` list: append `packages/arena-identity`
   (transitively already built via arena-api's reference; explicit entry
   matches the AR2-019 precedent).
2. `.github/workflows/ci.yml`: add the identity battery step
   (`working-directory: packages/arena-identity`, run
   `../../node_modules/.bin/tsx --test test/*.test.ts`) and append
   `test/oidc-auth.test.ts` to the arena-api step.
3. `pnpm-lock.yaml`: run `pnpm install` at integration to record the two new
   importers (`@arena/identity`, and the `@arena/identity` edge on
   `@arena/api`) — the local lockfile change was reverted before delivery.
4. `architecture-policy.yaml`: optional registration of `arena-identity`
   (roots `packages/arena-identity/src`, publicEntrypoints
   `packages/arena-identity/src/contract.ts`, owner `arena-tl`) — the guard
   passes with the package unregistered (AR2-019 precedent), registration
   makes the fence explicit in policy.

Reviewer: TL (acceptance per issue #54 acceptance record).
