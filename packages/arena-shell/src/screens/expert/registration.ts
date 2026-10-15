/**
 * UIA-001 Lane B — 专家工位屏登记（spec §1.1/§3.1）。
 *
 * 依赖（attempts + commands + principal）由组合根注入；attempt 级投影
 * 今天是 demo 标注的 mock client（屏上如实披露），escalation 级命令通道
 * 是真实绑定。导航只经 host.port。
 */
import type { ReactNode } from "react";
import { createElement } from "react";
import type { ArenaScreenHost, ArenaScreenRegistration } from "../../contract.js";
import { ExpertScreen } from "./ExpertScreen.js";
import {
  ExpertController,
  type ExpertAttemptPort,
  type ExpertCommandPort,
  type ExpertPrincipal,
} from "./controller.js";
import type { MockArenaClient, RealWorkbenchBinding } from "@arena/workbench";
import { DEMO_ACCEPTANCE_CRITERIA as DEMO_CRITERIA } from "@arena/workbench";

export interface ExpertScreenDeps {
  /** attempt 级投影端口（MockArenaClient 的结构子集 —— demo 标注）。 */
  attempts: ExpertAttemptPort;
  /** escalation 级规范命令端口（RealWorkbenchBinding.command 绑定 principal）。 */
  commands: ExpertCommandPort;
  principal: ExpertPrincipal;
}

export function expertRegistration(deps: ExpertScreenDeps): ArenaScreenRegistration {
  const controller = new ExpertController({
    attempts: deps.attempts,
    commands: deps.commands,
    principal: deps.principal,
  });
  return {
    screen: "expert",
    title: "Expert work",
    render(host: ArenaScreenHost): ReactNode {
      return createElement(ExpertScreen, { host, controller });
    },
  };
}

/**
 * 组合根适配器：MockArenaClient → ExpertAttemptPort（attempt 级投影的
 * demo 形态；真实 attempt 投影落地时替换本适配器，屏契约不变）。
 * principal 由各端口方法按调用携带（与 MockArenaClient 的签名一致）。
 */
export function mockAttemptsAdapter(
  client: Pick<MockArenaClient, "listAssignments" | "getAttempt" | "submitCandidate" | "submitSelfEvaluation" | "getEscalation">,
): ExpertAttemptPort {
  return {
    listAssignments: (p) => client.listAssignments(p),
    getAttempt: (id, p) => client.getAttempt(id, p),
    submitCandidate: (id, draft, p) => client.submitCandidate(id, draft, p),
    submitSelfEvaluation: (id, draft, p) => client.submitSelfEvaluation(id, draft, p),
    escalationCriteria: async (escalationId, p) => {
      const outcome = await client.getEscalation(escalationId, p);
      if (outcome.kind === "FOUND") {
        return outcome.request.acceptance_criteria.map((criterion) => ({
          criterion_id: criterion.criterion_id,
          statement: criterion.statement,
        }));
      }
      // 种子化 demo attempt 引用的 escalation 未经过本 mock 提交——mock 的
      // 自评校验器本身用冻结的 DEMO_ACCEPTANCE_CRITERIA；展示同一套 demo
      // 词表是对「提交将校验什么」的如实预告（同一 fixture，DEMO 标注）。
      return DEMO_CRITERIA.map((criterion) => ({
        criterion_id: criterion.criterion_id,
        statement: criterion.statement,
      }));
    },
  };
}

/** 组合根适配器：RealWorkbenchBinding.command → ExpertCommandPort（principal 绑定）。 */
export function bindingCommandAdapter(
  binding: Pick<RealWorkbenchBinding, "command">,
  principal: ExpertPrincipal,
): ExpertCommandPort {
  return {
    command: (escalationId, command, facts) =>
      binding.command(escalationId, command, facts, principal),
  };
}

