import { createHash, randomUUID } from "node:crypto";
import type { CapsuleManifest } from "@arena/contracts";

/** 冻结 id 类型经公开面派生（common.ts 的 ArenaId 类型未在 contract.ts 导出）。 */
type ArenaId = CapsuleManifest["tenant_id"];

/**
 * Scoped credential 语义（AR2-004 验收场景 4）：
 * - 短时效：按 manifest TTL 签发，不超过 24h（schema 已保证，这里以
 *   expires_at 的形式显式落地）；
 * - 永不落日志：redact() 是唯一安全展示形态，密文摘要仅在吊销验证中比较；
 * - 拆除时吊销并验证：未吊销凭证 = 拆除失败（TEARDOWN_FAILED）。
 * 纯逻辑 + 进程内台账：合成 provider 与测试直接复用；生产 provider
 * 换成其引擎侧实现，但语义（含 redaction）不得弱化。
 */

export interface ScopedCredentialSpec {
  credential_id: ArenaId;
  scope: string;
  ttl_seconds: number;
  rotation_policy: string;
}

export interface IssuedCredential {
  credential_id: ArenaId;
  scope: string;
  issued_at: string;
  expires_at: string;
  /** 仅存摘要；明文 secret 只在签发时一次性返回，不进入任何结构化状态。 */
  secret_digest: string;
  rotation_policy: string;
}

export interface IssuedSecret {
  credential_id: ArenaId;
  /** 一次性明文（调用方立即注入 capsule，禁止持久化/日志）。 */
  secret: string;
  expires_at: string;
}

export type CredentialIssueOutcome =
  | { kind: "ISSUED"; record: IssuedCredential; secret: IssuedSecret }
  | { kind: "EXPIRED_TTL"; ttl_seconds: number };

export type CredentialCheck =
  | { kind: "ACTIVE"; record: IssuedCredential }
  | { kind: "EXPIRED"; record: IssuedCredential }
  | { kind: "REVOKED"; credential_id: ArenaId }
  | { kind: "UNKNOWN"; credential_id: ArenaId };

/** 唯一安全展示形态：任何日志/UI 只允许出现这个。 */
export function redactCredential(credential: IssuedCredential): string {
  return `cred_${credential.credential_id}:REDACTED(scope=${credential.scope},exp=${credential.expires_at})`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * 进程内 scoped credential 台账。
 * secret 明文只在 issue() 返回值中出现一次；结构化状态只保留摘要。
 */
export class ScopedCredentialLedger {
  private readonly active = new Map<ArenaId, IssuedCredential>();
  private readonly revoked = new Set<ArenaId>();
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  issue(spec: ScopedCredentialSpec, manifestTtlCeiling?: number): CredentialIssueOutcome {
    const ttl =
      manifestTtlCeiling !== undefined
        ? Math.min(spec.ttl_seconds, manifestTtlCeiling)
        : spec.ttl_seconds;
    if (ttl <= 0) {
      return { kind: "EXPIRED_TTL", ttl_seconds: spec.ttl_seconds };
    }
    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + ttl * 1000);
    const secret = `cap-${randomUUID()}`;
    const record: IssuedCredential = {
      credential_id: spec.credential_id,
      scope: spec.scope,
      issued_at: issuedAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
      expires_at: expiresAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
      secret_digest: sha256Hex(secret),
      rotation_policy: spec.rotation_policy,
    };
    this.active.set(spec.credential_id, record);
    this.revoked.delete(spec.credential_id);
    return {
      kind: "ISSUED",
      record,
      secret: { credential_id: spec.credential_id, secret, expires_at: record.expires_at },
    };
  }

  check(credential_id: ArenaId, at?: Date): CredentialCheck {
    if (this.revoked.has(credential_id)) {
      return { kind: "REVOKED", credential_id };
    }
    const record = this.active.get(credential_id);
    if (record === undefined) {
      return { kind: "UNKNOWN", credential_id };
    }
    const now = (at ?? this.now()).getTime();
    if (now >= Date.parse(record.expires_at)) {
      return { kind: "EXPIRED", record };
    }
    return { kind: "ACTIVE", record };
  }

  revoke(credential_id: ArenaId): boolean {
    if (!this.active.has(credential_id)) {
      return false;
    }
    this.active.delete(credential_id);
    this.revoked.add(credential_id);
    return true;
  }

  /** 拆除路径：吊销 manifest 声明的全部凭证并验证。返回未吊销清单（空 = 通过）。 */
  revokeAllForManifest(manifest: CapsuleManifest): ArenaId[] {
    const unrevoked: ArenaId[] = [];
    for (const spec of manifest.credentials) {
      if (!this.revoke(spec.credential_id)) {
        // 未知凭证（从未签发）不阻塞拆除；已吊销的幂等通过。
        const state = this.check(spec.credential_id);
        if (state.kind !== "REVOKED" && state.kind !== "UNKNOWN") {
          unrevoked.push(spec.credential_id);
        }
      }
    }
    return unrevoked;
  }

  activeCredentialIds(): ArenaId[] {
    return [...this.active.keys()];
  }
}
