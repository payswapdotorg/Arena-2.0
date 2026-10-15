/**
 * UIA-001 Lane C — 评审/裁决工位控制器（headless 可测状态机）。
 *
 * 两条操作通道（与 Lane B 相同的诚实分层）：
 * - decks 端口：deck 投影（今日 = demo 标注的 MockArenaClient.getReviewDeck
 *   —— buildReviewDeck 的冻结产物；真实 result 投影是记录在案的前沿）；
 * - commands 端口：escalation 级规范命令通道（真实绑定）——
 *   SubmitReviewerEvaluation / RequestRevision，类型化 409/404 逐字。
 * 审计轨迹 = 服务端 timeline（规范事件流；追加只读，绝不客户端合成）。
 */
import type { ReviewDeckOutcome, TimelineOutcome, CommandApiOutcome } from "@arena/workbench";
import type { TransitionCommand } from "@arena/contracts";
import { commandOutcomeText } from "../requester/viewModel.js";

export interface ReviewerPrincipal {
  tenant_id: string;
  user_id: string;
}

/** deck 投影端口（MockArenaClient.getReviewDeck 的结构子集）。 */
export interface ReviewDeckPort {
  /** 可评审的结果清单（今日 = demo 结果 id 清单，DEMO 标注）。 */
  reviewableResultIds(principal: ReviewerPrincipal): Promise<
    readonly { result_id: string; escalation_id: string; demo: boolean }[]
  >;
  getReviewDeck(
    result_id: string,
    principal: ReviewerPrincipal,
  ): Promise<ReviewDeckOutcome>;
}

/** escalation 级命令端口（RealWorkbenchBinding.command 的结构子集）。 */
export interface ReviewerCommandPort {
  command(
    escalation_id: string,
    command: TransitionCommand,
    facts: Record<string, boolean>,
  ): Promise<CommandApiOutcome>;
}

/** 服务端 timeline 端口（审计轨迹 —— 规范事件流）。 */
export interface AuditTrailPort {
  timeline(escalation_id: string, principal: ReviewerPrincipal): Promise<TimelineOutcome>;
}

export type AsyncState<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export interface ReviewerSnapshot {
  queue: AsyncState<readonly { result_id: string; escalation_id: string; demo: boolean }[]>;
  selectedResultId: string | null;
  deck: AsyncState<NonNullable<unknown>> | { kind: "empty" };
  deckView: ReviewDeckOutcome | null;
  auditTrail: AsyncState<readonly { event_type: string; occurred_at: string; actor: string }[]>;
  voteEscalationId: string;
  voteOutcome: string | null;
  voteBusy: boolean;
}

type Listener = () => void;

export class ReviewerController {
  private readonly decks: ReviewDeckPort;
  private readonly commands: ReviewerCommandPort;
  private readonly audit: AuditTrailPort;
  private readonly principal: ReviewerPrincipal;
  private readonly listeners = new Set<Listener>();
  private queueRows: readonly { result_id: string; escalation_id: string; demo: boolean }[] | null = null;
  private selected: string | null = null;
  private deckOutcome: ReviewDeckOutcome | null = null;
  private deckLoading = false;
  private trailOutcome: TimelineOutcome | null = null;
  private voteEscalationId = "";
  private voteOutcome: string | null = null;
  private voteBusy = false;

  constructor(deps: {
    decks: ReviewDeckPort;
    commands: ReviewerCommandPort;
    audit: AuditTrailPort;
    principal: ReviewerPrincipal;
  }) {
    this.decks = deps.decks;
    this.commands = deps.commands;
    this.audit = deps.audit;
    this.principal = deps.principal;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private cachedSnapshot: ReviewerSnapshot | null = null;

  snapshot(): ReviewerSnapshot {
    // useSyncExternalStore 契约：状态未变时必须返回同一引用（否则 React
    // 会判定 store 每次都变化 → 无限重渲 → Minified error #185）。
    if (this.cachedSnapshot !== null) return this.cachedSnapshot;
    this.cachedSnapshot = this.buildSnapshot();
    return this.cachedSnapshot;
  }

  private buildSnapshot(): ReviewerSnapshot {    const trail: ReviewerSnapshot["auditTrail"] =
      this.trailOutcome === null
        ? { kind: "loading" }
        : this.trailOutcome.kind === "FOUND"
          ? this.trailOutcome.events.length === 0
            ? { kind: "empty" }
            : { kind: "ready", data: this.trailOutcome.events }
          : this.trailOutcome.kind === "NOT_FOUND"
            ? {
                kind: "error",
                message: `${this.trailOutcome.envelope.code}: ${this.trailOutcome.envelope.message}`,
              }
            : this.trailOutcome.kind === "UNAUTHENTICATED"
              ? { kind: "error", message: "UNAUTHENTICATED — the server rejected the credentials" }
              : { kind: "error", message: `TRANSPORT_ERROR — ${this.trailOutcome.message}` };
    return {
      queue:
        this.queueRows === null
          ? { kind: "loading" }
          : this.queueRows.length === 0
            ? { kind: "empty" }
            : { kind: "ready", data: this.queueRows },
      selectedResultId: this.selected,
      deck: this.deckLoading
        ? { kind: "loading" }
        : this.deckOutcome === null
          ? { kind: "empty" }
          : { kind: "ready", data: {} },
      deckView: this.deckOutcome,
      auditTrail: trail,
      voteEscalationId: this.voteEscalationId,
      voteOutcome: this.voteOutcome,
      voteBusy: this.voteBusy,
    };
  }

  private emit(): void {
    this.cachedSnapshot = null;
    for (const listener of this.listeners) listener();
  }

  async loadQueue(): Promise<void> {
    this.queueRows = null;
    this.emit();
    this.queueRows = await this.decks.reviewableResultIds(this.principal);
    this.emit();
  }

  async selectResult(result_id: string): Promise<void> {
    this.selected = result_id;
    this.deckLoading = true;
    this.deckOutcome = null;
    this.trailOutcome = null;
    this.emit();
    this.deckOutcome = await this.decks.getReviewDeck(result_id, this.principal);
    this.deckLoading = false;
    const escalationId =
      this.deckOutcome.kind === "FOUND" ? this.deckOutcome.deck.escalation_id : null;
    if (escalationId !== null) {
      this.trailOutcome = await this.audit.timeline(escalationId, this.principal);
    }
    this.emit();
  }

  /** 直接加载某 escalation 的审计轨迹（REAL timeline —— 不经 deck 选择）。 */
  async loadAuditTrailFor(escalation_id: string): Promise<void> {
    this.trailOutcome = null;
    this.emit();
    this.trailOutcome = await this.audit.timeline(escalation_id, this.principal);
    this.emit();
  }

  setVoteEscalationId(value: string): void {
    this.voteEscalationId = value;
    this.emit();
  }

  /** 独立评审投票（escalation 级规范命令通道 —— 真实绑定；409/404 逐字）。 */
  async submitReviewVote(): Promise<void> {
    const escalationId = this.voteEscalationId.trim();
    if (escalationId.length === 0) {
      this.voteOutcome = "an escalation id is required to submit an independent review vote";
      this.emit();
      return;
    }
    this.voteBusy = true;
    this.emit();
    const outcome = await this.commands.command(escalationId, "SubmitReviewerEvaluation", {
      review_independent: true,
    });
    this.voteBusy = false;
    this.voteOutcome = commandOutcomeText(outcome);
    this.emit();
  }
}
