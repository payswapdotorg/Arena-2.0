/**
 * UIA-001 Lane C — 开发者门户屏登记（spec §1.1/§3.1；UIA-003 扩展）。
 *
 * UIA-003：registration 新增 **可选** `{ binding, principal }` 依赖 —— 组合根
 * 注入真实 SDK 绑定（node 侧经 sdkBinding.ts 的 realSdkBinding 构造；浏览器
 * 组合根在 TL 的传输 shim 决策前保持无参调用 —— 诚实呈现未接线状态）。
 * 既有无参调用点（web / a11y render host）零破坏。
 * 导航只经 host.port；本文件绝不静态引入 sdkBinding.ts（浏览器打包边界）。
 */
import type { ReactNode } from "react";
import { createElement } from "react";
import type { ArenaScreenHost, ArenaScreenRegistration } from "../../contract.js";
import { DeveloperScreen } from "./DeveloperScreen.js";
import { DeveloperController, type DeveloperPrincipal, type DeveloperSdkBinding } from "./sdkMount.js";

export interface DeveloperScreenDeps {
  /** 真实 SDK 绑定（结构化端口 —— realSdkBinding 满足）。 */
  binding: DeveloperSdkBinding;
  /** 服务端凭据推导的主体（demo 形态来自 DEMO_PRINCIPAL_TOKENS 镜像）。 */
  principal: DeveloperPrincipal;
}

export function developerRegistration(deps?: DeveloperScreenDeps): ArenaScreenRegistration {
  const controller = new DeveloperController({
    binding: deps?.binding ?? null,
    principal: deps?.principal ?? null,
  });
  return {
    screen: "developer",
    title: "Developer",
    render(host: ArenaScreenHost): ReactNode {
      return createElement(DeveloperScreen, { host, controller });
    },
  };
}
