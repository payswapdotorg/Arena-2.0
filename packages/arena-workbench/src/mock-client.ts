import { escalationRequestSchema, type EscalationRequest } from "@arena/contracts";
import { DEMO_TAG, type DemoTag } from "./demo-fixtures.js";
import type { FieldError } from "./requester-form.js";

/**
 * AR2-003 — typed mock client（冻结 schema 驱动；AR2-006 绑定真实 API 时替换）。
 *
 * ROLE_IS_NOT_AUTHORIZATION_RULE 在此强制：
 * - 每个方法都只接收 principal（tenant/user——服务端凭据推导的替身），
 *   从不接收也不读取 UI role/lens；
 * - 提交入口 fail-closed：envelope 先过 escalationRequestSchema（strict），
 *   非法/超范围直接 REJECTED（分字段 issue），绝不部分接受；
 * - 跨租户读取与不存在不可区分（NOT_FOUND 单一形态）；
 * - 一切记录携带 DemoTag（DEMO 标注，architecture-lock 23）。
 */

/** 服务端凭据推导的主体（demo 形态；真实形态是 AR2-002 的 auth adapter）。 */
export interface WorkbenchPrincipal {
  tenant_id: string;
  user_id: string;
}

export interface EscalationSummary {
  escalation_id: string;
  title: string;
  state: string;
  budget_limit: number;
  currency: string;
  deadline: string;
  demo: DemoTag;
}

export type SubmitOutcome =
  | { kind: "SUBMITTED"; escalation_id: string; request_digest: string; demo: DemoTag }
  | { kind: "REJECTED"; fieldErrors: FieldError[] };

export type LookupOutcome =
  | { kind: "FOUND"; request: EscalationRequest; summary: EscalationSummary }
  | { kind: "NOT_FOUND" };

export interface ArenaWorkbenchClient {
  submitEscalation(request: unknown, principal: WorkbenchPrincipal): Promise<SubmitOutcome>;
  listEscalations(principal: WorkbenchPrincipal): Promise<EscalationSummary[]>;
  getEscalation(escalation_id: string, principal: WorkbenchPrincipal): Promise<LookupOutcome>;
}

interface StoredRecord {
  tenant_id: string;
  escalation_id: string;
  request: EscalationRequest;
}

/**
 * 确定性 mock：内存存储、按租户隔离、无时钟依赖（自增序号做 id）。
 * 注意：构造与所有方法都不含任何 role/lens 参数——这是规则的一部分。
 */
export class MockArenaClient implements ArenaWorkbenchClient {
  private readonly records: StoredRecord[] = [];
  private sequence = 0;

  async submitEscalation(request: unknown, principal: WorkbenchPrincipal): Promise<SubmitOutcome> {
    const parsed = escalationRequestSchema.safeParse(request);
    if (!parsed.success) {
      return {
        kind: "REJECTED",
        fieldErrors: parsed.error.issues.map((issue) => ({
          field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
          rule: `${issue.code}${issue.message ? ` — ${issue.message}` : ""}`,
        })),
      };
    }
    const valid = parsed.data;
    this.sequence += 1;
    const escalationId = `esc_${String(this.sequence).padStart(8, "0")}`;
    this.records.push({
      tenant_id: principal.tenant_id,
      escalation_id: escalationId,
      request: valid,
    });
    return {
      kind: "SUBMITTED",
      escalation_id: escalationId,
      request_digest: valid.request_digest,
      demo: DEMO_TAG,
    };
  }

  async listEscalations(principal: WorkbenchPrincipal): Promise<EscalationSummary[]> {
    return this.records
      .filter((record) => record.tenant_id === principal.tenant_id)
      .map((record) => this.summaryOf(record));
  }

  async getEscalation(
    escalation_id: string,
    principal: WorkbenchPrincipal,
  ): Promise<LookupOutcome> {
    // 跨租户与不存在不可区分：先按租户过滤再找 id。
    const record = this.records.find(
      (candidate) =>
        candidate.tenant_id === principal.tenant_id && candidate.escalation_id === escalation_id,
    );
    if (record === undefined) {
      return { kind: "NOT_FOUND" };
    }
    return { kind: "FOUND", request: record.request, summary: this.summaryOf(record) };
  }

  private summaryOf(record: StoredRecord): EscalationSummary {
    return {
      escalation_id: record.escalation_id,
      title: record.request.task.title,
      state: "CREATED",
      budget_limit: record.request.budget.limit_amount,
      currency: record.request.budget.currency,
      deadline: record.request.constraints.deadline,
      demo: DEMO_TAG,
    };
  }
}
