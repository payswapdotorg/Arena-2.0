# NOTICE — @arena/identity (AR2-022)

This package is part of Arena 2.0, a fork of zai-org/ZCode. The upstream
license (Apache-2.0), notices, dependency notices, attribution and security
disclosures are retained at the repository root (LICENSE, NOTICE.md,
THIRD-PARTY-NOTICES.md); this package adds to them and erases nothing.

## What this package adds

- The IDN1.0 versioned identity-adapter contract family (claim schemas,
  `IdentityAdapter` port, typed authn failure catalog, edge mapping rules).
- A production-representative reference implementation (OIDC access tokens,
  RS256 + JWKS fetch/rotation, issuer/audience validation, clock-skew
  bounds, optional bounded jti replay guard) implemented with `node:crypto`
  and the standard `fetch` only.
- The DEMO-ONLY deterministic registry (AR2-002 surface parity) behind the
  same port.
- The adversarial auth battery and API-edge cross-tenant evidence
  (`packages/arena-api/test/oidc-auth.test.ts`).

No upstream files are modified by this package; the frozen CF1.0 corpus in
`@arena/contracts` is consumed read-only and re-validated on every mapped
`TenantContext`.
