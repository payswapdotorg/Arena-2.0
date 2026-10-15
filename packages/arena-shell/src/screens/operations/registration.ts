/**
 * UIA-001 Lane C — 运维/治理屏登记（spec §1.1/§3.1；UIA-003 扩展）。
 *
 * UIA-003：deps 新增 **可选** probes —— 组合根注入真实站点探针
 * （node 侧经 stationProbes() 构造后传入；浏览器组合根未注入时
 * 聚合就绪面如实 unwired —— 绝不伪造 ready）。既有调用点
 * （{ audit, principal } 双字段形态）零破坏。
 * 本文件绝不静态引入 stationProbes.ts（node:fs/node:sqlite 是 node 专属）。
 */
import type { ReactNode } from "react";
import { createElement } from "react";
import type { ArenaScreenHost, ArenaScreenRegistration } from "../../contract.js";
import { OperationsScreen } from "./OperationsScreen.js";
import {
  OperationsController,
  type OperationsAuditPort,
  type OperationsPrincipal,
} from "./controller.js";
import type { RealWorkbenchBinding } from "@arena/workbench";
import type { DependencyProbe } from "@arena/ops";

export interface OperationsScreenDeps {
  audit: OperationsAuditPort;
  principal: OperationsPrincipal;
  /** 真实站点探针（可选 —— 未注入时聚合就绪面如实 unwired）。 */
  probes?: readonly DependencyProbe[];
}

export function operationsRegistration(deps: OperationsScreenDeps): ArenaScreenRegistration {
  const controller = new OperationsController({
    audit: deps.audit,
    principal: deps.principal,
    probes: deps.probes,
  });
  return {
    screen: "operations",
    title: "Operations",
    render(host: ArenaScreenHost): ReactNode {
      return createElement(OperationsScreen, { host, controller });
    },
  };
}

/** 组合根适配器：RealWorkbenchBinding.timeline → 审计轨迹端口（principal 按调用携带）。 */
export function bindingAuditAdapter(
  binding: Pick<RealWorkbenchBinding, "timeline">,
): OperationsAuditPort {
  return {
    timeline: (escalationId, p) => binding.timeline(escalationId, p),
  };
}
