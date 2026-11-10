import type { BluePassInquiry, Prisma } from "@prisma/client";
import { findBluePassAlternativeYachts, type BluePassYachtCard } from "@/core/bluepass/catalog";
import { buildBluePassDispatchText } from "@/core/bluepass/dispatch";
import type { BluePassInquiryIntent } from "@/core/bluepass/intent";
import { calculateBluePassLedgerEstimate, calculateBluePassLedgerSplit, marketForCurrency, type BluePassLedgerCurrency } from "@/core/bluepass/ledger";
import type { BluePassPersonaLead } from "@/core/bluepass/persona-lead";
import { composeAssistantReply } from "@/core/llm/assistant-reply-composer";
import { prisma } from "@/lib/prisma";
import {
  createAssistantMessage,
  createTravellerMessage,
  listRecentConversationMessages
} from "@/server/conversation/conversation-repository";
import { createAssistantLlmClient } from "@/server/llm/assistant-llm-client";
import {
  internationalToLocalPhone,
  normalizeLocalPhone,
  phoneDigitVariantsForMatch
} from "@/server/phone/normalize-local-phone";
import { sendTemplateMessage, sendWhatsAppText } from "@/server/whatsapp/client";
import { resolveBluePassOperatorDirectoryPhone } from "./bluepass-operator-directory";
import { createBluePassQuoteDraftForOperatorResponse, getBluePassQuote } from "./bluepass-quote";
import {
  buildOperatorInquiryFreeText,
  buildOperatorInquiryTemplatePayload,
  type WhatsAppTemplateComponent
} from "@/server/whatsapp/operator-dispatch";
import {
  buildTravellerInquiryUpdateParams,
  whatsappTemplateNames,
  type OperatorInquiryTemplateInput
} from "@/server/whatsapp/templates";

const activeInquiryStatuses = ["DRAFT", "READY_TO_DISPATCH", "OPERATOR_PENDING", "COUNTER_OFFERED"] as const;

export type BluePassSelectedYachtInput = {
  slug: string;
  name: string;
  operatorId?: string | null;
  operatorName?: string | null;
  operatorPhone?: string | null;
};

export type BluePassReferralInput = {
  referralPartnerId?: string | null;
  referralLinkId?: string | null;
  referralCode?: string | null;
  referralRole?: string | null;
};

export type CreateOrReuseBluePassInquiryInput = {
  tenantId: string;
  conversationId: string;
  sourceChannel?: string;
  travellerMessage: string;
  intent: BluePassInquiryIntent;
  selectedYacht?: BluePassSelectedYachtInput | null;
  referral?: BluePassReferralInput | null;
  alternativeOf?: {
    previousInquiryId: string;
    previousYachtSlug?: string | null;
    alternativeYachtSlug: string;
    reason: "operator_declined";
  } | null;
  notes?: string | null;
};

export type BluePassOperatorResponseAction = "accept" | "decline" | "counter" | "payment_ready" | "booking_confirmed";

export type BluePassOperatorResponseResult = {
  inquiry: BluePassInquiry;
  travellerNotification: {
    channel: string;
    sent: boolean;
    providerMessageId?: string | null;
    skippedReason?: string;
    whatsappDeliveryFailed?: boolean;
  } | null;
  notificationRecovery?: {
    state: "sent" | "already_sent" | "exhausted" | "no_anchor";
    uncertainPrior: boolean;
  };
  operatorFollowUp: {
    requested: boolean;
    channel?: string;
    sent?: boolean;
    providerMessageId?: string | null;
    prompt?: string;
    skippedReason?: string;
  } | null;
};

export type HandleBluePassOperatorResponseInput = {
  inquiryId: string;
  action: BluePassOperatorResponseAction;
  counterText?: string | null;
  providerMessageId?: string | null;
  operatorPhone?: string | null;
};

export type RecordBluePassTravellerWhatsAppDeliveryStatusInput = {
  providerMessageId: string;
  status: string;
  timestamp?: string | null;
  recipientId?: string | null;
  errors?: Array<{
    code: number | null;
    title: string | null;
    message: string | null;
    details: string | null;
  }>;
};

export type UpsertBluePassPersonaLeadInput = {
  tenantId: string;
  conversationId: string;
  persona: BluePassPersonaLead["persona"];
  lead: BluePassPersonaLead;
  sourceMessage: string;
};

export type HandleBluePassWhatsAppContextMessageInput = {
  from: string;
  body: string;
  providerMessageId?: string | null;
};

export async function createOrReuseBluePassInquiry(input: CreateOrReuseBluePassInquiryInput) {
  const existing = await prisma.bluePassInquiry.findFirst({
    where: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      status: { in: [...activeInquiryStatuses] }
    },
    orderBy: { createdAt: "desc" }
  });

  if (existing) {
    const inquiry = await prisma.bluePassInquiry.update({
      where: { id: existing.id },
      data: await buildInquiryData(input, existing)
    });

    await createBluePassInquiryEvent({
      inquiry,
      type: "INQUIRY_UPDATED",
      fromStatus: existing.status,
      toStatus: inquiry.status,
      metadata: buildAlternativeInquiryMetadata(input.alternativeOf)
    });

    return {
      inquiry,
      reusedExisting: true as const
    };
  }

  const inquiry = await prisma.bluePassInquiry.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      sourceChannel: input.sourceChannel ?? "WEB_WIDGET",
      ...(await buildInquiryData(input))
    }
  });

  await createBluePassInquiryEvent({
    inquiry,
    type: "INQUIRY_CREATED",
    fromStatus: null,
    toStatus: inquiry.status,
    metadata: buildAlternativeInquiryMetadata(input.alternativeOf)
  });

  return {
    inquiry,
    reusedExisting: false as const
  };
}

export async function syncBluePassReferralLedgerEstimate(inquiry: BluePassInquiry) {
  const estimates = calculateBluePassLedgerEstimate({
    inquiryId: inquiry.id,
    budget: inquiry.budget,
    referralPartnerId: inquiry.referralPartnerId,
    referralLinkId: inquiry.referralLinkId,
    referralCode: inquiry.referralCode,
    referralRole: inquiry.referralRole
  });

  await prisma.bluePassLedgerEntry.deleteMany({
    where: {
      bluePassInquiryId: inquiry.id,
      status: "PENDING"
    }
  });

  if (estimates.length === 0) {
    return [];
  }

  await prisma.bluePassLedgerEntry.createMany({
    data: estimates.map((estimate) => ({
      tenantId: inquiry.tenantId,
      conversationId: inquiry.conversationId,
      bluePassInquiryId: inquiry.id,
      kind: estimate.kind,
      amountCents: estimate.amountCents,
      currency: estimate.currency,
      status: estimate.status,
      referralPartnerId: estimate.referralPartnerId,
      referralLinkId: estimate.referralLinkId,
      referralCode: estimate.referralCode,
      referralRole: estimate.referralRole,
      metadata: estimate.metadata as Prisma.InputJsonValue
    }))
  });

  await createBluePassInquiryEvent({
    inquiry,
    type: "LEDGER_ESTIMATE_SYNCED",
    fromStatus: inquiry.status,
    toStatus: inquiry.status,
    metadata: { entryCount: estimates.length }
  });

  return prisma.bluePassLedgerEntry.findMany({
    where: {
      bluePassInquiryId: inquiry.id,
      status: "PENDING"
    },
    orderBy: { createdAt: "asc" }
  });
}

// Interim finalize trigger for Phase 1 (both regions): the operator's free-text "booking confirmed"
// WhatsApp message, via the same latest-parsed-quote price getBluePassQuote already resolves for
// the traveller-facing quote screen - not a real payment event yet (Phase 2 replaces this with a
// Stripe webhook for AU operators specifically; Indonesia keeps this trigger under the current
// phasing decision). Supersedes the PENDING budget-text estimate with a FINALIZED entry set computed
// from the actual agreed price, and voids the stale PENDING rows rather than leaving them alongside.
// Idempotent: now that both the WhatsApp "booking confirmed" trigger and the Stripe payment webhook
// can call this for the same inquiry, a second call must never double-finalize the ledger.
export async function finalizeBluePassLedgerForConfirmedBooking(inquiry: BluePassInquiry) {
  const alreadyFinalized = await prisma.bluePassLedgerEntry.findMany({
    where: { bluePassInquiryId: inquiry.id, status: "FINALIZED" }
  });
  if (alreadyFinalized.length > 0) {
    return alreadyFinalized;
  }

  const quote = await getBluePassQuote({ quoteId: inquiry.id });
  const grossAmountCents = quote?.grossPriceCents ?? null;

  const voided = await prisma.bluePassLedgerEntry.updateMany({
    where: { bluePassInquiryId: inquiry.id, status: "PENDING" },
    data: { status: "VOIDED", voidedAt: new Date(), voidReason: "superseded by booking-confirmation finalization" }
  });

  if (grossAmountCents == null) {
    // No parsed final price to finalize against yet - the voided PENDING estimate is all there is;
    // an admin can add a manual ledger adjustment later once a real price is known.
    return [];
  }

  const currency = (quote?.currency as BluePassLedgerCurrency | undefined) ?? "USD";
  const finalized = calculateBluePassLedgerSplit({
    inquiryId: inquiry.id,
    grossAmountCents,
    currency,
    status: "FINALIZED",
    referralPartnerId: inquiry.referralPartnerId,
    referralLinkId: inquiry.referralLinkId,
    referralCode: inquiry.referralCode,
    referralRole: inquiry.referralRole,
    market: marketForCurrency(currency)
  });

  await prisma.bluePassLedgerEntry.createMany({
    data: finalized.map((entry) => ({
      tenantId: inquiry.tenantId,
      conversationId: inquiry.conversationId,
      bluePassInquiryId: inquiry.id,
      kind: entry.kind,
      amountCents: entry.amountCents,
      currency: entry.currency,
      status: entry.status,
      referralPartnerId: entry.referralPartnerId,
      referralLinkId: entry.referralLinkId,
      referralCode: entry.referralCode,
      referralRole: entry.referralRole,
      metadata: entry.metadata as Prisma.InputJsonValue,
      finalizedAt: new Date()
    }))
  });

  await createBluePassInquiryEvent({
    inquiry,
    type: "LEDGER_FINALIZED",
    fromStatus: inquiry.status,
    toStatus: inquiry.status,
    metadata: { entryCount: finalized.length, voidedPendingCount: voided.count, grossAmountCents }
  });

  return finalized;
}

// Declined inquiries currently left their PENDING ledger estimate rows dangling forever - this
// closes that data-integrity gap (independent of any Stripe/payment work).
export async function voidBluePassLedgerEntries(input: { inquiryId: string; reason: string }) {
  const voided = await prisma.bluePassLedgerEntry.updateMany({
    where: { bluePassInquiryId: input.inquiryId, status: "PENDING" },
    data: { status: "VOIDED", voidedAt: new Date(), voidReason: input.reason }
  });

  return voided.count;
}

// Admin "commission owed/paid" view (Phase 1 foundation for real payouts). Defaults to FINALIZED
// entries - the real, confirmed amounts actually owed - since PENDING estimates aren't something
// to act on yet and VOIDED entries are dead. tenantId has no Prisma relation on this model (matches
// listBluePassInquiriesForTenantSlug's own pattern), so the tenant is resolved by slug first.
export async function listBluePassLedgerEntriesForTenantSlug(input: {
  tenantSlug: string;
  status?: "PENDING" | "FINALIZED" | "VOIDED";
  take?: number;
}) {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: input.tenantSlug },
    select: { id: true, slug: true, name: true }
  });

  if (!tenant) {
    return [];
  }

  return prisma.bluePassLedgerEntry.findMany({
    where: {
      tenantId: tenant.id,
      status: input.status ?? "FINALIZED"
    },
    orderBy: { createdAt: "desc" },
    take: input.take ?? 100,
    include: {
      inquiry: {
        select: {
          id: true,
          selectedYachtName: true,
          operatorName: true,
          operatorPhone: true,
          destination: true,
          status: true
        }
      }
    }
  });
}

// Only FINALIZED entries can be paid out - a PENDING estimate isn't a real owed amount yet, and a
// VOIDED entry was superseded/cancelled. Idempotent: marking an already-paid entry again is a no-op
// rather than an error, so a retried admin click can't double-write the audit trail.
export async function markBluePassLedgerEntryPaid(input: {
  entryId: string;
  paidOutReference: string;
  reviewerEmail: string;
}) {
  const entry = await prisma.bluePassLedgerEntry.findUniqueOrThrow({ where: { id: input.entryId } });

  if (entry.status !== "FINALIZED") {
    throw new Error(
      `BluePass ledger entry ${input.entryId} is ${entry.status}, not FINALIZED - only finalized entries can be marked paid.`
    );
  }
  if (entry.paidOutAt) {
    return entry;
  }

  return prisma.bluePassLedgerEntry.update({
    where: { id: input.entryId },
    data: {
      paidOutAt: new Date(),
      paidOutReference: input.paidOutReference,
      paidOutBy: input.reviewerEmail
    }
  });
}

