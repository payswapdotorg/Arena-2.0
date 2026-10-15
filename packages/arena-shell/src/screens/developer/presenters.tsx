/**
 * UIA-001 Lane C — 开发者门户展示层（纯 props；react-dom/server 可渲染）。
 *
 * 展示纪律：契约参考逐字（真实 schema 枚举）；键/供给如实 pending；
 * 投递状态 FIXTURE 标注；test_mode/NOT_GO 姿态诚实；零 ZCode 品牌。
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
  PROVIDER_CONFIGURATION_CONSTRAINT,
  REQUEST_ENVELOPE_FIELDS,
  RESULT_STATUS_VOCABULARY,
  SDK_OPS_RESOLUTION_CONSTRAINT,
} from "./contractReference.js";

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
      <h3>Typed contract reference</h3>
      <p className="arena-dev-note">
        Enumerated at runtime from the frozen CF1.0 schemas (never hand-mirrored) — the shapes your
        integration sends and receives:
      </p>
      <div className="arena-contract-shapes">
        <section data-contract="escalation_request">
          <h4>Escalation request envelope ({REQUEST_ENVELOPE_FIELDS.length} fields)</h4>
          <ul className="arena-field-list">
            {REQUEST_ENVELOPE_FIELDS.map((field) => (
              <li key={field}><code>{field}</code></li>
            ))}
          </ul>
        </section>
        <section data-contract="event_envelope">
          <h4>Event envelope ({EVENT_ENVELOPE_FIELDS.length} fields)</h4>
          <ul className="arena-field-list">
            {EVENT_ENVELOPE_FIELDS.map((field) => (
              <li key={field}><code>{field}</code></li>
            ))}
          </ul>
        </section>
        <section data-contract="result_status">
          <h4>Result status vocabulary</h4>
          <ul className="arena-field-list">
            {RESULT_STATUS_VOCABULARY.map((status) => (
              <li key={status}><code>{status}</code></li>
            ))}
          </ul>
        </section>
        <section data-contract="delivery_preferences">
          <h4>Delivery preferences ({DELIVERY_PREFERENCES_FIELDS.length} fields)</h4>
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
      <h3>Webhook &amp; transport setup</h3>
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
      <h3>Keys &amp; scopes</h3>
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
      <h3>Delivery status</h3>
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

export function ProviderConfigurationPanel(): ReactNode {
  return (
    <section className="arena-dev-panel" aria-label="capability-provider configuration (read-only vocabulary)">
      <h3>Capability-provider configuration</h3>
      <p className="arena-dev-note">{PROVIDER_CONFIGURATION_CONSTRAINT}</p>
      <ul className="arena-field-list" aria-label="routing vocabulary (spec 1.1)">
        <li><code>human expert</code></li>
        <li><code>scraper / data provider</code></li>
        <li><code>approved external API</code></li>
        <li><code>combination</code></li>
      </ul>
    </section>
  );
}

export function SdkResolutionNote(): ReactNode {
  return (
    <p className="arena-dev-constraint" role="note">
      {SDK_OPS_RESOLUTION_CONSTRAINT}
    </p>
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
