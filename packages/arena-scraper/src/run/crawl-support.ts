
/**
 * AR2-017 — crawl support: pure helpers extracted from the run service so the
 * orchestration file stays within the architecture line budget.
 */

/**
 * Terminal-state decision after a crawl (pure — testable in isolation):
 * cancellation wins over completion; deadline ambiguity lands in UNKNOWN
 * (never silently-failed); quarantine overflow fails closed.
 */
export function decideTerminalState(input: {
  stopReason: string;
  deadlineExceeded: boolean;
  quarantineOverflow: boolean;
  cancelled: boolean;
}): { status: "COMPLETED" | "FAILED" | "CANCELLED" | "UNKNOWN"; reason: string } {
  if (input.quarantineOverflow) return { status: "FAILED", reason: "SCRP_QUARANTINE_EXCESS" };
  if (input.cancelled && input.stopReason === "CANCELLED") {
    return { status: "CANCELLED", reason: "SCRP_RUN_CANCELLED" };
  }
  if (input.stopReason === "CANCELLED") return { status: "CANCELLED", reason: "SCRP_RUN_CANCELLED" };
  if (input.stopReason === "PROVIDER_STOPPED" || (input.stopReason === "WALL_TIME" && input.deadlineExceeded)) {
    return { status: "UNKNOWN", reason: "SCRP_RUN_DEADLINE_EXCEEDED" };
  }
  if (input.deadlineExceeded) return { status: "UNKNOWN", reason: "SCRP_RUN_DEADLINE_EXCEEDED" };
  if (input.stopReason === "COMPLETED") return { status: "COMPLETED", reason: "COMPLETED" };
  return { status: "COMPLETED", reason: `BUDGET_${input.stopReason}` };
}
