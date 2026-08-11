import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  cancelPmsBookingPaymentAttempt,
  createBluePassCheckoutSessionForPmsBooking,
  markPmsBookingLedgerEntryPaid,
  releasePmsBookingLedgerEntryPayoutViaStripe,
  settlePmsBookingPaymentAttempt
} from "./bluepass-pms-stripe";

// No test DB exists in this repo - these tests write real rows to the same Supabase instance
// production reads from (see createSettleableAttempt's `settle-test-` tenant slug prefix below).
// Without this cleanup, a leftover CONFIRMED attempt with a past dateText would be picked up forever
// by the Milestone 2 settlement cron sweep (src/server/payments/settlement-cron.ts) on every run -
// confirmed this actually happened: 22 leftover rows from earlier sessions were found live in
// production before this hook was added.
afterAll(async () => {
  const testTenants = await prisma.tenant.findMany({
    where: { slug: { startsWith: "settle-test-" } },
    select: { id: true }
  });
  const tenantIds = testTenants.map((tenant) => tenant.id);
  if (tenantIds.length === 0) return;
  await prisma.pmsBookingPaymentAttempt.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
});

function fakeStripeClient(sessionId: string) {
  return {
    checkout: {
      sessions: {
        create: vi.fn(async () => ({
          id: sessionId,
          url: `https://checkout.stripe.com/c/pay/${sessionId}`,
          payment_intent: null
        }))
      }
    }
  };
}

describe("createBluePassCheckoutSessionForPmsBooking", () => {
  it("creates a Stripe Checkout Session with the correct amount/currency/metadata and persists an AWAITING_PAYMENT attempt", async () => {
    const sessionId = `cs_test_${randomUUID()}`;
    const stripeClient = fakeStripeClient(sessionId);
    const tenantId = `tenant_${randomUUID()}`;
    const conversationId = `conv_${randomUUID()}`;

    const result = await createBluePassCheckoutSessionForPmsBooking(
      {
        tenantId,
        conversationId,
        pmsProvider: "REZDY",
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-26 13:30:00",
        guests: 2,
        travellerName: "Test",
        travellerEmail: "test@gmail.com",
        travellerPhone: "086775428176",
        ticketQuantities: [{ optionLabel: "Adult", quantity: 2 }],
        extraQuantities: [],
        grossAmountCents: 10000,
        currency: "AUD",
        externalBookingId: "RZ-HOLD-1"
      },
      { stripeClient: stripeClient as never, env: { BLUEPASS_STRIPE_SECRET_KEY: "sk_test_x", KAI_APP_URL: "https://kai.example" } }
    );

    expect(result.checkoutUrl).toBe(`https://checkout.stripe.com/c/pay/${sessionId}`);
    expect(result.sessionId).toBe(sessionId);

    expect(stripeClient.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "payment",
        line_items: [
          expect.objectContaining({
            quantity: 1,
            price_data: expect.objectContaining({
              currency: "aud",
              unit_amount: 10000
            })
          })
        ],
        success_url: "https://kai.example/embed/kai/payment-return?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://kai.example/embed/kai/payment-return?session_id={CHECKOUT_SESSION_ID}&cancelled=true",
        metadata: {
          kaiFlow: "PMS_BOOKING_DIRECT",
          tenantId,
          conversationId,
          pmsProvider: "REZDY"
        }
      })
    );

    const attempt = await prisma.pmsBookingPaymentAttempt.findUnique({
      where: { id: result.attemptId }
    });

    expect(attempt).toMatchObject({
      tenantId,
      conversationId,
      pmsProvider: "REZDY",
      productTitle: "Gold Coast Whale Escape",
      grossAmountCents: 10000,
      currency: "AUD",
      externalBookingId: "RZ-HOLD-1",
      stripeCheckoutSessionId: sessionId,
      status: "AWAITING_PAYMENT"
    });
  });

  it("throws and does not create an attempt row when Stripe does not return a checkout URL", async () => {
    const stripeClient = {
      checkout: {
        sessions: {
          create: vi.fn(async () => ({ id: "cs_no_url", url: null, payment_intent: null }))
        }
      }
    } as never;

    await expect(
      createBluePassCheckoutSessionForPmsBooking(
        {
          tenantId: `tenant_${randomUUID()}`,
          conversationId: `conv_${randomUUID()}`,
          pmsProvider: "REZDY",
          productExternalId: "boattime-whale-escape",
          productTitle: "Gold Coast Whale Escape",
          dateText: "2026-06-26 13:30:00",
          guests: 2,
          travellerName: "Test",
          travellerEmail: "test@gmail.com",
          grossAmountCents: 10000,
          currency: "AUD",
          externalBookingId: "RZ-HOLD-2"
        },
        { stripeClient, env: { BLUEPASS_STRIPE_SECRET_KEY: "sk_test_x" } }
      )
    ).rejects.toThrow("Stripe did not return a checkout URL for this session.");

    const attempt = await prisma.pmsBookingPaymentAttempt.findUnique({
      where: { stripeCheckoutSessionId: "cs_no_url" }
    });
    expect(attempt).toBeNull();
  });
});

