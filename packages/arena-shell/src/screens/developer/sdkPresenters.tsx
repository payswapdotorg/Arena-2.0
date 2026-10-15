/**
 * UIA-003 — 开发者门户：SDK 挂接面展示层（纯 props；react-dom/server 可渲染）。
 *
 * 展示纪律：真实 typed outcomes 逐字（CREATED/REPLAYED/REJECTED issues/
 * CONFLICT/UNAUTHENTICATED/TRANSPORT_ERROR + 真实错误信封 code/message/
 * correlation_id）；未接线状态如实（绝不伪造客户端/工具调用/摘要）；
 * EXAMPLE 材料标注；test-mode 披露逐字。
 */
import type { ReactNode } from "react";
import type { QuickstartReport, SdkTimelineOutcome } from "@arena/sdk";
import {
  REQUEST_DIGEST_FIELDS,
  REQUEST_DIGEST_SEMANTICS,
  SDK_BINDING_UNWIRED_DISCLOSURE,
  type DeveloperController,
  type DeveloperSnapshot,
} from "./sdkMount.js";

function envelopeLine(envelope: { code: string; message: string; correlation_id: string }): ReactNode {
  return (
    <p className="arena-typed-error" role="alert">
      {envelope.code}: {envelope.message} (correlation {envelope.correlation_id})
    </p>
  );
}

