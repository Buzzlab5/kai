import type { SettlementCandidate, SettlementDecision } from "./types";

// Rezdy's structured session time, as stored on PmsBookingPaymentAttempt.dateText once a specific
// time was resolved (either the only available option, or the traveller's disambiguated pick) -
// "YYYY-MM-DD HH:MM:SS", local to the operator's timezone (Rezdy's own "Local" naming). Treated as a
// plain UTC instant below: for a daily sweep this is off by at most a few hours, never enough to flip
// which calendar day the cron runs on, so it is not worth the complexity of per-operator timezone data
// that doesn't exist anywhere in this schema today.
const STRUCTURED_SESSION_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolves a booking's travel date/time from its raw dateText, or null when it can't be trusted.
 * Deliberately does NOT attempt to resolve relative words ("today"/"tomorrow"/"tonight") — those
 * only survive onto a CONFIRMED booking when the PMS offered zero explicit time options, and
 * resolving them after the fact would require the original message timestamp, which isn't stored.
 * Fails closed (null) rather than guess, matching resolveOperatorPayoutAccount's fail-closed
 * convention elsewhere in this settlement work — an unparseable booking simply stays available for
 * manual settlement via the existing admin endpoint, forever, rather than risk mis-timing a payout.
 */
export function parseAttemptTravelDate(dateText: string): Date | null {
  const trimmed = dateText.trim();

  const structured = trimmed.match(STRUCTURED_SESSION_TIME);
  if (structured) {
    const parsed = new Date(`${structured[1]}T${structured[2]}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (DATE_ONLY.test(trimmed)) {
    // Date-only: the trip counts as travelled once that whole day (UTC) has passed.
    const parsed = new Date(`${trimmed}T23:59:59Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

export function evaluateSettlement(candidate: SettlementCandidate, now: Date): SettlementDecision {
  const travelDate = parseAttemptTravelDate(candidate.dateText);
  return { due: travelDate !== null && travelDate.getTime() <= now.getTime(), travelDate };
}

/** Evaluate a batch; returns only the candidates whose travel date has passed. */
export function findBookingsReadyToSettle(candidates: SettlementCandidate[], now: Date): SettlementCandidate[] {
  return candidates.filter((candidate) => evaluateSettlement(candidate, now).due);
}