async function createFinalizedLedgerEntry(kind: "OPERATOR_PAYOUT_PLACEHOLDER" | "CONSERVATION_ALLOCATION") {
  // A real Tenant row (not just a fake tenantId string) so the module-level afterAll cleanup above
  // can actually find and delete this - a fake tenantId here previously left a real CONFIRMED
  // PmsBookingPaymentAttempt in production with no way to clean it up by tenant lookup, which is
  // exactly the kind of stray row the Milestone 2 settlement cron sweep would pick up forever.
  const tenant = await prisma.tenant.create({
    data: {
      slug: `settle-test-${randomUUID()}`,
      name: "Settle Test Tenant (ledger release)",
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: ["https://example.test"],
      status: "ACTIVE"
    }
  });
  const tenantId = tenant.id;
  const conversationId = `conv_${randomUUID()}`;
  const attempt = await prisma.pmsBookingPaymentAttempt.create({
    data: {
      tenantId,
      conversationId,
      pmsProvider: "REZDY",
      productExternalId: "boattime-whale-escape",
      productTitle: "Gold Coast Whale Escape",
      dateText: "2026-06-26 13:30:00",
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

  return prisma.pmsBookingLedgerEntry.create({
    data: {
      tenantId,
      conversationId,
      pmsBookingPaymentAttemptId: attempt.id,
      kind,
      amountCents: 8200,
      currency: "AUD",
      status: "FINALIZED",
      finalizedAt: new Date()
    }
  });
}

describe("releasePmsBookingLedgerEntryPayoutViaStripe", () => {
  it("releases the operator's payout share as a real Stripe transfer and marks the entry paid", async () => {
    const payoutEntry = await createFinalizedLedgerEntry("OPERATOR_PAYOUT_PLACEHOLDER");
    const transferId = `tr_test_${randomUUID()}`;
    const transfersCreate = vi.fn(async () => ({ id: transferId }));

    const result = await releasePmsBookingLedgerEntryPayoutViaStripe(
      { entryId: payoutEntry.id, stripeConnectAccountId: "acct_operator_release", reviewerEmail: "admin@bluepass.co" },
      { stripeClient: { transfers: { create: transfersCreate } } as never }
    );

    expect(transfersCreate).toHaveBeenCalledWith({
      amount: payoutEntry.amountCents,
      currency: payoutEntry.currency.toLowerCase(),
      destination: "acct_operator_release"
    });
    expect(result).toMatchObject({ paidOutReference: transferId, paidOutBy: "admin@bluepass.co" });

    const payoutRecord = await prisma.pmsBookingOperatorPayout.findUnique({
      where: { pmsBookingLedgerEntryId: payoutEntry.id }
    });
    expect(payoutRecord).toMatchObject({
      status: "TRANSFERRED",
      stripeTransferId: transferId,
      stripeConnectAccountId: "acct_operator_release"
    });
  });

  it("refuses to release a non-operator ledger entry via Stripe transfer", async () => {
    const conservationEntry = await createFinalizedLedgerEntry("CONSERVATION_ALLOCATION");
    const transfersCreate = vi.fn();

    await expect(
      releasePmsBookingLedgerEntryPayoutViaStripe(
        { entryId: conservationEntry.id, stripeConnectAccountId: "acct_operator_guard", reviewerEmail: "admin@bluepass.co" },
        { stripeClient: { transfers: { create: transfersCreate } } as never }
      )
    ).rejects.toThrow(/OPERATOR_PAYOUT_PLACEHOLDER/);
    expect(transfersCreate).not.toHaveBeenCalled();
  });

  it("records a failed payout attempt and rethrows when the Stripe transfer itself fails", async () => {
    const payoutEntry = await createFinalizedLedgerEntry("OPERATOR_PAYOUT_PLACEHOLDER");
    const transfersCreate = vi.fn(async () => {
      throw new Error("Your destination account's capabilities have not been enabled.");
    });

    await expect(
      releasePmsBookingLedgerEntryPayoutViaStripe(
        { entryId: payoutEntry.id, stripeConnectAccountId: "acct_operator_failure", reviewerEmail: "admin@bluepass.co" },
        { stripeClient: { transfers: { create: transfersCreate } } as never }
      )
    ).rejects.toThrow("capabilities have not been enabled");

    const payoutRecord = await prisma.pmsBookingOperatorPayout.findUnique({
      where: { pmsBookingLedgerEntryId: payoutEntry.id }
    });
    expect(payoutRecord).toMatchObject({ status: "FAILED", failureReason: expect.stringContaining("capabilities") });

    const entryAfterFailure = await prisma.pmsBookingLedgerEntry.findUniqueOrThrow({ where: { id: payoutEntry.id } });
    expect(entryAfterFailure.paidOutAt).toBeNull();
  });

  it("is idempotent - re-releasing an already-paid entry is a no-op that does not call Stripe again", async () => {
    const payoutEntry = await createFinalizedLedgerEntry("OPERATOR_PAYOUT_PLACEHOLDER");
    await markPmsBookingLedgerEntryPaid({
      entryId: payoutEntry.id,
      paidOutReference: "manual-ref-123",
      reviewerEmail: "admin@bluepass.co"
    });
    const transfersCreate = vi.fn();

    const result = await releasePmsBookingLedgerEntryPayoutViaStripe(
      { entryId: payoutEntry.id, stripeConnectAccountId: "acct_operator_idempotent", reviewerEmail: "admin@bluepass.co" },
      { stripeClient: { transfers: { create: transfersCreate } } as never }
    );

    expect(transfersCreate).not.toHaveBeenCalled();
    expect(result.paidOutReference).toBe("manual-ref-123");
  });
});

async function createSettleableAttempt(status: "CONFIRMED" | "AWAITING_PAYMENT" = "CONFIRMED") {
  const tenant = await prisma.tenant.create({
    data: {
      slug: `settle-test-${randomUUID()}`,
      name: "Settle Test Tenant",
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
      dateText: "2026-06-26 13:30:00",
      guests: 2,
      travellerName: "Test",
      travellerEmail: "test@gmail.com",
      grossAmountCents: 10000,
      currency: "AUD",
      externalBookingId: "RZ-HOLD-1",
      stripeCheckoutSessionId: `cs_${randomUUID()}`,
      stripePaymentIntentId: `pi_${randomUUID()}`,
      status
    }
  });
  const payoutEntry = await prisma.pmsBookingLedgerEntry.create({
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

  return { tenant, attempt, payoutEntry };
}

/**
 * Unlike createSettleableAttempt, this creates a real Conversation (cancelPmsBookingPaymentAttempt
 * calls createAssistantMessage, which needs a real conversationId FK) and the full 4-entry ledger
 * split (conservation 5% / processing 3% / commission 10% / operator 82% of a 10000-cent gross, sums
 * exactly - real percentages don't matter for these tests, only that they sum to gross).
 */
async function createCancellableAttempt(dateText: string) {
  const tenant = await prisma.tenant.create({
    data: {
      slug: `settle-test-${randomUUID()}`,
      name: "Cancel Test Tenant",
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: ["https://example.test"],
      status: "ACTIVE"
    }
  });
  const conversation = await prisma.conversation.create({ data: { tenantId: tenant.id, channel: "WEB_WIDGET" } });
  const attempt = await prisma.pmsBookingPaymentAttempt.create({
    data: {
      tenantId: tenant.id,
      conversationId: conversation.id,
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
  await prisma.pmsBookingLedgerEntry.createMany({
    data: [
      { kind: "CONSERVATION_ALLOCATION" as const, amountCents: 500 },
      { kind: "PAYMENT_PROCESSING_ALLOCATION" as const, amountCents: 300 },
      { kind: "BLUEPASS_PLATFORM_COMMISSION" as const, amountCents: 1000 },
      { kind: "OPERATOR_PAYOUT_PLACEHOLDER" as const, amountCents: 8200 }
    ].map((entry) => ({
      tenantId: tenant.id,
      conversationId: conversation.id,
      pmsBookingPaymentAttemptId: attempt.id,
      currency: "AUD",
      status: "FINALIZED" as const,
      finalizedAt: new Date(),
      ...entry
    }))
  });

  return { tenant, attempt };
}

// Fixed "now" for every cancellation test below so day-before-departure math is deterministic and
// doesn't depend on the actual wall-clock date the suite happens to run on.
const CANCELLATION_TEST_NOW = new Date("2026-08-10T00:00:00Z");

function noopFetcher(cancellationPolicyTiers: { minDaysBeforeDeparture: number; refundPercent: number }[] | null = null) {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({ stripeConnectAccountId: null, chargesEnabled: false, payoutsEnabled: false, cancellationPolicyTiers }),
        { status: 200 }
      )
  );
}

describe("cancelPmsBookingPaymentAttempt", () => {
  it("refunds 100% and voids every ledger entry when the operator cancels, regardless of timing", async () => {
    const { attempt } = await createCancellableAttempt("2026-08-11 00:00:00"); // 1 day out - would be 0% for a customer
    const refundsCreate = vi.fn(async () => ({ id: `re_test_${randomUUID()}` }));

    const result = await cancelPmsBookingPaymentAttempt(
      { attemptId: attempt.id, cancelledBy: "OPERATOR", reviewerEmail: "admin@bluepass.co" },
      {
        stripeClient: { refunds: { create: refundsCreate } } as never,
        fetcher: noopFetcher() as unknown as typeof fetch,
        now: CANCELLATION_TEST_NOW
      }
    );

    expect(result.refundTierPercent).toBe(100);
    expect(result.refundAmountCents).toBe(10000);
    expect(refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: attempt.stripePaymentIntentId, amount: 10000 })
    );
    expect(result.attempt.status).toBe("CANCELLED_REFUNDED");
    expect(result.attempt.cancelledBy).toBe("OPERATOR");

    const entries = await prisma.pmsBookingLedgerEntry.findMany({ where: { pmsBookingPaymentAttemptId: attempt.id } });
    expect(entries.every((entry) => entry.status === "VOIDED")).toBe(true);
  }, 30000);

  it("prorates the retained ledger entries and always zeroes conservation on a partial refund", async () => {
    const { attempt } = await createCancellableAttempt("2026-08-15 00:00:00"); // 5 days out -> default policy's 50% tier
    const refundsCreate = vi.fn(async () => ({ id: `re_test_${randomUUID()}` }));

    const result = await cancelPmsBookingPaymentAttempt(
      { attemptId: attempt.id, cancelledBy: "CUSTOMER", reviewerEmail: "admin@bluepass.co" },
      {
        stripeClient: { refunds: { create: refundsCreate } } as never,
        fetcher: noopFetcher() as unknown as typeof fetch,
        now: CANCELLATION_TEST_NOW
      }
    );

    expect(result.refundTierPercent).toBe(50);
    expect(result.refundAmountCents).toBe(5000);
    expect(result.retainedCents).toBe(5000);
    expect(refundsCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 5000 }));

    const entries = await prisma.pmsBookingLedgerEntry.findMany({ where: { pmsBookingPaymentAttemptId: attempt.id } });
    const conservation = entries.filter((e) => e.kind === "CONSERVATION_ALLOCATION");
    expect(conservation).toHaveLength(1);
    expect(conservation[0].status).toBe("VOIDED");

    const retainedNew = entries.filter((e) => e.kind !== "CONSERVATION_ALLOCATION" && e.status === "FINALIZED");
    const retainedSum = retainedNew.reduce((total, e) => total + e.amountCents, 0);
    expect(retainedSum).toBe(5000);

    // Fixture: conservation 500 / processing 300 / commission 1000 / operatorPayout 8200 (of 10000
    // gross). Processing and operatorPayout scale cleanly to exactly 50% of their original amount;
    // commission absorbs BOTH its own 50% share (500) AND conservation's now-voided 50% share (250) -
    // BluePass keeps what it chose not to charge the customer, rather than it silently inflating the
    // operator's payout (confirmed via a live simulation and an explicit user decision 2026-08-10).
    const byKind = Object.fromEntries(retainedNew.map((e) => [e.kind, e.amountCents]));
    expect(byKind.PAYMENT_PROCESSING_ALLOCATION).toBe(150);
    expect(byKind.OPERATOR_PAYOUT_PLACEHOLDER).toBe(4100);
    expect(byKind.BLUEPASS_PLATFORM_COMMISSION).toBe(750);
  }, 30000);

  it("skips the Stripe refund call entirely on a 0% tier but still voids conservation", async () => {
    const { attempt } = await createCancellableAttempt("2026-08-10 12:00:00"); // same day -> 0%
    const refundsCreate = vi.fn(async () => ({ id: `re_test_${randomUUID()}` }));

    const result = await cancelPmsBookingPaymentAttempt(
      { attemptId: attempt.id, cancelledBy: "CUSTOMER", reviewerEmail: "admin@bluepass.co" },
      {
        stripeClient: { refunds: { create: refundsCreate } } as never,
        fetcher: noopFetcher() as unknown as typeof fetch,
        now: CANCELLATION_TEST_NOW
      }
    );

    expect(result.refundTierPercent).toBe(0);
    expect(result.refundAmountCents).toBe(0);
    expect(refundsCreate).not.toHaveBeenCalled();

    const conservation = await prisma.pmsBookingLedgerEntry.findFirst({
      where: { pmsBookingPaymentAttemptId: attempt.id, kind: "CONSERVATION_ALLOCATION" }
    });
    expect(conservation?.status).toBe("VOIDED");
  }, 30000);

  it("uses the operator's own policy tiers instead of the platform default when one is set", async () => {
    const { attempt } = await createCancellableAttempt("2026-08-17 00:00:00"); // 7 days out
    const refundsCreate = vi.fn(async () => ({ id: `re_test_${randomUUID()}` }));
    const fetcher = noopFetcher([
      { minDaysBeforeDeparture: 30, refundPercent: 100 },
      { minDaysBeforeDeparture: 0, refundPercent: 25 }
    ]);

    const result = await cancelPmsBookingPaymentAttempt(
      { attemptId: attempt.id, cancelledBy: "CUSTOMER", reviewerEmail: "admin@bluepass.co" },
      {
        stripeClient: { refunds: { create: refundsCreate } } as never,
        fetcher: fetcher as unknown as typeof fetch,
        now: CANCELLATION_TEST_NOW
      }
    );

    expect(result.refundTierPercent).toBe(25);
  }, 30000);

  it("throws and does not touch anything when the travel date can't be resolved and no override is given", async () => {
    const { attempt } = await createCancellableAttempt("tomorrow");
    const refundsCreate = vi.fn();

    await expect(
      cancelPmsBookingPaymentAttempt(
        { attemptId: attempt.id, cancelledBy: "CUSTOMER", reviewerEmail: "admin@bluepass.co" },
        {
        stripeClient: { refunds: { create: refundsCreate } } as never,
        fetcher: noopFetcher() as unknown as typeof fetch,
        now: CANCELLATION_TEST_NOW
      }
      )
    ).rejects.toThrow(/Cannot auto-determine a refund tier/);

    expect(refundsCreate).not.toHaveBeenCalled();
    const unchanged = await prisma.pmsBookingPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(unchanged.status).toBe("CONFIRMED");
  }, 30000);

  it("uses an explicit refundTierPercentOverride instead of the automatic lookup/calculation", async () => {
    const { attempt } = await createCancellableAttempt("tomorrow"); // unresolvable - override must bypass this entirely
    const refundsCreate = vi.fn(async () => ({ id: `re_test_${randomUUID()}` }));

    const result = await cancelPmsBookingPaymentAttempt(
      { attemptId: attempt.id, cancelledBy: "ADMIN", reviewerEmail: "admin@bluepass.co", refundTierPercentOverride: 75 },
      { stripeClient: { refunds: { create: refundsCreate } } as never, fetcher: vi.fn() as unknown as typeof fetch }
    );

    expect(result.refundTierPercent).toBe(75);
    expect(result.refundAmountCents).toBe(7500);
  }, 30000);

  it("refuses to cancel a booking that isn't CONFIRMED", async () => {
    const { attempt } = await createCancellableAttempt("2026-08-15 00:00:00");
    await prisma.pmsBookingPaymentAttempt.update({ where: { id: attempt.id }, data: { status: "SETTLED" } });

    await expect(
      cancelPmsBookingPaymentAttempt(
        { attemptId: attempt.id, cancelledBy: "CUSTOMER", reviewerEmail: "admin@bluepass.co", refundTierPercentOverride: 100 },
        { fetcher: vi.fn() as unknown as typeof fetch }
      )
    ).rejects.toThrow(/not CONFIRMED/);
  });
});

describe("settlePmsBookingPaymentAttempt", () => {
  it("looks up the Stripe Connect account automatically and releases a real transfer when the operator is onboarded", async () => {
    const { tenant, attempt } = await createSettleableAttempt();
    const transferId = `tr_test_${randomUUID()}`;
    const transfersCreate = vi.fn(async () => ({ id: transferId }));
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ stripeConnectAccountId: "acct_auto_lookup", chargesEnabled: true, payoutsEnabled: true }), {
        status: 200
      })
    );

    const result = await settlePmsBookingPaymentAttempt(
      { attemptId: attempt.id, reviewerEmail: "admin@bluepass.co" },
      {
        stripeClient: { transfers: { create: transfersCreate } } as never,
        env: { BLUEPASS_APP_URL: "https://bluepass.co", BLUEPASS_APP_SERVICE_TOKEN: "secret" },
        fetcher: fetcher as unknown as typeof fetch
      }
    );

    expect(fetcher).toHaveBeenCalled();
    const [url] = fetcher.mock.calls[0] as unknown as [string];
    expect(url).toContain(`tenantSlug=${tenant.slug}`);
    expect(transfersCreate).toHaveBeenCalledWith(
      expect.objectContaining({ destination: "acct_auto_lookup" })
    );
    expect(result.method).toBe("STRIPE");
    expect(result.attempt.status).toBe("SETTLED");
    expect(result.attempt.settledAt).not.toBeNull();
  }, 30000);

  it("uses an explicitly-supplied Stripe Connect account id instead of looking one up", async () => {
    const { attempt } = await createSettleableAttempt();
    const transfersCreate = vi.fn(async () => ({ id: `tr_test_${randomUUID()}` }));
    const fetcher = vi.fn();

    const result = await settlePmsBookingPaymentAttempt(
      { attemptId: attempt.id, reviewerEmail: "admin@bluepass.co", stripeConnectAccountId: "acct_manual_override" },
      { stripeClient: { transfers: { create: transfersCreate } } as never, fetcher: fetcher as unknown as typeof fetch }
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(transfersCreate).toHaveBeenCalledWith(expect.objectContaining({ destination: "acct_manual_override" }));
    expect(result.method).toBe("STRIPE");
  }, 30000);

  it("falls back to the manual bank-transfer path when no Stripe Connect account is linked yet", async () => {
    const { attempt } = await createSettleableAttempt();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ stripeConnectAccountId: null, chargesEnabled: false, payoutsEnabled: false }), { status: 200 }));

    const result = await settlePmsBookingPaymentAttempt(
      { attemptId: attempt.id, reviewerEmail: "admin@bluepass.co", paidOutReference: "bank-ref-456" },
      { env: { BLUEPASS_APP_URL: "https://bluepass.co", BLUEPASS_APP_SERVICE_TOKEN: "secret" }, fetcher: fetcher as unknown as typeof fetch }
    );

    expect(result.method).toBe("MANUAL");
    expect(result.ledgerEntry.paidOutReference).toBe("bank-ref-456");
    expect(result.attempt.status).toBe("SETTLED");
  }, 30000);

  it("throws and does not settle when no Stripe account is linked and no manual reference is supplied", async () => {
    const { attempt } = await createSettleableAttempt();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ stripeConnectAccountId: null, chargesEnabled: false, payoutsEnabled: false }), { status: 200 }));

    await expect(
      settlePmsBookingPaymentAttempt(
        { attemptId: attempt.id, reviewerEmail: "admin@bluepass.co" },
        { env: { BLUEPASS_APP_URL: "https://bluepass.co", BLUEPASS_APP_SERVICE_TOKEN: "secret" }, fetcher: fetcher as unknown as typeof fetch }
      )
    ).rejects.toThrow(/No Stripe Connect account is linked/);

    const unchanged = await prisma.pmsBookingPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(unchanged.status).toBe("CONFIRMED");
    expect(unchanged.settledAt).toBeNull();
  }, 30000);

  it("throws a specific Airwallex-not-live message when the operator's rail is Airwallex and no manual reference is supplied", async () => {
    const { attempt } = await createSettleableAttempt();
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ stripeConnectAccountId: null, chargesEnabled: false, payoutsEnabled: false, payoutMethod: "AIRWALLEX" }),
          { status: 200 }
        )
    );

    await expect(
      settlePmsBookingPaymentAttempt(
        { attemptId: attempt.id, reviewerEmail: "admin@bluepass.co" },
        { env: { BLUEPASS_APP_URL: "https://bluepass.co", BLUEPASS_APP_SERVICE_TOKEN: "secret" }, fetcher: fetcher as unknown as typeof fetch }
      )
    ).rejects.toThrow(/Airwallex payout rail, which is not live yet/);

    const unchanged = await prisma.pmsBookingPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(unchanged.status).toBe("CONFIRMED");
  }, 30000);

  it("refuses to settle a booking that isn't CONFIRMED yet", async () => {
    const { attempt } = await createSettleableAttempt("AWAITING_PAYMENT");

    await expect(
      settlePmsBookingPaymentAttempt({ attemptId: attempt.id, reviewerEmail: "admin@bluepass.co", paidOutReference: "ref" })
    ).rejects.toThrow(/not CONFIRMED/);
  });
});