function SubmitOutcomeView(props: { report: QuickstartReport }): ReactNode {
  const submit = props.report.submit;
  if (submit.kind === "CREATED" || submit.kind === "REPLAYED") {
    return (
      <dl className="arena-trail-facts">
        <div><dt>outcome</dt><dd data-submit-outcome={submit.kind}>{submit.kind}</dd></div>
        <div><dt>escalation_id</dt><dd><code>{submit.escalation_id}</code></dd></div>
        <div><dt>status</dt><dd>{submit.status}</dd></div>
        <div><dt>version</dt><dd>{submit.version}</dd></div>
      </dl>
    );
  }
  if (submit.kind === "REJECTED") {
    return (
      <div>
        {submit.envelope !== null ? envelopeLine(submit.envelope) : null}
        <ul className="arena-field-list" aria-label="rejection issues">
          {submit.issues.map((issue) => (
            <li key={`${issue.field}:${issue.rule}`}>
              <code>{issue.field}</code>: {issue.rule}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (submit.kind === "CONFLICT") return envelopeLine(submit.envelope);
  if (submit.kind === "UNAUTHENTICATED") {
    return <p className="arena-typed-error" role="alert">UNAUTHENTICATED — the server rejected the credentials</p>;
  }
  return <p className="arena-typed-error" role="alert">TRANSPORT_ERROR — {submit.message}</p>;
}

function ProjectionView(props: { report: QuickstartReport }): ReactNode {
  const projection = props.report.projection;
  if (projection.kind === "FOUND") {
    return (
      <dl className="arena-trail-facts">
        <div><dt>escalation_id</dt><dd><code>{projection.projection.escalation_id}</code></dd></div>
        <div><dt>status</dt><dd data-projection-status={projection.projection.status}>{projection.projection.status}</dd></div>
        <div><dt>version</dt><dd>{projection.projection.version}</dd></div>
        <div><dt>contract_version</dt><dd><code>{projection.projection.contract_version}</code></dd></div>
        <div><dt>updated_at</dt><dd><time dateTime={projection.projection.updated_at}>{projection.projection.updated_at}</time></dd></div>
      </dl>
    );
  }
  if (projection.kind === "NOT_FOUND") return envelopeLine(projection.envelope);
  if (projection.kind === "UNAUTHENTICATED") {
    return <p className="arena-typed-error" role="alert">UNAUTHENTICATED — the server rejected the credentials</p>;
  }
  return <p className="arena-typed-error" role="alert">TRANSPORT_ERROR — {projection.message}</p>;
}

function TimelineView(props: { timeline: SdkTimelineOutcome | null }): ReactNode {
  const timeline = props.timeline;
  if (timeline === null) {
    return <p className="arena-queue-fact">timeline not fetched — the submit produced no escalation id</p>;
  }
  if (timeline.kind === "FOUND") {
    if (timeline.events.length === 0) {
      return <p className="arena-queue-fact">server recorded no events yet</p>;
    }
    return (
      <ol className="arena-timeline" aria-label="timeline projection (server events)">
        {timeline.events.map((event, index) => (
          <li key={index} data-event={event.event_type}>
            <span className="arena-timeline-type">{event.event_type}</span>
            <time dateTime={event.occurred_at}>{event.occurred_at}</time>
            <span className="arena-timeline-actor">actor {event.actor}</span>
          </li>
        ))}
      </ol>
    );
  }
  if (timeline.kind === "NOT_FOUND") return envelopeLine(timeline.envelope);
  if (timeline.kind === "UNAUTHENTICATED") {
    return <p className="arena-typed-error" role="alert">UNAUTHENTICATED — the server rejected the credentials</p>;
  }
  return <p className="arena-typed-error" role="alert">TRANSPORT_ERROR — {timeline.message}</p>;
}

/** SDK quickstart 面板：真实 typed outcomes（readiness → submit → 投影 + timeline）。 */
export function SdkQuickstartPanel(props: {
  controller: DeveloperController;
  snap: DeveloperSnapshot;
}): ReactNode {
  const { controller, snap } = props;
  const disclosures = controller.disclosures();
  return (
    <section className="arena-dev-panel" aria-label="SDK quickstart (real typed outcomes)">
      <h2>SDK quickstart</h2>
      {snap.wiring.kind === "unwired" ? (
        <p className="arena-dev-note" role="note">{SDK_BINDING_UNWIRED_DISCLOSURE}</p>
      ) : (
        <div>
          <dl className="arena-trail-facts">
            <div><dt>binding baseUrl</dt><dd><code>{snap.wiring.baseUrl}</code></dd></div>
            <div><dt>principal</dt><dd><code>{snap.wiring.principal.tenant_id}/{snap.wiring.principal.user_id}</code></dd></div>
          </dl>
          {disclosures !== null ? (
            <p className="arena-dev-note" role="note">{disclosures.sdk}</p>
          ) : null}
          {disclosures !== null ? (
            <p className="arena-dev-note" data-test-mode="true">{disclosures.testMode}</p>
          ) : null}
        </div>
      )}
      <p className="arena-dev-note" data-example="true">
        EXAMPLE envelope (test-mode material): title below, idempotency key{" "}
        <code>{snap.exampleKey}</code> — built by the frozen CF1.0 form builder, validated by the
        server as the sole authority.
      </p>
      {snap.exampleIssues.length > 0 ? (
        <ul className="arena-field-list" aria-label="example envelope build issues">
          {snap.exampleIssues.map((issue) => (
            <li key={`${issue.field}:${issue.rule}`}><code>{issue.field}</code>: {issue.rule}</li>
          ))}
        </ul>
      ) : null}
      <form
        className="arena-audit-lookup"
        aria-label="run the SDK quickstart"
        onSubmit={(event) => {
          event.preventDefault();
          void controller.run();
        }}
      >
        <label htmlFor="arena-dev-quickstart-title">Example task title</label>
        <input
          id="arena-dev-quickstart-title"
          value={snap.title}
          disabled={snap.wiring.kind === "unwired"}
          onChange={(e) => controller.setTitle(e.target.value)}
        />
        <button
          type="submit"
          className="arena-submit"
          disabled={snap.wiring.kind === "unwired" || snap.exampleRequest === null}
        >
          Run quickstart (readyz → submit → projection → timeline)
        </button>
      </form>
      {snap.quickstart.kind === "idle" ? (
        <p className="arena-queue-fact">not run yet — the outcomes below appear after a real run</p>
      ) : null}
      {snap.quickstart.kind === "running" ? (
        <p className="arena-timeline-state" role="status">running the quickstart against the binding…</p>
      ) : null}
      {snap.quickstart.kind === "unauthenticated" ? (
        <p className="arena-typed-error" role="alert">
          UNAUTHENTICATED — the binding resolved no credentials for this principal (demo registry
          mirror)
        </p>
      ) : null}
      {snap.quickstart.kind === "ready" ? (
        <div>
          <h3>readiness</h3>
          {snap.quickstart.report.readiness === null ? (
            <p className="arena-typed-error" role="alert">readiness probe unreachable (transport failure)</p>
          ) : (
            <dl className="arena-trail-facts">
              <div><dt>status</dt><dd data-readiness-status={snap.quickstart.report.readiness.status}>{snap.quickstart.report.readiness.status}</dd></div>
              <div><dt>persistence mode</dt><dd><code>{snap.quickstart.report.readiness.dependencies.persistence.mode}</code></dd></div>
              <div><dt>persistence ready</dt><dd>{String(snap.quickstart.report.readiness.dependencies.persistence.ready)}</dd></div>
            </dl>
          )}
          <h3>submit</h3>
          <SubmitOutcomeView report={snap.quickstart.report} />
          <h3>lookup projection</h3>
          <ProjectionView report={snap.quickstart.report} />
          <h3>timeline projection</h3>
          <TimelineView timeline={snap.quickstart.timeline} />
        </div>
      ) : null}
    </section>
  );
}

/** MCP 门面面板：工具词表只读枚举（零工具调用）。 */
export function McpFacadePanel(props: { controller: DeveloperController }): ReactNode {
  const surface = props.controller.mcpSurface();
  return (
    <section className="arena-dev-panel" aria-label="MCP facade tool surface (read-only)">
      <h2>MCP facade</h2>
      {surface === null ? (
        <p className="arena-dev-note" role="note">
          the MCP facade tool vocabulary is unavailable: this composition root wired no SDK binding —
          the portal never fabricates a tool surface (and executes zero tool invocations either way)
        </p>
      ) : (
        <div>
          <dl className="arena-trail-facts">
            <div><dt>server</dt><dd><code>{surface.server.name}</code></dd></div>
            <div><dt>version</dt><dd>{surface.server.version}</dd></div>
            <div><dt>protocol</dt><dd><code>{surface.server.protocolVersion}</code></dd></div>
          </dl>
          <p className="arena-dev-note">
            read-only enumeration of the facade&apos;s tool descriptors (real McpFacade exports) —
            this portal never invokes tools; every facade call would go through the same public API
            URL and authorization:
          </p>
          <p className="arena-dev-note" role="note">{props.controller.disclosures()?.mcpFacade}</p>
          <ul className="arena-field-list" aria-label="MCP tools (read-only vocabulary)">
            {surface.tools.map((tool) => (
              <li key={tool.name} data-tool={tool.name}>
                <code>{tool.name}</code>
                <span className="arena-queue-fact">{tool.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** 摘要分组（16 字符 × 4 —— 长十六进制串的可换行呈现，内容不变）。 */
export function digestHexGroups(digest: string): readonly string[] {
  const groups: string[] = [];
  for (let index = 0; index < digest.length; index += 16) {
    groups.push(digest.slice(index, index + 16));
  }
  return groups;
}

/** 请求摘要面板：canonicalRequestDigest 的交互式真实演示。 */
export function DigestPanel(props: {
  controller: DeveloperController;
  snap: DeveloperSnapshot;
}): ReactNode {
  const { controller, snap } = props;
  const wired = snap.wiring.kind === "wired";
  return (
    <section className="arena-dev-panel" aria-label="canonical request digest">
      <h2>Request digest</h2>
      <p className="arena-dev-note" role="note">{REQUEST_DIGEST_SEMANTICS}</p>
      <ul className="arena-field-list" aria-label="digest input fields (canonical subset)">
        {REQUEST_DIGEST_FIELDS.map((field) => (
          <li key={field}><code>{field}</code></li>
        ))}
      </ul>
      <form
        className="arena-audit-lookup"
        aria-label="digest demonstration input"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label htmlFor="arena-dev-digest-title">Example task title (changes the digest)</label>
        <input
          id="arena-dev-digest-title"
          value={snap.title}
          disabled={!wired}
          onChange={(e) => controller.setTitle(e.target.value)}
        />
      </form>
      {snap.digest === null ? (
        <p className="arena-dev-note" role="note">
          the interactive digest requires the SDK binding&apos;s canonicalRequestDigest — not wired
          at this composition root; no digest is fabricated
        </p>
      ) : (
        <div>
          <p className="arena-queue-fact" aria-label="canonical request digest">
            {digestHexGroups(snap.digest).map((group) => (
              <code key={group}>{group} </code>
            ))}
          </p>
          <p className="arena-dev-note" data-example="true">
            EXAMPLE material: changing the task title changes the digest; the idempotency key (
            <code>{snap.exampleKey}</code>) never does — it is not part of the digest input.
          </p>
        </div>
      )}
    </section>
  );
}
