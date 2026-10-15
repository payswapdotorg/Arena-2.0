/**
 * UIA-001 Lane B — 专家工位控制器（headless 可测状态机）。
 *
 * 两条操作通道（诚实分层）：
 * - attempts 端口：attempt 级投影（队列/工作区/候选/自评/标准）—— 今天由
 *   demo 标注的 MockArenaClient 提供（真实 attempt 投影是记录在案的前沿）；
 * - commands 端口：escalation 级规范命令通道（真实绑定 command 路径）——
 *   SubmitIntervention，类型化 409/404 逐字上抛。
 * 控制器绝不读 lens/role（ROLE_IS_NOT_AUTHORIZATION —— 仅展示层）。
 */
import type {
  AttemptLookupOutcome,
  CandidateDraft,
  CandidateSubmitOutcome,
  CommandApiOutcome,
  SelfEvaluationSubmitOutcome,
} from "@arena/workbench";
import type { TransitionCommand } from "@arena/contracts";
import { commandOutcomeText } from "../requester/viewModel.js";

export interface ExpertPrincipal {
  tenant_id: string;
  user_id: string;
}

export interface AttemptSummaryRow {
  attempt_id: string;
  escalation_id: string;
  state: string;
  expert_id: string;
  budget_remaining: number;
  currency: string;
  candidates: number;
  demo: { demo: true; disclosure: string };
}

export interface CriterionRow {
  criterion_id: string;
  statement: string;
}

/** attempt 级端口（MockArenaClient 的结构子集）。 */
export interface ExpertAttemptPort {
  listAssignments(principal: ExpertPrincipal): Promise<readonly AttemptSummaryRow[]>;
  getAttempt(attempt_id: string, principal: ExpertPrincipal): Promise<AttemptLookupOutcome>;
  submitCandidate(
    attempt_id: string,
    draft: CandidateDraft,
    principal: ExpertPrincipal,
  ): Promise<CandidateSubmitOutcome>;
  submitSelfEvaluation(
    attempt_id: string,
    draft: {
      entries: {
        criterion_id: string;
        decision: "PASS" | "FAIL" | "INCONCLUSIVE" | "NOT_EVALUATED";
        evidence_ids: string[];
        rationale: string;
      }[];
    },
    principal: ExpertPrincipal,
  ): Promise<SelfEvaluationSubmitOutcome>;
  /** 选中 attempt 所属 escalation 的验收标准（自评表单的冻结驱动源）。 */
  escalationCriteria(
    escalation_id: string,
    principal: ExpertPrincipal,
  ): Promise<readonly CriterionRow[] | null>;
}

/** escalation 级命令端口（RealWorkbenchBinding.command 的结构子集）。 */
export interface ExpertCommandPort {
  command(
    escalation_id: string,
    command: TransitionCommand,
    facts: Record<string, boolean>,
  ): Promise<CommandApiOutcome>;
}

export type AsyncState<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export interface SelfEvalEntryState {
  decision: "PASS" | "FAIL" | "INCONCLUSIVE" | "NOT_EVALUATED";
  rationale: string;
  evidenceIds: string;
}

export interface QueueRowView {
  attempt_id: string;
  escalation_id: string;
  state: string;
  expert_id: string;
  budget_remaining: number;
  currency: string;
  candidates: number;
  demo: boolean;
}

export interface AttemptDetailView {
  attempt_id: string;
  escalation_id: string;
  status: string;
  budget: { remaining_amount: number; currency: string };
  candidates: number;
}

export interface ExpertSnapshot {
  queue: AsyncState<readonly QueueRowView[]>;
  selectedAttemptId: string | null;
  attempt: AsyncState<AttemptDetailView>;
  criteria: readonly CriterionRow[];
  manifestValue: string;
  notesValue: string;
  candidateErrors: readonly { field: string; rule: string }[];
  candidateOutcome: string | null;
  selfEvalEntries: Record<string, SelfEvalEntryState>;
  selfEvalErrors: readonly { field: string; rule: string }[];
  selfEvalOutcome: string | null;
  interventionEscalationId: string;
  interventionOutcome: string | null;
  commandBusy: boolean;
}

type Listener = () => void;

