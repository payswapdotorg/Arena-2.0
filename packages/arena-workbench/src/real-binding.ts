import type { TransitionCommand } from "@arena/contracts";
import type { FieldError } from "./requester-form.js";
import {
  validateEscalationDraft,
  type BuildContext,
  type EscalationDraft,
} from "./requester-form.js";
import {
  ArenaApiClient,
  type ApiCredentials,
  type CommandApiOutcome,
  type EscalationListItem,
  type SubmitApiOutcome,
  type TimelineOutcome,
} from "./api-client.js";
import type { WorkbenchPrincipal } from "./mock-client.js";

/**
 * AR2-006 — Workbench ↔ 真实 API 组合绑定（issue #8）。
 *
 * - 服务端投影是唯一规范状态源：tracking/状态/时间线全部来自
 *   GET /v1/escalations*（NO_UIONLY_LIFECYCLE）；客户端不持有、不推导
 *   任何生命周期状态。
 * - ROLE_IS_NOT_AUTHORIZATION_RULE：绑定只按 principal 解析凭据；
 *   lens/role 从不进入请求路径 —— 切换镜头不改变任何可见能力。
 * - 提交路径：draft 先过冻结表单校验（fail-fast 分字段错误），
 *   再经真实 API（服务端才是权威校验者）；幂等键来自信封。
 * - 命令路径：RespondToClarification / SubmitIntervention /
 *   SubmitSelfEvaluation / SubmitReviewerEvaluation / RequestRevision /
 *   SubmitAppeal —— 全部走服务端冻结状态机；类型化失败（409/404）
 *   原样上抛给视图层（legible failures）。
 * - 凭据映射 = 披露的 demo 注册表镜像（与 arena-api DEMO_PRINCIPALS
 *   一一对应）；生产认证适配器替换 token 来源，契约不变。
 */

export const REAL_BINDING_DISCLOSURE =
  "AR2-006 real binding: canonical lifecycle state comes exclusively from the Arena API " +
  "(projections + frozen state-machine commands); the demo token registry mirrors the API's " +
  "DEMO_PRINCIPALS and is replaced by the production auth adapter without contract change";

export interface PrincipalCredentials {
  principal: WorkbenchPrincipal;
  bearerToken: string;
}

/** 与 arena-api/src/auth.ts 的 DEMO_PRINCIPALS 对齐的镜像（demo 形态）。 */
export const DEMO_PRINCIPAL_TOKENS: readonly PrincipalCredentials[] = [
  {
    principal: { tenant_id: "tnt_00000001", user_id: "usr_00000001" },
    bearerToken: "demo-token-requester-alpha",
  },
  {
    principal: { tenant_id: "tnt_00000002", user_id: "usr_00000002" },
    bearerToken: "demo-token-requester-beta",
  },
  {
    principal: { tenant_id: "tnt_00000001", user_id: "usr_00000003" },
    bearerToken: "demo-token-expert-omega",
  },
];

/** 追踪行视图模型：全部字段来自服务端投影（title 为提交回显，非状态）。 */
export interface TrackingRow {
  escalation_id: string;
  state: string;
  updated_at: string;
  title: string;
}

export type SubmitFlowOutcome =
  | { kind: "SUBMITTED"; escalation_id: string; status: string; version: number; replayed: boolean }
  | { kind: "REJECTED"; fieldErrors: FieldError[] }
  | { kind: "CONFLICT"; message: string }
  | { kind: "UNAUTHENTICATED" }
  | { kind: "TRANSPORT_ERROR"; message: string };

export class RealWorkbenchBinding {
  readonly api: ArenaApiClient;
  private readonly credentials: ReadonlyMap<string, ApiCredentials>;

  constructor(options: {
    baseUrl: string;
    principals?: readonly PrincipalCredentials[];
    fetchImpl?: typeof fetch;
  }) {
    this.api = new ArenaApiClient({ baseUrl: options.baseUrl, fetchImpl: options.fetchImpl });
    const registry = options.principals ?? DEMO_PRINCIPAL_TOKENS;
    this.credentials = new Map(
      registry.map((entry) => [
        credentialsKey(entry.principal),
        { bearerToken: entry.bearerToken },
      ]),
    );
  }

