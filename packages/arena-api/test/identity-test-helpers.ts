import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";

/**
 * AR2-022 arena-api 端到端测试夹具（本地副本 —— 测试辅助不跨包共享，
 * @arena/identity 的 test/ 不属于其公开导出面）：
 * - 真实 RSA-2048 密钥对 + RS256 铸造（与生产令牌同路径）；
 * - 本地假 OIDC IdP（node:http JWKS 端点）。
 */

export interface RsaKeyMaterial {
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
  kid: string;
}

export function generateRsaKeyMaterial(kid: string): RsaKeyMaterial {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  return { privateKey, jwk: { ...jwk, kid, use: "sig", alg: "RS256" }, kid };
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

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export interface MintTokenOptions {
  key: RsaKeyMaterial;
  claims: Record<string, unknown>;
  headerOverride?: Record<string, unknown>;
  tamperSignature?: boolean;
  signWith?: KeyObject;
}

export function mintCompactJws(options: MintTokenOptions): string {
  const header: Record<string, unknown> = {
    alg: "RS256",
    typ: "JWT",
    kid: options.key.kid,
    ...options.headerOverride,
  };
  const headerSegment = base64Url(JSON.stringify(header));
  const claimsSegment = base64Url(JSON.stringify(options.claims));
  const signingInput = `${headerSegment}.${claimsSegment}`;
  let signature: Buffer = cryptoSign(
    "sha256",
    Buffer.from(signingInput, "ascii"),
    options.signWith ?? options.key.privateKey,
  );
  if (options.tamperSignature === true) {
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
  arena?: Record<string, unknown>;
}

export function mintValidRs256Token(
  key: RsaKeyMaterial,
  nowEpochSeconds: number,
  overrides: ClaimOverrides = {},
): string {
  const claims: Record<string, unknown> = {
    iss: overrides.iss ?? ISSUER,
    sub: overrides.sub ?? "usr_00000001",
    aud: overrides.aud ?? AUDIENCE,
    exp: overrides.exp ?? nowEpochSeconds + 600,
    iat: nowEpochSeconds - 10,
    ...(overrides.nbf !== undefined ? { nbf: overrides.nbf } : {}),
    ...(overrides.jti !== undefined ? { jti: overrides.jti } : {}),
    arena_tenant_context: overrides.arena ?? TENANT_ALPHA,
  };
  return mintCompactJws({ key, claims });
}

export interface FakeIdp {
  base: string;
  jwksUri: string;
  close(): Promise<void>;
}

export async function startFakeJwksServer(
  initialKeys: Record<string, unknown>[],
): Promise<FakeIdp> {
  let keys = initialKeys;
  const server: Server = createServer((request, response) => {
    if (request.url === undefined || !request.url.startsWith("/jwks.json")) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
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
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
