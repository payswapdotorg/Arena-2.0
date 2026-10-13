# SUPPLY-CHAIN RECORD — @arena/identity (AR2-022)

## npm dependencies

| Dependency | Version constraint | Kind | Note |
| --- | --- | --- | --- |
| `@arena/contracts` | `workspace:*` | runtime | frozen CF1.0 corpus — consumed read-only, never modified |
| `zod` | `4.6.5` | runtime | same pin as every other arena contract package (schema validation) |
| `typescript` | `^6.0.2` | dev | same pin family as every other arena package |

**Zero external npm runtime dependencies beyond `zod`** (which is already a
workspace-wide pinned dependency). Cryptography is `node:crypto` (JWK import,
RS256 verify, HMAC, `timingSafeEqual`); HTTP is the platform `fetch` with
`AbortSignal.timeout`. No native modules, no postinstall steps, no network
access at install time.

Runtime network access: the JWKS endpoint configured by the operator (env
only) is fetched lazily and cached; no other egress exists in this package.

## Test-time local services

| Service | Purpose | Provenance discipline |
| --- | --- | --- |
| fake JWKS server (`node:http`, 127.0.0.1:0) | IdP stand-in for the adversarial battery | test fixture only, never shipped; RSA-2048 keys generated per run via `node:crypto` |

## Secrets posture

- No credentials in code, tests, logs or docs.
- The reference flow is public-key (RS256+JWKS): no client secret exists on
  the API side. Confidential-client secrets are explicitly out of scope
  (owner decision, AR2-023).
- Environment parsing fails fast naming the variable (never the value);
  `redactIdentityConfig` is the only disclosure-safe projection.
