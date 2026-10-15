/**
 * UIA-001 Lane B — 请求方驾驶舱容器（React 薄胶水）。
 *
 * 状态全部在 RequesterController（headless 可测）；本组件只做
 * useSyncExternalStore 订阅 + 挂载时加载 + 导航经 host.port（拒绝逐字）。
 * lens 只进展示（LensContext）；绝不进请求路径。
 */
import { useEffect, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { ArenaScreenHost } from "../../contract.js";
import {
  DELIVERY_CHANNEL_OPTIONS,
  CURRENCY_OPTIONS,
  ESCALATION_MODE_OPTIONS,
  PRIVACY_PROFILE_OPTIONS,
  RETENTION_PROFILE_OPTIONS,
  RISK_TIER_OPTIONS,
} from "./formModel.js";
import { RequesterController } from "./controller.js";
import { FieldErrors } from "./presenters.js";
import {
  LensContext,
  PaymentPanel,
  ReleasePostureNote,
  RequesterEmpty,
  RequesterError,
  RequesterLoading,
  ResultPanel,
  RoutingPanel,
  SubmitOutcomeView,
  TimelineList,
  TrackingList,
} from "./presenters.js";

export interface RequesterScreenProps {
  host: ArenaScreenHost;
  controller: RequesterController;
}

export function RequesterScreen(props: RequesterScreenProps): ReactNode {
  const { host, controller } = props;
  const snap = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.snapshot(),
    () => controller.snapshot(),
  );

  useEffect(() => {
    void controller.loadTracking();
  }, [controller]);

  const form = snap.form;
  const set = controller.setForm.bind(controller);

  return (
    <section className="arena-screen arena-requester" data-arena-screen="requester" aria-label="requester cockpit">
      <LensContext lens={host.lens} />
      <h2>Requests</h2>
      <ReleasePostureNote />

      <div className="arena-requester-grid">
        <form
          className="arena-escalation-form"
          aria-busy={snap.submitting}
          onSubmit={(event) => {
            event.preventDefault();
            void controller.submit();
          }}
        >
          <h3>Compose a capability-gap request</h3>

          <label htmlFor="arena-form-title">Task title</label>
          <input
            id="arena-form-title"
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
          />

          <label htmlFor="arena-form-outcome">Outcome description</label>
          <textarea
            id="arena-form-outcome"
            value={form.outcomeDescription}
            onChange={(e) => set({ outcomeDescription: e.target.value })}
          />

          <label htmlFor="arena-form-domain">Task domain</label>
          <input
            id="arena-form-domain"
            value={form.domain}
            onChange={(e) => set({ domain: e.target.value })}
          />

          <label htmlFor="arena-form-capability">Required capability / minimum level</label>
          <div className="arena-form-pair">
            <input
              id="arena-form-capability"
              aria-label="capability id"
              value={form.capabilityId}
              onChange={(e) => set({ capabilityId: e.target.value })}
            />
            <input
              aria-label="minimum level"
              value={form.minimumLevel}
              onChange={(e) => set({ minimumLevel: e.target.value })}
            />
          </div>

          <label htmlFor="arena-form-qualification">Required qualification (optional)</label>
          <input
            id="arena-form-qualification"
            value={form.qualification}
            onChange={(e) => set({ qualification: e.target.value })}
          />

          <label htmlFor="arena-form-risk">Risk tier</label>
          <select
            id="arena-form-risk"
            value={form.riskTier}
            onChange={(e) => set({ riskTier: e.target.value as typeof form.riskTier })}
          >
            {RISK_TIER_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>

          <label htmlFor="arena-form-privacy">Privacy profile</label>
          <select
            id="arena-form-privacy"
            value={form.privacyProfile}
            onChange={(e) => set({ privacyProfile: e.target.value as typeof form.privacyProfile })}
          >
            {PRIVACY_PROFILE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>

          <label htmlFor="arena-form-retention">Retention profile</label>
          <select
            id="arena-form-retention"
            value={form.retentionProfile}
            onChange={(e) => set({ retentionProfile: e.target.value as typeof form.retentionProfile })}
          >
            {RETENTION_PROFILE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>

          <fieldset className="arena-form-modes">
            <legend>Escalation modes</legend>
            {ESCALATION_MODE_OPTIONS.map((mode) => (
              <label key={mode} className="arena-form-check">
                <input
                  type="checkbox"
                  checked={form.escalationModes.includes(mode)}
                  onChange={() => controller.toggleEscalationMode(mode)}
                />
                {mode}
              </label>
            ))}
          </fieldset>

          <label htmlFor="arena-form-budget">Budget limit</label>
          <div className="arena-form-pair">
            <input
              id="arena-form-budget"
              inputMode="decimal"
              aria-label="budget limit amount"
              value={form.budgetLimit}
              onChange={(e) => set({ budgetLimit: e.target.value })}
            />
            <select
              aria-label="budget currency"
              value={form.currency}
              onChange={(e) => set({ currency: e.target.value as typeof form.currency })}
            >
              {CURRENCY_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <label htmlFor="arena-form-attempts">Allowed attempts</label>
          <input
            id="arena-form-attempts"
            inputMode="numeric"
            value={form.allowedAttempts}
            onChange={(e) => set({ allowedAttempts: e.target.value })}
          />

          <label htmlFor="arena-form-delivery">Delivery channel</label>
          <select
            id="arena-form-delivery"
            value={form.deliveryChannel}
            onChange={(e) => set({ deliveryChannel: e.target.value as typeof form.deliveryChannel })}
          >
            {DELIVERY_CHANNEL_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          {form.deliveryChannel === "webhook" ? (
            <>
              <label htmlFor="arena-form-webhook">Webhook URL</label>
              <input
                id="arena-form-webhook"
                value={form.webhookUrl}
                onChange={(e) => set({ webhookUrl: e.target.value })}
              />
            </>
          ) : null}

          <FieldErrors errors={snap.fieldErrors} />
          <button type="submit" className="arena-submit" aria-disabled={snap.submitting}>
            Submit escalation
          </button>
          <p className="arena-live-status" aria-live="polite">{snap.statusMessage}</p>
          <SubmitOutcomeView outcome={snap.submitOutcome} />
        </form>

        <div className="arena-requester-side">
          <section className="arena-tracking-section" aria-label="request tracking">
            <h3>Tracking</h3>
            {snap.tracking.kind === "loading" ? <RequesterLoading /> : null}
            {snap.tracking.kind === "empty" ? <RequesterEmpty /> : null}
            {snap.tracking.kind === "error" ? (
              <RequesterError
                message={snap.tracking.message}
                onRetry={() => void controller.loadTracking()}
              />
            ) : null}
            {snap.tracking.kind === "ready" ? (
              <TrackingList
                rows={snap.tracking.data}
                selected={snap.selectedEscalation}
                onSelect={(id) => void controller.selectEscalation(id)}
              />
            ) : null}
          </section>

          <RoutingPanel timelineEvents={snap.timeline.kind === "ready" ? snap.timeline.data : null} />

          <section className="arena-inspection" aria-label="evidence and results inspection">
            <h3>Evidence &amp; results</h3>
            <TimelineList timeline={snap.timeline} />
            <ResultPanel result={snap.result} />
          </section>

          <PaymentPanel />
        </div>
      </div>
    </section>
  );
}
