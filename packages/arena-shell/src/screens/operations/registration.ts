/**
 * UIA-001 Lane C — 运维/治理屏登记（spec §1.1/§3.1）。
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

export interface OperationsScreenDeps {
  audit: OperationsAuditPort;
  principal: OperationsPrincipal;
}

export function operationsRegistration(deps: OperationsScreenDeps): ArenaScreenRegistration {
  const controller = new OperationsController({
    audit: deps.audit,
    principal: deps.principal,
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
