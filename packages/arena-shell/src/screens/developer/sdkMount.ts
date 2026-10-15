/**
 * UIA-003 — 开发者门户：SDK quickstart / MCP 门面 / 摘要挂接面（视图模型 + 控制器）。
 *
 * 冻结纪律：
 * - 屏层只声明 **结构化端口**（DeveloperSdkBinding）—— @arena/sdk 的真实
 *   运行面对象由组合根注入（真实实现 = sdkBinding.ts 的 realSdkBinding；
 *   类型从公开契约 type-only 导入）。之所以不直接 import 运行时桶：
 *   @arena/sdk 公开桶转出 webhook-receiver（node:http 值导入）与
 *   webhook-signer（createHmac）—— 浏览器组合根（web / a11y render host）
 *   未提供这些传输 shim，静态引入会破坏其打包。这与请求方屏的
 *   RequesterBindingPort 法完全同源（依赖注入、层内零硬编码端点）。
 * - quickstart 驱动 **真实 typed outcomes**（readiness / submit / lookup /
 *   timeline + 真实错误信封）—— 视图层绝不吞错、绝不合成成功。
 * - 示例信封 = 诚实标注的 EXAMPLE 材料：经冻结的 workbench builder
 *   （validateEscalationDraft）构造 —— 同一 CF1.0 契约，无第二套语义。
 */
import {
  DEMO_ACCEPTANCE_CRITERIA,
  validateEscalationDraft,
  type BuildContext,
  type EscalationDraft,
  type FieldError,
} from "@arena/workbench";
import type { EscalationRequest } from "@arena/contracts";
import type {
  McpToolDescriptor,
  QuickstartReport,
  SdkCredentials,
  SdkTimelineOutcome,
} from "@arena/sdk";

/** 组合根注入的主体（demo 形态来自 DEMO_PRINCIPAL_TOKENS 镜像）。 */
export interface DeveloperPrincipal {
  tenant_id: string;
  user_id: string;
}

/**
 * SDK 绑定端口（结构化 —— 真实实现见 sdkBinding.ts）：
 * baseUrl + 按 principal 解析凭据 + 真实 sdkQuickstart / timeline /
 * McpFacade 工具词表 / canonicalRequestDigest / 披露常量。
 */
export interface DeveloperSdkBinding {
  readonly baseUrl: string;
  credentialsFor(principal: DeveloperPrincipal): SdkCredentials | null;
  quickstart(request: EscalationRequest, auth: SdkCredentials): Promise<QuickstartReport>;
  timeline(escalation_id: string, auth: SdkCredentials): Promise<SdkTimelineOutcome>;
  toolDescriptors(): readonly McpToolDescriptor[];
  digest(request: EscalationRequest): string;
  readonly mcpServer: {
    readonly name: string;
    readonly version: string;
    readonly protocolVersion: string;
  };
  readonly disclosures: {
    readonly sdk: string;
    readonly testMode: string;
    readonly mcpFacade: string;
  };
}

/** 组合根未接线时的诚实披露（绝不伪造 SDK 表面）。 */
export const SDK_BINDING_UNWIRED_DISCLOSURE =
  "the SDK surface mounts through the registration's { binding, principal } options: this " +
  "composition root wired no SDK binding, so the quickstart / MCP facade / request digest render " +
  "as truthfully unwired — never a fabricated client, tool invocation, or digest";

/** 摘要语义（canonicalRequestDigest 的精确语义标注）。 */
export const REQUEST_DIGEST_SEMANTICS =
  "sha256 (hex) of the canonical request subset — exactly the fields below, in this canonical " +
  "JSON form — independent of the server-side idempotency digest (same key + same subset = replay; " +
  "the caller_idempotency_key itself is NOT part of the digest input)";

/** 摘要输入的规范字段（逐字 —— 真实函数的载荷子集）。 */
export const REQUEST_DIGEST_FIELDS = [
  "task",
  "task_type",
  "acceptance_criteria",
  "constraints",
  "budget",
] as const;

/** 示例信封的默认任务标题（EXAMPLE 材料 —— test-mode only）。 */
export const QUICKSTART_EXAMPLE_TITLE = "Verify pricing-rule edge table via SDK quickstart";

/** quickstart 示例草稿（EXAMPLE 标注；结构 = 冻结 EscalationDraft）。 */
export function quickstartExampleDraft(title: string): EscalationDraft {
  return {
    task: {
      title,
      outcome_description:
        "EXAMPLE material: the SDK quickstart submits this envelope through the real API edge " +
        "(test mode only) and renders the server's typed projections verbatim.",
    },
    task_type: { domain: "software-engineering", type_id: "typ_00000001", type_version: "1.0.0" },
    required_capabilities: [{ capability_id: "cap_00000001", minimum_level: "senior" }],
    required_qualifications: [],
    acceptance_criteria: DEMO_ACCEPTANCE_CRITERIA,
    proof_policy_preset: "demo_p1_rubric",
    constraints: {
      risk_tier: "MEDIUM",
      privacy_profile: "TENANT",
      retention_profile: "STANDARD",
      jurisdiction: null,
      professional_requirements: [],
      deadline: "2026-12-01T00:00:00Z",
      escalation_modes: ["next_expert", "budget_stop"],
    },
    budget: { limit_amount: 500, currency: "USD", allowed_attempts: 3, per_attempt_limit: null },
    input_artifacts: [],
    result_schema: { schema_id: "sch_00000001", schema_version: "1.0.0" },
    delivery_preferences: { channel: "poll", webhook_url: null },
  };
}

