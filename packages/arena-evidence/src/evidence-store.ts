import {
  evidenceEnvelopeSchema,
  validateEvidenceEnvelopeSemantics,
  type EvidenceEnvelope,
} from "@arena/contracts";

/** 语义问题（与 contracts 返回形状结构兼容；公开面未导出该类型，本地声明）。 */
export interface SemanticIssue {
  field: string;
  rule: string;
}

/**
 * AR2-007 — append-only EvidenceEnvelope 存储（ES2.0 §3/§5；PVP1.0 §6）。
 *
 * 冻结规则在本存储的强制方式：
 * - EVIDENCE_IMMUTABILITY_RULE：记录一旦接受即不可变 —— 存储不提供任何
 *   update/delete 入口；修正 = 追加一条新信封（correction 指向被取代者），
 *   旧记录原样保留。
 * - CALLER_PROOF_TRUST_RULE：受信 tier（arena_runner /
 *   registered_application_runner）必须有签名/认证字段，否则 FORGED 拒绝；
 *   untrusted_attachment 不得标 public（语义校验）。
 * - 绑定校验（tenant/escalation/attempt/environment/validator）：调用方给出
 *   本次记录的期望绑定上下文，信封 binding 与之不符即类型化拒绝 ——
 *   错租户/错尝试的证据在进入存储前被挡下，且与「不存在」不可区分原则
 *   无关（这是写入侧的 fail-closed，不泄漏存在性）。
 * - 重放防护：evidence_id 全局唯一（重复 = REPLAYED 拒绝）；
 *   provenance.replay_protection 声明的 nonce/sequence/timestamp_window
 *   机制由签发方实现，本存储拒绝同一 evidence_id 的再次提交。
 * - recorded_at 不得早于 issued_at（语义校验）。
 */

/** 存储层类型化拒绝码（写入侧；与 ARENA_ERROR_CATALOG 独立，最终由
 * 调用方（AR2-010 前的 pipeline）映射到 typed API 错误）。 */
export type EvidenceRejectionCode =
  | "SCHEMA_INVALID"
  | "SEMANTIC_INVALID"
  | "FORGED_UNSIGNED_TRUSTED_TIER"
  | "REPLAYED_EVIDENCE_ID"
  | "WRONG_TENANT"
  | "WRONG_ESCALATION"
  | "WRONG_ATTEMPT"
  | "SUPERSEDES_UNKNOWN_EVIDENCE";

export interface EvidenceRejection {
  code: EvidenceRejectionCode;
  message: string;
  issues: SemanticIssue[];
}

export type RecordOutcome =
  | { kind: "ACCEPTED"; evidence: EvidenceEnvelope }
  | { kind: "REJECTED"; rejection: EvidenceRejection };

/** 本次写入的期望绑定上下文（由命令/运行时上下文派生，绝不来自客户端声明）。 */
export interface ExpectedBinding {
  tenant_id: string;
  escalation_id: string;
  attempt_id: string;
}

/** 追加式存储（内存参考实现；durable 化属于 AR2-005 端口接线，接口不变）。 */
export class EvidenceStore {
  private readonly byId = new Map<string, EvidenceEnvelope>();
  private readonly accepted: EvidenceEnvelope[] = [];

  /**
   * 唯一写入入口：先 schema（strict，未知字段拒绝）→ 语义 → 绑定 →
   * 重放/修正链校验，全部通过才追加。任何失败返回类型化 REJECTED，
   * 存储状态零改动。
   */
  record(envelope: unknown, expected: ExpectedBinding): RecordOutcome {
    const parsed = evidenceEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) {
      return {
        kind: "REJECTED",
        rejection: {
          code: "SCHEMA_INVALID",
          message: "evidence envelope failed the frozen CF1.0 schema",
          issues: parsed.error.issues.map((issue) => ({
            field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
            rule: `${issue.code}${issue.message ? ` — ${issue.message}` : ""}`,
          })),
        },
      };
    }
    const candidate = parsed.data;

    const semanticIssues = validateEvidenceEnvelopeSemantics(candidate);
    if (semanticIssues.length > 0) {
      // 受信 tier 未签名属于伪造，单独归类（fail-closed 于信任边界）。
      const forged = semanticIssues.some((issue) => issue.field === "provenance.signature");
      return {
        kind: "REJECTED",
        rejection: {
          code: forged ? "FORGED_UNSIGNED_TRUSTED_TIER" : "SEMANTIC_INVALID",
          message: forged
            ? "trusted-tier evidence must be signed or authenticated (CALLER_PROOF_TRUST_RULE)"
            : "evidence envelope violated frozen semantic rules",
          issues: semanticIssues,
        },
      };
    }

    if (candidate.binding.tenant_id !== expected.tenant_id) {
      return rejectedSimple(
        "WRONG_TENANT",
        "evidence binding tenant does not match the recording context",
      );
    }
    if (candidate.binding.escalation_id !== expected.escalation_id) {
      return rejectedSimple(
        "WRONG_ESCALATION",
        "evidence binding escalation does not match the recording context",
      );
    }
    if (candidate.binding.attempt_id !== expected.attempt_id) {
      return rejectedSimple(
        "WRONG_ATTEMPT",
        "evidence binding attempt does not match the recording context",
      );
    }

    if (this.byId.has(candidate.evidence_id)) {
      return rejectedSimple(
        "REPLAYED_EVIDENCE_ID",
        "evidence_id already recorded — replayed evidence is rejected (append-only, immutable)",
      );
    }

    if (
      candidate.correction !== null &&
      !this.byId.has(candidate.correction.supersedes_evidence_id)
    ) {
      return rejectedSimple(
        "SUPERSEDES_UNKNOWN_EVIDENCE",
        "correction references an evidence_id that was never accepted in this store",
      );
    }

    this.byId.set(candidate.evidence_id, candidate);
    this.accepted.push(candidate);
    return { kind: "ACCEPTED", evidence: candidate };
  }

  /** 只读快照（顺序 = 接受顺序）。调用方不得修改（不可变信封按构造共享）。 */
  all(): readonly EvidenceEnvelope[] {
    return this.accepted;
  }

  byAttempt(attempt_id: string): readonly EvidenceEnvelope[] {
    return this.accepted.filter((e) => e.binding.attempt_id === attempt_id);
  }

  has(evidence_id: string): boolean {
    return this.byId.has(evidence_id);
  }

  get(evidence_id: string): EvidenceEnvelope | null {
    return this.byId.get(evidence_id) ?? null;
  }
}

function rejectedSimple(code: EvidenceRejectionCode, message: string): RecordOutcome {
  return { kind: "REJECTED", rejection: { code, message, issues: [] } };
}
