import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { runSettlementSweep } from "./settlement-cron";

async function createConfirmedAttempt(dateText: string) {
  const tenant = await prisma.tenant.create({
    data: {
      slug: `settle-cron-test-${randomUUID()}`,
      name: "Settlement Cron Test Tenant",
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: ["https://example.test"],
      status: "ACTIVE"
    }
  });
  const conversationId = `conv_${randomUUID()}`;
  const attempt = await prisma.pmsBookingPaymentAttempt.create({
    data: {
      tenantId: tenant.id,
      conversationId,
      pmsProvider: "REZDY",
      productExternalId: "boattime-whale-escape",
      productTitle: "Gold Coast Whale Escape",
      dateText,
      guests: 2,
      travellerName: "Test",
      travellerEmail: "test@gmail.com",
      grossAmountCents: 10000,
      currency: "AUD",
      externalBookingId: "RZ-HOLD-1",
      stripeCheckoutSessionId: `cs_${randomUUID()}`,
      stripePaymentIntentId: `pi_${randomUUID()}`,
      status: "CONFIRMED"
    }
  });
  await prisma.pmsBookingLedgerEntry.create({
    data: {
      tenantId: tenant.id,
      conversationId,
      pmsBookingPaymentAttemptId: attempt.id,
      kind: "OPERATOR_PAYOUT_PLACEHOLDER",
      amountCents: 8200,
      currency: "AUD",
      status: "FINALIZED",
      finalizedAt: new Date()
    }
  });

  return { tenant, attempt };
}

// Deliberately a different prefix from bluepass-pms-stripe.test.ts's "settle-test-" - vitest runs
// test files in parallel by default, so a shared prefix means one file's afterAll can delete a
// tenant the other file's still-running test still needs (reproduced: caused a real failure here).
afterAll(async () => {
  const testTenants = await prisma.tenant.findMany({
    where: { slug: { startsWith: "settle-cron-test-" } },
    select: { id: true }
  });
  const tenantIds = testTenants.map((tenant) => tenant.id);
  if (tenantIds.length === 0) return;
  await prisma.pmsBookingPaymentAttempt.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
});

describe("runSettlementSweep", () => {
  it("settles a due booking automatically via Stripe when the operator is onboarded", async () => {
    const { attempt } = await createConfirmedAttempt("2026-06-26 13:30:00");
    const transfersCreate = vi.fn(async () => ({ id: `tr_test_${randomUUID()}` }));
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({ stripeConnectAccountId: "acct_auto_lookup", chargesEnabled: true, payoutsEnabled: true }),
        { status: 200 }
      )
    );

    const result = await runSettlementSweep(new Date("2026-08-10T00:00:00Z"), {
      stripeClient: { transfers: { create: transfersCreate } } as never,
      env: { BLUEPASS_APP_URL: "https://bluepass.co", BLUEPASS_APP_SERVICE_TOKEN: "secret" },
      fetcher: fetcher as unknown as typeof fetch
    });

    expect(result.settled).toContain(attempt.id);
    expect(transfersCreate).toHaveBeenCalledWith(expect.objectContaining({ destination: "acct_auto_lookup" }));

    const settled = await prisma.pmsBookingPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(settled.status).toBe("SETTLED");
  }, 30000);

  it("skips a due booking whose operator has no Stripe Connect account, without throwing", async () => {
    const { attempt } = await createConfirmedAttempt("2026-06-26 13:30:00");
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ stripeConnectAccountId: null, chargesEnabled: false, payoutsEnabled: false }), {
        status: 200
      })
    );

    const result = await runSettlementSweep(new Date("2026-08-10T00:00:00Z"), {
      env: { BLUEPASS_APP_URL: "https://bluepass.co", BLUEPASS_APP_SERVICE_TOKEN: "secret" },
      fetcher: fetcher as unknown as typeof fetch
    });

    expect(result.settled).not.toContain(attempt.id);
    const skipped = result.skipped.find((s) => s.attemptId === attempt.id);
    expect(skipped?.reason).toMatch(/No Stripe Connect account is linked/);

    const unchanged = await prisma.pmsBookingPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(unchanged.status).toBe("CONFIRMED");
  }, 30000);

  it("does not touch a confirmed booking whose travel date hasn't passed yet", async () => {
    const { attempt } = await createConfirmedAttempt("2026-12-25 09:00:00");

    const result = await runSettlementSweep(new Date("2026-08-10T00:00:00Z"));

    expect(result.settled).not.toContain(attempt.id);
    expect(result.skipped.some((s) => s.attemptId === attempt.id)).toBe(false);

    const unchanged = await prisma.pmsBookingPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(unchanged.status).toBe("CONFIRMED");
  }, 30000);

  it("does not touch a confirmed booking with an unresolvable travel date", async () => {
    const { attempt } = await createConfirmedAttempt("tomorrow");

    const result = await runSettlementSweep(new Date("2026-08-10T00:00:00Z"));

    expect(result.settled).not.toContain(attempt.id);
    expect(result.skipped.some((s) => s.attemptId === attempt.id)).toBe(false);

    const unchanged = await prisma.pmsBookingPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(unchanged.status).toBe("CONFIRMED");
  }, 30000);
});
