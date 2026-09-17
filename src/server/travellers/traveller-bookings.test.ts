import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  findAwaitingPaymentAttemptForTraveller,
  getTravellerConservationTotal,
  listBookingsForTravellerAccount
} from "./traveller-bookings";

async function createTestTenant(label: string) {
  return prisma.tenant.create({
    data: {
      slug: `traveller-bookings-${label}-${randomUUID()}`,
      name: `Traveller Bookings ${label} Test`,
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: ["https://example.test"],
      status: "ACTIVE"
    }
  });
}

// No test DB exists in this repo - these tests write real rows to the same Supabase instance
// production reads from.
afterAll(async () => {
  const testTenants = await prisma.tenant.findMany({
    where: { slug: { startsWith: "traveller-bookings-" } },
    select: { id: true }
  });
  const tenantIds = testTenants.map((tenant) => tenant.id);
  if (tenantIds.length === 0) return;

  const conversations = await prisma.conversation.findMany({
    where: { tenantId: { in: tenantIds } },
    select: { id: true }
  });
  const conversationIds = conversations.map((conversation) => conversation.id);

  if (conversationIds.length > 0) {
    await prisma.pmsBookingPaymentAttempt.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await prisma.bluePassInquiry.deleteMany({ where: { conversationId: { in: conversationIds } } });
  }
  await prisma.conversation.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
});

