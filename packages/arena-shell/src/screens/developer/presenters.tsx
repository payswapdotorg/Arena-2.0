/**
 * UIA-001 Lane C — 开发者门户展示层（纯 props；react-dom/server 可渲染；UIA-003 扩展）。
 *
 * 展示纪律：契约参考逐字（真实 schema 枚举）；键/供给如实 pending；
 * 投递状态 FIXTURE 标注；test_mode/NOT_GO 姿态诚实；零 ZCode 品牌。
 * UIA-003：提供方配置面板从手抄词表改为真实 ACQ1.0 词表
 * （providerRegistry —— @arena/acquisition 公开 schema 运行时枚举）；
 * SDK 回退约束披露（SdkResolutionNote）随真实挂接面退役。
 */
import type { ReactNode } from "react";
import { ARENA_PRODUCT_NAME, ARENA_RELEASE_POSTURE, type ArenaScreenHost } from "../../contract.js";
import {
  CANONICAL_TRANSPORT_HEADERS,
  CREDENTIAL_PROVISIONING_DISCLOSURE,
  DELIVERY_PREFERENCES_FIELDS,
  deliveryStatusFixtureRows,
  EVENT_ENVELOPE_FIELDS,
  IDEMPOTENCY_RULES,
  REQUEST_ENVELOPE_FIELDS,
  RESULT_STATUS_VOCABULARY,
} from "./contractReference.js";
import { providerRegistryViewModel } from "./providerRegistry.js";

export function LensContext(props: { lens: ArenaScreenHost["lens"] }): ReactNode {
  return (
    <p className="arena-lens-context" data-arena-lens={props.lens}>
      Viewing as {props.lens} (presentation only — never an authorization)
    </p>
  );
}