export async function dispatchBluePassOperatorWhatsApp(input: { inquiryId: string }) {
  const inquiry = await prisma.bluePassInquiry.findUniqueOrThrow({
    where: { id: input.inquiryId }
  });

  if (!inquiry.operatorPhone) {
    throw new Error("BluePass inquiry has no operator phone target.");
  }

  const outboundText = buildBluePassDispatchText({
    inquiryId: inquiry.id,
    selectedYachtName: inquiry.selectedYachtName,
    travellerName: inquiry.travellerName,
    travellerPhone: inquiry.travellerPhone,
    destination: inquiry.destination,
    dateWindow: inquiry.dateWindow,
    guests: inquiry.guests,
    budget: inquiry.budget,
    referralCode: inquiry.referralCode
  });

  const dispatch = await prisma.bluePassOperatorDispatch.create({
    data: {
      tenantId: inquiry.tenantId,
      conversationId: inquiry.conversationId,
      bluePassInquiryId: inquiry.id,
      status: "QUEUED",
      operatorId: inquiry.operatorId,
      operatorName: inquiry.operatorName,
      operatorPhone: inquiry.operatorPhone,
      outboundText
    }
  });

  const sendMode = resolveOperatorInquirySendMode();
  if (sendMode !== "queue") {
    try {
      const templateInput = buildOperatorInquiryTemplateInput({
        inquiry,
        operatorPhone: inquiry.operatorPhone
      });
      const template = buildOperatorInquiryTemplatePayload(templateInput);
      const sendResult = await sendOperatorInquiryMessage({
        mode: sendMode,
        to: template.to,
        templateName: template.template.name,
        languageCode: template.template.language.code,
        components: template.template.components,
        textBody: buildOperatorInquiryFreeText(templateInput)
      });

      await prisma.bluePassOperatorDispatch.update({
        where: { id: dispatch.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          providerMessageId: sendResult.providerMessageId,
          metadata: {
            messageKind: sendResult.messageKind,
            templateName:
              sendResult.messageKind === "template" ? whatsappTemplateNames.bookingInquiryOperator : "operator_inquiry_text"
          }
        }
      });
    } catch (error) {
      await prisma.bluePassOperatorDispatch.update({
        where: { id: dispatch.id },
        data: {
          status: "FAILED",
          failureReason: error instanceof Error ? error.message : "WhatsApp send failed."
        }
      });

      await createBluePassInquiryEvent({
        inquiry,
        type: "OPERATOR_DISPATCH_FAILED",
        fromStatus: inquiry.status,
        toStatus: inquiry.status,
        metadata: { dispatchId: dispatch.id }
      });

      return prisma.bluePassOperatorDispatch.findUniqueOrThrow({
        where: { id: dispatch.id }
      });
    }
  }

  const updated = await prisma.bluePassInquiry.update({
    where: { id: inquiry.id },
    data: { status: "OPERATOR_PENDING" }
  });

  await createBluePassInquiryEvent({
    inquiry: updated,
    type: "OPERATOR_DISPATCH_QUEUED",
    fromStatus: inquiry.status,
    toStatus: updated.status,
    metadata: { dispatchId: dispatch.id }
  });

  return prisma.bluePassOperatorDispatch.findUniqueOrThrow({
    where: { id: dispatch.id }
  });
}

/** Any enquiry at all from this chat, whatever its status: once one exists, "say yes and I'll send it" is wrong. */
export async function hasBluePassInquiryInConversation(input: { tenantId: string; conversationId: string }) {
  const inquiry = await prisma.bluePassInquiry.findFirst({
    where: { tenantId: input.tenantId, conversationId: input.conversationId },
    select: { id: true }
  });

  return Boolean(inquiry);
}

export async function getActiveBluePassInquiryStatus(input: { tenantId: string; conversationId: string }) {
  const inquiry = await prisma.bluePassInquiry.findFirst({
    where: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      status: { in: [...activeInquiryStatuses] }
    },
    orderBy: { createdAt: "desc" },
    include: {
      events: { orderBy: { createdAt: "asc" } },
      ledger: {
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" }
      },
      dispatches: { orderBy: { createdAt: "desc" } }
    }
  });

  return inquiry
    ? {
        inquiry,
        events: inquiry.events,
        ledger: inquiry.ledger,
        dispatches: inquiry.dispatches
      }
    : null;
}

export async function upsertBluePassPersonaLead(input: UpsertBluePassPersonaLeadInput) {
  const tripType = input.persona === "OPERATOR" ? "OPERATOR_LEAD" : "PARTNER_LEAD";
  const existing = await prisma.bluePassInquiry.findFirst({
    where: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      tripType,
      status: "DRAFT"
    },
    orderBy: { createdAt: "desc" }
  });
  const data = {
    sourceChannel: "WHATSAPP",
    status: "DRAFT" as const,
    travellerName: input.lead.name ?? existing?.travellerName,
    travellerEmail: input.lead.email ?? existing?.travellerEmail,
    travellerPhone: input.lead.phone ?? existing?.travellerPhone,
    travellerMessage: input.sourceMessage,
    tripType,
    notes: `${input.persona.toLowerCase()} lead captured by Kai`
  };

  const inquiry = existing
    ? await prisma.bluePassInquiry.update({
        where: { id: existing.id },
        data
      })
    : await prisma.bluePassInquiry.create({
        data: {
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          ...data
        }
      });

  await createBluePassInquiryEvent({
    inquiry,
    type: existing ? "PERSONA_LEAD_UPDATED" : "PERSONA_LEAD_CREATED",
    fromStatus: existing?.status ?? null,
    toStatus: inquiry.status,
    metadata: {
      persona: input.persona,
      lead: {
        name: input.lead.name ?? null,
        email: input.lead.email ?? null,
        phone: input.lead.phone ?? null
      },
      source: "bluepass_persona_triage"
    }
  });

  return inquiry;
}

function buildAlternativeInquiryMetadata(input?: CreateOrReuseBluePassInquiryInput["alternativeOf"]) {
  return input
    ? {
        reason: input.reason,
        previousInquiryId: input.previousInquiryId,
        previousYachtSlug: input.previousYachtSlug ?? null,
        alternativeYachtSlug: input.alternativeYachtSlug
      }
    : undefined;
}

