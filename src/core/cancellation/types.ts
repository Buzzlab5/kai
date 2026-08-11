/**
 * Auto-refund calculator (payment-settlement plan, Milestone 3/2.4) — turns "this booking got
 * cancelled" into a refund percentage, without touching Prisma/Stripe. Mirrors the follow-up engine
 * and settlement sweep's shape (src/core/followup, src/core/settlement): a pure decision function the
 * live layer feeds real data into and acts on.
 */

export type CancelledBy = "CUSTOMER" | "OPERATOR" | "ADMIN";

/**
 * One tier of an operator's cancellation policy: cancel at least `minDaysBeforeDeparture` days out,
 * get `refundPercent` back. A policy is an array of these, matched by the largest
 * minDaysBeforeDeparture the cancellation still qualifies for - see resolveRefundTierPercent.
 */
export interface CancellationPolicyTier {
  minDaysBeforeDeparture: number;
  refundPercent: number;
}

export interface RefundTierDecision {
  /**
   * True when a tier could be confidently resolved. False when the travel date couldn't be
   * determined (see parseAttemptTravelDate in core/settlement/rules.ts) - the caller must never
   * auto-refund in that case, only surface it for manual handling.
   */
  resolved: boolean;
  refundPercent: number | null;
  daysBeforeDeparture: number | null;
}
