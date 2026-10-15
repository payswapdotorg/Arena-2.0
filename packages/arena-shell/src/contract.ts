/**
 * @arena/shell — 冻结的 Wave 0 公共契约（spec/ux/arena-native-ui.md）。
 *
 * 本文件是 arena-shell 模块唯一的公共入口（architecture-policy.yaml
 * publicEntrypoints）。Worker A/B/C 在这些名字之后实现；语义变更需要
 * TL 的 ACR，绝不静默修改。导出面与 spec/ux/arena-native-ui.md §1/§2
 * 一一对应：屏词汇（封闭集合）、导航端口（类型化拒绝）、角色透镜
 * （仅展示 —— ROLE_IS_NOT_AUTHORIZATION_RULE 原样继承）、产品身份
 * 常量、真实姿态常量（NOT_GO / test_mode / disabled 的诚实展示法）。
 */
import type { ReactNode } from "react";

/** 产品身份（spec §2.1）：用户可见的产品名是 Arena。 */
export const ARENA_PRODUCT_NAME = "Arena" as const;

/** 屏词汇（spec §1.1，FROZEN 封闭集合 —— 增删需 ACR）。 */
export const ARENA_SCREEN_IDS = [
  "requester",
  "expert",
  "reviewer",
  "developer",
  "operations",
] as const;

export type ArenaScreenId = (typeof ARENA_SCREEN_IDS)[number];

export function isArenaScreenId(value: unknown): value is ArenaScreenId {
  return typeof value === "string" && (ARENA_SCREEN_IDS as readonly string[]).includes(value);
}

/** 默认落点：请求方驾驶舱（spec §1.2 —— 产品主循环的入口）。 */
export const ARENA_DEFAULT_SCREEN: ArenaScreenId = "requester";

/**
 * 角色透镜（spec §1.3，FROZEN）：仅改变展示。切镜头从不改变 API 接受
 * 什么 —— ROLE_IS_NOT_AUTHORIZATION_RULE（@arena/workbench 契约）原样
 * 继承到 shell 层。
 */
export const ARENA_ROLE_LENSES = [
  "requester",
  "expert",
  "reviewer",
  "developer",
  "operator",
] as const;

export type ArenaRoleLens = (typeof ARENA_ROLE_LENSES)[number];

export function isArenaRoleLens(value: unknown): value is ArenaRoleLens {
  return typeof value === "string" && (ARENA_ROLE_LENSES as readonly string[]).includes(value);
}

/** 导航拒绝（spec §1.2）：类型化、逐字展示、从不静默吞掉。 */
export type ArenaNavigationRefusal =
  | { kind: "unregistered_screen"; screenId: string }
  | { kind: "navigation_unavailable"; reason: string };

export type ArenaNavigateOutcome =
  | { kind: "navigated"; screen: ArenaScreenId }
  | { kind: "refused"; refusal: ArenaNavigationRefusal };

/**
 * 导航端口（spec §1.2，FROZEN）：屏永不自行改路由/URL —— 一律经端口
 * 请求导航，拒绝逐字渲染。web/desktop 的挂接由 TL 集成提交完成。
 */
export interface ArenaShellPort {
  navigate(screenId: ArenaScreenId): ArenaNavigateOutcome;
  activeScreen(): ArenaScreenId;
}

/** 屏宿主：屏只拿到端口 + 当前透镜（拿不到路由内部）。 */
export interface ArenaScreenHost {
  port: ArenaShellPort;
  lens: ArenaRoleLens;
}

/** 屏注册项（spec §1.1）：title 为用户可见导航标签。 */
export interface ArenaScreenRegistration {
  screen: ArenaScreenId;
  title: string;
  render(host: ArenaScreenHost): ReactNode;
}

/**
 * 解决方案工作台挂槽（spec §1.1）：继承的 ZCode 编码工作台不是屏词汇
 * 的成员；它作为"解决方案工作台"经此槽在专家任务上下文内挂接。
 * TL 集成提交注入真实实现；lanes 期间为 null（挂槽缺失 = 该入口
 * 诚实显示为不可用，绝不静默隐藏）。
 */
export type ArenaSolutionWorkspaceSlot = (context: { taskId: string }) => ReactNode | null;

/**
 * 真实姿态常量（spec §2.3，FROZEN）：每个角色面必须诚实展示的记录
 * 姿态。restricted 行为渲染为"如实禁用 + 指向记录依据"，绝不渲染为
 * 不存在，也绝不暗示生产隔离、真实支付或发布 GO。
 */
export const ARENA_RELEASE_POSTURE = {
  releaseDecision: "NOT_GO",
  decisionBasis: "docs/evidence/release/AR2-015-gate-report-2026-10-11.md",
  financeMode: "test_mode",
  untrustedExecution: "disabled",
  isolationEvidence: "docs/evidence/isolation/AR2-019-strict-mode-station-evidence-2026-10-14.md",
  authorizationInstrument: "docs/evidence/release/AR2-023-authorization-workflow-2026-10-14.md",
} as const;

export type ArenaReleasePosture = typeof ARENA_RELEASE_POSTURE;

/** 证据等级词表（spec §2.2）：DEMO/FIXTURE/REAL 逐字流转，绝不升值。 */
export const ARENA_EVIDENCE_GRADES = ["DEMO", "FIXTURE", "REAL"] as const;
export type ArenaEvidenceGrade = (typeof ARENA_EVIDENCE_GRADES)[number];
