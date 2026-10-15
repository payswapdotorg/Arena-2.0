/**
 * UIA-001 Lane B — 请求方屏状态视图模型（spec §1.1 提交-追踪-检验主循环）。
 *
 * 冻结纪律：
 * - 状态源 = 服务端投影（binding.tracking/timeline/resultView）——
 *   视图层绝不持有/推导生命周期（NO_UI_ONLY_LIFECYCLE）；
 * - 一切类型化失败（FieldError / ArenaErrorEnvelope / CommandApiOutcome）
 *   逐字渲染，绝不软化；
 * - SLA/时钟显示只来自服务端时间戳（updated_at / occurred_at）。
 */
import type {
  CommandApiOutcome,
  ResultViewOutcome,
  SubmitFlowOutcome,
  TimelineEvent,
  TimelineOutcome,
  TrackingRow,
} from "@arena/workbench";

/** 异步面的四态（加载/就绪/空/错误 —— 诚实覆盖法）。 */
export type AsyncViewModel<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export function trackingViewModel(rows: readonly TrackingRow[] | null): AsyncViewModel<readonly TrackingRow[]> {
  if (rows === null) return { kind: "loading" };
  if (rows.length === 0) return { kind: "empty" };
  return { kind: "ready", data: rows };
}

/** timeline 视图（事件的服务端时间戳逐字）。 */
export function timelineViewModel(
  outcome: TimelineOutcome | null,
): AsyncViewModel<readonly TimelineEvent[]> {
  if (outcome === null) return { kind: "loading" };
  if (outcome.kind === "FOUND" && outcome.events.length === 0) return { kind: "empty" };
  if (outcome.kind === "FOUND") return { kind: "ready", data: outcome.events };
  if (outcome.kind === "NOT_FOUND") {
    return { kind: "error", message: `${outcome.envelope.code}: ${outcome.envelope.message}` };
  }
  if (outcome.kind === "UNAUTHENTICATED") {
    return { kind: "error", message: "UNAUTHENTICATED — the server rejected the credentials" };
  }
  return { kind: "error", message: `TRANSPORT_ERROR — ${outcome.message}` };
}

/** 结果视图（typed stub 的诚实披露逐字 —— legible「随 AR2-007 落地」）。 */
export interface ResultViewModel {
  kind: "not_available" | "not_found" | "error" | "loading";
  message: string;
  disclosure: string | null;
}

export function resultViewModel(outcome: ResultViewOutcome | null): ResultViewModel {
  if (outcome === null) return { kind: "loading", message: "loading…", disclosure: null };
  if (outcome.kind === "NOT_AVAILABLE") {
    return { kind: "not_available", message: `${outcome.envelope.code}: ${outcome.envelope.message}`, disclosure: outcome.disclosure };
  }
  if (outcome.kind === "NOT_FOUND") {
    return { kind: "not_found", message: `${outcome.envelope.code}: ${outcome.envelope.message}`, disclosure: null };
  }
  if (outcome.kind === "UNAUTHENTICATED") {
    return { kind: "error", message: "UNAUTHENTICATED — the server rejected the credentials", disclosure: null };
  }
  return { kind: "error", message: `TRANSPORT_ERROR — ${outcome.message}`, disclosure: null };
}

/** 提交流程结果视图（六型逐字 —— REJECTED 的分字段错误交给 FieldErrorList）。 */
export type SubmitOutcomeViewModel =
  | { kind: "SUBMITTED"; escalation_id: string; status: string; replayed: boolean }
  | { kind: "REJECTED"; fieldRules: readonly string[] }
  | { kind: "CONFLICT"; message: string }
  | { kind: "UNAUTHENTICATED"; message: string }
  | { kind: "TRANSPORT_ERROR"; message: string }
  | { kind: "NONE" };

export const NO_SUBMISSION_YET: SubmitOutcomeViewModel = { kind: "NONE" };

export function submitOutcomeViewModel(outcome: SubmitFlowOutcome): SubmitOutcomeViewModel {
  switch (outcome.kind) {
    case "SUBMITTED":
      return {
        kind: "SUBMITTED",
        escalation_id: outcome.escalation_id,
        status: outcome.status,
        replayed: outcome.replayed,
      };
    case "REJECTED":
      return { kind: "REJECTED", fieldRules: outcome.fieldErrors.map((e) => `${e.field}: ${e.rule}`) };
    case "CONFLICT":
      return { kind: "CONFLICT", message: outcome.message };
    case "UNAUTHENTICATED":
      return { kind: "UNAUTHENTICATED", message: "UNAUTHENTICATED — the server rejected the credentials" };
    case "TRANSPORT_ERROR":
      return { kind: "TRANSPORT_ERROR", message: outcome.message };
  }
}

/** 专家命令结果的逐字渲染助手（Lane B 内：提交路径上的命令态展示）。 */
export function commandOutcomeText(outcome: CommandApiOutcome): string {
  switch (outcome.kind) {
    case "ACCEPTED":
      return `ACCEPTED ${outcome.aggregate_id} ${outcome.from} -> ${outcome.to} (v${outcome.version})`;
    case "INVALID_TRANSITION":
      return `INVALID_TRANSITION ${outcome.envelope.code}: ${outcome.envelope.message}`;
    case "INVARIANT_VIOLATION":
      return `INVARIANT_VIOLATION ${outcome.envelope.code}: ${outcome.envelope.message} (failed guards: ${outcome.failed_guards.join(", ")})`;
    case "NOT_FOUND":
      return `NOT_FOUND ${outcome.envelope.code}: ${outcome.envelope.message}`;
    case "UNKNOWN_COMMAND":
      return "UNKNOWN_COMMAND — the server does not recognize this command";
    case "UNAUTHENTICATED":
      return "UNAUTHENTICATED — the server rejected the credentials";
    case "TRANSPORT_ERROR":
      return `TRANSPORT_ERROR — ${outcome.message}`;
  }
}
