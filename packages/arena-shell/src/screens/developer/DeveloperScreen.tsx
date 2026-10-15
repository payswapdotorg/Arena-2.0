/**
 * UIA-001 Lane C — 开发者门户容器（UIA-003 扩展：真实 SDK/ACQ 挂接面）。
 *
 * SDK quickstart / MCP 门面 / 摘要面经注册注入的控制器驱动（未接线时
 * 如实呈现）；ACQ 提供方注册表 = 真实 schema 词表只读枚举。
 */
import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { ArenaScreenHost } from "../../contract.js";
import {
  ContractReferencePanel,
  DeliveryStatusPanel,
  KeysScopesPanel,
  LensContext,
  ProviderRegistryPanel,
  ReleasePostureNote,
  WebhookSetupPanel,
} from "./presenters.js";
import { DigestPanel, McpFacadePanel, SdkQuickstartPanel } from "./sdkPresenters.js";
import type { DeveloperController } from "./sdkMount.js";

export interface DeveloperScreenProps {
  host: ArenaScreenHost;
  controller: DeveloperController;
}

export function DeveloperScreen(props: DeveloperScreenProps): ReactNode {
  const { host, controller } = props;
  const snap = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.snapshot(),
    () => controller.snapshot(),
  );

  return (
    <section className="arena-screen arena-developer" data-arena-screen="developer" aria-label="developer portal">
      <LensContext lens={host.lens} />
      <h1>Developer</h1>
      <ReleasePostureNote />
      <div className="arena-developer-grid">
        <ContractReferencePanel />
        <SdkQuickstartPanel controller={controller} snap={snap} />
        <McpFacadePanel controller={controller} />
        <DigestPanel controller={controller} snap={snap} />
        <WebhookSetupPanel />
        <KeysScopesPanel />
        <DeliveryStatusPanel />
        <ProviderRegistryPanel />
      </div>
    </section>
  );
}
