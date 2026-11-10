import type { PmsBookingPaymentAttempt, Tenant, TenantConfig } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculateBluePassLedgerSplit, marketForCurrency, type BluePassLedgerCurrency } from "@/core/bluepass/ledger";
import { createAssistantMessage, upsertConversationBookingState } from "@/server/conversation/conversation-repository";
import { sendWhatsAppText } from "@/server/whatsapp/client";

/**
 * Everything that happens once a paid direct-PMS booking is really confirmed: the real commission
 * split goes into the ledger, the attempt becomes CONFIRMED, the traveller is told, and the
 * operator's admin gets a heads-up. Shared by the two ways a booking gets confirmed: the PMS says so
 * straight after payment (Rezdy and Boattime), or the operator accepts a paid native booking. No
 * ledger entry exists before this runs, so a refunded booking never leaves one behind.
 */
export async function finalizeConfirmedPmsBooking(updated: PmsBookingPaymentAttempt, tenant: Tenant & { config: TenantConfig | null }) {
  const finalized = calculateBluePassLedgerSplit({
    inquiryId: updated.id,
    grossAmountCents: updated.grossAmountCents,
    currency: updated.currency as BluePassLedgerCurrency,
    status: "FINALIZED",
    referralPartnerId: updated.referralPartnerId,
    referralLinkId: updated.referralLinkId,
    referralCode: updated.referralCode,
    referralRole: updated.referralRole,
    // The attempt carries no market, so the currency decides it where it can (AUD, IDR); USD and the
    // rest get the 20% default. The referral role only adds the partner line; it never changes the
    // platform-fee percentage.
    market: marketForCurrency(updated.currency)
  });

  await prisma.pmsBookingLedgerEntry.createMany({
    data: finalized.map((entry) => ({
      tenantId: updated.tenantId,
      conversationId: updated.conversationId,
      pmsBookingPaymentAttemptId: updated.id,
      kind: entry.kind,
      amountCents: entry.amountCents,
      currency: entry.currency,
      status: entry.status,
      referralPartnerId: entry.referralPartnerId,
      referralLinkId: entry.referralLinkId,
      referralCode: entry.referralCode,
      referralRole: entry.referralRole,
      finalizedAt: new Date()
    }))
  });

  await prisma.pmsBookingPaymentAttempt.update({
    where: { id: updated.id },
    data: { status: "CONFIRMED" }
  });

  await upsertConversationBookingState({
    tenantId: updated.tenantId,
    conversationId: updated.conversationId,
    state: {
      productExternalId: updated.productExternalId,
      productTitle: updated.productTitle,
      dateText: updated.dateText,
      guests: updated.guests,
      travellerName: updated.travellerName,
      travellerEmail: updated.travellerEmail,
      travellerPhone: updated.travellerPhone,
      bookingStatus: "CONFIRMED",
      externalBookingId: updated.externalBookingId,
      externalProvider: updated.pmsProvider,
      bookingError: null
    }
  });

  await createAssistantMessage({
    tenantId: updated.tenantId,
    conversationId: updated.conversationId,
    content: `Payment received - your booking for ${updated.productTitle} on ${updated.dateText} for ${updated.guests} guest${
      updated.guests === 1 ? "" : "s"
    } is confirmed. Booking reference: ${updated.externalBookingId}.`
  });

  // Best-effort operator success alert, mirroring the failure path's own alert
  // (pms-booking-confirm-failure.ts) - a missing admin phone is a legitimate steady-state for some
  // tenants, so this never fails the webhook, just skips silently.
  const adminPhone = tenant.config?.adminWhatsAppPhone?.trim();
  if (adminPhone) {
    await sendWhatsAppText({
      to: adminPhone,
      role: "ops",
      body: `Kai alert: new booking confirmed - ${updated.productTitle} on ${updated.dateText} (${updated.guests} guest${
        updated.guests === 1 ? "" : "s"
      }, ${updated.travellerName}). Booking reference: ${updated.externalBookingId}.`
    });
    await prisma.pmsBookingPaymentAttempt.update({
      where: { id: updated.id },
      data: { adminAlertSentAt: new Date() }
    });
  }
}
