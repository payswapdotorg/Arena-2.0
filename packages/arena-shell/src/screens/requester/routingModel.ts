/**
 * UIA-001 Lane B — 路由透明度视图模型（spec/ux/arena-native-ui.md §1.1）。
 *
 * 冻结纪律（packet B1.2）：
 * - 产品主循环的路由词表 = spec §1.1 冻结文本里的四概念
 *   （human expert / scraper / external API / combination）—— 解释文案
 *   只解释「何时、为何」这个循环里的路由形态，绝不发明选择依据；
 * - 每个 escalation 的实际路由决定只能来自服务端投影（timeline 事件）；
 *   投影未携带时诚实显示「尚未记录」，绝不客户端编造理由；
 * - 证据等级（DEMO/FIXTURE/REAL）逐字流转，绝不升值。
 */
import type { TimelineEvent } from "@arena/workbench";

/** spec §1.1 冻结路由词表（人类专家 / 抓取器 / 外部 API / 组合）。 */
export const ROUTING_CONCEPTS = [
  {
    concept: "human expert",
    when: "the capability gap requires licensed human judgment (domain expertise, qualifications, professional accountability)",
    why: "the frozen escalation contract routes to an eligible expert when required_capabilities and required_qualifications demand human accountability",
  },
  {
    concept: "scraper / data provider",
    when: "the gap is retrievable public or permitted data acquisition",
    why: "the capability-acquisition router may select a scraper provider when the requested capability maps to data retrieval within policy",
  },
  {
    concept: "approved external API",
    when: "the gap is satisfied by an already-approved external service interface",
    why: "a registered external API provider may serve the request when the capability maps to an API-deliverable outcome within budget and policy",
  },
  {
    concept: "combination",
    when: "the outcome needs more than one provider class",
    why: "policy permits composing human expert, scraper and external API work when the acceptance criteria span multiple capability classes",
  },
] as const;

export type RoutingConcept = (typeof ROUTING_CONCEPTS)[number];

/** 单个 escalation 的路由状态（只从服务端 timeline 派生 —— 绝不编造）。 */
export type RoutingStatus =
  | { kind: "not_recorded"; disclosure: string }
  | { kind: "recorded"; events: readonly TimelineEvent[] };

const NOT_RECORDED_DISCLOSURE =
  "Routing decisions are recorded by the capability-acquisition router on the server; " +
  "this escalation's server projection does not yet carry a routing event — the decision " +
  "will be displayed here verbatim when the projection records it (never invented client-side)";

/** timeline 结果 → 路由状态（服务端事件流是唯一来源）。 */
export function routingStatusFromEvents(
  events: readonly TimelineEvent[] | null,
): RoutingStatus {
  if (events === null) {
    return { kind: "not_recorded", disclosure: NOT_RECORDED_DISCLOSURE };
  }
  const routingEvents = events.filter((event) =>
    event.event_type.toLowerCase().includes("rout"),
  );
  if (routingEvents.length === 0) {
    return { kind: "not_recorded", disclosure: NOT_RECORDED_DISCLOSURE };
  }
  return { kind: "recorded", events: routingEvents };
}

/** 概念面板视图模型（PURE —— 渲染层只消费这个）。 */
export interface RoutingPanelViewModel {
  concepts: readonly RoutingConcept[];
  status: RoutingStatus;
}

export function routingPanelViewModel(events: readonly TimelineEvent[] | null): RoutingPanelViewModel {
  return { concepts: ROUTING_CONCEPTS, status: routingStatusFromEvents(events) };
}
