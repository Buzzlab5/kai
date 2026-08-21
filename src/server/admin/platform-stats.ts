import { prisma } from "@/lib/prisma";

export type LedgerKindTotal = {
  kind: string;
  currency: string;
  amountCents: number;
};

export type RegionStats = {
  totalsByKindAndCurrency: LedgerKindTotal[];
  /** Distinct confirmed/finalized bookings the ledger totals above were computed from. */
  bookingCount: number;
};

export type PlatformStats = {
  au: RegionStats;
  indonesia: RegionStats;
};

/**
 * The real numbers behind the admin overview page - every FINALIZED ledger line, summed by kind and
 * currency, across every tenant at once. Nothing here is invented or estimated: it's the same rows
 * the payouts page already reads per-tenant, just aggregated across all of them in one query instead
 * of requiring the caller to already know every tenant slug to ask about.
 *
 * FINALIZED only (not PENDING/VOIDED) - a stats page claiming revenue that hasn't actually settled
 * yet would overstate what's real, exactly the kind of fabricated-number risk this whole project has
 * held a hard line against all along.
 */
export async function getPlatformStats(): Promise<PlatformStats> {
  const [auTotals, auBookingCount, idTotals, idBookingCount] = await Promise.all([
    prisma.pmsBookingLedgerEntry.groupBy({
      by: ["kind", "currency"],
      where: { status: "FINALIZED" },
      _sum: { amountCents: true }
    }),
    prisma.pmsBookingLedgerEntry.findMany({
      where: { status: "FINALIZED" },
      distinct: ["pmsBookingPaymentAttemptId"],
      select: { pmsBookingPaymentAttemptId: true }
    }),
    prisma.bluePassLedgerEntry.groupBy({
      by: ["kind", "currency"],
      where: { status: "FINALIZED" },
      _sum: { amountCents: true }
    }),
    prisma.bluePassLedgerEntry.findMany({
      where: { status: "FINALIZED" },
      distinct: ["bluePassInquiryId"],
      select: { bluePassInquiryId: true }
    })
  ]);

  const toTotals = (rows: { kind: string; currency: string; _sum: { amountCents: number | null } }[]) =>
    rows.map((row) => ({
      kind: row.kind,
      currency: row.currency,
      amountCents: row._sum.amountCents ?? 0
    }));

  return {
    au: { totalsByKindAndCurrency: toTotals(auTotals), bookingCount: auBookingCount.length },
    indonesia: { totalsByKindAndCurrency: toTotals(idTotals), bookingCount: idBookingCount.length }
  };
}
