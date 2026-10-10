import {
  EVENT_SCHEMA_VERSION,
  PROOF_POLICY_VERSION,
  attemptStateMachine,
  escalationStateMachine,
  evaluateTransition,
  type GuardFacts,
  type StateMachineDefinition,
  type TransitionCommand,
} from "@arena/contracts";
import { DomainError, randomId, type EscalationRecord } from "./create-escalation.js";
import type { ArenaRuntime } from "./runtime.js";

/**
 * 状态机命令执行器：全部迁移来自 @arena/contracts 的冻结状态机
 * （escalationStateMachine / attemptStateMachine），绝不手写状态跳转。
 * 非法迁移返回 ARENA_INVALID_TRANSITION；守卫不满足返回
 * ARENA_INVARIANT_VIOLATION 并携带失败守卫名。
 *
 * 守卫事实必须由服务端派生（本 WO 的演示组装由 API 层提供并标注 DEMO；
 * 匹配引擎/预算检查/capsule host 的真实接线属于后续 WO）。
 * 运行时依赖为 ArenaRuntime 结构（runtime.ts）：durable / in-memory 无感知。
 */

export interface ExecuteCommandInput {
  aggregate_type: "escalation" | "attempt";
  aggregate_id: string;
  command: TransitionCommand;
  facts: GuardFacts;
  actor: {
    type: "requester" | "expert" | "reviewer" | "adjudicator" | "system" | "provider" | "operator";
    id: string;
  };
  tenant_id: string;
  request_id: string | null;
  correlation_id: string;
}

export interface ExecuteCommandOutcome {
  aggregate_id: string;
  from: string;
  to: string;
  version: number;
}

export async function executeCommand(
  runtime: ArenaRuntime,
  input: ExecuteCommandInput,
  now: () => string = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
): Promise<ExecuteCommandOutcome> {
  const machine = (
    input.aggregate_type === "escalation" ? escalationStateMachine : attemptStateMachine
  ) as StateMachineDefinition<string>;
  const stored = await runtime.aggregates.loadAggregate(input.aggregate_type, input.aggregate_id);
  if (stored === null) {
    throw new DomainError(
      input.aggregate_type === "escalation"
        ? "ARENA_ESCALATION_NOT_FOUND"
        : "ARENA_ATTEMPT_NOT_FOUND",
      404,
      `${input.aggregate_type} not visible in tenant scope`,
    );
  }
  const record = stored.record as EscalationRecord & { tenant_id: string; status: string };
  if (record.tenant_id !== input.tenant_id) {
    // 失败关闭：跨租户对象访问不可区分于不存在。
    throw new DomainError(
      input.aggregate_type === "escalation"
        ? "ARENA_ESCALATION_NOT_FOUND"
        : "ARENA_ATTEMPT_NOT_FOUND",
      404,
      `${input.aggregate_type} not visible in tenant scope`,
    );
  }

  const evaluation = evaluateTransition(
    machine,
    record.status as string,
    input.command,
    input.facts,
  );
  if (!evaluation.ok) {
    if (evaluation.code === "ARENA_INVALID_TRANSITION") {
      throw new DomainError(
        "ARENA_INVALID_TRANSITION",
        409,
        `command ${input.command} not valid in state ${record.status}`,
      );
    }
    throw new DomainError(
      "ARENA_INVARIANT_VIOLATION",
      409,
      `transition rejected: failed guards ${evaluation.failed_guards.join(", ")}`,
      { failed_guards: evaluation.failed_guards },
    );
  }

  const timestamp = now();
  const eventType = `${input.aggregate_type.slice(0, 1).toUpperCase()}${input.aggregate_type.slice(1)}${input.command}`;
  record.status = evaluation.to;
  record.updated_at = timestamp;
  record.timeline.push({
    event_type: eventType,
    occurred_at: timestamp,
    actor: `${input.actor.type}:${input.actor.id}`,
  });
  await runtime.aggregates.saveAggregate({
    ref: {
      aggregate_type: input.aggregate_type,
      aggregate_id: input.aggregate_id,
      expected_version: stored.version,
    },
    record,
    events: [
      {
        event_id: `evt_${randomId()}`,
        schema_version: EVENT_SCHEMA_VERSION,
        tenant_id: input.tenant_id,
        aggregate: {
          type: input.aggregate_type,
          id: input.aggregate_id,
          version: stored.version + 1,
        },
        event_type: eventType,
        occurred_at: timestamp,
        recorded_at: timestamp,
        actor: input.actor,
        correlation_id: input.correlation_id,
        causation_id: null,
        request_id: input.request_id,
        policy_version: PROOF_POLICY_VERSION,
        payload: { schema_id: `sch_${input.aggregate_type}command1`, redaction_class: "tenant" },
        immutable: true,
        correction: null,
      },
    ],
    recorded_at: timestamp,
  });

  return {
    aggregate_id: input.aggregate_id,
    from: evaluation.matched.from,
    to: evaluation.to,
    version: stored.version + 1,
  };
}
