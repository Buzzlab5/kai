import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { findBookingsReadyToSettle } from "@/core/settlement/rules";
import type { SettlementCandidate } from "@/core/settlement/types";
import { settlePmsBookingPaymentAttempt } from "./bluepass-pms-stripe";
import type { BluePassStripeEnv } from "./bluepass-stripe";

/**
 * Milestone 2 (payment-settlement plan): the live layer over src/core/settlement/rules.ts -
 * queries every CONFIRMED booking, hands them to the pure decision function, and settles the ones
 * whose travel date has passed. Never invented for the caller: settlePmsBookingPaymentAttempt only
 * auto-releases via a real Stripe Connect account (no paidOutReference is passed here, since a cron
 * can't invent a bank-transfer reference) - a CONFIRMED booking whose operator isn't yet onboarded
 * to Stripe Connect simply throws and is recorded as skipped, staying available for the existing
 * manual admin settle endpoint indefinitely. This is the same fail-closed posture as
 * resolveOperatorPayoutAccount: never guess, never force a payout path that isn't real.
 */
const SETTLEMENT_SYSTEM_REVIEWER = "cron@bluepass.co";

export interface SettlementSweepResult {
  checked: number;
  settled: string[];
  skipped: { attemptId: string; reason: string }[];
}

export async function runSettlementSweep(
  now: Date = new Date(),
  deps: { stripeClient?: Stripe; env?: BluePassStripeEnv; fetcher?: typeof fetch } = {}
): Promise<SettlementSweepResult> {
  const confirmedAttempts = await prisma.pmsBookingPaymentAttempt.findMany({
    where: { status: "CONFIRMED" },
    select: { id: true, dateText: true }
  });

  const candidates: SettlementCandidate[] = confirmedAttempts.map((attempt) => ({
    attemptId: attempt.id,
    dateText: attempt.dateText
  }));
  const dueBookings = findBookingsReadyToSettle(candidates, now);

  const settled: string[] = [];
  const skipped: { attemptId: string; reason: string }[] = [];

  for (const booking of dueBookings) {
    try {
      await settlePmsBookingPaymentAttempt(
        { attemptId: booking.attemptId, reviewerEmail: SETTLEMENT_SYSTEM_REVIEWER },
        deps
      );
      settled.push(booking.attemptId);
    } catch (error) {
      skipped.push({
        attemptId: booking.attemptId,
        reason: error instanceof Error ? error.message : "Unknown settlement error."
      });
    }
  }

  return { checked: confirmedAttempts.length, settled, skipped };
}
