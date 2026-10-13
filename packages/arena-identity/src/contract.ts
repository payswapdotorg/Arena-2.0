/**
 * arena-identity 公开契约（AR2-022，issue #54）。
 *
 * 版本族决策：IDN1.0 是独立版本化的契约族 —— 冻结的 CF1.0 语料
 * （@arena/contracts）在本包内绝不被编辑或扩展；两个家族仅通过
 * TenantContext 形状复用（@arena/contracts 公开导出的只读引用）
 * 与冻结 schema 出口校验关联。任何共享信封的变更都需要新的 ACR
 * 与显式版本化（AR2-022 验收：No frozen-contract changes without
 * explicit version/ACR）。
 *
 * 包外只允许从本文件 import（deep import 被禁止）。
 * 适配器端口：demo 适配器（DEMO-ONLY）与 OIDC/JWKS 参考实现
 * （生产代表性路径）。IdP 厂商选择是 owner 决策（AR2-023 记录），
 * 不在本包范围。
 */

export {
  // IDN1.0 contract family: version, claim schemas, adapter port, edge mapping rules
  IDENTITY_CONTRACT_VERSION,
  arenaTenantClaimSchema,
  idnClaimsSchema,
  tenantContextFromClaim,
  AUTHN_EDGE_MAPPING_RULE,
  IDN_TENANT_DERIVATION_RULE,
  type ArenaTenantClaim,
  type IdnClaims,
  type AuthnResult,
  type AuthnSuccessMeta,
  type ClaimMappingResult,
  type IdentityAdapter,
  type AdapterReadiness,
  type ProbeableAdapter,
} from "./idn.js";

export {
  // typed authn failure catalog (closed enum; details never leave the trust boundary)
  AUTHN_FAILURE_CATALOG,
  AUTHN_FAILURE_CODES,
  authnFailure,
  type AuthnFailureCode,
  type AuthnFailureSpec,
} from "./errors.js";

export {
  // compact JWS parsing + RS256/HS256 verification primitives (node:crypto only)
  parseCompactJws,
  extractBearerToken,
  verifyRs256,
  verifyHs256,
  isRsaSigningJwk,
  type ParsedJws,
  type RsaJwk,
} from "./jwt.js";

export {
  // JWKS client: fetch / TTL cache / kid-driven refresh / fail-closed
  createJwksClient,
  JwksUnavailableError,
  type JwksClient,
  type JwksClientOptions,
  type JwksState,
} from "./jwks.js";

export {
  // bounded replay guard (jti_once is an explicit single-instance hardening)
  createReplayGuard,
  type ReplayGuard,
  type ReplayPolicy,
  type ReplayGuardOptions,
} from "./replay.js";

export {
  // production-representative reference adapter (OIDC / RS256+JWKS / skew bounds)
  createOidcIdentityAdapter,
  type OidcAdapterOptions,
  type OidcAdapter,
} from "./adapter-oidc.js";

export {
  // DEMO-ONLY adapter (deterministic registry; never production identity)
  createDemoIdentityAdapter,
  DEMO_IDENTITY_DISCLOSURE,
  isDemoAdapter,
} from "./adapter-demo.js";

export {
  // env-only configuration (fail-fast; redacted projection; no credential values)
  loadIdentityConfigFromEnv,
  redactIdentityConfig,
  IdentityConfigError,
  type IdentityEnvConfig,
  type OidcAdapterEnvConfig,
  type DemoEnvConfig,
  type AuthMode,
} from "./config.js";

export { arenaIdentityModule } from "./module.js";
