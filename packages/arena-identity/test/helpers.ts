import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  type KeyObject,
} from "node:crypto";

/**
 * AR2-022 对抗电池的测试夹具：
 * - 真实 RSA-2048 密钥对 + RS256 签名（与生产令牌同路径）；
 * - 本地假 OIDC IdP（node:http 提供 JWKS 端点）；
 * - 令牌铸造器（完全控制每个声明字段以构造对抗向量）。
 * 零第三方依赖：node:crypto + node:http。
 */

export interface RsaKeyMaterial {
  privateKeyPem: string;
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
  kid: string;
}

export function generateRsaKeyMaterial(kid: string): RsaKeyMaterial {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    privateKey,
    jwk: { ...jwk, kid, use: "sig", alg: "RS256" },
    kid,
  };
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export interface MintTokenOptions {
  key: RsaKeyMaterial | { privateKey: KeyObject; kid?: string };
  headerOverride?: Record<string, unknown>;
  claims: Record<string, unknown>;
  /** 签名后是否破坏签名（伪造向量）。 */
  tamperSignature?: boolean;
  /** 覆盖签名（用别的密钥签 —— 伪造向量）。 */
  signWith?: KeyObject;
  algorithm?: "RS256" | "HS256";
  hmacSecret?: Buffer;
}

export function mintCompactJws(options: MintTokenOptions): string {
  const header: Record<string, unknown> = {
    alg: options.algorithm ?? "RS256",
    typ: "JWT",
    ...(options.key.kid !== undefined ? { kid: options.key.kid } : {}),
    ...options.headerOverride,
  };
  const headerSegment = base64Url(JSON.stringify(header));
  const claimsSegment = base64Url(JSON.stringify(options.claims));
  const signingInput = `${headerSegment}.${claimsSegment}`;
  let signature: Buffer;
  if (options.algorithm === "HS256") {
    assert.ok(options.hmacSecret !== undefined, "HS256 mint requires hmacSecret");
    signature = createHmac("sha256", options.hmacSecret).update(signingInput).digest();
  } else {
    const key = options.signWith ?? options.key.privateKey;
    signature = cryptoSign("sha256", Buffer.from(signingInput, "ascii"), key);
  }
  if (options.tamperSignature === true) {
    // 翻转签名首字节（保持 base64url 合法性：重编码）。
    const flipped = Buffer.from(signature);
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    signature = flipped;
  }
  return `${signingInput}.${base64Url(signature)}`;
}

export interface ClaimOverrides {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nbf?: number;
  jti?: string;
  arena?: Record<string, unknown> | null;
  extra?: Record<string, unknown>;
}

export const ISSUER = "https://idp.arena.example/realms/arena";
export const AUDIENCE = "arena-api";

export const TENANT_ALPHA = {
  tenant_id: "tnt_00000001",
  client_application_id: "app_00000001",
  principal_id: "usr_00000001",
  acting_identity_id: null,
  role: "requester",
  authorization_scope_ids: ["scp_00000001"],
};

export const TENANT_BETA = {
  tenant_id: "tnt_00000002",
  client_application_id: "app_00000002",
  principal_id: "usr_00000002",
  acting_identity_id: null,
  role: "requester",
  authorization_scope_ids: ["scp_00000002"],
};

export function standardClaims(
  nowEpochSeconds: number,
  overrides: ClaimOverrides = {},
): Record<string, unknown> {
  return {
    iss: overrides.iss ?? ISSUER,
    sub: overrides.sub ?? "usr_00000001",
    aud: overrides.aud ?? AUDIENCE,
    exp: overrides.exp ?? nowEpochSeconds + 600,
    iat: overrides.iat ?? nowEpochSeconds - 10,
    ...(overrides.nbf !== undefined ? { nbf: overrides.nbf } : {}),
    ...(overrides.jti !== undefined ? { jti: overrides.jti } : {}),
    arena_tenant_context: overrides.arena === null ? undefined : (overrides.arena ?? TENANT_ALPHA),
    ...overrides.extra,
  };
}

export function mintValidRs256Token(
  key: RsaKeyMaterial,
  nowEpochSeconds: number,
  overrides: ClaimOverrides = {},
): string {
  const claims = standardClaims(nowEpochSeconds, overrides);
  if (claims["arena_tenant_context"] === undefined) delete claims["arena_tenant_context"];
  return mintCompactJws({ key, claims });
}

export interface FakeIdp {
  base: string;
  jwksUri: string;
  /** 替换 JWK 集（轮换向量）。 */
  setKeys(keys: Record<string, unknown>[]): void;
  /** 断开 JWKS 端点（fail-closed 向量）。 */
  breakEndpoint(): void;
  /** 请求计数（缓存行为断言用）。 */
  requestCount(): number;
  close(): Promise<void>;
}

export async function startFakeJwksServer(
  initialKeys: Record<string, unknown>[],
): Promise<FakeIdp> {
  let keys = initialKeys;
  let broken = false;
  let count = 0;
  const server: Server = createServer((request, response) => {
    count += 1;
    if (request.url === undefined || !request.url.startsWith("/jwks.json")) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    if (broken) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "temporarily_unavailable" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ keys }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    jwksUri: `http://127.0.0.1:${port}/jwks.json`,
    setKeys(next) {
      keys = next;
    },
    breakEndpoint() {
      broken = true;
    },
    requestCount: () => count,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

/** HMAC 密钥（对称模式向量）。 */
export function hmacSecretForTest(): Buffer {
  return createHash("sha256").update("test-hmac-secret-material").digest();
}

/** 由 RSA 公钥材料构造「alg 混淆」攻击令牌（HS256 + 公钥当密钥）。 */
export function mintAlgConfusionToken(
  key: RsaKeyMaterial,
  claims: Record<string, unknown>,
): string {
  const publicJwk = key.jwk;
  const secretMaterial = Buffer.from(
    JSON.stringify({ n: publicJwk["n"], e: publicJwk["e"] }),
    "utf8",
  );
  return mintCompactJws({
    key: { privateKey: createPrivateKey(key.privateKeyPem), kid: key.kid },
    claims,
    algorithm: "HS256",
    hmacSecret: secretMaterial,
    headerOverride: { kid: key.kid },
  });
}

/** 独立密钥（未知 kid / 伪造签名向量）。 */
export function generateAttackerKeyMaterial(kid: string): RsaKeyMaterial {
  return generateRsaKeyMaterial(kid);
}

export { createPublicKey };
