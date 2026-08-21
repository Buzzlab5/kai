import { prisma } from "@/lib/prisma";

/**
 * Resolves a logged-in traveller's real booking history via the same linkage the widget session
 * endpoint already establishes (see `/api/widget/session/route.ts` and
 * `conversation-repository.ts`'s `findRecentWidgetConversationForTraveller`) - `travellerId` on
 * `Conversation` is bluepass-redesign's `BluePassAccount.id` for `WEB_WIDGET` conversations. This has
 * been live since that cross-device-resume feature shipped; nothing about booking history required new
 * plumbing on the write side, only this read.
 *
 * Scoped to `WEB_WIDGET` deliberately: `travellerId` on a `WHATSAPP` conversation is a phone number
 * (Kai's own WhatsApp traveller tracking, a different identity space entirely) - including it here
 * would only ever produce a false miss (a phone number never equals a BluePassAccount cuid), but the
 * filter documents the distinction rather than relying on that coincidence.
 */
export async function listBookingsForTravellerAccount(travellerAccountId: string) {
  const conversations = await prisma.conversation.findMany({
    where: { travellerId: travellerAccountId, channel: "WEB_WIDGET" },
    select: { id: true, tenantId: true, tenant: { select: { slug: true, name: true } } }
  });

  if (conversations.length === 0) {
    return { auBookings: [], indonesiaInquiries: [] };
  }

  const conversationIds = conversations.map((conversation) => conversation.id);
  const tenantByConversationId = new Map(
    conversations.map((conversation) => [conversation.id, conversation.tenant])
  );

  const [auAttempts, indonesiaInquiries] = await Promise.all([
    prisma.pmsBookingPaymentAttempt.findMany({
      where: { conversationId: { in: conversationIds } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        conversationId: true,
        productTitle: true,
        dateText: true,
        guests: true,
        grossAmountCents: true,
        currency: true,
        status: true,
        externalBookingId: true,
        settledAt: true,
        cancelledAt: true,
        createdAt: true
      }
    }),
    prisma.bluePassInquiry.findMany({
      where: { conversationId: { in: conversationIds } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        conversationId: true,
        status: true,
        destination: true,
        selectedYachtName: true,
        operatorName: true,
        dateWindow: true,
        guests: true,
        createdAt: true
      }
    })
  ]);

  return {
    auBookings: auAttempts.map((attempt) => ({
      ...attempt,
      tenant: tenantByConversationId.get(attempt.conversationId) ?? null
    })),
    indonesiaInquiries: indonesiaInquiries.map((inquiry) => ({
      ...inquiry,
      tenant: tenantByConversationId.get(inquiry.conversationId) ?? null
    }))
  };
}

/**
 * How much of this traveller's own money has gone to the reef — the conservation-first pitch made
 * personal, one account at a time, real cents in real ledger rows rather than an estimate.
 *
 * Same `travellerId` + `WEB_WIDGET` linkage as listBookingsForTravellerAccount above, joined onward
 * to each region's CONSERVATION_ALLOCATION ledger entries. FINALIZED only - a PENDING estimate on an
 * inquiry that never became a real booking would overstate what this traveller has actually funded.
 * Grouped by currency rather than summed together, for the same reason the admin overview page
 * never adds AUD and USD into one number.
 */
export async function getTravellerConservationTotal(
  travellerAccountId: string
): Promise<{ currency: string; amountCents: number }[]> {
  const conversations = await prisma.conversation.findMany({
    where: { travellerId: travellerAccountId, channel: "WEB_WIDGET" },
    select: { id: true }
  });

  if (conversations.length === 0) {
    return [];
  }

  const conversationIds = conversations.map((conversation) => conversation.id);

  const [auTotals, indonesiaTotals] = await Promise.all([
    prisma.pmsBookingLedgerEntry.groupBy({
      by: ["currency"],
      where: { conversationId: { in: conversationIds }, kind: "CONSERVATION_ALLOCATION", status: "FINALIZED" },
      _sum: { amountCents: true }
    }),
    prisma.bluePassLedgerEntry.groupBy({
      by: ["currency"],
      where: { conversationId: { in: conversationIds }, kind: "CONSERVATION_ALLOCATION", status: "FINALIZED" },
      _sum: { amountCents: true }
    })
  ]);

  const byCurrency = new Map<string, number>();
  for (const row of [...auTotals, ...indonesiaTotals]) {
    const amount = row._sum.amountCents ?? 0;
    byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0) + amount);
  }

  return Array.from(byCurrency.entries())
    .map(([currency, amountCents]) => ({ currency, amountCents }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}
