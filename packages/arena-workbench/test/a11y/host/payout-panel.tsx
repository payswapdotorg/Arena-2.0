import type { ReactNode } from "react";
import { LiveAnnouncer, StateBadge, WORKBENCH_STATE_VIEWS } from "../../../src/contract.js";
import { PAYOUT_HAPPY_PATH } from "./drive.js";

/**
 * AR2-021 render host — payout status panel.
 *
 * The workbench has no dedicated payout screen; this host-composed panel is
 * the equivalent surface: every state comes 1:1 from the frozen
 * PAYMENT_STATES machine via the workbench's own StateBadge/state views, in
 * the AR2-010 test-mode payout progression, with the test-mode disclosure
 * (live money disabled, architecture-lock 21) and a live-region announcement
 * on every transition.
 */
export function PayoutStatusPanel(props: { step: number; onAdvance: () => void }): ReactNode {
  const payoutStep = props.step;
  const payoutTerminal = payoutStep >= PAYOUT_HAPPY_PATH.length - 1;
  const payoutState = PAYOUT_HAPPY_PATH[payoutStep] ?? PAYOUT_HAPPY_PATH[0] ?? "PENDING_EVIDENCE";
  const payoutLabel =
    WORKBENCH_STATE_VIEWS.payment.find((view) => view.state === payoutState)?.label ?? payoutState;
  return (
    <section className="arena-payout-panel" aria-labelledby="arena-payout-heading">
      <h2 id="arena-payout-heading">Payout status</h2>
      <p className="arena-payout-mode">Test-mode payout — live money disabled (architecture-lock 21)</p>
      <p className="arena-payout-current" data-payout-state={payoutState}>
        Payment status: <StateBadge machine="payment" state={payoutState} />
      </p>
      <LiveAnnouncer message={`Payment status: ${payoutLabel} (test-mode)`} />
      <ol className="arena-payout-steps" aria-label="payment lifecycle (frozen payment states)">
        {PAYOUT_HAPPY_PATH.map((state, index) => (
          <li
            key={state}
            data-payment-state={state}
            aria-current={index === payoutStep ? "step" : undefined}
            className={index === payoutStep ? "arena-payout-step-current" : undefined}
          >
            <StateBadge machine="payment" state={state} />
          </li>
        ))}
      </ol>
      <button type="button" onClick={props.onAdvance} aria-disabled={payoutTerminal}>
        Advance payment lifecycle
      </button>
    </section>
  );
}
