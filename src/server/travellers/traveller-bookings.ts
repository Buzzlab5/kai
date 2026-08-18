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