export async function getLatestBluePassInquiryStatus(input: { tenantId: string; conversationId: string }) {
  const inquiry = await prisma.bluePassInquiry.findFirst({
    where: {
      tenantId: input.tenantId,
      conversationId: input.conversationId
    },
    orderBy: { createdAt: "desc" },
    include: {
      events: { orderBy: { createdAt: "desc" }, take: 5 },
      ledger: {
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" }
      },
      dispatches: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });

  return inquiry
    ? {
        inquiry,
        events: inquiry.events,
        ledger: inquiry.ledger,
        dispatches: inquiry.dispatches
      }
    : null;
}

const bluePassOperatorActionAnchorEventTypes: Record<BluePassOperatorResponseAction, string> = {
  accept: "OPERATOR_ACCEPTED",
  decline: "OPERATOR_DECLINED",
  counter: "OPERATOR_COUNTER_OFFERED",
  payment_ready: "OPERATOR_PAYMENT_READY",
  booking_confirmed: "OPERATOR_BOOKING_CONFIRMED"
};

const TRAVELLER_NOTIFICATION_CLAIM_EVENT_TYPE = "TRAVELLER_WHATSAPP_NOTIFICATION_CLAIM";
const TRAVELLER_NOTIFICATION_ATTEMPT_EVENT_TYPE = "TRAVELLER_WHATSAPP_NOTIFICATION_ATTEMPT";
const TRAVELLER_NOTIFICATION_MAX_SEND_CLAIMS = 3;

type TravellerNotificationClaimDecision =
  | { state: "no_anchor" | "already_sent" | "exhausted" }
  | {
      state: "send";
      uncertainPrior: boolean;
      notification: BluePassOperatorResponseResult["travellerNotification"];
    };

/**
 * Fenced, capped delivery of the traveller notification behind an operator action.
 *
 * Why this exists: the action transition commits before the notification is sent, so a crash
 * (or a plain provider failure) between the two leaves the traveller hanging - the state
 * moved, no notification went out, and a redelivery of the same operator reply no-ops on the
 * status guard. Every path that can reach the notification (first attempt, concurrent-delivery
 * loser, redelivery no-op, terminal repeat) funnels through here:
 *
 * - Exactly one sender: an advisory lock serializes candidates per inquiry; whoever finds no
 *   SENT/SKIPPED event after the action's anchor event writes a CLAIM marker (capped) and wins
 *   the right to send. Losers observe the recorded outcome and stop.
 * - Bounded recovery: a failed send records a FAILED event; the next redelivery re-enters here
 *   and claims another attempt, up to TRAVELLER_NOTIFICATION_MAX_SEND_CLAIMS per anchor. At the
 *   cap the failure stays durable (FAILED events + CLAIM markers + an unresolved receipt
 *   outcome) for an operator to act on instead of looping forever.
 * - Honest uncertainty: the send writes an ATTEMPT event before calling the provider and a
 *   SENT/FAILED event after. A crash between provider accept and the SENT write leaves an
 *   unresolved ATTEMPT; re-drives flag that (priorAttemptUncertain) because the traveller may
 *   already have received the first send. Exactly-once is NOT guaranteed - Meta provides no
 *   idempotency key - so this chooses bounded at-least-once (the traveller is never silently
 *   abandoned) with the possible duplicate explicitly marked.
 */
async function ensureBluePassTravellerNotifiedForOperatorAction(input: {
  inquiry: BluePassInquiry;
  action: BluePassOperatorResponseAction;
  counterText?: string | null;
  paymentText?: string | null;
  confirmationText?: string | null;
  quoteUrl?: string | null;
}): Promise<{
  state: "sent" | "already_sent" | "exhausted" | "no_anchor";
  uncertainPrior: boolean;
  notification: BluePassOperatorResponseResult["travellerNotification"];
}> {
  const anchorType = bluePassOperatorActionAnchorEventTypes[input.action];
  const isCompletedEvent = (type: string) =>
    type === "TRAVELLER_WHATSAPP_NOTIFICATION_SENT" || type === "TRAVELLER_WHATSAPP_NOTIFICATION_SKIPPED";

  // Pre-read (unlocked) for content building only; the locked section re-verifies everything.
  const initialEvents = await prisma.bluePassInquiryEvent.findMany({
    where: { bluePassInquiryId: input.inquiry.id },
    orderBy: { createdAt: "asc" }
  });
  const initialAnchor = [...initialEvents].reverse().find((event) => event.type === anchorType);
  if (!initialAnchor) {
    return { state: "no_anchor", uncertainPrior: false, notification: null };
  }

  // Rebuild the traveller-facing content, preferring this call's own details and falling back
  // to the anchor event's metadata (the redrive-of-a-crash case).
  const initialMetadata =
    initialAnchor.metadata && typeof initialAnchor.metadata === "object" && !Array.isArray(initialAnchor.metadata)
      ? (initialAnchor.metadata as Record<string, unknown>)
      : {};
  const anchorText = (key: string) => {
    const value = initialMetadata[key];
    return typeof value === "string" && value.trim() ? value : null;
  };

  let content: string | null = null;
  if (input.action === "payment_ready") {
    const paymentText = input.paymentText?.trim() || anchorText("paymentText");
    if (paymentText) {
      content = buildPaymentReadyTravellerNotification({ inquiry: input.inquiry, paymentText });
    }
  } else if (input.action === "booking_confirmed") {
    const confirmationText = input.confirmationText?.trim() || anchorText("confirmationText");
    if (confirmationText) {
      content = buildBookingConfirmedTravellerNotification({ inquiry: input.inquiry, confirmationText });
    }
  } else {
    const quoteUrl =
      input.quoteUrl ?? (await getBluePassQuote({ quoteId: input.inquiry.id }))?.quoteUrl ?? null;
    content = buildOperatorResponseTravellerNotification({
      inquiry: input.inquiry,
      action: input.action,
      counterText: input.counterText?.trim() || anchorText("counterText"),
      quoteUrl
    });
  }
  if (!content) {
    return { state: "no_anchor", uncertainPrior: false, notification: null };
  }
  const notificationContent = content;

  const decision = await prisma.$transaction(
    async (tx): Promise<TravellerNotificationClaimDecision> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.inquiry.id}, 0))`;
      const events = await tx.bluePassInquiryEvent.findMany({
        where: { bluePassInquiryId: input.inquiry.id },
        orderBy: { createdAt: "asc" }
      });
      const anchor = [...events].reverse().find((event) => event.type === anchorType);
      if (!anchor) return { state: "no_anchor" };
      const afterAnchor = events.filter((event) => event.createdAt >= anchor.createdAt && event.id !== anchor.id);
      if (afterAnchor.some((event) => isCompletedEvent(event.type))) {
        return { state: "already_sent" };
      }
      // The cap counts ATTEMPT events (one per provider send, written before the call), so it
      // bounds real sends even if a CLAIM marker is rolled back by a transaction abort.
      const sendAttempts = afterAnchor.filter((event) => event.type === TRAVELLER_NOTIFICATION_ATTEMPT_EVENT_TYPE);
      if (sendAttempts.length >= TRAVELLER_NOTIFICATION_MAX_SEND_CLAIMS) {
        // Bounded retry is exhausted; this is NOT a delivered guarantee. Record a durable,
        // actionable audit event (once) so an operator can see the traveller was never
        // notified and intervene manually, instead of the failure fading into a quiet outcome.
        const exhaustionAlreadyRecorded = afterAnchor.some(
          (event) => event.type === "TRAVELLER_WHATSAPP_NOTIFICATION_RECOVERY_EXHAUSTED"
        );
        if (!exhaustionAlreadyRecorded) {
          await tx.bluePassInquiryEvent.create({
            data: {
              tenantId: input.inquiry.tenantId,
              conversationId: input.inquiry.conversationId,
              bluePassInquiryId: input.inquiry.id,
              type: "TRAVELLER_WHATSAPP_NOTIFICATION_RECOVERY_EXHAUSTED",
              fromStatus: input.inquiry.status,
              toStatus: input.inquiry.status,
              metadata: {
                anchorEventId: anchor.id,
                anchorType,
                attempts: sendAttempts.length,
                actionRequired:
                  "Traveller was never notified of the operator's reply after bounded retries; contact the traveller manually."
              }
            }
          });
        }
        return { state: "exhausted" };
      }
      const claims = afterAnchor.filter((event) => event.type === TRAVELLER_NOTIFICATION_CLAIM_EVENT_TYPE);
      const lastAttempt = [...sendAttempts].reverse()[0];
      const uncertainPrior = Boolean(
        lastAttempt &&
          !afterAnchor.some(
            (event) =>
              event.createdAt >= lastAttempt.createdAt &&
              (event.type === "TRAVELLER_WHATSAPP_NOTIFICATION_SENT" ||
                event.type === "TRAVELLER_WHATSAPP_NOTIFICATION_FAILED" ||
                event.type === "TRAVELLER_WHATSAPP_NOTIFICATION_SKIPPED")
          )
      );
      await tx.bluePassInquiryEvent.create({
        data: {
          tenantId: input.inquiry.tenantId,
          conversationId: input.inquiry.conversationId,
          bluePassInquiryId: input.inquiry.id,
          type: TRAVELLER_NOTIFICATION_CLAIM_EVENT_TYPE,
          fromStatus: input.inquiry.status,
          toStatus: input.inquiry.status,
          metadata: {
            anchorEventId: anchor.id,
            anchorType,
            attempt: claims.length + 1,
            priorAttemptUncertain: uncertainPrior
          }
        }
      });

      // Hold the advisory lock THROUGH the provider send: a concurrent candidate blocks on the
      // lock until this attempt's outcome (SENT / FAILED / SKIPPED) is recorded, then observes
      // it and stops - so the notification goes out once per claim, never twice from a race.
      // ATTEMPT/SENT/FAILED are written on the default connection (outside this transaction),
      // so a crash or abort here still leaves the durable uncertainty record behind.

      // If a previous attempt crashed after writing the assistant message but before the send,
      // the content is already in the conversation; reuse it instead of double-posting.
      const recentMessages = await listRecentConversationMessages({
        tenantId: input.inquiry.tenantId,
        conversationId: input.inquiry.conversationId,
        take: 4
      });
      const lastAssistant = [...recentMessages].reverse().find((message) => message.role === "assistant");
      if (lastAssistant?.content !== notificationContent) {
        await createAssistantMessage({
          tenantId: input.inquiry.tenantId,
          conversationId: input.inquiry.conversationId,
          content: notificationContent
        });
      }

      const notification = await sendTravellerWhatsAppNotification({
        inquiry: input.inquiry,
        content: notificationContent
      });
      return { state: "send", uncertainPrior, notification };
    },
    { maxWait: 30_000, timeout: 60_000 }
  );

  if (decision.state !== "send") {
    return { state: decision.state, uncertainPrior: false, notification: null };
  }
  return { state: "sent", uncertainPrior: decision.uncertainPrior, notification: decision.notification };
}

export async function handleBluePassOperatorResponse(
  input: HandleBluePassOperatorResponseInput
): Promise<BluePassOperatorResponseResult> {
  const inquiry = await prisma.bluePassInquiry.findUnique({
    where: { id: input.inquiryId },
    include: {
      dispatches: {
        select: { operatorPhone: true }
      }
    }
  });
  if (!inquiry) {
    throw new Error(`BluePass inquiry ${input.inquiryId} was not found for operator response.`);
  }

  // Sender ownership: an operator response only applies to the inquiry that operator was
  // actually dispatched (or named on). Without this, anyone who learns an inquiry id - or any
  // traveller whose text is misread as a command - could move someone else's inquiry.
  const ownership = verifyBluePassOperatorResponseOwnership(inquiry, input.operatorPhone);
  if (!ownership.ok) {
    await recordRejectedBluePassOperatorResponse({
      inquiry,
      input,
      reason: ownership.reason
    });
    throw new Error(
      `Rejected ${input.action} for BluePass inquiry ${inquiry.id}: ${ownership.reason}`
    );
  }

  // Status guard: terminal inquiries never move again, actions only apply from statuses where
  // they make sense, and repeating the action that produced the current status is an idempotent
  // no-op instead of a duplicate traveller notification.
  const statusGuard = checkBluePassOperatorResponseStatus(inquiry.status, input.action);
  if (statusGuard.kind === "reject") {
    await recordRejectedBluePassOperatorResponse({
      inquiry,
      input,
      reason: statusGuard.reason
    });
    throw new Error(
      `Rejected ${input.action} for BluePass inquiry ${inquiry.id}: ${statusGuard.reason}`
    );
  }
  if (statusGuard.kind === "noop") {
    const notificationDelivery = await ensureBluePassTravellerNotifiedForOperatorAction({
      inquiry,
      action: input.action
    });
    return {
      inquiry,
      travellerNotification: notificationDelivery.notification,
      operatorFollowUp: null,
      notificationRecovery: {
        state: notificationDelivery.state,
        uncertainPrior: notificationDelivery.uncertainPrior
      }
    };
  }

  if (input.action === "counter" && !input.counterText?.trim()) {
    const operatorFollowUp = await requestOperatorCounterDetails({
      inquiry,
      providerMessageId: input.providerMessageId,
      operatorPhone: input.operatorPhone
    });

    return {
      inquiry,
      travellerNotification: null,
      operatorFollowUp
    };
  }

  if (input.action === "payment_ready") {
    return handleBluePassPaymentReadyOperatorResponse({
      inquiry,
      paymentText: input.counterText,
      providerMessageId: input.providerMessageId,
      operatorPhone: input.operatorPhone
    });
  }

  if (input.action === "booking_confirmed") {
    return handleBluePassBookingConfirmedOperatorResponse({
      inquiry,
      confirmationText: input.counterText,
      providerMessageId: input.providerMessageId,
      operatorPhone: input.operatorPhone
    });
  }

  const nextStatus = resolveOperatorResponseStatus(input.action);
  const eventType = resolveOperatorResponseEventType(input.action);
  // Compare-and-set: concurrent operator replies (different message ids, e.g. Meta delivering
  // two webhooks at once) both pass the read-side status guard, but only one can move the
  // inquiry. The loser re-reads and re-applies the guard instead of double-notifying.
  const transition = await prisma.bluePassInquiry.updateMany({
    where: { id: inquiry.id, status: inquiry.status },
    data: {
      status: nextStatus
    }
  });
  if (transition.count === 0) {
    return handleConcurrentBluePassOperatorResponse({ inquiryId: inquiry.id, input });
  }
  const updated = await prisma.bluePassInquiry.findUniqueOrThrow({
    where: { id: inquiry.id }
  });

  await createBluePassInquiryEvent({
    inquiry: updated,
    type: eventType,
    fromStatus: inquiry.status,
    toStatus: updated.status,
    metadata: {
      providerMessageId: input.providerMessageId ?? null,
      operatorPhone: input.operatorPhone ?? null,
      counterText: input.counterText ?? null
    }
  });

  if (input.action === "decline") {
    await voidBluePassLedgerEntries({ inquiryId: updated.id, reason: "operator declined the inquiry" });
  }

  let quoteUrl: string | null = null;
  let needsAcceptPriceFollowUp = false;
  if (input.action === "accept" || input.action === "counter") {
    await createBluePassQuoteDraftForOperatorResponse({
      inquiry: updated,
      action: input.action,
      counterText: input.counterText
    });
    const quote = await getBluePassQuote({ quoteId: updated.id });
    quoteUrl = quote?.quoteUrl ?? null;
    needsAcceptPriceFollowUp = input.action === "accept" && quote?.status === "NEEDS_FINAL_PRICE";
  }

  const notificationDelivery = await ensureBluePassTravellerNotifiedForOperatorAction({
    inquiry: updated,
    action: input.action,
    counterText: input.counterText,
    quoteUrl
  });

  const operatorFollowUp = needsAcceptPriceFollowUp
    ? await requestOperatorAcceptPriceDetails({
        inquiry: updated,
        providerMessageId: input.providerMessageId,
        operatorPhone: input.operatorPhone
      })
    : null;

  return {
    inquiry: updated,
    travellerNotification: notificationDelivery.notification,
    operatorFollowUp,
    notificationRecovery: {
      state: notificationDelivery.state,
      uncertainPrior: notificationDelivery.uncertainPrior
    }
  };
}

export async function resolveLatestPendingBluePassInquiryIdForOperatorPhone(operatorPhone?: string | null) {
  const candidates = buildOperatorPhoneCandidates(operatorPhone);
  if (candidates.length === 0) return null;

  const dispatch = await prisma.bluePassOperatorDispatch.findFirst({
    where: {
      operatorPhone: { in: candidates },
      inquiry: {
        status: { in: ["READY_TO_DISPATCH", "OPERATOR_PENDING", "OPERATOR_ACCEPTED", "COUNTER_OFFERED"] }
      }
    },
    orderBy: [{ createdAt: "desc" }],
    select: {
      bluePassInquiryId: true
    }
  });

  return dispatch?.bluePassInquiryId ?? null;
}

export async function recordBluePassTravellerWhatsAppDeliveryStatus(
  input: RecordBluePassTravellerWhatsAppDeliveryStatusInput
) {
  const sentEvent = await findTravellerWhatsAppSentEvent(input.providerMessageId);
  if (!sentEvent) {
    throw new Error(`No BluePass traveller WhatsApp notification matched ${input.providerMessageId}.`);
  }

  const inquiry = await prisma.bluePassInquiry.findUnique({
    where: { id: sentEvent.bluePassInquiryId }
  });
  if (!inquiry) {
    throw new Error(`BluePass inquiry ${sentEvent.bluePassInquiryId} was not found for WhatsApp delivery status.`);
  }

  const statusEvent = await createBluePassInquiryEvent({
    inquiry,
    type: "TRAVELLER_WHATSAPP_DELIVERY_STATUS",
    fromStatus: inquiry.status,
    toStatus: inquiry.status,
    metadata: {
      providerMessageId: input.providerMessageId,
      status: input.status,
      timestamp: input.timestamp ?? null,
      recipientId: input.recipientId ?? null,
      errors: input.errors ?? []
    }
  });

  if (shouldFallbackTravellerTemplateFromDeliveryStatus(input, sentEvent.metadata)) {
    await resendTravellerTemplateAfterDeliveryFailure({
      inquiry,
      failedProviderMessageId: input.providerMessageId,
      errors: input.errors ?? []
    });
  }

  return statusEvent;
}

export async function handleBluePassWhatsAppContextMessage(input: HandleBluePassWhatsAppContextMessageInput) {
  const context = await findLatestBluePassParticipantContext(input.from);
  if (!context) {
    return {
      handled: false as const,
      sent: false as const,
      inquiry: null,
      participant: null,
      reply: null
    };
  }

  const { inquiry, participant } = context;
  const alternativeDispatch =
    participant === "traveller"
      ? await dispatchDeclinedAlternativeFromTravellerApproval({
          inquiry,
          travellerMessage: input.body
        })
      : null;
  const replyInquiry = alternativeDispatch?.inquiry ?? inquiry;
  const reply =
    alternativeDispatch?.reply ??
    (await buildBluePassWhatsAppContextReply({
      inquiry,
      participant,
      latestMessage: input.body
    }));

  await createBluePassInquiryEvent({
    inquiry,
    type: "WHATSAPP_CONTEXT_MESSAGE_RECEIVED",
    fromStatus: inquiry.status,
    toStatus: inquiry.status,
    metadata: {
      participant,
      from: input.from,
      body: input.body,
      providerMessageId: input.providerMessageId ?? null
    }
  });

  if (participant === "traveller") {
    await createTravellerMessage({
      tenantId: inquiry.tenantId,
      conversationId: inquiry.conversationId,
      content: input.body
    });
    await createAssistantMessage({
      tenantId: replyInquiry.tenantId,
      conversationId: replyInquiry.conversationId,
      content: reply
    });
  }

  try {
    const sendResult = await sendWhatsAppText({
      to: input.from,
      role: participant === "operator" ? "ops" : "kai",
      body: reply
    });

    await createBluePassInquiryEvent({
      inquiry: replyInquiry,
      type: "WHATSAPP_CONTEXT_REPLY_SENT",
      fromStatus: replyInquiry.status,
      toStatus: replyInquiry.status,
      metadata: {
        participant,
        providerMessageId: sendResult.providerMessageId,
        inboundProviderMessageId: input.providerMessageId ?? null,
        alternativeDispatchId: alternativeDispatch?.dispatch?.id ?? null
      }
    });

    return {
      handled: true as const,
      sent: true as const,
      inquiry: replyInquiry,
      participant,
      reply,
      providerMessageId: sendResult.providerMessageId
    };
  } catch (error) {
    await createBluePassInquiryEvent({
      inquiry: replyInquiry,
      type: "WHATSAPP_CONTEXT_REPLY_FAILED",
      fromStatus: replyInquiry.status,
      toStatus: replyInquiry.status,
      metadata: {
        participant,
        inboundProviderMessageId: input.providerMessageId ?? null,
        reason: error instanceof Error ? error.message : "WhatsApp context reply failed."
      }
    });

    return {
      handled: true as const,
      sent: false as const,
      inquiry: replyInquiry,
      participant,
      reply,
      skippedReason: error instanceof Error ? error.message : "WhatsApp context reply failed."
    };
  }
}

export async function listBluePassInquiriesForTenantSlug(input: { tenantSlug: string; take?: number }) {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: input.tenantSlug },
    select: { id: true, slug: true, name: true }
  });

  if (!tenant) {
    return [];
  }

  const inquiries = await prisma.bluePassInquiry.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "desc" },
    take: input.take ?? 50,
    include: {
      events: { orderBy: { createdAt: "desc" }, take: 5 },
      ledger: {
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" }
      },
      dispatches: { orderBy: { createdAt: "desc" } }
    }
  });

  return inquiries.map((inquiry) => ({
    ...inquiry,
    tenant,
    events: inquiry.events,
    ledger: inquiry.ledger,
    dispatches: inquiry.dispatches
  }));
}

async function buildInquiryData(input: CreateOrReuseBluePassInquiryInput, existing?: BluePassInquiry) {
  const selectedYacht = resolveInquirySelectedYacht(input.selectedYacht, existing);
  const operatorDirectoryPhone = await resolveBluePassOperatorDirectoryPhone({
    selectedYacht
  });
  const operatorPhone = resolveBluePassOperatorPhone({
    selectedYacht,
    existingOperatorPhone: existing?.operatorPhone,
    operatorDirectoryPhone
  });

  return {
    status: "READY_TO_DISPATCH" as const,
    travellerName: input.intent.travellerName ?? existing?.travellerName,
    travellerEmail: input.intent.travellerEmail ?? existing?.travellerEmail,
    travellerPhone: input.intent.travellerPhone ?? existing?.travellerPhone,
    destination: input.intent.destination ?? existing?.destination,
    tripType: input.intent.tripType ?? existing?.tripType,
    dateWindow: input.intent.dateWindow ?? existing?.dateWindow,
    guests: input.intent.guests ?? existing?.guests,
    budget: input.intent.budget ?? existing?.budget,
    interests: input.intent.interests ? (input.intent.interests as Prisma.InputJsonArray) : undefined,
    selectedYachtSlug: selectedYacht?.slug ?? existing?.selectedYachtSlug,
    selectedYachtName: selectedYacht?.name ?? existing?.selectedYachtName,
    operatorId: selectedYacht?.operatorId ?? existing?.operatorId,
    operatorName: selectedYacht?.operatorName ?? existing?.operatorName,
    operatorPhone,
    notes: input.notes ?? existing?.notes,
    travellerMessage: input.travellerMessage,
    referralPartnerId: input.referral?.referralPartnerId ?? existing?.referralPartnerId,
    referralLinkId: input.referral?.referralLinkId ?? existing?.referralLinkId,
    referralCode: input.referral?.referralCode ?? existing?.referralCode,
    referralRole: input.referral?.referralRole ?? existing?.referralRole
  };
}

function resolveBluePassOperatorPhone(input: {
  selectedYacht?: BluePassSelectedYachtInput | null;
  existingOperatorPhone?: string | null;
  operatorDirectoryPhone?: string | null;
}) {
  const forcedTestPhone = shouldForceBluePassTestOperatorPhone() ? normalizeConfiguredPhone(process.env.BLUEPASS_TEST_OPERATOR_PHONE) : null;
  if (forcedTestPhone) return forcedTestPhone;

  const operatorDirectoryPhone = normalizeRuntimeOperatorPhone(input.operatorDirectoryPhone);
  if (operatorDirectoryPhone) return operatorDirectoryPhone;

  const overridePhone = resolveBluePassOperatorPhoneOverride(input.selectedYacht);
  if (overridePhone) return overridePhone;

  const selectedOperatorPhone = normalizeRuntimeOperatorPhone(input.selectedYacht?.operatorPhone);
  if (selectedOperatorPhone) return selectedOperatorPhone;

  const existingOperatorPhone = normalizeRuntimeOperatorPhone(input.existingOperatorPhone);
  if (existingOperatorPhone) return existingOperatorPhone;

  return null;
}

function resolveBluePassOperatorPhoneOverride(selectedYacht?: BluePassSelectedYachtInput | null) {
  const overrides = parseBluePassOperatorPhoneOverrides();
  if (!selectedYacht || overrides.size === 0) return null;

  const keys = [selectedYacht.slug, selectedYacht.operatorId, selectedYacht.operatorName, selectedYacht.name]
    .map((value) => normalizeOperatorPhoneOverrideKey(value))
    .filter((value): value is string => Boolean(value));

  for (const key of keys) {
    const phone = normalizeConfiguredPhone(overrides.get(key));
    if (phone) return phone;
  }

  return null;
}

function parseBluePassOperatorPhoneOverrides() {
  const raw = process.env.BLUEPASS_OPERATOR_PHONE_OVERRIDES?.trim();
  const overrides = new Map<string, string>();
  if (!raw) return overrides;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return overrides;

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string") continue;
      const normalizedKey = normalizeOperatorPhoneOverrideKey(key);
      const phone = normalizeConfiguredPhone(value);
      if (normalizedKey && phone) overrides.set(normalizedKey, phone);
    }
  } catch {
    return overrides;
  }

  return overrides;
}

function normalizeOperatorPhoneOverrideKey(value?: string | null) {
  return value
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeConfiguredPhone(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function normalizeRuntimeOperatorPhone(value?: string | null) {
  const phone = normalizeConfiguredPhone(value);
  if (!phone) return null;
  if (isProductionRuntime() && isPreviewCatalogOperatorPhone(phone)) return null;

  return phone;
}

function isPreviewCatalogOperatorPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return /^6281234567\d+$/.test(digits);
}

function shouldForceBluePassTestOperatorPhone() {
  if (isProductionRuntime()) return false;
  return /^(1|true|yes|on)$/i.test(process.env.BLUEPASS_FORCE_TEST_OPERATOR_PHONE?.trim() ?? "");
}

function isProductionRuntime() {
  return process.env.NODE_ENV === "production";
}

function buildOperatorPhoneCandidates(value?: string | null) {
  const raw = value?.trim();
  if (!raw) return [];

  const digits = raw.replace(/\D/g, "");
  return Array.from(new Set([raw, digits, digits ? `+${digits}` : ""])).filter(Boolean);
}

type BluePassInquiryWithDispatchPhones = BluePassInquiry & {
  dispatches: Array<{ operatorPhone: string }>;
};

function collectStoredOperatorPhoneDigitVariants(inquiry: BluePassInquiryWithDispatchPhones) {
  const variants = new Set<string>();
  const storedPhones = [...inquiry.dispatches.map((dispatch) => dispatch.operatorPhone), inquiry.operatorPhone];
  for (const phone of storedPhones) {
    for (const variant of phoneDigitVariantsForMatch(phone)) {
      variants.add(variant);
    }
  }
  return variants;
}

function verifyBluePassOperatorResponseOwnership(
  inquiry: BluePassInquiryWithDispatchPhones,
  operatorPhone?: string | null
): { ok: true } | { ok: false; reason: string } {
  const senderVariants = phoneDigitVariantsForMatch(operatorPhone);
  if (senderVariants.length === 0) {
    return { ok: false, reason: "sender phone missing, ownership cannot be verified" };
  }

  const storedVariants = collectStoredOperatorPhoneDigitVariants(inquiry);
  if (storedVariants.size === 0) {
    return { ok: false, reason: "inquiry has no dispatched or recorded operator phone" };
  }

  return senderVariants.some((variant) => storedVariants.has(variant))
    ? { ok: true }
    : { ok: false, reason: "sender is not the operator this inquiry was dispatched to" };
}

const bluePassOperatorResponseAllowedStatuses: Record<BluePassOperatorResponseAction, readonly string[]> = {
  accept: ["READY_TO_DISPATCH", "OPERATOR_PENDING", "OPERATOR_ACCEPTED", "COUNTER_OFFERED"],
  decline: ["READY_TO_DISPATCH", "OPERATOR_PENDING", "OPERATOR_ACCEPTED", "COUNTER_OFFERED"],
  counter: ["READY_TO_DISPATCH", "OPERATOR_PENDING", "OPERATOR_ACCEPTED", "COUNTER_OFFERED"],
  payment_ready: ["OPERATOR_ACCEPTED", "COUNTER_OFFERED"],
  booking_confirmed: ["OPERATOR_ACCEPTED", "COUNTER_OFFERED"]
};

const bluePassOperatorResponseTerminalStatuses = new Set(["DECLINED", "CLOSED"]);

function checkBluePassOperatorResponseStatus(
  status: BluePassInquiry["status"],
  action: BluePassOperatorResponseAction
): { kind: "apply" } | { kind: "noop" } | { kind: "reject"; reason: string } {
  if (bluePassOperatorResponseTerminalStatuses.has(status)) {
    // Repeating the reply that produced the terminal state is an idempotent no-op, so a
    // redelivery can recover a traveller notification lost after the transition committed.
    // A conflicting action on a terminal inquiry stays rejected.
    const repeatsTerminalOutcome =
      (action === "decline" && status === "DECLINED") ||
      (action === "booking_confirmed" && status === "CLOSED");
    if (repeatsTerminalOutcome) {
      return { kind: "noop" };
    }
    return { kind: "reject", reason: `inquiry is already ${status.toLowerCase().replace(/_/g, " ")}` };
  }

  if (!bluePassOperatorResponseAllowedStatuses[action].includes(status)) {
    return {
      kind: "reject",
      reason: `a ${action.replace(/_/g, " ")} reply does not apply while the inquiry is ${status
        .toLowerCase()
        .replace(/_/g, " ")}`
    };
  }

  // Repeating the reply that produced the current status changes nothing; acknowledge it without
  // re-sending the traveller notification or re-drafting the quote.
  const repeatsCurrentStatus =
    (action === "accept" && status === "OPERATOR_ACCEPTED") ||
    (action === "counter" && status === "COUNTER_OFFERED");
  return repeatsCurrentStatus ? { kind: "noop" } : { kind: "apply" };
}

async function recordRejectedBluePassOperatorResponse(input: {
  inquiry: BluePassInquiry;
  input: HandleBluePassOperatorResponseInput;
  reason: string;
}) {
  try {
    await createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: "OPERATOR_RESPONSE_REJECTED",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        reason: input.reason,
        action: input.input.action,
        providerMessageId: input.input.providerMessageId ?? null,
        operatorPhone: input.input.operatorPhone ?? null,
        counterText: input.input.counterText ?? null
      }
    });
  } catch {
    // Rejection audit must never mask the rejection itself.
  }
}

/**
 * The losing side of a concurrent status transition: re-read the inquiry and re-apply the
 * status guard. A repeat of the action that won the race is an idempotent no-op; anything
 * else is judged against the status the inquiry actually has now.
 */
async function handleConcurrentBluePassOperatorResponse(input: {
  inquiryId: string;
  input: HandleBluePassOperatorResponseInput;
}): Promise<BluePassOperatorResponseResult> {
  const current = await prisma.bluePassInquiry.findUniqueOrThrow({
    where: { id: input.inquiryId }
  });
  const statusGuard = checkBluePassOperatorResponseStatus(current.status, input.input.action);
  if (statusGuard.kind === "noop") {
    const notificationDelivery = await ensureBluePassTravellerNotifiedForOperatorAction({
      inquiry: current,
      action: input.input.action
    });
    return {
      inquiry: current,
      travellerNotification: notificationDelivery.notification,
      operatorFollowUp: null,
      notificationRecovery: {
        state: notificationDelivery.state,
        uncertainPrior: notificationDelivery.uncertainPrior
      }
    };
  }
  if (statusGuard.kind === "apply") {
    // The winning transition moved the inquiry to a status this action is still allowed from
    // (e.g. decline after a concurrent accept): apply it against the current row.
    return handleBluePassOperatorResponse(input.input);
  }
  await recordRejectedBluePassOperatorResponse({
    inquiry: current,
    input: input.input,
    reason: statusGuard.reason
  });
  throw new Error(
    `Rejected ${input.input.action} for BluePass inquiry ${input.inquiryId}: ${statusGuard.reason}`
  );
}

/**
 * Phones holding any BluePass operator dispatch whose stored number matches one of the given
 * senders (in any stored format). The webhook route uses this to decide whose free-text replies
 * may be parsed as operator commands - everyone else's words stay ordinary conversation.
 *
 * Deliberate scope: ANY historical dispatch counts, of any age or outcome. There is no global
 * retention policy for dispatch rows today and this function does not invent one; while an
 * operator keeps the same phone, their informal replies keep parsing as operator commands.
 * Sender ownership for actually APPLYING a reply is enforced per inquiry inside
 * handleBluePassOperatorResponse, so a stale "known operator" can never move an inquiry that
 * was not dispatched to them - the worst case of the broad parse gate is an informal reply
 * being rejected (audited) instead of treated as conversation.
 */
export async function findDispatchedBluePassOperatorPhones(fromPhones: Array<string | null | undefined>) {
  const candidates = new Set<string>();
  for (const phone of fromPhones) {
    for (const candidate of buildOperatorPhoneCandidates(phone)) {
      candidates.add(candidate);
    }
    for (const variant of phoneDigitVariantsForMatch(phone)) {
      candidates.add(variant);
      candidates.add(`+${variant}`);
    }
  }
  if (candidates.size === 0) return [];

  const dispatches = await prisma.bluePassOperatorDispatch.findMany({
    where: { operatorPhone: { in: Array.from(candidates) } },
    select: { operatorPhone: true },
    distinct: ["operatorPhone"]
  });

  return dispatches.map((dispatch) => dispatch.operatorPhone);
}

function buildParticipantPhoneCandidates(value?: string | null) {
  const raw = value?.trim();
  if (!raw) return [];

  const digits = raw.replace(/\D/g, "");
  const indonesiaLocal = internationalToLocalPhone(digits);
  const indonesiaInternational = digits.startsWith("0") ? normalizeLocalPhone(digits) : null;
  const candidates = [
    raw,
    digits,
    digits ? `+${digits}` : null,
    indonesiaLocal,
    indonesiaLocal ? `+${indonesiaLocal}` : null,
    indonesiaInternational,
    indonesiaInternational ? `+${indonesiaInternational}` : null
  ];

  return Array.from(new Set(candidates.filter((candidate): candidate is string => Boolean(candidate))));
}

async function dispatchDeclinedAlternativeFromTravellerApproval(input: {
  inquiry: BluePassInquiry;
  travellerMessage: string;
}) {
  if (input.inquiry.status !== "DECLINED") {
    return null;
  }

  const selection = resolveDeclinedAlternativeSelection({
    inquiry: input.inquiry,
    travellerMessage: input.travellerMessage
  });
  if (!selection.approved) {
    return null;
  }

  const alternative = selection.alternative;
  if (!alternative) {
    return {
      inquiry: input.inquiry,
      dispatch: null,
      reply:
        "I had a look, but there's nothing similar enough in the BluePass catalogue for this one yet. The team will follow up with you before sending another enquiry."
    };
  }

  const created = await createOrReuseBluePassInquiry({
    tenantId: input.inquiry.tenantId,
    conversationId: input.inquiry.conversationId,
    sourceChannel: "WHATSAPP",
    travellerMessage: input.travellerMessage,
    intent: {
      destination: input.inquiry.destination ?? alternative.region,
      tripType: input.inquiry.tripType ?? undefined,
      dateWindow: input.inquiry.dateWindow ?? undefined,
      guests: input.inquiry.guests ?? undefined,
      budget: input.inquiry.budget ?? undefined,
      interests: Array.isArray(input.inquiry.interests)
        ? input.inquiry.interests.filter((interest): interest is string => typeof interest === "string")
        : undefined,
      travellerName: input.inquiry.travellerName ?? undefined,
      travellerEmail: input.inquiry.travellerEmail ?? undefined,
      travellerPhone: input.inquiry.travellerPhone ?? undefined,
      selectedYachtSlug: alternative.slug
    },
    selectedYacht: alternative,
    referral: {
      referralPartnerId: input.inquiry.referralPartnerId,
      referralLinkId: input.inquiry.referralLinkId,
      referralCode: input.inquiry.referralCode,
      referralRole: input.inquiry.referralRole
    },
    alternativeOf: {
      previousInquiryId: input.inquiry.id,
      previousYachtSlug: input.inquiry.selectedYachtSlug,
      alternativeYachtSlug: alternative.slug,
      reason: "operator_declined"
    }
  });
  await syncBluePassReferralLedgerEstimate(created.inquiry);
  const dispatch = created.inquiry.operatorPhone
    ? await dispatchBluePassOperatorWhatsApp({ inquiryId: created.inquiry.id })
    : null;
  const updatedInquiry = await prisma.bluePassInquiry.findUniqueOrThrow({
    where: { id: created.inquiry.id }
  });

  return {
    inquiry: updatedInquiry,
    dispatch,
    reply: buildAlternativeDispatchReply({
      inquiry: updatedInquiry,
      previousInquiry: input.inquiry,
      dispatchFailed: dispatch?.status === "FAILED"
    })
  };
}

function resolveInquirySelectedYacht(
  selectedYacht?: BluePassSelectedYachtInput | null,
  existing?: BluePassInquiry
): BluePassSelectedYachtInput | null {
  if (selectedYacht) return selectedYacht;
  if (!existing?.selectedYachtSlug && !existing?.selectedYachtName && !existing?.operatorId && !existing?.operatorName) return null;

  return {
    slug: existing.selectedYachtSlug ?? existing.operatorId ?? existing.selectedYachtName ?? "unknown",
    name: existing.selectedYachtName ?? existing.selectedYachtSlug ?? existing.operatorName ?? "Unknown yacht",
    operatorId: existing.operatorId,
    operatorName: existing.operatorName,
    operatorPhone: existing.operatorPhone
  };
}

function resolveDeclinedAlternativeSelection(input: { inquiry: BluePassInquiry; travellerMessage: string }) {
  const alternatives = findBluePassAlternativeYachts({
    destination: input.inquiry.destination ?? undefined,
    guests: input.inquiry.guests ?? undefined,
    declinedYachtSlug: input.inquiry.selectedYachtSlug
  });
  const mentionedAlternative = alternatives.find((alternative) =>
    messageMentionsAlternative(input.travellerMessage, alternative)
  );

  if (mentionedAlternative && hasTravellerAlternativeDispatchIntent(input.travellerMessage)) {
    return {
      approved: true,
      alternative: mentionedAlternative,
      alternatives
    };
  }

  if (isTravellerAlternativeApproval(input.travellerMessage)) {
    return {
      approved: true,
      alternative: alternatives[0] ?? null,
      alternatives
    };
  }

  return {
    approved: false,
    alternative: null,
    alternatives
  };
}

export async function findLatestBluePassParticipantContext(from: string) {
  const candidates = buildParticipantPhoneCandidates(from);
  if (candidates.length === 0) return null;

  const dispatch = await prisma.bluePassOperatorDispatch.findFirst({
    where: {
      operatorPhone: { in: candidates }
    },
    orderBy: { createdAt: "desc" },
    select: { bluePassInquiryId: true }
  });

  if (dispatch) {
    const inquiry = await findBluePassInquiryWithRecentEvents(dispatch.bluePassInquiryId);
    if (inquiry) {
      return {
        participant: "operator" as const,
        inquiry
      };
    }
  }

  const inquiry = await prisma.bluePassInquiry.findFirst({
    where: {
      travellerPhone: { in: candidates }
    },
    orderBy: { createdAt: "desc" },
    include: {
      events: { orderBy: { createdAt: "desc" }, take: 8 }
    }
  });

  return inquiry
    ? {
        participant: "traveller" as const,
        inquiry
      }
    : null;
}

function isTravellerAlternativeApproval(value: string) {
  return hasTravellerAlternativeDispatchIntent(value);
}

function hasTravellerAlternativeDispatchIntent(value: string) {
  const normalized = normalizeAlternativeSelectionText(value);

  return /\b(?:yes|yep|yeah|ok|okay|sure|please|go ahead|proceed|send|submit|try)\b/.test(normalized);
}

function messageMentionsAlternative(message: string, alternative: BluePassYachtCard) {
  const normalizedMessage = normalizeAlternativeSelectionText(message);

  return [alternative.name, alternative.slug].some((value) =>
    normalizedMessage.includes(normalizeAlternativeSelectionText(value))
  );
}

function normalizeAlternativeSelectionText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAlternativeDispatchReply(input: {
  inquiry: BluePassInquiry;
  previousInquiry: BluePassInquiry;
  dispatchFailed: boolean;
}) {
  const yachtName = input.inquiry.selectedYachtName ?? input.inquiry.operatorName ?? "the next operator";
  const previousYachtName =
    input.previousInquiry.selectedYachtName ?? input.previousInquiry.operatorName ?? "the previous operator";
  const dispatchLine = input.dispatchFailed
    ? "I couldn't reach them on WhatsApp just now, so the team will send it on."
    : "I've sent them your enquiry and I'll let you know as soon as they reply.";

  return `${previousYachtName} couldn't do it, so I've tried a similar boat: ${yachtName} for ${describeTrip(input.inquiry)}. ${dispatchLine} It's not booked yet: they'll confirm availability and the final price first.`;
}

async function findBluePassInquiryWithRecentEvents(inquiryId: string) {
  return prisma.bluePassInquiry.findUnique({
    where: { id: inquiryId },
    include: {
      events: { orderBy: { createdAt: "desc" }, take: 8 }
    }
  });
}

async function buildBluePassWhatsAppContextReply(input: {
  inquiry: BluePassInquiry & { events?: Array<{ type: string; metadata: Prisma.JsonValue }> };
  participant: "traveller" | "operator";
  latestMessage: string;
}) {
  const inquiry = input.inquiry;
  const yachtName = inquiry.selectedYachtName ?? inquiry.operatorName ?? "the operator";
  const tripSummary = formatTripSummary(inquiry);
  const quoteUrl = buildBluePassQuoteUrl(inquiry.id);
  const paymentText = findLatestEventMetadataString(inquiry.events, "OPERATOR_PAYMENT_READY", "paymentText");
  const confirmationText = findLatestEventMetadataString(
    inquiry.events,
    "OPERATOR_BOOKING_CONFIRMED",
    "confirmationText"
  );
  const hasQuoteApproval = Boolean(inquiry.events?.some((event) => event.type === "BLUEPASS_QUOTE_APPROVED"));

  if (input.participant === "operator") {
    const travellerName = inquiry.travellerName ?? "the traveller";
    const guestTrip = describeTrip(inquiry, `${travellerName}'s`);

    if (inquiry.status === "CLOSED" || confirmationText) {
      return composeBluePassWhatsAppContextReply({
        deterministicReply: `${capitalise(guestTrip)} with ${yachtName} is marked confirmed. ${confirmationText ? `Latest confirmation: ${confirmationText}` : "I'll keep the traveller posted."}`,
        inquiry,
        participant: input.participant,
        latestMessage: input.latestMessage,
        requiredFacts: [yachtName, guestTrip]
      });
    }

    if (paymentText) {
      return composeBluePassWhatsAppContextReply({
        deterministicReply: `The payment details for ${guestTrip} with ${yachtName} are already with them: ${paymentText} Just reply here once payment's in and the booking's confirmed.`,
        inquiry,
        participant: input.participant,
        latestMessage: input.latestMessage,
        requiredFacts: [yachtName, guestTrip, paymentText]
      });
    }

    if (hasQuoteApproval) {
      return composeBluePassWhatsAppContextReply({
        deterministicReply: `${capitalise(travellerName)} approved the BluePass quote for ${describeTrip(inquiry, "their")} with ${yachtName}. Please hold the spot and send the payment link, deposit terms and booking reference here.`,
        inquiry,
        participant: input.participant,
        latestMessage: input.latestMessage,
        requiredFacts: [yachtName, "approved the BluePass quote"]
      });
    }

    if (inquiry.status === "COUNTER_OFFERED") {
      return composeBluePassWhatsAppContextReply({
        deterministicReply: `Your counter-offer for ${guestTrip} with ${yachtName} is with them now, and I'm waiting to hear if they take it or want changes.`,
        inquiry,
        participant: input.participant,
        latestMessage: input.latestMessage,
        requiredFacts: [yachtName, guestTrip, "counter-offer"]
      });
    }

    return composeBluePassWhatsAppContextReply({
      deterministicReply: `${capitalise(guestTrip)} with ${yachtName} is ${describeStatus(inquiry.status, "operator")}. You can reply with availability, a counter-offer, payment details or a booking confirmation.`,
      inquiry,
      participant: input.participant,
      latestMessage: input.latestMessage,
      requiredFacts: [yachtName, guestTrip]
    });
  }

  const trip = describeTrip(inquiry);

  if (inquiry.status === "CLOSED" || confirmationText) {
    return composeBluePassWhatsAppContextReply({
      deterministicReply: `You're all booked with ${yachtName} for ${trip}. ${confirmationText ? `Their confirmation: ${confirmationText}` : "I'm here if you need anything before you go."}`,
      inquiry,
      participant: input.participant,
      latestMessage: input.latestMessage,
      requiredFacts: [yachtName, trip]
    });
  }

  if (paymentText) {
    return composeBluePassWhatsAppContextReply({
      deterministicReply: `${yachtName} has sent the payment details for ${trip}: ${paymentText} It's not booked until you've paid and they've confirmed.`,
      inquiry,
      participant: input.participant,
      latestMessage: input.latestMessage,
      requiredFacts: [yachtName, trip, paymentText, "not booked"]
    });
  }

  if (hasQuoteApproval) {
    return composeBluePassWhatsAppContextReply({
      deterministicReply: `You've approved the quote for ${trip}, and I'm waiting on ${yachtName} to hold your spot and send the payment details. Here's your quote: ${quoteUrl}`,
      inquiry,
      participant: input.participant,
      latestMessage: input.latestMessage,
      requiredFacts: [yachtName, trip, quoteUrl]
    });
  }

  if (inquiry.status === "COUNTER_OFFERED") {
    return composeBluePassWhatsAppContextReply({
      deterministicReply: `${yachtName} has come back with a different offer for ${trip}. You can take it, ask for changes or compare other options here: ${quoteUrl}`,
      inquiry,
      participant: input.participant,
      latestMessage: input.latestMessage,
      requiredFacts: [yachtName, trip, quoteUrl]
    });
  }

  if (inquiry.status === "DECLINED") {
    return composeBluePassWhatsAppContextReply({
      deterministicReply: `Sorry, ${yachtName} can't do ${trip}. Want me to find you something similar?`,
      inquiry,
      participant: input.participant,
      latestMessage: input.latestMessage,
      requiredFacts: [yachtName, trip, "can't do"]
    });
  }

  if (inquiry.status === "OPERATOR_ACCEPTED") {
    return composeBluePassWhatsAppContextReply({
      deterministicReply: `Good news, ${yachtName} said yes to ${trip}. It's not booked yet: I'm waiting on the final quote and payment details.`,
      inquiry,
      participant: input.participant,
      latestMessage: input.latestMessage,
      requiredFacts: [yachtName, trip, "not booked yet"]
    });
  }

  return composeBluePassWhatsAppContextReply({
    deterministicReply: `Your enquiry with ${yachtName} for ${trip} is ${describeStatus(inquiry.status, "traveller")}. I'll keep you posted here.`,
    inquiry,
    participant: input.participant,
    latestMessage: input.latestMessage,
    requiredFacts: [yachtName, trip]
  });
}

