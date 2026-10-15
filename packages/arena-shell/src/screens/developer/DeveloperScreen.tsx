/**
 * UIA-001 Lane C — 开发者门户容器（参考面为主；无异步依赖 —— 纯呈现）。
 */
import type { ReactNode } from "react";
import type { ArenaScreenHost } from "../../contract.js";
import {
  ContractReferencePanel,
  DeliveryStatusPanel,
  KeysScopesPanel,
  LensContext,
  ProviderConfigurationPanel,
  ReleasePostureNote,
  SdkResolutionNote,
  WebhookSetupPanel,
} from "./presenters.js";

export function DeveloperScreen(props: { host: ArenaScreenHost }): ReactNode {
  return (
    <section className="arena-screen arena-developer" data-arena-screen="developer" aria-label="developer portal">
      <LensContext lens={props.host.lens} />
      <h2>Developer</h2>
      <ReleasePostureNote />
      <SdkResolutionNote />
      <div className="arena-developer-grid">
        <ContractReferencePanel />
        <WebhookSetupPanel />
        <KeysScopesPanel />
        <DeliveryStatusPanel />
        <ProviderConfigurationPanel />
      </div>
    </section>
  );
}