describe("listBookingsForTravellerAccount", () => {
  it("returns nothing for an account with no linked conversations", async () => {
    const result = await listBookingsForTravellerAccount(`unlinked-${randomUUID()}`);

    expect(result).toEqual({ auBookings: [], indonesiaInquiries: [] });
  });

  it("finds an AU booking through a WEB_WIDGET conversation tagged with the account id", async () => {
    const tenant = await createTestTenant("au");
    const travellerAccountId = `account-${randomUUID()}`;
    const conversation = await prisma.conversation.create({
      data: { tenantId: tenant.id, channel: "WEB_WIDGET", controlMode: "AI", travellerId: travellerAccountId }
    });
    await prisma.pmsBookingPaymentAttempt.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        pmsProvider: "REZDY",
        productExternalId: "prod-1",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-09-01",
        guests: 2,
        travellerName: "Test Traveller",
        travellerEmail: "traveller@example.test",
        grossAmountCents: 15900,
        currency: "AUD",
        externalBookingId: `ext-${randomUUID()}`,
        stripeCheckoutSessionId: `cs_${randomUUID()}`
      }
    });

    const result = await listBookingsForTravellerAccount(travellerAccountId);

    expect(result.auBookings).toHaveLength(1);
    expect(result.auBookings[0].productTitle).toBe("Gold Coast Whale Escape");
    expect(result.auBookings[0].tenant).toEqual({ slug: tenant.slug, name: tenant.name });
    expect(result.indonesiaInquiries).toHaveLength(0);
  });

  it("finds an Indonesia inquiry through a WEB_WIDGET conversation tagged with the account id", async () => {
    const tenant = await createTestTenant("id");
    const travellerAccountId = `account-${randomUUID()}`;
    const conversation = await prisma.conversation.create({
      data: { tenantId: tenant.id, channel: "WEB_WIDGET", controlMode: "AI", travellerId: travellerAccountId }
    });
    await prisma.bluePassInquiry.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        destination: "Raja Ampat",
        selectedYachtName: "Aliikai",
        travellerMessage: "Looking for a December liveaboard."
      }
    });

    const result = await listBookingsForTravellerAccount(travellerAccountId);

    expect(result.indonesiaInquiries).toHaveLength(1);
    expect(result.indonesiaInquiries[0].selectedYachtName).toBe("Aliikai");
    expect(result.auBookings).toHaveLength(0);
  });

  it("never matches a WHATSAPP conversation, even if its phone-number travellerId happens to be requested", async () => {
    const tenant = await createTestTenant("whatsapp");
    const phoneAsTravellerId = `62811${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const conversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        channel: "WHATSAPP",
        controlMode: "AI",
        travellerId: phoneAsTravellerId,
        whatsappPhone: phoneAsTravellerId
      }
    });
    await prisma.bluePassInquiry.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        travellerMessage: "Hi from WhatsApp"
      }
    });

    const result = await listBookingsForTravellerAccount(phoneAsTravellerId);

    expect(result).toEqual({ auBookings: [], indonesiaInquiries: [] });
  });

  it("keeps two accounts' bookings separate even within the same tenant", async () => {
    const tenant = await createTestTenant("isolation");
    const accountA = `account-${randomUUID()}`;
    const accountB = `account-${randomUUID()}`;
    const conversationA = await prisma.conversation.create({
      data: { tenantId: tenant.id, channel: "WEB_WIDGET", controlMode: "AI", travellerId: accountA }
    });
    await prisma.conversation.create({
      data: { tenantId: tenant.id, channel: "WEB_WIDGET", controlMode: "AI", travellerId: accountB }
    });
    await prisma.bluePassInquiry.create({
      data: { tenantId: tenant.id, conversationId: conversationA.id, travellerMessage: "Only mine" }
    });

    const resultB = await listBookingsForTravellerAccount(accountB);

    expect(resultB).toEqual({ auBookings: [], indonesiaInquiries: [] });
  });
});

describe("getTravellerConservationTotal", () => {
  it("returns nothing for an account with no linked conversations", async () => {
    expect(await getTravellerConservationTotal(`unlinked-${randomUUID()}`)).toEqual([]);
  });

  it("sums FINALIZED CONSERVATION_ALLOCATION across both regions, by currency", async () => {
    const tenant = await createTestTenant("conservation");
    const travellerAccountId = `account-${randomUUID()}`;
    const auConversation = await prisma.conversation.create({
      data: { tenantId: tenant.id, channel: "WEB_WIDGET", controlMode: "AI", travellerId: travellerAccountId }
    });
    const attempt = await prisma.pmsBookingPaymentAttempt.create({
      data: {
        tenantId: tenant.id,
        conversationId: auConversation.id,
        pmsProvider: "REZDY",
        productExternalId: "prod-conservation",
        productTitle: "Reef Trip",
        dateText: "2026-09-01",
        guests: 2,
        travellerName: "Test Traveller",
        travellerEmail: "traveller@example.test",
        grossAmountCents: 15900,
        currency: "AUD",
        externalBookingId: `ext-${randomUUID()}`,
        stripeCheckoutSessionId: `cs_${randomUUID()}`
      }
    });
    await prisma.pmsBookingLedgerEntry.create({
      data: {
        tenantId: tenant.id,
        conversationId: auConversation.id,
        pmsBookingPaymentAttemptId: attempt.id,
        kind: "CONSERVATION_ALLOCATION",
        amountCents: 795,
        currency: "AUD",
        status: "FINALIZED",
        finalizedAt: new Date()
      }
    });
    // A PENDING row must never count - this traveller hasn't actually funded it yet.
    await prisma.pmsBookingLedgerEntry.create({
      data: {
        tenantId: tenant.id,
        conversationId: auConversation.id,
        pmsBookingPaymentAttemptId: attempt.id,
        kind: "CONSERVATION_ALLOCATION",
        amountCents: 999_999,
        currency: "AUD",
        status: "PENDING"
      }
    });

    const idConversation = await prisma.conversation.create({
      data: { tenantId: tenant.id, channel: "WEB_WIDGET", controlMode: "AI", travellerId: travellerAccountId }
    });
    const inquiry = await prisma.bluePassInquiry.create({
      data: { tenantId: tenant.id, conversationId: idConversation.id, travellerMessage: "Komodo trip" }
    });
    await prisma.bluePassLedgerEntry.create({
      data: {
        tenantId: tenant.id,
        conversationId: idConversation.id,
        bluePassInquiryId: inquiry.id,
        kind: "CONSERVATION_ALLOCATION",
        amountCents: 250,
        currency: "USD",
        status: "FINALIZED",
        finalizedAt: new Date()
      }
    });

    const totals = await getTravellerConservationTotal(travellerAccountId);

    expect(totals).toEqual([
      { currency: "AUD", amountCents: 795 },
      { currency: "USD", amountCents: 250 }
    ]);
  }, 30_000);

  it("never counts another traveller's contribution", async () => {
    const tenant = await createTestTenant("conservation-isolation");
    const accountA = `account-${randomUUID()}`;
    const accountB = `account-${randomUUID()}`;
    const conversationA = await prisma.conversation.create({
      data: { tenantId: tenant.id, channel: "WEB_WIDGET", controlMode: "AI", travellerId: accountA }
    });
    const inquiryA = await prisma.bluePassInquiry.create({
      data: { tenantId: tenant.id, conversationId: conversationA.id, travellerMessage: "Only mine" }
    });
    await prisma.bluePassLedgerEntry.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversationA.id,
        bluePassInquiryId: inquiryA.id,
        kind: "CONSERVATION_ALLOCATION",
        amountCents: 500,
        currency: "USD",
        status: "FINALIZED",
        finalizedAt: new Date()
      }
    });

    expect(await getTravellerConservationTotal(accountB)).toEqual([]);
  });
});

describe("findAwaitingPaymentAttemptForTraveller", () => {
  it("returns null for an account with no linked conversations", async () => {
    expect(await findAwaitingPaymentAttemptForTraveller(`unlinked-${randomUUID()}`)).toBeNull();
  });

  async function createAttempt(input: {
    tenantId: string;
    conversationId: string;
    status: "AWAITING_PAYMENT" | "CONFIRMED" | "PAYMENT_FAILED";
    productTitle: string;
  }) {
    return prisma.pmsBookingPaymentAttempt.create({
      data: {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        pmsProvider: "REZDY",
        productExternalId: "prod-unfinished",
        productTitle: input.productTitle,
        dateText: "2026-09-06 17:00:00",
        guests: 2,
        travellerName: "Test Traveller",
        travellerEmail: "traveller@example.test",
        grossAmountCents: 15900,
        currency: "AUD",
        externalBookingId: `ext-${randomUUID()}`,
        stripeCheckoutSessionId: `cs_${randomUUID()}`,
        status: input.status
      }
    });
  }

  it("finds a real AWAITING_PAYMENT attempt", async () => {
    const tenant = await createTestTenant("unfinished");
    const travellerAccountId = `account-${randomUUID()}`;
    const conversation = await prisma.conversation.create({
      data: { tenantId: tenant.id, channel: "WEB_WIDGET", controlMode: "AI", travellerId: travellerAccountId }
    });
    await createAttempt({
      tenantId: tenant.id,
      conversationId: conversation.id,
      status: "AWAITING_PAYMENT",
      productTitle: "New Year's Eve 2026"
    });

    const result = await findAwaitingPaymentAttemptForTraveller(travellerAccountId);

    expect(result?.productTitle).toBe("New Year's Eve 2026");
    expect(result?.conversationId).toBe(conversation.id);
  });

  it("ignores an attempt that already resolved (CONFIRMED or PAYMENT_FAILED) - nothing left unfinished", async () => {
    const tenant = await createTestTenant("resolved");
    const travellerAccountId = `account-${randomUUID()}`;
    const conversation = await prisma.conversation.create({
      data: { tenantId: tenant.id, channel: "WEB_WIDGET", controlMode: "AI", travellerId: travellerAccountId }
    });
    await createAttempt({
      tenantId: tenant.id,
      conversationId: conversation.id,
      status: "CONFIRMED",
      productTitle: "Already Booked Trip"
    });

    expect(await findAwaitingPaymentAttemptForTraveller(travellerAccountId)).toBeNull();
  });

  it("never matches another traveller's attempt", async () => {
    const tenant = await createTestTenant("unfinished-isolation");
    const accountA = `account-${randomUUID()}`;
    const accountB = `account-${randomUUID()}`;
    const conversationA = await prisma.conversation.create({
      data: { tenantId: tenant.id, channel: "WEB_WIDGET", controlMode: "AI", travellerId: accountA }
    });
    await createAttempt({
      tenantId: tenant.id,
      conversationId: conversationA.id,
      status: "AWAITING_PAYMENT",
      productTitle: "Only Account A's Trip"
    });

    expect(await findAwaitingPaymentAttemptForTraveller(accountB)).toBeNull();
  });
});