async function composeBluePassWhatsAppContextReply(input: {
  deterministicReply: string;
  inquiry: BluePassInquiry;
  participant: "traveller" | "operator";
  latestMessage: string;
  requiredFacts: string[];
}) {
  const llmClient = createAssistantLlmClient(process.env);
  const history = await listRecentConversationMessages({
    tenantId: input.inquiry.tenantId,
    conversationId: input.inquiry.conversationId
  });
  const result = await composeAssistantReply({
    deterministicReply: input.deterministicReply,
    requiredFacts: input.requiredFacts,
    latestUserMessage: input.latestMessage,
    conversationHistory: history,
    llmClient,
    tenantContext: {
      tenantName: "BluePass",
      // Travellers get Kai's own voice (core/llm/kai-persona.ts); operators get it with a crisper tone.
      brandVoice:
        input.participant === "operator" ? "Concise, operational, and clear about the next action needed from the operator." : null,
      pmsProvider: "BluePass operator network",
      responseGuardrails: [
        "Do not confirm availability, final price, payment, or booking before operator confirmation.",
        "Do not invent operator responses, prices, dates, payment links, or live availability."
      ],
      productTitles: [input.inquiry.selectedYachtName, input.inquiry.operatorName].filter(
        (value): value is string => Boolean(value)
      )
    }
  });

  return result.reply;
}

