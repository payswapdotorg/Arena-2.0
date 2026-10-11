/**
 * AR2-010 — 测试模式 provider 模拟器（issue #12「test simulator」验收件）。
 *
 * PRODUCTION_ENABLED 是冻结的 false 字面量（capsule 先例）：真实转账
 * 在书面商业发布决策（所有权/司法辖区/provider/税务/KYC-AML/退款争议/
 * 对账控制）记录之前保持禁用。
 */

export const PRODUCTION_ENABLED = false as const;

export const TEST_PAYMENT_PROVIDER_DISCLOSURE =
  "TEST-MODE payment simulator only: the in-memory provider adapter acknowledges, times out or " +
  "refunds on demand; PRODUCTION_ENABLED is a frozen false literal (capsule precedent) — live " +
  "transfers stay disabled until a written commercial release decision records ownership, " +
  "jurisdiction, provider, tax, KYC/AML, refunds/disputes and reconciliation controls";

export interface TestPaymentProvider {
  readonly id: string;
  /** 提交转账/退款操作；acknowledged=false 表示 provider 挂起（超时）。 */
  submit(operation: {
    payment_operation_id: string;
    kind: "release" | "refund";
    amount: number;
    currency: string;
    payee: string;
  }): Promise<{ acknowledged: boolean }>;
}

/** 按操作 id 查询 provider 侧状态（对账通道）。 */
export interface ProviderReconciliation {
  query(operationId: string): Promise<{ settled: boolean } | null>;
}

export interface TestProviderScript {
  /** 预设行为：submit 时 acknowledge（默认 true）与 query 的返回。 */
  acknowledgeOnSubmit?: boolean;
  /** query 返回：null = provider 无记录（对账后可重提交）；省略 = 已结算。 */
  queryResult?: { settled: boolean } | null;
}

/**
 * 内存测试 provider：行为按操作 id 可脚本化（默认全部确认）。
 * 同一操作 id 的重复 submit 记为同一操作（计数器可断言「唯一 provider 操作」）。
 */
export class InMemoryTestProvider implements TestPaymentProvider, ProviderReconciliation {
  readonly id: string;
  private readonly scripts = new Map<string, TestProviderScript>();
  private readonly submitted = new Map<string, { kind: "release" | "refund"; count: number }>();

  constructor(id = "pay_testmode_00000001") {
    this.id = id;
  }

  /** 为特定操作预设行为（缺省 = acknowledge + settled）。 */
  script(payment_operation_id: string, behavior: TestProviderScript): this {
    this.scripts.set(payment_operation_id, behavior);
    return this;
  }

  async submit(operation: {
    payment_operation_id: string;
    kind: "release" | "refund";
    amount: number;
    currency: string;
    payee: string;
  }): Promise<{ acknowledged: boolean }> {
    const existing = this.submitted.get(operation.payment_operation_id);
    if (existing !== undefined) {
      existing.count += 1;
    } else {
      this.submitted.set(operation.payment_operation_id, { kind: operation.kind, count: 1 });
    }
    const behavior = this.scripts.get(operation.payment_operation_id);
    return { acknowledged: behavior?.acknowledgeOnSubmit ?? true };
  }

  async query(operationId: string): Promise<{ settled: boolean } | null> {
    const behavior = this.scripts.get(operationId);
    if (behavior?.queryResult !== undefined) {
      return behavior.queryResult;
    }
    const wasSubmitted = this.submitted.get(operationId);
    if (wasSubmitted === undefined) {
      return null;
    }
    return { settled: (behavior?.acknowledgeOnSubmit ?? true) === true };
  }

  /** 断言辅助：某操作 id 被 submit 的次数（重复回调检测）。 */
  submitCount(payment_operation_id: string): number {
    return this.submitted.get(payment_operation_id)?.count ?? 0;
  }

  /** 断言辅助：provider 侧操作总数。 */
  operationCount(): number {
    return this.submitted.size;
  }
}
