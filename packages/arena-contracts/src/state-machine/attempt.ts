import { ASSIGNMENT_GUARDS, ENVIRONMENT_GUARDS } from "./escalation.js";
import type { StateMachineDefinition } from "./machine.js";

/**
 * A11 — Attempt 状态机（ES2.0 §3/§6；PVP1.0 §4/§5）。
 * 不变量 3（无不可变候选版本不得 SUBMITTED）挂在这里；
 * 失败尝试是不可变历史：重试 = 新 attempt（SUPERSEDED 标记旧尝试，
 * 绝不覆盖失败记录）。
 */

export const ATTEMPT_STATES = [
  "CREATED",
  "ASSIGNED",
  "ENVIRONMENT_READY",
  "SUBMITTED",
  "VERIFYING",
  "ACCEPTED",
  "REJECTED",
  "INCONCLUSIVE",
  "FAILED",
  "EXPIRED",
  "SUPERSEDED",
] as const;

export type AttemptState = (typeof ATTEMPT_STATES)[number];

/** 不变量 3 的守卫。 */
export const CANDIDATE_GUARDS = [
  "candidate_version_immutable",
  "artifact_manifest_present",
] as const;

/** 不变量 10：重试边界。 */
export const RETRY_GUARDS = ["budget_remaining", "attempts_remaining"] as const;

export const attemptStateMachine: StateMachineDefinition<AttemptState> = {
  id: "attempt",
  initial: "CREATED",
  states: ATTEMPT_STATES,
  terminals: ["ACCEPTED", "REJECTED", "INCONCLUSIVE", "FAILED", "EXPIRED", "SUPERSEDED"],
  transitions: [
    { from: "CREATED", to: "ASSIGNED", command: "StartAttempt", guards: [...ASSIGNMENT_GUARDS] },
    {
      from: "ASSIGNED",
      to: "ENVIRONMENT_READY",
      command: "StartAttempt",
      guards: [...ENVIRONMENT_GUARDS],
    },
    {
      from: "ENVIRONMENT_READY",
      to: "SUBMITTED",
      command: "SubmitIntervention",
      guards: [...CANDIDATE_GUARDS],
    },
    {
      from: "SUBMITTED",
      to: "VERIFYING",
      command: "SubmitSelfEvaluation",
      guards: ["self_evaluation_structured"],
    },
    {
      from: "VERIFYING",
      to: "ACCEPTED",
      command: "SystemRecordProofDecision",
      guards: ["proof_satisfied", "criterion_conjunction_passed"],
    },
    {
      from: "VERIFYING",
      to: "REJECTED",
      command: "SystemRecordProofDecision",
      guards: ["proof_failed"],
    },
    {
      from: "VERIFYING",
      to: "INCONCLUSIVE",
      command: "SystemRecordProofDecision",
      guards: ["proof_inconclusive"],
    },
    {
      from: "VERIFYING",
      to: "FAILED",
      command: "SystemRecordProofDecision",
      guards: ["validator_failure_recorded"],
    },
    {
      from: "CREATED",
      to: "EXPIRED",
      command: "SystemExpireEscalation",
      guards: ["deadline_exceeded"],
    },
    {
      from: "ASSIGNED",
      to: "EXPIRED",
      command: "SystemExpireEscalation",
      guards: ["deadline_exceeded"],
    },
    {
      from: "ENVIRONMENT_READY",
      to: "EXPIRED",
      command: "SystemExpireEscalation",
      guards: ["deadline_exceeded"],
    },
    {
      from: "SUBMITTED",
      to: "EXPIRED",
      command: "SystemExpireEscalation",
      guards: ["deadline_exceeded"],
    },
    {
      from: "VERIFYING",
      to: "EXPIRED",
      command: "SystemExpireEscalation",
      guards: ["deadline_exceeded"],
    },
    {
      from: "CREATED",
      to: "SUPERSEDED",
      command: "SystemRouteNextExpert",
      guards: [...RETRY_GUARDS],
    },
    {
      from: "ASSIGNED",
      to: "SUPERSEDED",
      command: "SystemRouteNextExpert",
      guards: [...RETRY_GUARDS],
    },
    {
      from: "ENVIRONMENT_READY",
      to: "SUPERSEDED",
      command: "SystemRouteNextExpert",
      guards: [...RETRY_GUARDS],
    },
    {
      from: "SUBMITTED",
      to: "SUPERSEDED",
      command: "SystemRouteNextExpert",
      guards: [...RETRY_GUARDS],
    },
    {
      from: "VERIFYING",
      to: "SUPERSEDED",
      command: "SystemRouteNextExpert",
      guards: [...RETRY_GUARDS],
    },
  ],
  state_docs: {
    CREATED: {
      entry: "attempt record created for an assignment",
      exit: "assignment checks pass or routing/expiry",
    },
    ASSIGNED: {
      entry: "expert assigned with all six checks",
      exit: "environment provisioned or routing/expiry",
    },
    ENVIRONMENT_READY: {
      entry: "capsule manifest + assurance recorded",
      exit: "candidate submitted or routing/expiry",
    },
    SUBMITTED: {
      entry: "immutable candidate + artifact manifest present",
      exit: "verification begins or expiry",
    },
    VERIFYING: {
      entry: "structured self-evaluation recorded",
      exit: "proof decision recorded immutably",
    },
    ACCEPTED: {
      entry: "proof satisfied and conjunction passed",
      exit: "terminal (immutable decision)",
    },
    REJECTED: { entry: "proof failed", exit: "terminal (routes to next expert within budget)" },
    INCONCLUSIVE: {
      entry: "evidence inconclusive under the policy",
      exit: "terminal (retry/review per policy)",
    },
    FAILED: {
      entry: "validator failure with evidence and reason codes",
      exit: "terminal (immutable failure record)",
    },
    EXPIRED: { entry: "deadline exceeded mid-attempt", exit: "terminal" },
    SUPERSEDED: {
      entry: "next expert routed within budget/attempts",
      exit: "terminal (prior attempt kept as history)",
    },
  },
};