function findLatestEventMetadataString(
  events: Array<{ type: string; metadata: Prisma.JsonValue }> | undefined,
  type: string,
  key: string
) {
  const event = events?.find((item) => item.type === type);
  if (!event || !event.metadata || typeof event.metadata !== "object" || Array.isArray(event.metadata)) {
    return null;
  }

  const value = event.metadata[key as keyof typeof event.metadata];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildBluePassQuoteUrl(quoteId: string) {
  const baseUrl =
    process.env.BLUEPASS_APP_URL?.trim() || process.env.NEXT_PUBLIC_BLUEPASS_APP_URL?.trim() || "https://bluepass.co";
  return `${baseUrl.replace(/\/$/, "")}/quotes/${quoteId}`;
}

async function findTravellerWhatsAppSentEvent(providerMessageId: string) {
  const recentSentEvents = await prisma.bluePassInquiryEvent.findMany({
    where: {
      type: "TRAVELLER_WHATSAPP_NOTIFICATION_SENT"
    },
    orderBy: { createdAt: "desc" },
    take: 500
  });

  return (
    recentSentEvents.find((event) => {
      const metadata = event.metadata;
      return (
        metadata !== null &&
        typeof metadata === "object" &&
        !Array.isArray(metadata) &&
        "providerMessageId" in metadata &&
        metadata.providerMessageId === providerMessageId
      );
    }) ?? null
  );
}

/**
 * True when an inbound traveller message id already has a context-handling event recorded
 * (received / reply sent / reply failed). The webhook route uses this to skip re-running a
 * reclaimed conversational message whose first attempt actually completed, because a
 * conversational reply is not safe to send twice and the handler has no CAS equivalent.
 */
export async function hasBluePassContextMessageBeenProcessed(providerMessageId: string, tenantId: string) {
  // Exact durable identity match scoped to the tenant that owns the conversation: neither a
  // bounded tail scan (a record must never age out of a recency window) nor a global match
  // (global uniqueness of provider message ids is an external claim we do not rely on - the
  // same id under another tenant must NOT read as processed here). Fail-closed without a
  // tenant scope: an unscoped query would silently drop the tenant filter and read as global.
  if (!tenantId) return false;
  // WHATSAPP_CONTEXT_MESSAGE_RECEIVED records the inbound id as providerMessageId; the reply
  // events record it as inboundProviderMessageId (their providerMessageId is the outbound id).
  const received = await prisma.bluePassInquiryEvent.findFirst({
    where: {
      tenantId,
      type: "WHATSAPP_CONTEXT_MESSAGE_RECEIVED",
      metadata: { path: ["providerMessageId"], equals: providerMessageId }
    },
    select: { id: true }
  });
  if (received) return true;

  const replied = await prisma.bluePassInquiryEvent.findFirst({
    where: {
      tenantId,
      type: { in: ["WHATSAPP_CONTEXT_REPLY_SENT", "WHATSAPP_CONTEXT_REPLY_FAILED"] },
      metadata: { path: ["inboundProviderMessageId"], equals: providerMessageId }
    },
    select: { id: true }
  });
  return Boolean(replied);
}

export async function createBluePassInquiryEvent(input: {
  inquiry: BluePassInquiry;
  type: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  return prisma.bluePassInquiryEvent.create({
    data: {
      tenantId: input.inquiry.tenantId,
      conversationId: input.inquiry.conversationId,
      bluePassInquiryId: input.inquiry.id,
      type: input.type,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      metadata: input.metadata
    }
  });
}

function resolveOperatorInquirySendMode() {
  if (process.env.WHATSAPP_OPERATOR_INQUIRY_SEND_MODE === "template") return "template";
  if (process.env.WHATSAPP_OPERATOR_INQUIRY_SEND_MODE === "text") return "text";
  return "queue";
}

function resolveOperatorResponseStatus(action: BluePassOperatorResponseAction) {
  if (action === "accept") return "OPERATOR_ACCEPTED" as const;
  if (action === "decline") return "DECLINED" as const;
  return "COUNTER_OFFERED" as const;
}

function resolveOperatorResponseEventType(action: BluePassOperatorResponseAction) {
  if (action === "accept") return "OPERATOR_ACCEPTED";
  if (action === "decline") return "OPERATOR_DECLINED";
  return "OPERATOR_COUNTER_OFFERED";
}

function buildOperatorResponseTravellerNotification(input: {
  inquiry: BluePassInquiry;
  action: Exclude<BluePassOperatorResponseAction, "payment_ready" | "booking_confirmed">;
  counterText?: string | null;
  quoteUrl?: string | null;
}) {
  const yachtName = input.inquiry.selectedYachtName ?? input.inquiry.operatorName ?? "the operator";
  const quoteLink = input.quoteUrl ? ` Quote link: ${input.quoteUrl}` : "";
  const trip = describeTrip(input.inquiry);

  if (input.action === "accept") {
    return `Good news, ${yachtName} said yes to ${trip}. It's not booked yet: the final price and payment details come next, and I'll send them through as soon as they're ready.${quoteLink}`;
  }

  if (input.action === "decline") {
    const alternatives = formatDeclineAlternatives(input.inquiry);
    return `Sorry, ${yachtName} can't do ${trip}.${alternatives}`;
  }

  const counterText = input.counterText?.trim();
  const details = counterText
    ? ` Here's what they said: ${counterText}`
    : " I'm waiting on the details from them and will pass them on as soon as they land.";

  return `${yachtName} has come back with a different offer for ${trip}.${details} You can take it, ask for changes or have me compare other options.${quoteLink}`;
}

function buildPaymentReadyTravellerNotification(input: { inquiry: BluePassInquiry; paymentText: string }) {
  const yachtName = input.inquiry.selectedYachtName ?? input.inquiry.operatorName ?? "the operator";

  return `${yachtName} is holding ${describeTrip(input.inquiry)} for you. Here's how to pay and lock it in: ${input.paymentText} It's not booked until you've paid and they've confirmed.`;
}

function buildBookingConfirmedTravellerNotification(input: { inquiry: BluePassInquiry; confirmationText: string }) {
  const yachtName = input.inquiry.selectedYachtName ?? input.inquiry.operatorName ?? "the operator";

  return `You're booked with ${yachtName} for ${describeTrip(input.inquiry)}. Their confirmation: ${input.confirmationText} I'm here in this chat if you need anything before you go.`;
}

async function handleBluePassPaymentReadyOperatorResponse(input: {
  inquiry: BluePassInquiry;
  paymentText?: string | null;
  providerMessageId?: string | null;
  operatorPhone?: string | null;
}) {
  const paymentText = input.paymentText?.trim();
  const quote = await getBluePassQuote({ quoteId: input.inquiry.id });

  if (!paymentText) {
    await createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: "OPERATOR_PAYMENT_READY_IGNORED",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        reason: "payment details missing",
        providerMessageId: input.providerMessageId ?? null,
        operatorPhone: input.operatorPhone ?? null
      }
    });

    return {
      inquiry: input.inquiry,
      travellerNotification: null,
      operatorFollowUp: null
    };
  }

  if (quote?.status !== "TRAVELLER_APPROVED") {
    await createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: "OPERATOR_PAYMENT_READY_WAITING_FOR_TRAVELLER_APPROVAL",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        providerMessageId: input.providerMessageId ?? null,
        operatorPhone: input.operatorPhone ?? null,
        paymentText
      }
    });

    return {
      inquiry: input.inquiry,
      travellerNotification: null,
      operatorFollowUp: null
    };
  }

  // Once-only per inquiry: concurrent payment-ready replies (different message ids) would both
  // pass the read-side checks, so the event insert is serialized per inquiry with an advisory
  // lock and the loser is acknowledged without re-sending the traveller the payment details.
  const paymentReadyEvent = {
    tenantId: input.inquiry.tenantId,
    conversationId: input.inquiry.conversationId,
    bluePassInquiryId: input.inquiry.id,
    type: "OPERATOR_PAYMENT_READY",
    fromStatus: input.inquiry.status,
    toStatus: input.inquiry.status,
    metadata: {
      providerMessageId: input.providerMessageId ?? null,
      operatorPhone: input.operatorPhone ?? null,
      paymentText,
      quoteId: quote.id
    }
  };
  const wonPaymentReady = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.inquiry.id}, 0))`;
    const existing = await tx.bluePassInquiryEvent.findFirst({
      where: { bluePassInquiryId: input.inquiry.id, type: "OPERATOR_PAYMENT_READY" }
    });
    if (existing) return false;
    await tx.bluePassInquiryEvent.create({ data: paymentReadyEvent });
    return true;
  });
  if (!wonPaymentReady) {
    const notificationDelivery = await ensureBluePassTravellerNotifiedForOperatorAction({
      inquiry: input.inquiry,
      action: "payment_ready"
    });
    return {
      inquiry: input.inquiry,
      travellerNotification: notificationDelivery.notification,
      operatorFollowUp: null,
      notificationRecovery: {
        state: notificationDelivery.state,
        uncertainPrior: notificationDelivery.uncertainPrior
      }
    };
  }

  const notificationDelivery = await ensureBluePassTravellerNotifiedForOperatorAction({
    inquiry: input.inquiry,
    action: "payment_ready",
    paymentText
  });

  return {
    inquiry: input.inquiry,
    travellerNotification: notificationDelivery.notification,
    operatorFollowUp: null,
    notificationRecovery: {
      state: notificationDelivery.state,
      uncertainPrior: notificationDelivery.uncertainPrior
    }
  };
}

async function handleBluePassBookingConfirmedOperatorResponse(input: {
  inquiry: BluePassInquiry;
  confirmationText?: string | null;
  providerMessageId?: string | null;
  operatorPhone?: string | null;
}) {
  const confirmationText = input.confirmationText?.trim();

  if (!confirmationText) {
    await createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: "OPERATOR_BOOKING_CONFIRMATION_IGNORED",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        reason: "confirmation details missing",
        providerMessageId: input.providerMessageId ?? null,
        operatorPhone: input.operatorPhone ?? null
      }
    });

    return {
      inquiry: input.inquiry,
      travellerNotification: null,
      operatorFollowUp: null
    };
  }

  // Compare-and-set for the same concurrent-delivery reason as the main response path.
  const transition = await prisma.bluePassInquiry.updateMany({
    where: { id: input.inquiry.id, status: input.inquiry.status },
    data: { status: "CLOSED" }
  });
  if (transition.count === 0) {
    const current = await prisma.bluePassInquiry.findUniqueOrThrow({
      where: { id: input.inquiry.id }
    });
    if (current.status === "CLOSED") {
      // A concurrent confirmation already closed it; acknowledge without duplicate effects,
      // but recover the traveller notification if the winner died before sending it.
      const notificationDelivery = await ensureBluePassTravellerNotifiedForOperatorAction({
        inquiry: current,
        action: "booking_confirmed"
      });
      return {
        inquiry: current,
        travellerNotification: notificationDelivery.notification,
        operatorFollowUp: null,
        notificationRecovery: {
          state: notificationDelivery.state,
          uncertainPrior: notificationDelivery.uncertainPrior
        }
      };
    }
    await recordRejectedBluePassOperatorResponse({
      inquiry: current,
      input: {
        inquiryId: input.inquiry.id,
        action: "booking_confirmed",
        counterText: input.confirmationText,
        providerMessageId: input.providerMessageId,
        operatorPhone: input.operatorPhone
      },
      reason: `a concurrent operator reply moved the inquiry to ${current.status.toLowerCase().replace(/_/g, " ")}`
    });
    throw new Error(
      `Rejected booking confirmed for BluePass inquiry ${input.inquiry.id}: a concurrent operator reply moved the inquiry.`
    );
  }
  const updated = await prisma.bluePassInquiry.findUniqueOrThrow({
    where: { id: input.inquiry.id }
  });

  await createBluePassInquiryEvent({
    inquiry: updated,
    type: "OPERATOR_BOOKING_CONFIRMED",
    fromStatus: input.inquiry.status,
    toStatus: updated.status,
    metadata: {
      providerMessageId: input.providerMessageId ?? null,
      operatorPhone: input.operatorPhone ?? null,
      confirmationText
    }
  });

  await finalizeBluePassLedgerForConfirmedBooking(updated);

  const notificationDelivery = await ensureBluePassTravellerNotifiedForOperatorAction({
    inquiry: updated,
    action: "booking_confirmed",
    confirmationText
  });

  return {
    inquiry: updated,
    travellerNotification: notificationDelivery.notification,
    operatorFollowUp: null,
    notificationRecovery: {
      state: notificationDelivery.state,
      uncertainPrior: notificationDelivery.uncertainPrior
    }
  };
}

function formatDeclineAlternatives(inquiry: BluePassInquiry) {
  const alternatives = findBluePassAlternativeYachts({
    destination: inquiry.destination ?? undefined,
    guests: inquiry.guests ?? undefined,
    declinedYachtSlug: inquiry.selectedYachtSlug
  });

  if (alternatives.length === 0) {
    return " I'll look for something similar and check with you before I send another enquiry.";
  }

  const optionLines = alternatives.map((alternative, index) => `${index + 1}. ${alternative.name}`).join("\n");
  const firstAlternative = alternatives[0]?.name ?? "the best match";

  return `\n\nSimilar BluePass options:\n${optionLines}\n\nReply "try ${firstAlternative}" and I'll send them an enquiry, or ask me to compare them first.`;
}

