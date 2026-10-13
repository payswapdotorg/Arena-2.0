import { WORKBENCH_STATE_VIEWS, DEMO_ACCEPTANCE_CRITERIA } from "../../../src/contract.js";
import type { ReviewDeckView } from "../../../src/contract.js";

/**
 * AR2-021 render host — journey driving values.
 *
 * Test-driving data for the composition layer (the same pattern the
 * Node-side suites use to drive the mock client): principals, the draft
 * builder context, the deck case registry and the frozen payment lifecycle.
 * The fixtures themselves (criteria, policy preset, seeds) come from the
 * workbench's own demo fixtures — nothing is redefined here.
 */

/** Host-driving principal for the requester journey (mock client stand-in). */
export const REQUESTER_PRINCIPAL = { tenant_id: "tnt_a11yhost", user_id: "usr_a11yhost" } as const;

/** Build context for the escalation draft (test-driving values). */
export const SUBMIT_CONTEXT = {
  client_application_id: "app_a11yhost",
  caller_idempotency_key: "idem-a11yhost-001",
} as const;

/** Evidence envelope shape re-typed through the public deck view model. */
export type EvidenceEnvelopeView = ReviewDeckView["redaction"]["shared"][number];

export type DeckChoice = "res_00000001" | "res_00000002";
export const DECK_CHOICES: readonly DeckChoice[] = ["res_00000001", "res_00000002"];

/**
 * Payout journey: the frozen payment machine's happy-path states in machine
 * order (the AR2-010 test-mode payout progression). Every value is a frozen
 * PAYMENT_STATES member validated at module init — no invented states.
 */
export const PAYOUT_HAPPY_PATH: readonly string[] = [
  "PENDING_EVIDENCE",
  "EVIDENCE_ACCEPTED",
  "READY_TO_RELEASE",
  "RELEASE_SUBMITTED",
  "SETTLED",
];

const FROZEN_PAYMENT_STATES = WORKBENCH_STATE_VIEWS.payment.map((view) => view.state);
for (const state of PAYOUT_HAPPY_PATH) {
  if (!FROZEN_PAYMENT_STATES.includes(state)) {
    throw new Error(`render host: payout journey state "${state}" is not a frozen payment state`);
  }
}

/** Escalation draft built from cockpit field state + fixed demo policy inputs. */
export function buildDraft(title: string, outcome: string, budget: string) {
  const budgetNumber = Number.parseFloat(budget);
  return {
    task: { title, outcome_description: outcome },
    task_type: { domain: "engineering", type_id: "tty_00000001", type_version: "1.0.0" },
    required_capabilities: [{ capability_id: "cap_00000001", minimum_level: "senior" }],
    required_qualifications: ["5+ years applied economics"],
    acceptance_criteria: DEMO_ACCEPTANCE_CRITERIA,
    proof_policy_preset: "demo_p1_rubric",
    constraints: {
      risk_tier: "MEDIUM" as const,
      privacy_profile: "TENANT" as const,
      retention_profile: "STANDARD" as const,
      jurisdiction: null,
      professional_requirements: [],
      deadline: "2026-11-01T00:00:00Z",
      escalation_modes: ["next_expert" as const, "budget_stop" as const],
    },
    budget: {
      limit_amount: Number.isNaN(budgetNumber) ? Number.NaN : budgetNumber,
      currency: "USD",
      allowed_attempts: 3,
      per_attempt_limit: 200,
    },
    input_artifacts: [],
    result_schema: { schema_id: "sch_00000001", schema_version: "1.0.0" },
    delivery_preferences: { channel: "poll" as const, webhook_url: null },
  };
}