/** 示例信封构造上下文（客户端应用 + 幂等键 —— 与请求方舱同法）。 */
export function quickBuildContext(idempotencyKey: string): BuildContext {
  return { client_application_id: "app_00000001", caller_idempotency_key: idempotencyKey };
}

export type ExampleRequestBuild =
  | { ok: true; request: EscalationRequest }
  | { ok: false; fieldErrors: readonly FieldError[] };

/** 冻结 builder 构造示例信封（服务端仍是权威校验者）。 */
export function buildExampleRequest(
  title: string,
  idempotencyKey: string,
): ExampleRequestBuild {
  return validateEscalationDraft(quickstartExampleDraft(title), quickBuildContext(idempotencyKey));
}

/** quickstart 运行状态（真实 typed outcomes 原样上抛）。 */
export type QuickstartRunState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "unauthenticated" }
  | { kind: "ready"; report: QuickstartReport; timeline: SdkTimelineOutcome | null };

export interface DeveloperSnapshot {
  wiring: { kind: "unwired" } | { kind: "wired"; baseUrl: string; principal: DeveloperPrincipal };
  title: string;
  exampleKey: string;
  exampleRequest: EscalationRequest | null;
  exampleIssues: readonly FieldError[];
  digest: string | null;
  quickstart: QuickstartRunState;
}

type Listener = () => void;

/** 开发者门户控制器（useSyncExternalStore 契约：快照引用稳定）。 */
export class DeveloperController {
  private readonly binding: DeveloperSdkBinding | null;
  private readonly principal: DeveloperPrincipal | null;
  private readonly listeners = new Set<Listener>();
  private title = QUICKSTART_EXAMPLE_TITLE;
  private runCounter = 0;
  private exampleKey = "arena-shell-dev-quickstart-1";
  private runState: QuickstartRunState = { kind: "idle" };
  private cachedSnapshot: DeveloperSnapshot | null = null;

  constructor(deps: { binding: DeveloperSdkBinding | null; principal: DeveloperPrincipal | null }) {
    this.binding = deps.binding;
    this.principal = deps.principal;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): DeveloperSnapshot {
    if (this.cachedSnapshot !== null) return this.cachedSnapshot;
    this.cachedSnapshot = this.buildSnapshot();
    return this.cachedSnapshot;
  }

  private buildSnapshot(): DeveloperSnapshot {
    const build = buildExampleRequest(this.title, this.exampleKey);
    return {
      wiring:
        this.binding === null || this.principal === null
          ? { kind: "unwired" }
          : { kind: "wired", baseUrl: this.binding.baseUrl, principal: this.principal },
      title: this.title,
      exampleKey: this.exampleKey,
      exampleRequest: build.ok ? build.request : null,
      exampleIssues: build.ok ? [] : build.fieldErrors,
      digest: this.binding !== null && build.ok ? this.binding.digest(build.request) : null,
      quickstart: this.runState,
    };
  }

  private emit(): void {
    this.cachedSnapshot = null;
    for (const listener of this.listeners) listener();
  }

  /** 示例任务标题（摘要交互面 —— 标题变化即摘要变化）。 */
  setTitle(title: string): void {
    this.title = title;
    this.emit();
  }

  /** MCP 门面工具词表（只读枚举 —— 零工具调用）。 */
  mcpSurface(): { server: DeveloperSdkBinding["mcpServer"]; tools: readonly McpToolDescriptor[] } | null {
    if (this.binding === null) return null;
    return { server: this.binding.mcpServer, tools: this.binding.toolDescriptors() };
  }

  /** SDK 披露常量（经绑定从真实公开导出流转 —— 未接线时为 null）。 */
  disclosures(): DeveloperSdkBinding["disclosures"] | null {
    return this.binding !== null ? this.binding.disclosures : null;
  }

  /** 运行 quickstart（readiness → submit → 服务端投影 + timeline 投影）。 */
  async run(options?: { idempotencyKey?: string }): Promise<void> {
    if (this.binding === null || this.principal === null) return;
    const auth = this.binding.credentialsFor(this.principal);
    if (auth === null) {
      this.runState = { kind: "unauthenticated" };
      this.emit();
      return;
    }
    if (options?.idempotencyKey !== undefined) this.exampleKey = options.idempotencyKey;
    else {
      this.runCounter += 1;
      this.exampleKey = `arena-shell-dev-quickstart-${this.runCounter}`;
    }
    const build = buildExampleRequest(this.title, this.exampleKey);
    if (!build.ok) {
      this.emit();
      return;
    }
    this.runState = { kind: "running" };
    this.emit();
    const report = await this.binding.quickstart(build.request, auth);
    const escalationId =
      report.submit.kind === "CREATED" || report.submit.kind === "REPLAYED"
        ? report.submit.escalation_id
        : null;
    const timeline =
      escalationId === null ? null : await this.binding.timeline(escalationId, auth);
    this.runState = { kind: "ready", report, timeline };
    this.emit();
  }
}