export class ExpertController {
  private readonly attempts: ExpertAttemptPort;
  private readonly commands: ExpertCommandPort;
  private readonly principal: ExpertPrincipal;
  private readonly listeners = new Set<Listener>();
  private queueRows: readonly AttemptSummaryRow[] | null = null;
  private selected: string | null = null;
  private attemptDetail: Awaited<ReturnType<ExpertAttemptPort["getAttempt"]>> | null = null;
  private criteria: readonly CriterionRow[] = [];
  private manifest = "";
  private notes = "";
  private candidateErrors: readonly { field: string; rule: string }[] = [];
  private candidateOutcome: string | null = null;
  private selfEvalEntries: Record<string, SelfEvalEntryState> = {};
  private selfEvalErrors: readonly { field: string; rule: string }[] = [];
  private selfEvalOutcome: string | null = null;
  private interventionEscalationId = "";
  private interventionOutcome: string | null = null;
  private commandBusy = false;

  constructor(deps: {
    attempts: ExpertAttemptPort;
    commands: ExpertCommandPort;
    principal: ExpertPrincipal;
  }) {
    this.attempts = deps.attempts;
    this.commands = deps.commands;
    this.principal = deps.principal;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private cachedSnapshot: ExpertSnapshot | null = null;

  snapshot(): ExpertSnapshot {
    // useSyncExternalStore 契约：状态未变时必须返回同一引用（否则 React
    // 会判定 store 每次都变化 → 无限重渲 → Minified error #185）。
    if (this.cachedSnapshot !== null) return this.cachedSnapshot;
    this.cachedSnapshot = this.buildSnapshot();
    return this.cachedSnapshot;
  }

  private buildSnapshot(): ExpertSnapshot {    return {
      queue: this.queueViewModel(),
      selectedAttemptId: this.selected,
      attempt: this.attemptViewModel(),
      criteria: this.criteria,
      manifestValue: this.manifest,
      notesValue: this.notes,
      candidateErrors: this.candidateErrors,
      candidateOutcome: this.candidateOutcome,
      selfEvalEntries: this.selfEvalEntries,
      selfEvalErrors: this.selfEvalErrors,
      selfEvalOutcome: this.selfEvalOutcome,
      interventionEscalationId: this.interventionEscalationId,
      interventionOutcome: this.interventionOutcome,
      commandBusy: this.commandBusy,
    };
  }

  private queueViewModel(): ExpertSnapshot["queue"] {
    if (this.queueRows === null) return { kind: "loading" };
    if (this.queueRows.length === 0) return { kind: "empty" };
    return {
      kind: "ready",
      data: this.queueRows.map((row) => ({
        attempt_id: row.attempt_id,
        escalation_id: row.escalation_id,
        state: row.state,
        expert_id: row.expert_id,
        budget_remaining: row.budget_remaining,
        currency: row.currency,
        candidates: row.candidates,
        demo: row.demo.demo === true,
      })),
    };
  }

  private attemptViewModel(): ExpertSnapshot["attempt"] {
    if (this.selected === null) return { kind: "empty" };
    if (this.attemptDetail === null) return { kind: "loading" };
    if (this.attemptDetail.kind === "NOT_FOUND") {
      return {
        kind: "error",
        message:
          "NOT_FOUND — the attempt does not exist for this principal (indistinguishable from another tenant's)",
      };
    }
    const attempt = this.attemptDetail.attempt;
    return {
      kind: "ready",
      data: {
        attempt_id: attempt.attempt_id,
        escalation_id: attempt.escalation_id,
        status: attempt.status,
        budget: {
          remaining_amount: attempt.budget.remaining_amount,
          currency: attempt.budget.currency,
        },
        candidates: attempt.candidates.length,
      },
    };
  }

  private emit(): void {
    this.cachedSnapshot = null;
    for (const listener of this.listeners) listener();
  }

  async loadQueue(): Promise<void> {
    this.queueRows = null;
    this.emit();
    this.queueRows = await this.attempts.listAssignments(this.principal);
    this.emit();
  }

  async selectAttempt(attempt_id: string): Promise<void> {
    this.selected = attempt_id;
    this.attemptDetail = null;
    this.candidateErrors = [];
    this.candidateOutcome = null;
    this.selfEvalErrors = [];
    this.selfEvalOutcome = null;
    this.emit();
    this.attemptDetail = await this.attempts.getAttempt(attempt_id, this.principal);
    if (this.attemptDetail.kind === "FOUND") {
      const escalationId = this.attemptDetail.attempt.escalation_id;
      this.criteria =
        (await this.attempts.escalationCriteria(escalationId, this.principal)) ?? [];
      this.selfEvalEntries = {};
      for (const criterion of this.criteria) {
        this.selfEvalEntries[criterion.criterion_id] = {
          decision: "NOT_EVALUATED",
          rationale: "",
          evidenceIds: "",
        };
      }
    }
    this.emit();
  }

  setManifest(value: string): void {
    this.manifest = value;
    this.emit();
  }

  setNotes(value: string): void {
    this.notes = value;
    this.emit();
  }

  setSelfEvalEntry(criterionId: string, patch: Partial<SelfEvalEntryState>): void {
    const current = this.selfEvalEntries[criterionId];
    if (current === undefined) return;
    this.selfEvalEntries = {
      ...this.selfEvalEntries,
      [criterionId]: { ...current, ...patch },
    };
    this.emit();
  }

  /** 候选提交（attempt 级 —— 冻结 attempt 状态机；失败逐字）。 */
  async submitCandidate(): Promise<void> {
    if (this.selected === null) return;
    const outcome = await this.attempts.submitCandidate(
      this.selected,
      { artifact_manifest: this.manifest, submission_notes: this.notes },
      this.principal,
    );
    this.applyCandidateOutcome(outcome);
    await this.refreshAttempt();
  }

  private applyCandidateOutcome(outcome: CandidateSubmitOutcome): void {
    if (outcome.kind === "REJECTED") {
      this.candidateErrors = outcome.fieldErrors;
      this.candidateOutcome = "REJECTED — see field errors (typed, verbatim)";
      return;
    }
    this.candidateErrors = [];
    if (outcome.kind === "SUBMITTED") {
      this.candidateOutcome = `SUBMITTED candidate v${outcome.candidate_version} — attempt state ${outcome.state}`;
    } else if (outcome.kind === "INVALID_TRANSITION") {
      this.candidateOutcome = `INVALID_TRANSITION ${outcome.code} (failed guards: ${outcome.failed_guards.join(", ")})`;
    } else if (outcome.kind === "NOT_FOUND") {
      this.candidateOutcome = "NOT_FOUND — the attempt does not exist for this principal";
    }
  }

  /** 结构化自评提交（attempt 级；可见证据、永不投票；全覆盖由冻结校验器裁决）。 */
  async submitSelfEvaluation(): Promise<void> {
    if (this.selected === null) return;
    const entries = this.criteria.map((criterion) => {
      const state = this.selfEvalEntries[criterion.criterion_id];
      return {
        criterion_id: criterion.criterion_id,
        decision: state?.decision ?? "NOT_EVALUATED",
        evidence_ids: (state?.evidenceIds ?? "")
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
        rationale: state?.rationale ?? "",
      };
    });
    const outcome = await this.attempts.submitSelfEvaluation(this.selected, { entries }, this.principal);
    this.applySelfEvalOutcome(outcome);
    await this.refreshAttempt();
  }

  private applySelfEvalOutcome(outcome: SelfEvaluationSubmitOutcome): void {
    if (outcome.kind === "REJECTED") {
      this.selfEvalErrors = outcome.fieldErrors;
      this.selfEvalOutcome = "REJECTED — see field errors (typed, verbatim)";
      return;
    }
    this.selfEvalErrors = [];
    if (outcome.kind === "SUBMITTED") {
      this.selfEvalOutcome = `SUBMITTED self-evaluation — attempt state ${outcome.state} (never an independent vote)`;
    } else if (outcome.kind === "INVALID_TRANSITION") {
      this.selfEvalOutcome = `INVALID_TRANSITION ${outcome.code} (failed guards: ${outcome.failed_guards.join(", ")})`;
    } else if (outcome.kind === "NOT_FOUND") {
      this.selfEvalOutcome = "NOT_FOUND — the attempt does not exist for this principal";
    }
  }

  private async refreshAttempt(): Promise<void> {
    if (this.selected === null) return;
    this.attemptDetail = await this.attempts.getAttempt(this.selected, this.principal);
    this.emit();
  }

  setInterventionEscalationId(value: string): void {
    this.interventionEscalationId = value;
    this.emit();
  }

  /** 提交介入（escalation 级规范命令通道 —— 真实绑定路径；409/404 逐字）。 */
  async submitIntervention(): Promise<void> {
    const escalationId = this.interventionEscalationId.trim();
    if (escalationId.length === 0) {
      this.interventionOutcome = "an escalation id is required to submit an intervention";
      this.emit();
      return;
    }
    this.commandBusy = true;
    this.emit();
    const outcome = await this.commands.command(escalationId, "SubmitIntervention", {
      candidate_version_immutable: true,
      artifact_manifest_present: true,
    });
    this.commandBusy = false;
    this.interventionOutcome = commandOutcomeText(outcome);
    this.emit();
  }
}