// "your Komodo trip (20 July, 2 guests)", for messages a person reads. formatTripSummary below stays
// compact because it also fills the approved WhatsApp template.
function describeTrip(inquiry: BluePassInquiry, owner = "your") {
  const details = [inquiry.dateWindow, inquiry.guests ? `${inquiry.guests} guest${inquiry.guests === 1 ? "" : "s"}` : null]
    .filter(Boolean)
    .join(", ");
  const trip = inquiry.destination ? `${owner} ${inquiry.destination} trip` : `${owner} trip`;

  return details ? `${trip} (${details})` : trip;
}

function describeStatus(status: BluePassInquiry["status"], participant: "traveller" | "operator") {
  if (status === "OPERATOR_PENDING") return participant === "operator" ? "waiting on your reply" : "with the operator, waiting on their reply";
  if (status === "DRAFT" || status === "READY_TO_DISPATCH") return "saved and on its way to the operator";
  if (status === "CLOSED") return "closed";

  return status.replace(/_/g, " ").toLowerCase();
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatTripSummary(inquiry: BluePassInquiry) {
  const parts = [
    inquiry.destination,
    inquiry.dateWindow,
    inquiry.guests ? `${inquiry.guests} guests` : null
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" / ") : "your requested trip";
}

async function sendTravellerWhatsAppNotification(input: { inquiry: BluePassInquiry; content: string }) {
  const mode = resolveTravellerWhatsAppNotificationMode();
  if (mode === "disabled") {
    await createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: "TRAVELLER_WHATSAPP_NOTIFICATION_SKIPPED",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        reason: "traveller WhatsApp notification mode is not enabled"
      }
    });

    return {
      channel: "conversation" as const,
      sent: true,
      providerMessageId: null
    };
  }

  if (!input.inquiry.travellerPhone) {
    await createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: "TRAVELLER_WHATSAPP_NOTIFICATION_SKIPPED",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        reason: "traveller phone missing"
      }
    });

    return {
      channel: "conversation" as const,
      sent: true,
      providerMessageId: null,
      skippedReason: "traveller phone missing"
    };
  }

  // Bookkeeping writes (ATTEMPT / SENT / FAILED events) are deliberately separated from the
  // provider call: a bookkeeping failure must never be misclassified as a provider failure.
  // Misclassification would erase the durable uncertainty record AND, via the webhook's 500 /
  // redrive path, duplicate a send the provider already accepted.
  try {
    // Mark the attempt BEFORE calling the provider: if the process dies between provider
    // accept and the SENT write below, this unresolved ATTEMPT is the durable record that
    // the send's outcome is uncertain (the traveller may already have received it).
    await createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: "TRAVELLER_WHATSAPP_NOTIFICATION_ATTEMPT",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        messageType: mode,
        templateName: mode === "template" ? resolveTravellerUpdateTemplateName() : null
      }
    });
  } catch {
    // Fail closed: without durable pre-send intent the provider call must not happen. An
    // unrecorded send would defeat the bounded-retry cap (counted on ATTEMPT rows) and erase
    // uncertainty tracking. The webhook answers 500 and Meta redelivers; the retry sends once
    // bookkeeping is healthy. The conversation copy already exists, so the traveller is not
    // silently abandoned while the database is down.
    return {
      channel: "conversation" as const,
      sent: true,
      providerMessageId: null,
      skippedReason: "traveller notification bookkeeping unavailable",
      whatsappDeliveryFailed: true as const
    };
  }

  let result: { providerMessageId: string | null };
  try {
    result = await sendTravellerWhatsAppNotificationByMode(input, mode);
  } catch (providerError) {
    const reason = providerError instanceof Error ? providerError.message : "Traveller WhatsApp notification failed.";

    if (mode === "text" && isWhatsAppReEngagementError(providerError)) {
      try {
        await createBluePassInquiryEvent({
          inquiry: input.inquiry,
          type: "TRAVELLER_WHATSAPP_NOTIFICATION_ATTEMPT",
          fromStatus: input.inquiry.status,
          toStatus: input.inquiry.status,
          metadata: {
            messageType: "template",
            templateName: resolveTravellerUpdateTemplateName(),
            fallbackFrom: "text",
            fallbackReason: reason
          }
        });
      } catch {
        // Fail closed, as above: no durable pre-send intent, no provider call.
        return {
          channel: "conversation" as const,
          sent: true,
          providerMessageId: null,
          skippedReason: "traveller notification bookkeeping unavailable",
          whatsappDeliveryFailed: true as const
        };
      }
      try {
        const fallbackResult = await sendTravellerWhatsAppNotificationByMode(input, "template");
        try {
          await createBluePassInquiryEvent({
            inquiry: input.inquiry,
            type: "TRAVELLER_WHATSAPP_NOTIFICATION_SENT",
            fromStatus: input.inquiry.status,
            toStatus: input.inquiry.status,
            metadata: {
              providerMessageId: fallbackResult.providerMessageId,
              messageType: "template",
              templateName: resolveTravellerUpdateTemplateName(),
              fallbackFrom: "text",
              fallbackReason: reason
            }
          });
        } catch {
          // Provider accepted; the unresolved ATTEMPT row keeps the uncertainty durable.
        }

        return {
          channel: "whatsapp" as const,
          sent: true,
          providerMessageId: fallbackResult.providerMessageId
        };
      } catch (fallbackProviderError) {
        const fallbackReason =
          fallbackProviderError instanceof Error ? fallbackProviderError.message : "Traveller WhatsApp template fallback failed.";

        try {
          await createBluePassInquiryEvent({
            inquiry: input.inquiry,
            type: "TRAVELLER_WHATSAPP_NOTIFICATION_FAILED",
            fromStatus: input.inquiry.status,
            toStatus: input.inquiry.status,
            metadata: {
              reason: fallbackReason,
              fallbackFrom: "text",
              fallbackReasonText: reason
            }
          });
        } catch {
          // Best-effort bookkeeping, as above.
        }

        return {
          channel: "conversation" as const,
          sent: true,
          providerMessageId: null,
          skippedReason: fallbackReason,
          // The conversation copy exists, but the WhatsApp delivery failed - callers must
          // not read this as the traveller being reached on WhatsApp.
          whatsappDeliveryFailed: true as const
        };
      }
    }

    try {
      await createBluePassInquiryEvent({
        inquiry: input.inquiry,
        type: "TRAVELLER_WHATSAPP_NOTIFICATION_FAILED",
        fromStatus: input.inquiry.status,
        toStatus: input.inquiry.status,
        metadata: {
          reason
        }
      });
    } catch {
      // Best-effort bookkeeping, as above.
    }

    return {
      channel: "conversation" as const,
      sent: true,
      providerMessageId: null,
      skippedReason: reason,
      // The conversation copy exists, but the WhatsApp delivery failed - callers must not
      // read this as the traveller being reached on WhatsApp.
      whatsappDeliveryFailed: true as const
    };
  }

  // The provider accepted the send. Record SENT; if THIS write fails, the ATTEMPT row stays
  // unresolved - the truthful "provider accepted, bookkeeping incomplete" state, so a later
  // re-drive is flagged priorAttemptUncertain instead of the send being mislabeled FAILED.
  try {
    await createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: "TRAVELLER_WHATSAPP_NOTIFICATION_SENT",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        providerMessageId: result.providerMessageId,
        messageType: mode,
        templateName: mode === "template" ? resolveTravellerUpdateTemplateName() : null
      }
    });
  } catch {
    // Deliberate: see above.
  }

  return {
    channel: "whatsapp" as const,
    sent: true,
    providerMessageId: result.providerMessageId
  };
}

