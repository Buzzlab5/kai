/**
 * Automatic settlement trigger (payment-settlement plan, Milestone 2/2.3) — decides WHICH confirmed
 * bookings are due to be paid out to the operator, without touching Prisma/Stripe. Mirrors the
 * follow-up engine's shape (src/core/followup/types.ts): a pure decision function the live layer
 * (a cron route) queries into and acts on, so every branch stays unit-testable with no DB.
 */

/**
 * A normalized, storage-agnostic view of one CONFIRMED booking the live layer is considering for
 * automatic settlement.
 */
export interface SettlementCandidate {
  attemptId: string;
  /**
   * The attempt's raw `dateText` — usually Rezdy's structured "YYYY-MM-DD HH:MM:SS" session time
   * (see resolveRezdyDateRange / parseSelectedTimeOption in booking-orchestrator.ts), but can still
   * be an unresolved relative word ("today"/"tomorrow"/"tonight") for the rare booking whose PMS
   * availability had zero explicit time options and never routed through disambiguation. Parsing is
   * intentionally conservative: an unparseable value must never be treated as "due," only ever
   * excluded and left for manual settlement.
   */
  dateText: string;
}

export interface SettlementDecision {
  due: boolean;
  /** Parsed travel date/time, or null when dateText could not be reliably resolved. */
  travelDate: Date | null;
}
