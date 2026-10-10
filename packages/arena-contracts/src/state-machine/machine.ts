import { z } from "zod";
import { commandNameSchema, systemCommandNameSchema } from "../idempotency.js";

/**
 * A11 支撑 — 状态机通用引擎（纯函数，无 IO）。
 * 每个受管状态机声明：状态枚举、初始态、终态、迁移表（含守卫）、
 * 每个状态的进入/出口文档。B4 完备性由 reachableStates + 文档共同保证。
 */

export const transitionCommandSchema = commandNameSchema.or(systemCommandNameSchema);

export type TransitionCommand = z.infer<typeof transitionCommandSchema>;

export type GuardId = string;

export interface TransitionRule<S extends string> {
  from: S;
  to: S;
  command: TransitionCommand;
  /** 全部守卫都必须为真（AND 语义）；OR 语义通过组合守卫事实表达并记录在不变量注册表。 */
  guards: readonly GuardId[];
}

export interface StateDoc {
  entry: string;
  exit: string;
}

export interface StateMachineDefinition<S extends string> {
  id: string;
  initial: S;
  states: readonly S[];
  terminals: readonly S[];
  transitions: readonly TransitionRule<S>[];
  state_docs: Record<S, StateDoc>;
}

export type GuardFacts = Record<GuardId, boolean>;

export type TransitionEvaluation<S extends string> =
  | { ok: true; to: S; matched: TransitionRule<S> }
  | {
      ok: false;
      code: "ARENA_INVALID_TRANSITION" | "ARENA_INVARIANT_VIOLATION";
      failed_guards: GuardId[];
      rule?: TransitionRule<S>;
    };

/** 求值一次迁移：找到 from+command 的唯一规则后核对守卫事实。 */
export function evaluateTransition<S extends string>(
  def: StateMachineDefinition<S>,
  from: S,
  command: TransitionCommand,
  facts: GuardFacts,
): TransitionEvaluation<S> {
  const candidates = def.transitions.filter((t) => t.from === from && t.command === command);
  if (candidates.length === 0) {
    return { ok: false, code: "ARENA_INVALID_TRANSITION", failed_guards: [] };
  }
  const failures: Array<{ rule: TransitionRule<S>; failed: GuardId[] }> = [];
  for (const rule of candidates) {
    const failed = rule.guards.filter((g) => facts[g] !== true);
    if (failed.length === 0) return { ok: true, to: rule.to, matched: rule };
    failures.push({ rule, failed });
  }
  // 同一 (from, command) 存在多条规则时（如按守卫分流），返回第一条的失败守卫。
  const first = failures[0];
  if (first === undefined) {
    return { ok: false, code: "ARENA_INVALID_TRANSITION", failed_guards: [] };
  }
  return {
    ok: false,
    code: "ARENA_INVARIANT_VIOLATION",
    failed_guards: first.failed,
    rule: first.rule,
  };
}

/** B4：从初始态 BFS 求可达状态集。 */
export function reachableStates<S extends string>(def: StateMachineDefinition<S>): Set<S> {
  const reached = new Set<S>([def.initial]);
  let frontier: S[] = [def.initial];
  while (frontier.length > 0) {
    const next: S[] = [];
    for (const state of frontier) {
      for (const rule of def.transitions) {
        if (rule.from === state && !reached.has(rule.to)) {
          reached.add(rule.to);
          next.push(rule.to);
        }
      }
    }
    frontier = next;
  }
  return reached;
}

/** B4：无孤儿状态 —— 每个状态可达、有文档、或有入边；每个非终态有出边。 */
export interface CompletenessIssue {
  state: string;
  rule: string;
}

export function checkCompleteness<S extends string>(
  def: StateMachineDefinition<S>,
): CompletenessIssue[] {
  const issues: CompletenessIssue[] = [];
  const reached = reachableStates(def);
  for (const state of def.states) {
    if (!reached.has(state)) {
      issues.push({ state, rule: "unreachable state (B4)" });
    }
    const hasInbound = state === def.initial || def.transitions.some((t) => t.to === state);
    if (!hasInbound) {
      issues.push({ state, rule: "no documented entry (no inbound transition, not initial)" });
    }
    const isTerminal = def.terminals.includes(state);
    const hasOutbound = def.transitions.some((t) => t.from === state);
    if (!isTerminal && !hasOutbound) {
      issues.push({ state, rule: "non-terminal state with no exit (B4)" });
    }
    if (!def.state_docs[state]) {
      issues.push({ state, rule: "missing state documentation (B4)" });
    }
  }
  for (const terminal of def.terminals) {
    if (!def.states.includes(terminal)) {
      issues.push({ state: terminal, rule: "terminal not in state enumeration" });
    }
  }
  return issues;
}

/** 迁移合法性（无 facts 语义时仅查表）：from+to 是否存在规则。 */
export function isAllowedEdge<S extends string>(
  def: StateMachineDefinition<S>,
  from: S,
  to: S,
): boolean {
  return def.transitions.some((t) => t.from === from && t.to === to);
}

export function assertTransitionThrows<S extends string>(
  def: StateMachineDefinition<S>,
  from: S,
  command: TransitionCommand,
  facts: GuardFacts,
): S {
  const result = evaluateTransition(def, from, command, facts);
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.failed_guards.join(", ") || "no rule"}`);
  }
  return result.to;
}