function sendTravellerWhatsAppNotificationByMode(
  input: { inquiry: BluePassInquiry; content: string },
  mode: "text" | "template"
) {
  if (mode === "template") {
    return sendTemplateMessage({
      to: input.inquiry.travellerPhone ?? "",
      role: "kai",
      name: resolveTravellerUpdateTemplateName(),
      languageCode: resolveTravellerUpdateTemplateLanguage(),
      components: [
        {
          type: "body",
          parameters: buildTravellerInquiryUpdateParams({
            travellerName: input.inquiry.travellerName ?? "BluePass traveller",
            tripSummary: formatTripSummary(input.inquiry),
            operatorName: input.inquiry.selectedYachtName ?? input.inquiry.operatorName ?? "BluePass operator",
            status: formatTravellerTemplateStatus(input.inquiry.status, input.content)
          }).map((text) => ({
            type: "text",
            text
          }))
        }
      ]
    });
  }

  return sendWhatsAppText({
    to: input.inquiry.travellerPhone ?? "",
    role: "kai",
    body: input.content
  });
}

function isWhatsAppReEngagementError(error: unknown) {
  return error instanceof Error && /\bcode=131047\b|re-engagement/i.test(error.message);
}

function shouldFallbackTravellerTemplateFromDeliveryStatus(
  input: RecordBluePassTravellerWhatsAppDeliveryStatusInput,
  sentMetadata: Prisma.JsonValue
) {
  if (input.status !== "failed") return false;
  if (!hasWhatsAppReEngagementStatusError(input.errors)) return false;
  if (!sentMetadata || typeof sentMetadata !== "object" || Array.isArray(sentMetadata)) return false;

  return sentMetadata.messageType === "text";
}

