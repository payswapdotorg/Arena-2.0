/**
 * UIA-001 Lane B — 请求方屏登记（spec §1.1/§3.1）。
 *
 * TL 集成把 registration 装入 shell 注册表；依赖（binding + principal）
 * 由组合根注入 —— 层内零硬编码端点。导航只经 host.port。
 */
import type { ReactNode } from "react";
import { createElement } from "react";
import type { ArenaScreenHost, ArenaScreenRegistration } from "../../contract.js";
import { RequesterScreen } from "./RequesterScreen.js";
import { RequesterController, type RequesterBindingPort } from "./controller.js";

export interface RequesterScreenDeps {
  /** 真实绑定（RealWorkbenchBinding 满足此结构子集）。 */
  binding: RequesterBindingPort;
  /** 服务端凭据推导的主体（demo 形态来自 DEMO_PRINCIPAL_TOKENS）。 */
  principal: { tenant_id: string; user_id: string };
}

export function requesterRegistration(deps: RequesterScreenDeps): ArenaScreenRegistration {
  const controller = new RequesterController({
    binding: deps.binding,
    principal: deps.principal,
  });
  return {
    screen: "requester",
    title: "Requests",
    render(host: ArenaScreenHost): ReactNode {
      return createElement(RequesterScreen, { host, controller });
    },
  };
}
