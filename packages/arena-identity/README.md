# @arena/identity — AR2-022 production identity adapter (IDN1.0)

Production-representative identity adapter seam for the Arena API edge. This
package turns the AR2-015 gate report's recorded seam ("the tested
tenant-isolation surface uses a demo authentication adapter; the production
identity adapter remains a future integration boundary" — grg_00000005) into
versioned contract + reference implementation + adversarial evidence.

## What is in here

| Surface | File | Notes |
| --- | --- | --- |
| IDN1.0 contract family | `src/idn.ts` (exported via `src/contract.ts`) | versioned claim schemas, `IdentityAdapter` port, `AuthnResult`, edge-mapping rules |
| Typed failure catalog | `src/errors.ts` | closed enum `IDN_*` codes; details never leave the trust boundary |
| JWS primitives | `src/jwt.ts` | compact-JWS parsing, RS256 (JWK) / HS256 (explicit) verification, Bearer extraction — node:crypto only |
| JWKS client | `src/jwks.ts` | fetch + TTL cache + kid-driven rotation refresh + single-flight + fail-closed |
| Replay guard | `src/replay.ts` | bounded `jti_once` hardening (explicit opt-in; see honest-boundary note) |
| OIDC reference adapter | `src/adapter-oidc.ts` | production-representative: RS256+JWKS, issuer/audience validation, clock-skew bounds |
| Demo adapter | `src/adapter-demo.ts` | **DEMO-ONLY** deterministic registry (AR2-002 surface parity) |
| Env config | `src/config.ts` | env-only composition, fail-fast, redacted projection |

## IDN1.0 design rules (frozen discipline)

1. **No frozen-contract changes.** `@arena/contracts` (CF1.0) is consumed
   read-only; IDN1.0 is a new, independently versioned contract family. The
   output side maps to the frozen `TenantContext` schema and is validated
   against it on every success (zero-drift guard).
2. **Tenant context is server-derived from verified claims only.** The token
   must carry a strict `arena_tenant_context` claim; unknown fields inside it
   are rejected. Top-level OIDC claims (sub, azp, scope, email, …) are
   tolerated and **never** mapped — a forged top-level `tenant` field is
   structurally unable to participate in derivation.
3. **`derived_from` is server-owned.** Tokens cannot declare their own
   derivation; the adapter always fills `authenticated_credentials`.
4. **Fail-closed everywhere.** Missing header, malformed JWS, rejected alg
   (including `none` and alg-confusion), issuer/audience mismatch, expiry
   beyond the skew bound, signature failure, JWKS unavailability, invalid
   claims, replay — all typed failures, never a downgrade-to-allow.
5. **No oracle at the edge.** Every authn failure maps to the same uniform
   401 envelope at the HTTP edge (`AUTHN_EDGE_MAPPING_RULE`); typed codes are
   for tests and operations only.
6. **Verification order.** structure → alg allowlist → **signature** → iss →
   aud → exp/nbf (skew-bounded) → arena claims → replay. Unverified payload
   bytes are never trusted for any decision.

## Composition (arena-api wiring)

```ts
import { createOidcIdentityAdapter } from "@arena/identity";
import { createArenaServer, createAuthGateway } from "@arena/api";

const adapter = createOidcIdentityAdapter({
  issuer: "https://your-idp.example/realms/arena",
  audience: "arena-api",
  jwksUri: "https://your-idp.example/realms/arena/protocol/openid-connect/certs",
  clockSkewSeconds: 60,        // default
  replayPolicy: "none",        // default (see below)
});
await adapter.probe();          // startup readiness (affects /readyz only)

const server = createArenaServer({ runtime, auth: createAuthGateway(adapter) });
```

Environment composition via `main.ts` (no code changes for deployments):

| Variable | Meaning | Default |
| --- | --- | --- |
| `ARENA_AUTH_MODE` | `demo` \| `oidc` | `demo` |
| `ARENA_AUTH_OIDC_ISSUER` | expected issuer (exact match) | required for oidc |
| `ARENA_AUTH_OIDC_AUDIENCE` | expected audience | required for oidc |
| `ARENA_AUTH_OIDC_JWKS_URI` | JWKS endpoint (explicit, no discovery guessing) | required for oidc |
| `ARENA_AUTH_OIDC_CLOCK_SKEW_SECONDS` | exp/nbf tolerance bound | `60` |
| `ARENA_AUTH_OIDC_JWKS_CACHE_TTL_SECONDS` | JWKS cache TTL | `600` |
| `ARENA_AUTH_OIDC_JWKS_TIMEOUT_MS` | JWKS request timeout | `5000` |
| `ARENA_AUTH_OIDC_REPLAY_POLICY` | `none` \| `jti_once` | `none` |

## Secrets handling and rotation expectations

- Keys and endpoints enter **only** via environment/explicit constructor
  options; there are zero in-code literals, and no log or disclosure path
  emits credential values (`redactIdentityConfig` is the safe projection).
- The public-key flow (RS256 + JWKS) needs no client secret on the API side.
  Confidential-client flows (client_secret) are **out of scope** by design —
  choosing the operator's IdP vendor and integration posture is an owner
  decision recorded separately (AR2-023).
- IdP key rotation is handled by kid-driven refresh: a token with an unknown
  `kid` triggers exactly one JWKS refresh; a `kid` absent after refresh fails
  closed. Retired keys stop validating immediately; the cache TTL bounds
  staleness (default 10 minutes — align it with your IdP's rotation cadence).
- Token lifetime policy (exp), skew bounds and replay policy are deployment
  decisions; the reference defaults are conservative and disclosed.

## Honest boundaries (read before production claims)

- The OIDC adapter is a **reference implementation**, not a vendor
  integration: discovery/metadata endpoints, logout, refresh-token handling,
  DPoP/mTLS and multi-issuer tenancy are intentionally absent (seam-first
  scope per issue #54).
- `jti_once` replay defense is an in-memory single-instance guard; in a
  multi-instance topology complete replay defense belongs to the IdP/gateway
  layer. Default is `none` (disclosed), never a silent claim.
- JWKS caching trades rotation latency for availability within one TTL
  window (documented in `src/jwks.ts`); fail-closed is preserved for unseen
  kids.
- HS256 (symmetric) mode exists for completeness and requires explicit
  secret distribution discipline; the production-representative path is
  RS256 + JWKS.

## DEMO adapter marking (acceptance requirement)

The demo registry is marked demo-only in **code** (`DEMO_IDENTITY_DISCLOSURE`,
`mode: "demo"`, `isDemoAdapter()`) and in **docs** (this file). It preserves
AR2-002 behavior byte-for-byte for the existing test surface and is never
production identity evidence.

## Tests

```bash
../../node_modules/.bin/tsx --test test/*.test.ts
```

- `idn-contract.test.ts` — IDN1.0 positive/negative contract vectors
- `jwt.test.ts` — structural attacks, alg=none, alg-confusion, forgery, timing-safe MAC
- `jwks.test.ts` — fetch/rotation/unknown-kid/outage fail-closed (real local HTTP)
- `replay.test.ts` — jti_once, sweep, bounded eviction
- `adapter-oidc.test.ts` — the adversarial battery through the reference adapter
- `adapter-demo.test.ts` — demo parity + demo-only marking

Cross-tenant denial **through the real adapter path** (the grg_00000005 seam
closure) is evidenced at the API edge in
`packages/arena-api/test/oidc-auth.test.ts`: byte-indistinguishable 404s,
uniform 401s, frozen-schema tenant-override rejection, readyz/contract
disclosures.
