/**
 * UIA-001 Lane C — 开发者门户屏登记（spec §1.1/§3.1）。
 * 参考面无异步依赖；导航只经 host.port。
 */
import type { ReactNode } from "react";
import { createElement } from "react";
import type { ArenaScreenHost, ArenaScreenRegistration } from "../../contract.js";
import { DeveloperScreen } from "./DeveloperScreen.js";

export function developerRegistration(): ArenaScreenRegistration {
  return {
    screen: "developer",
    title: "Developer",
    render(host: ArenaScreenHost): ReactNode {
      return createElement(DeveloperScreen, { host });
    },
  };
}