function hasWhatsAppReEngagementStatusError(
  errors?: Array<{ code?: number | null; title?: string | null; message?: string | null; details?: string | null }>
) {
  return Boolean(
    errors?.some(
      (error) =>
        error.code === 131047 ||
        /re-engagement/i.test(error.title ?? "") ||
        /more than 24 hours/i.test(error.message ?? "") ||
        /more than 24 hours/i.test(error.details ?? "")
    )
  );
}

async function resendTravellerTemplateAfterDeliveryFailure(input: {
  inquiry: BluePassInquiry;
  failedProviderMessageId: string;
  errors: Array<{ code?: number | null; title?: string | null; message?: string | null; details?: string | null }>;
}) {
  if (!input.inquiry.travellerPhone) return null;

  const content = buildDeliveryStatusFallbackTravellerContent(input.inquiry);

  try {
    const result = await sendTravellerWhatsAppNotificationByMode(
      {
        inquiry: input.inquiry,
        content
      },
      "template"
    );

    return createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: "TRAVELLER_WHATSAPP_NOTIFICATION_SENT",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        providerMessageId: result.providerMessageId,
        messageType: "template",
        templateName: resolveTravellerUpdateTemplateName(),
        fallbackFrom: "delivery_status_131047",
        failedProviderMessageId: input.failedProviderMessageId
      }
    });
  } catch (error) {
    return createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: "TRAVELLER_WHATSAPP_NOTIFICATION_FAILED",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        reason: error instanceof Error ? error.message : "Traveller WhatsApp template fallback failed.",
        fallbackFrom: "delivery_status_131047",
        failedProviderMessageId: input.failedProviderMessageId,
        errors: input.errors
      }
    });
  }
}

function buildDeliveryStatusFallbackTravellerContent(inquiry: BluePassInquiry) {
  if (inquiry.status === "DECLINED") {
    return buildOperatorResponseTravellerNotification({
      inquiry,
      action: "decline"
    });
  }

  if (inquiry.status === "OPERATOR_ACCEPTED") {
    return buildOperatorResponseTravellerNotification({
      inquiry,
      action: "accept",
      quoteUrl: buildBluePassQuoteUrl(inquiry.id)
    });
  }

  return `A quick update on ${describeTrip(inquiry)}: it's ${describeStatus(inquiry.status, "traveller")}.`;
}

function resolveTravellerWhatsAppNotificationMode(): "disabled" | "text" | "template" {
  const configuredMode = process.env.WHATSAPP_TRAVELLER_NOTIFY_SEND_MODE?.trim().toLowerCase();
  if (configuredMode === "text" || configuredMode === "template") return configuredMode;
  if (configuredMode) return "disabled";

  return process.env.WHATSAPP_ACCESS_TOKEN?.trim() &&
    process.env.WHATSAPP_PHONE_ID_KAI?.trim() &&
    process.env.META_GRAPH_VERSION?.trim()
    ? "text"
    : "disabled";
}

function resolveTravellerUpdateTemplateName() {
  return process.env.WHATSAPP_TRAVELLER_UPDATE_TEMPLATE?.trim() || whatsappTemplateNames.bluePassInquiryUpdate;
}

function resolveTravellerUpdateTemplateLanguage() {
  return process.env.WHATSAPP_TRAVELLER_UPDATE_TEMPLATE_LANGUAGE?.trim() || "en";
}

function formatTravellerTemplateStatus(status: BluePassInquiry["status"], content?: string) {
  const quoteUrl = extractQuoteUrl(content);
  const quoteSuffix = quoteUrl ? `. Quote: ${quoteUrl}` : "";

  if (status === "OPERATOR_ACCEPTED") return `The operator said yes${quoteSuffix}`;
  if (status === "DECLINED") return formatDeclinedTravellerTemplateStatus(content);
  if (status === "COUNTER_OFFERED") return `The operator sent a different offer${quoteSuffix}`;

  return "There's an update on your enquiry";
}

function formatDeclinedTravellerTemplateStatus(content?: string) {
  const alternatives = extractDeclineAlternativeNames(content);
  if (alternatives.length === 0) return "The operator can't do it. Similar options are being checked.";

  return `The operator can't do it. Similar options: ${alternatives.join(", ")}. Reply try ${alternatives[0]}.`;
}

function extractDeclineAlternativeNames(content?: string) {
  const alternativeSection = content?.match(/Similar BluePass options:\s*([\s\S]*?)(?:\n\s*\n|$)/i)?.[1];
  if (!alternativeSection) return [];

  return alternativeSection
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+\.\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

function extractQuoteUrl(content?: string) {
  return content?.match(/\bQuote link:\s*(https?:\/\/\S+)/i)?.[1] ?? null;
}

async function sendOperatorPriceFollowUpPrompt(input: {
  inquiry: BluePassInquiry;
  providerMessageId?: string | null;
  operatorPhone?: string | null;
  intro: string;
  requestedEventType: string;
  requestFailedEventType: string;
}) {
  const operatorPhone = input.operatorPhone ?? input.inquiry.operatorPhone;
  const prompt = [
    input.intro,
    "",
    "Suggested format:",
    "Available 18 July 2026. Final price USD 3,900 per cabin/night. Includes meals, dives, crew, tanks and weights. Excludes flights, park fees, alcohol and tips. Condition: 30% deposit to hold.",
    "",
    "BluePass will attach your reply to the latest pending inquiry automatically."
  ].join("\n");

  await createBluePassInquiryEvent({
    inquiry: input.inquiry,
    type: input.requestedEventType,
    fromStatus: input.inquiry.status,
    toStatus: input.inquiry.status,
    metadata: {
      providerMessageId: input.providerMessageId ?? null,
      operatorPhone: input.operatorPhone ?? null
    }
  });

  if (!operatorPhone || process.env.WHATSAPP_OPERATOR_COUNTER_REQUEST_SEND_MODE !== "text") {
    return {
      requested: true,
      channel: "event" as const,
      sent: false,
      prompt
    };
  }

  try {
    const result = await sendWhatsAppText({
      to: operatorPhone,
      role: "ops",
      body: prompt
    });

    return {
      requested: true,
      channel: "whatsapp" as const,
      sent: true,
      providerMessageId: result.providerMessageId,
      prompt
    };
  } catch (error) {
    await createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: input.requestFailedEventType,
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        reason: error instanceof Error ? error.message : "Operator price follow-up request failed."
      }
    });

    return {
      requested: true,
      channel: "event" as const,
      sent: false,
      prompt,
      skippedReason: error instanceof Error ? error.message : "Operator price follow-up request failed."
    };
  }
}

async function requestOperatorCounterDetails(input: {
  inquiry: BluePassInquiry;
  providerMessageId?: string | null;
  operatorPhone?: string | null;
}) {
  return sendOperatorPriceFollowUpPrompt({
    ...input,
    intro: `Please reply with the counter-offer details for ${input.inquiry.travellerName ?? "this traveller"}'s ${input.inquiry.selectedYachtName ?? "BluePass"} inquiry.`,
    requestedEventType: "OPERATOR_COUNTER_DETAILS_REQUESTED",
    requestFailedEventType: "OPERATOR_COUNTER_DETAILS_REQUEST_FAILED"
  });
}

// Tapping "Accept" alone never carries a price - the traveller often has no stated budget either
// (source of the NEEDS_FINAL_PRICE quote status), so without this prompt the operator sees their
// tap register but never learns they still need to reply with an actual price. Mirrors
// requestOperatorCounterDetails's format, since it's the same underlying ask, just reached from a
// different button.
async function requestOperatorAcceptPriceDetails(input: {
  inquiry: BluePassInquiry;
  providerMessageId?: string | null;
  operatorPhone?: string | null;
}) {
  return sendOperatorPriceFollowUpPrompt({
    ...input,
    intro: `Thanks for accepting! ${input.inquiry.travellerName ?? "This traveller"} did not state a budget, so please reply with your price for the ${input.inquiry.selectedYachtName ?? "BluePass"} inquiry so BluePass can share a quote.`,
    requestedEventType: "OPERATOR_ACCEPT_PRICE_REQUESTED",
    requestFailedEventType: "OPERATOR_ACCEPT_PRICE_REQUEST_FAILED"
  });
}

async function sendOperatorInquiryMessage(input: {
  mode: "template" | "text";
  to: string;
  templateName: string;
  languageCode: string;
  components: WhatsAppTemplateComponent[];
  textBody: string;
}): Promise<{
  messageKind: "template" | "text";
  providerMessageId: string | null;
}> {
  if (input.mode === "text") {
    const result = await sendWhatsAppText({
      to: input.to,
      role: "ops",
      body: input.textBody
    });

    return { messageKind: "text", providerMessageId: result.providerMessageId };
  }

  try {
    const result = await sendTemplateMessage({
      to: input.to,
      role: "ops",
      name: input.templateName,
      languageCode: input.languageCode,
      components: input.components
    });

    return { messageKind: "template", providerMessageId: result.providerMessageId };
  } catch {
    const result = await sendWhatsAppText({
      to: input.to,
      role: "ops",
      body: input.textBody
    });

    return { messageKind: "text", providerMessageId: result.providerMessageId };
  }
}

function buildOperatorInquiryTemplateInput(input: {
  inquiry: BluePassInquiry;
  operatorPhone: string;
}): OperatorInquiryTemplateInput {
  const inquiryTitle = [
    input.inquiry.destination,
    input.inquiry.tripType,
    input.inquiry.guests ? `${input.inquiry.guests} guests` : undefined
  ]
    .filter(Boolean)
    .join(" / ");
  const selectedYachtName = input.inquiry.selectedYachtName;
  const tripTitle = selectedYachtName
    ? `${selectedYachtName} inquiry`
    : `${input.inquiry.destination ?? "Indonesia"} inquiry`;
  const notes = [
    input.inquiry.notes,
    input.inquiry.selectedYachtSlug ? `Selected yacht: ${input.inquiry.selectedYachtSlug}` : undefined,
    input.inquiry.referralCode ? `Referral: ${formatReferralSource(input.inquiry.referralCode, input.inquiry.referralRole)}` : undefined
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    to: input.operatorPhone,
    bookingId: input.inquiry.id,
    inquiryTitle: inquiryTitle || "BluePass yacht inquiry",
    travellerName: input.inquiry.travellerName ?? "BluePass traveller",
    travellerPhone: input.inquiry.travellerPhone ?? "Not provided",
    dateRange: input.inquiry.dateWindow ?? "Not provided",
    guests: input.inquiry.guests ? String(input.inquiry.guests) : "Not provided",
    quote: input.inquiry.budget ?? "Quote requested",
    tripTitle,
    notes: notes || "No additional notes"
  };
}

function formatReferralSource(code: string, role?: string | null) {
  return role ? `${role.toLowerCase()} / ${code}` : code;
}
