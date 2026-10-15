/**
 * UIA-001 Lane C — 评审/裁决工位屏登记（spec §1.1/§3.1）。
 *
 * 依赖（decks + commands + audit + principal）由组合根注入；deck 投影
 * 今天是 demo 标注的 mock client（屏上如实披露），独立评审投票走真实
 * 绑定的命令通道。导航只经 host.port。
 */
import type { ReactNode } from "react";
import { createElement } from "react";
import type { ArenaScreenHost, ArenaScreenRegistration } from "../../contract.js";
import { ReviewerScreen } from "./ReviewerScreen.js";
import {
  ReviewerController,
  type AuditTrailPort,
  type ReviewDeckPort,
  type ReviewerCommandPort,
  type ReviewerPrincipal,
} from "./controller.js";
import type { MockArenaClient, RealWorkbenchBinding } from "@arena/workbench";
import { DEMO_RESULT as R1, DEMO_RESULT_DIVERGENT as R2 } from "@arena/workbench";

export interface ReviewerScreenDeps {
  decks: ReviewDeckPort;
  commands: ReviewerCommandPort;
  audit: AuditTrailPort;
  principal: ReviewerPrincipal;
}

export function reviewerRegistration(deps: ReviewerScreenDeps): ArenaScreenRegistration {
  const controller = new ReviewerController({
    decks: deps.decks,
    commands: deps.commands,
    audit: deps.audit,
    principal: deps.principal,
  });
  return {
    screen: "reviewer",
    title: "Review",
    render(host: ArenaScreenHost): ReactNode {
      return createElement(ReviewerScreen, { host, controller });
    },
  };
}

/**
 * 组合根适配器：MockArenaClient → ReviewDeckPort（deck 投影的 demo 形态；
 * 真实 result 投影落地时替换本适配器，屏契约不变）。可评审清单 = 导出
 * 的 demo 结果 fixture（DEMO 标注）。
 */
export function mockDecksAdapter(
  client: Pick<MockArenaClient, "getReviewDeck">,
): ReviewDeckPort {
  return {
    reviewableResultIds: async () => [
      { result_id: R1.result_id, escalation_id: R1.escalation_id, demo: true },
      { result_id: R2.result_id, escalation_id: R2.escalation_id, demo: true },
    ],
    getReviewDeck: (id, p) => client.getReviewDeck(id, p),
  };
}

/** 组合根适配器：RealWorkbenchBinding → 评审命令 + 审计轨迹端口（principal 绑定）。 */
export function bindingReviewerAdapters(
  binding: Pick<RealWorkbenchBinding, "command" | "timeline">,
  principal: ReviewerPrincipal,
): { commands: ReviewerCommandPort; audit: AuditTrailPort } {
  return {
    commands: {
      command: (escalationId, command, facts) =>
        binding.command(escalationId, command, facts, principal),
    },
    audit: {
      timeline: (escalationId, p) => binding.timeline(escalationId, p),
    },
  };
}