export function ContractReferencePanel(): ReactNode {
  return (
    <section className="arena-dev-panel" aria-label="typed request and result contract reference">
      <h2>Typed contract reference</h2>
      <p className="arena-dev-note">
        Enumerated at runtime from the frozen CF1.0 schemas (never hand-mirrored) — the shapes your
        integration sends and receives:
      </p>
      <div className="arena-contract-shapes">
        <section data-contract="escalation_request">
          <h2>Escalation request envelope ({REQUEST_ENVELOPE_FIELDS.length} fields)</h2>
          <ul className="arena-field-list">
            {REQUEST_ENVELOPE_FIELDS.map((field) => (
              <li key={field}><code>{field}</code></li>
            ))}
          </ul>
        </section>
        <section data-contract="event_envelope">
          <h2>Event envelope ({EVENT_ENVELOPE_FIELDS.length} fields)</h2>
          <ul className="arena-field-list">
            {EVENT_ENVELOPE_FIELDS.map((field) => (
              <li key={field}><code>{field}</code></li>
            ))}
          </ul>
        </section>
        <section data-contract="result_status">
          <h2>Result status vocabulary</h2>
          <ul className="arena-field-list">
            {RESULT_STATUS_VOCABULARY.map((status) => (
              <li key={status}><code>{status}</code></li>
            ))}
          </ul>
        </section>
        <section data-contract="delivery_preferences">
          <h2>Delivery preferences ({DELIVERY_PREFERENCES_FIELDS.length} fields)</h2>
          <ul className="arena-field-list">
            {DELIVERY_PREFERENCES_FIELDS.map((field) => (
              <li key={field}><code>{field}</code></li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}

export function WebhookSetupPanel(): ReactNode {
  return (
    <section className="arena-dev-panel" aria-label="webhook and transport setup">
      <h2>Webhook &amp; transport setup</h2>
      <p className="arena-dev-note">
        Canonical transport headers (from the real binding's request path):
      </p>
      <dl className="arena-trail-facts">
        {CANONICAL_TRANSPORT_HEADERS.map((header) => (
          <div key={header.header}>
            <dt><code>{header.header}</code></dt>
            <dd>{header.semantics}</dd>
          </div>
        ))}
      </dl>
      <p className="arena-dev-note">Apply-once / replay / duplicate semantics (CF1.0, verbatim):</p>
      <dl className="arena-trail-facts">
        {IDEMPOTENCY_RULES.map((rule) => (
          <div key={rule.key}>
            <dt><code>{rule.key}</code></dt>
            <dd>{rule.text}</dd>
          </div>
        ))}
      </dl>
      <p className="arena-dev-note">
        A webhook delivery carries the event envelope (fields above) signed by the registered
        signature key; delivery uses the durable outbox with unique per-event delivery identity.
      </p>
    </section>
  );
}

export function KeysScopesPanel(): ReactNode {
  return (
    <section className="arena-dev-panel" aria-label="keys and scopes">
      <h2>Keys &amp; scopes</h2>
      <p className="arena-dev-note">{CREDENTIAL_PROVISIONING_DISCLOSURE}</p>
      <button type="button" className="arena-capsule-open" disabled aria-disabled="true">
        Provision credential (disabled — no live provider at this base)
      </button>
    </section>
  );
}

export function DeliveryStatusPanel(): ReactNode {
  const rows = deliveryStatusFixtureRows();
  return (
    <section className="arena-dev-panel" aria-label="webhook delivery status (fixture)">
      <h2>Delivery status</h2>
      <p className="arena-dev-note" data-fixture="true">
        FIXTURE rows (deterministic, labelled) — semantics verbatim from the CF1.0 idempotency law:
      </p>
      <ul className="arena-delivery-list" aria-label="delivery status rows">
        {rows.map((row) => (
          <li key={row.delivery_id} data-outcome={row.outcome} data-fixture="true">
            <code>{row.delivery_id}</code>
            <span className={`arena-delivery-outcome arena-delivery-${row.outcome.toLowerCase()}`}>
              {row.outcome}
            </span>
            <span className="arena-dev-note">{row.semantics}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 能力提供方注册表（真实 ACQ1.0 词表 —— @arena/acquisition 公开 schema 运行时枚举）。 */
export function ProviderRegistryPanel(): ReactNode {
  const vm = providerRegistryViewModel();
  return (
    <section className="arena-dev-panel" aria-label="capability-provider registry (read-only ACQ1.0 vocabulary)">
      <h2>Capability-provider registry</h2>
      <p className="arena-dev-note">
        Read-only presentation of the ACQ1.0 routing vocabulary and provider-registration descriptor
        shapes, enumerated at runtime from the real @arena/acquisition schemas (never hand-mirrored):
      </p>
      <div className="arena-contract-shapes">
        <section data-contract="acquisition_route_modes">
          <h3>Route modes</h3>
          <ul className="arena-field-list">
            {vm.routeModes.map((mode) => (
              <li key={mode}><code>{mode}</code></li>
            ))}
          </ul>
        </section>
        <section data-contract="preferred_route">
          <h3>Preferred route ({vm.preferredRouteFields.length} fields)</h3>
          <ul className="arena-field-list">
            {vm.preferredRouteFields.map((field) => (
              <li key={field}><code>{field}</code></li>
            ))}
          </ul>
          <p className="arena-dev-note">pinned reference fields: {vm.pinnedReferenceFields.map((field) => (
            <code key={field}>{field} </code>
          ))}</p>
        </section>
        <section data-contract="provider_descriptor">
          <h3>Provider descriptor ({vm.descriptorFields.length} fields)</h3>
          <ul className="arena-field-list">
            {vm.descriptorFields.map((field) => (
              <li key={field}><code>{field}</code></li>
            ))}
          </ul>
        </section>
        <section data-contract="provider_kinds_statuses">
          <h3>Kinds · statuses · rights postures</h3>
          <ul className="arena-field-list">
            {vm.kinds.map((kind) => (
              <li key={kind}><code>{kind}</code></li>
            ))}
            {vm.statuses.map((status) => (
              <li key={status} data-provider-status={status}><code>{status}</code></li>
            ))}
            {vm.rightsPostures.map((posture) => (
              <li key={posture}><code>{posture}</code></li>
            ))}
          </ul>
          <p className="arena-dev-note">capability offer fields: {vm.capabilityOfferFields.map((field) => (
            <code key={field}>{field} </code>
          ))}</p>
        </section>
      </div>
      <dl className="arena-trail-facts">
        <div><dt>fallback rule</dt><dd>{vm.fallbackRule}</dd></div>
        <div><dt>tenant rule</dt><dd>{vm.tenantRule}</dd></div>
      </dl>
    </section>
  );
}

export function ReleasePostureNote(): ReactNode {
  return (
    <p className="arena-posture-note" data-release-decision={ARENA_RELEASE_POSTURE.releaseDecision}>
      {ARENA_PRODUCT_NAME} release decision {ARENA_RELEASE_POSTURE.releaseDecision} · finance{" "}
      {ARENA_RELEASE_POSTURE.financeMode} · examples run in test mode only
    </p>
  );
}
