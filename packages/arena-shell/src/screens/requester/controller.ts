/**
 * UIA-001 Lane B — 请求方屏控制器（headless 可测的状态机）。
 *
 * 架构：React 组件只是薄胶水（useSyncExternalStore）；全部状态迁移在
 * 这个控制器里 —— 测试无需 DOM 即可驱动 加载→就绪→提交→选检 的
 * 完整流。数据一律经注入的 binding 端口（RealWorkbenchBinding 的
 * 结构子集）；控制器绝不读 lens/role（ROLE_IS_NOT_AUTHORIZATION ——
 * lens 只到展示层）。
 */
import type {
  EscalationDraft,
  SubmitFlowOutcome,
  TimelineEvent,
  TimelineOutcome,
  TrackingRow,
} from "@arena/workbench";
import type { BuildContext } from "@arena/workbench";
import { buildContext, buildDraft, quickValidate, type RequesterFormState } from "./formModel.js";
import { initialFormState } from "./formModel.js";
import {
  NO_SUBMISSION_YET,
  resultViewModel,
  submitOutcomeViewModel,
  timelineViewModel,
  trackingViewModel,
  type AsyncViewModel,
  type ResultViewModel,
  type SubmitOutcomeViewModel,
} from "./viewModel.js";
import type { ResultViewOutcome } from "@arena/workbench";

/** 绑定端口（RealWorkbenchBinding 的结构子集 —— 测试注入假件）。 */
export interface RequesterBindingPort {
  submitDraft(
    draft: EscalationDraft,
    context: BuildContext,
    principal: { tenant_id: string; user_id: string },
  ): Promise<SubmitFlowOutcome>;
  tracking(
    principal: { tenant_id: string; user_id: string },
    titleEcho?: ReadonlyMap<string, string>,
  ): Promise<readonly TrackingRow[] | null>;
  timeline(
    escalation_id: string,
    principal: { tenant_id: string; user_id: string },
  ): Promise<TimelineOutcome>;
  resultView(
    escalation_id: string,
    principal: { tenant_id: string; user_id: string },
  ): Promise<ResultViewOutcome | null>;
}

export interface RequesterSnapshot {
  form: RequesterFormState;
  fieldErrors: readonly { field: string; rule: string }[];
  tracking: AsyncViewModel<readonly TrackingRow[]>;
  timeline: AsyncViewModel<readonly TimelineEvent[]>;
  result: ResultViewModel;
  selectedEscalation: string | null;
  submitting: boolean;
  submitOutcome: SubmitOutcomeViewModel;
  statusMessage: string;
}

type Listener = () => void;

export class RequesterController {
  private readonly binding: RequesterBindingPort;
  private readonly principal: { tenant_id: string; user_id: string };
  private readonly listeners = new Set<Listener>();
  private form: RequesterFormState = initialFormState();
  private fieldErrors: readonly { field: string; rule: string }[] = [];
  private trackingRows: readonly TrackingRow[] | null = null;
  private timelineOutcome: TimelineOutcome | null = null;
  private resultOutcome: ResultViewOutcome | null = null;
  private selected: string | null = null;
  private submitting = false;
  private submitOutcome: SubmitOutcomeViewModel = NO_SUBMISSION_YET;
  private statusMessage = "";
  private titleEcho = new Map<string, string>();
  private submissionCounter = 0;

  constructor(deps: { binding: RequesterBindingPort; principal: { tenant_id: string; user_id: string } }) {
    this.binding = deps.binding;
    this.principal = deps.principal;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private cachedSnapshot: RequesterSnapshot | null = null;

  snapshot(): RequesterSnapshot {
    // useSyncExternalStore 契约：状态未变时必须返回同一引用（否则 React
    // 会判定 store 每次都变化 → 无限重渲 → Minified error #185）。
    if (this.cachedSnapshot !== null) return this.cachedSnapshot;
    this.cachedSnapshot = this.buildSnapshot();
    return this.cachedSnapshot;
  }

  private buildSnapshot(): RequesterSnapshot {    return {
      form: this.form,
      fieldErrors: this.fieldErrors,
      tracking: trackingViewModel(this.trackingRows),
      timeline: timelineViewModel(this.timelineOutcome),
      result: resultViewModel(this.resultOutcome),
      selectedEscalation: this.selected,
      submitting: this.submitting,
      submitOutcome: this.submitOutcome,
      statusMessage: this.statusMessage,
    };
  }

  private emit(): void {
    this.cachedSnapshot = null;
    for (const listener of this.listeners) listener();
  }

  setForm(patch: Partial<RequesterFormState>): void {
    this.form = { ...this.form, ...patch };
    this.emit();
  }

  toggleEscalationMode(mode: RequesterFormState["escalationModes"][number]): void {
    const modes = this.form.escalationModes.includes(mode)
      ? this.form.escalationModes.filter((m) => m !== mode)
      : [...this.form.escalationModes, mode];
    this.setForm({ escalationModes: modes });
  }

  /** 加载追踪（服务端投影 —— 状态绝不由 UI 持有）。 */
  async loadTracking(): Promise<void> {
    this.trackingRows = null;
    this.emit();
    const rows = await this.binding.tracking(this.principal, this.titleEcho);
    this.trackingRows = rows;
    this.emit();
  }

  /** 提交（表单 fail-fast → 服务端权威校验；结果六型逐字入视图）。 */
  async submit(): Promise<void> {
    this.submissionCounter += 1;
    const context = buildContext(`arena-shell-requester-${this.submissionCounter}`);
    const quick = quickValidate(this.form, context);
    if (!quick.ok) {
      this.fieldErrors = quick.fieldErrors;
      this.submitOutcome = { kind: "REJECTED", fieldRules: quick.fieldErrors.map((e) => `${e.field}: ${e.rule}`) };
      this.statusMessage = "submission blocked by form validation";
      this.emit();
      return;
    }
    this.fieldErrors = [];
    this.submitting = true;
    this.statusMessage = "submitting…";
    this.emit();
    const outcome = await this.binding.submitDraft(buildDraft(this.form), context, this.principal);
    this.submitting = false;
    this.submitOutcome = submitOutcomeViewModel(outcome);
    if (outcome.kind === "SUBMITTED") {
      this.titleEcho.set(outcome.escalation_id, this.form.title);
      this.statusMessage = `submitted ${outcome.escalation_id} (status ${outcome.status}${outcome.replayed ? ", idempotent replay" : ""})`;
      await this.loadTracking();
      this.selected = outcome.escalation_id;
      await this.loadInspection();
      return;
    }
    if (outcome.kind === "REJECTED") this.fieldErrors = outcome.fieldErrors;
    this.statusMessage = `submission outcome: ${outcome.kind}`;
    this.emit();
  }

  /** 选检（timeline + result —— 服务端规范事件流与 typed stub）。 */
  async selectEscalation(escalation_id: string): Promise<void> {
    this.selected = escalation_id;
    this.emit();
    await this.loadInspection();
  }

  private async loadInspection(): Promise<void> {
    if (this.selected === null) return;
    const [timeline, result] = await Promise.all([
      this.binding.timeline(this.selected, this.principal),
      this.binding.resultView(this.selected, this.principal),
    ]);
    this.timelineOutcome = timeline;
    this.resultOutcome = result;
    this.emit();
  }
}
