import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getPlatformStats } from "./platform-stats";

/**
 * No test DB exists in this repo, and getPlatformStats aggregates across every tenant at once - it
 * has no prefix to scope a query by. So instead of asserting an absolute total (which real
 * production rows would make flaky), this snapshots the totals before inserting a known set of
 * FINALIZED rows, then asserts the *delta* matches exactly what was inserted. Cleans up after itself
 * either way.
 */
async function createTestTenant() {
  return prisma.tenant.create({
    data: {
      slug: `platform-stats-test-${randomUUID()}`,
      name: "Platform Stats Test",
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: ["https://example.test"],
      status: "ACTIVE"
    }
  });
}

describe("getPlatformStats", () => {
  it("sums FINALIZED AU ledger entries by kind and currency across tenants, and counts distinct bookings", async () => {
    const before = await getPlatformStats();

    const tenant = await createTestTenant();
    const conversation = await prisma.conversation.create({ data: { tenantId: tenant.id, channel: "WEB_WIDGET" } });
    const attempt = await prisma.pmsBookingPaymentAttempt.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        pmsProvider: "REZDY",
        productExternalId: "stats-test-product",
        productTitle: "Stats Test Trip",
        dateText: "2026-09-01 09:00:00",
        guests: 2,
        travellerName: "Stats Test",
        travellerEmail: "stats-test@example.test",
        grossAmountCents: 10_000,
        currency: "AUD",
        externalBookingId: "STATS-TEST-1",
        stripeCheckoutSessionId: `cs_stats_${randomUUID()}`,
        status: "CONFIRMED"
      }
    });
    await prisma.pmsBookingLedgerEntry.createMany({
      data: [
        {
          tenantId: tenant.id,
          conversationId: conversation.id,
          pmsBookingPaymentAttemptId: attempt.id,
          kind: "CONSERVATION_ALLOCATION",
          amountCents: 500,
          currency: "AUD",
          status: "FINALIZED",
          finalizedAt: new Date()
        },
        {
          tenantId: tenant.id,
          conversationId: conversation.id,
          pmsBookingPaymentAttemptId: attempt.id,
          kind: "OPERATOR_PAYOUT_PLACEHOLDER",
          amountCents: 8_200,
          currency: "AUD",
          status: "FINALIZED",
          finalizedAt: new Date()
        },
        {
          // PENDING must never count toward "real" totals.
          tenantId: tenant.id,
          conversationId: conversation.id,
          pmsBookingPaymentAttemptId: attempt.id,
          kind: "BLUEPASS_PLATFORM_COMMISSION",
          amountCents: 999_999,
          currency: "AUD",
          status: "PENDING"
        }
      ]
    });

    const after = await getPlatformStats();

    const findAmount = (stats: typeof after, kind: string, currency: string) =>
      stats.au.totalsByKindAndCurrency.find((row) => row.kind === kind && row.currency === currency)
        ?.amountCents ?? 0;

    expect(findAmount(after, "CONSERVATION_ALLOCATION", "AUD") - findAmount(before, "CONSERVATION_ALLOCATION", "AUD")).toBe(500);
    expect(
      findAmount(after, "OPERATOR_PAYOUT_PLACEHOLDER", "AUD") - findAmount(before, "OPERATOR_PAYOUT_PLACEHOLDER", "AUD")
    ).toBe(8_200);
    // The PENDING row must not move this total at all.
    expect(
      findAmount(after, "BLUEPASS_PLATFORM_COMMISSION", "AUD") - findAmount(before, "BLUEPASS_PLATFORM_COMMISSION", "AUD")
    ).toBe(0);
    expect(after.au.bookingCount - before.au.bookingCount).toBe(1);

    await prisma.pmsBookingLedgerEntry.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.pmsBookingPaymentAttempt.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.conversation.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
  }, 30_000);
});