  /** 提交流程：表单校验（快速失败）→ 真实 API（权威校验 + 幂等）。 */
  async submitDraft(
    draft: EscalationDraft,
    context: BuildContext,
    principal: WorkbenchPrincipal,
  ): Promise<SubmitFlowOutcome> {
    const validation = validateEscalationDraft(draft, context);
    if (!validation.ok) {
      return { kind: "REJECTED", fieldErrors: validation.fieldErrors };
    }
    const auth = this.credentialsFor(principal);
    if (auth === null) return { kind: "UNAUTHENTICATED" };
    const outcome: SubmitApiOutcome = await this.api.submitEscalation(validation.request, auth);
    switch (outcome.kind) {
      case "CREATED":
        return {
          kind: "SUBMITTED",
          escalation_id: outcome.escalation_id,
          status: outcome.status,
          version: outcome.version,
          replayed: false,
        };
      case "REPLAYED":
        return {
          kind: "SUBMITTED",
          escalation_id: outcome.escalation_id,
          status: outcome.status,
          version: outcome.version,
          replayed: true,
        };
      case "REJECTED":
        return { kind: "REJECTED", fieldErrors: outcome.fieldErrors };
      case "CONFLICT":
        return { kind: "CONFLICT", message: outcome.message };
      case "UNAUTHENTICATED":
        return { kind: "UNAUTHENTICATED" };
      case "TRANSPORT_ERROR":
        return { kind: "TRANSPORT_ERROR", message: outcome.message };
    }
  }

  /** 追踪列表（服务端投影 + 提交时的标题回显 —— 状态字段绝不由 UI 持有）。 */
  async tracking(
    principal: WorkbenchPrincipal,
    titleEcho: ReadonlyMap<string, string> = new Map(),
  ): Promise<readonly TrackingRow[] | null> {
    const auth = this.credentialsFor(principal);
    if (auth === null) return null;
    const listed = await this.api.listEscalations(auth);
    if (listed === null) return null;
    return listed.items.map((item: EscalationListItem) => ({
      escalation_id: item.escalation_id,
      state: item.status,
      updated_at: item.updated_at,
      title: titleEcho.get(item.escalation_id) ?? "",
    }));
  }

  /** 状态/证据时间线（规范事件流 = 服务端 timeline）。 */
  async timeline(escalation_id: string, principal: WorkbenchPrincipal): Promise<TimelineOutcome> {
    const auth = this.credentialsFor(principal);
    if (auth === null) {
      return { kind: "UNAUTHENTICATED" } as const;
    }
    return this.api.getTimeline(escalation_id, auth);
  }

  /**
   * 生命周期命令（唯一的服务端状态推进通道）：
   * RespondToClarification / SubmitIntervention / SubmitSelfEvaluation /
   * SubmitReviewerEvaluation / RequestRevision / SubmitAppeal / …
   * 守卫事实由调用方按命令语义构造（demo 形态 —— 生产事实由服务端派生）。
   */
  async command(
    escalation_id: string,
    command: TransitionCommand,
    facts: Record<string, boolean>,
    principal: WorkbenchPrincipal,
  ): Promise<CommandApiOutcome> {
    const auth = this.credentialsFor(principal);
    if (auth === null) {
      return { kind: "UNAUTHENTICATED" } as const;
    }
    return this.api.escalationCommand(escalation_id, command, facts, auth);
  }

  /** 结果视图（服务端 typed stub —— legible「随 AR2-007 落地」披露）。 */
  async resultView(escalation_id: string, principal: WorkbenchPrincipal) {
    const auth = this.credentialsFor(principal);
    if (auth === null) return null;
    return this.api.getResultView(escalation_id, auth);
  }

  private credentialsFor(principal: WorkbenchPrincipal): ApiCredentials | null {
    return this.credentials.get(credentialsKey(principal)) ?? null;
  }
}

function credentialsKey(principal: WorkbenchPrincipal): string {
  return `${principal.tenant_id}/${principal.user_id}`;
}
