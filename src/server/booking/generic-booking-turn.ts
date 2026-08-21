import type { BookingMemoryState } from "@/core/booking/booking-memory";
import { updateBookingMemoryState } from "@/core/booking/booking-memory";
import { handleTravellerBookingMessage, formatCurrencyAmount, type BookingOrchestratorResult } from "@/core/booking/booking-orchestrator";
import { calculateConservationContributionCents } from "@/core/bluepass/ledger";
import { formatCancellationPolicySummary } from "@/core/cancellation/rules";
import type { AssistantConversationMessage, AssistantLlmClient } from "@/core/llm/assistant-reply-composer";
import type { GenericBookingRouterLlmClient } from "@/core/llm/generic-booking-router";
import { parseKnowledgePack, summarizeKnowledgePack } from "@/core/knowledge/knowledge-matcher";
import { MappedPmsAdapter } from "@/core/pms/mapped-pms-adapter";
import { parsePublicProductCatalog } from "@/core/pms/public-product-catalog";
import type { PmsProvider } from "@/core/tenant/types";
import { buildBookingFailureManualInquiry } from "@/server/conversation/manual-inquiry-fallback";
import { createManualInquiry, upsertConversationBookingState } from "@/server/conversation/conversation-repository";
import { getPmsAdapter } from "@/server/pms/pms-adapter-registry";
import { resolveTenantPmsEnv } from "@/server/pms/tenant-pms-credentials";
import { BLUEPASS_STRIPE_PMS_CHECKOUT_FEATURE } from "@/core/tenant/feature-flags";
import { createBluePassPmsCheckoutClient, type BluePassPmsCheckoutClient } from "@/server/payments/bluepass-pms-checkout-client";
import { resolveOperatorPayoutAccount } from "@/server/payments/operator-payout-account-client";

export interface GenericBookingTurnTenant {
  id: string;
  slug: string;
  name: string;
  config: {
    pmsProvider: PmsProvider;
    publicProductCatalog: unknown;
    operatorKnowledgePack?: unknown;
    bookingWriteEnabled?: boolean | null;
    responseGuardrails?: string[] | null;
    enabledFeatures?: string[] | null;
  } | null;
  branding: {
    brandVoice: string | null;
  } | null;
}

export interface RunGenericBookingTurnInput {
  tenant: GenericBookingTurnTenant;
  conversationId: string;
  content: string;
  previousBookingState: BookingMemoryState | null;
  priorTravellerMessages: string[];
  priorConversationMessages: AssistantConversationMessage[];
  llmClient?: AssistantLlmClient | null;
  routerClient?: GenericBookingRouterLlmClient | null;
  bluePassPmsCheckoutClient?: BluePassPmsCheckoutClient;
  /** Threaded into resolveOperatorPayoutAccount for the cancellation-policy disclosure lookup -
   * same injection point bluepass-pms-stripe.ts already uses for that call, so a test can fake the
   * cross-repo HTTP call instead of hitting it for real. */
  fetcher?: typeof fetch;
}

export interface RunGenericBookingTurnResult {
  bookingResult: BookingOrchestratorResult | null;
  assistantContent: string;
  manualInquiry: Awaited<ReturnType<typeof createManualInquiry>> | null;
  contactRequest: {
    conversationId: string;
    fields: ["name", "email", "phone"];
    status: "CONTACT_DETAILS_REQUIRED";
  } | null;
  paymentRequest: {
    conversationId: string;
    productTitle: string | null;
    dateText: string | null;
    guests: number | null;
    checkoutUrl: string | null;
    status: "PAYMENT_PENDING";
  } | null;
}

// Shared core of "run one traveller turn through the generic tenant/PMS booking engine" - extracted
// from src/app/api/widget/messages/route.ts so the WhatsApp channel can drive the exact same PMS
// adapter construction, booking-state persistence, and manual-inquiry side effects as the web
// widget, rather than a second, drifting copy. The web widget route calls this too; its own tests
// are the regression guard that this extraction didn't change its behavior.
export async function runGenericBookingTurn(
  input: RunGenericBookingTurnInput
): Promise<RunGenericBookingTurnResult> {
  const provider = (input.tenant.config?.pmsProvider ?? "MOCK") as PmsProvider;
  let bookingResult: BookingOrchestratorResult | null = null;
  let assistantContent: string;
  let manualInquiry: Awaited<ReturnType<typeof createManualInquiry>> | null = null;
  let paymentRequest: RunGenericBookingTurnResult["paymentRequest"] = null;
  let contactRequest: RunGenericBookingTurnResult["contactRequest"] = null;
  let assistantContentOverride: string | null = null;

  const bluePassStripeCheckoutEnabled = (input.tenant.config?.enabledFeatures ?? []).includes(
    BLUEPASS_STRIPE_PMS_CHECKOUT_FEATURE
  );

  try {
    const tenantPmsEnv = await resolveTenantPmsEnv(input.tenant.id, provider, process.env);
    const sourcePmsAdapter = getPmsAdapter(provider, tenantPmsEnv, fetch, input.tenant.slug);
    const publicProductCatalog = parsePublicProductCatalog(input.tenant.config?.publicProductCatalog);
    const pmsAdapter =
      publicProductCatalog.length > 0 ? new MappedPmsAdapter(sourcePmsAdapter, publicProductCatalog) : sourcePmsAdapter;
    const knowledgePack = parseKnowledgePack(input.tenant.config?.operatorKnowledgePack);
    const products = await pmsAdapter.listProducts();
    const bookingState = updateBookingMemoryState({
      previousState: input.previousBookingState,
      message: input.content,
      products
    });

    await upsertConversationBookingState({
      tenantId: input.tenant.id,
      conversationId: input.conversationId,
      state: bookingState
    });

    bookingResult = await handleTravellerBookingMessage({
      message: input.content,
      priorTravellerMessages: input.priorTravellerMessages,
      conversationHistory: [...input.priorConversationMessages, { role: "traveller", content: input.content }],
      bookingMemory: bookingState,
      pmsAdapter,
      bookingWriteEnabled: input.tenant.config?.bookingWriteEnabled ?? false,
      allowUnpaidExternalBooking: false,
      bluePassStripeCheckoutEnabled,
      llmClient: input.llmClient ?? null,
      routerClient: input.routerClient ?? null,
      knowledgePack,
      tenantContext: {
        tenantName: input.tenant.name,
        brandVoice: input.tenant.branding?.brandVoice ?? null,
        pmsProvider: provider,
        responseGuardrails: input.tenant.config?.responseGuardrails ?? [],
        productTitles: products.map((product) => product.title),
        knowledgeSummary: summarizeKnowledgePack(knowledgePack)
      }
    });

    if (bookingResult.action === "MANUAL_INQUIRY_REQUIRED") {
      manualInquiry = await createManualInquiry({
        tenantId: input.tenant.id,
        conversationId: input.conversationId,
        state: bookingState,
        travellerMessage: input.content
      });
    }

    const bookingStatePatch = bookingResult.bookingStatePatch;

    if (bookingStatePatch) {
      await upsertConversationBookingState({
        tenantId: input.tenant.id,
        conversationId: input.conversationId,
        state: bookingStatePatch
      });

      if (bookingResult.action === "BOOKING_PAYMENT_REQUIRED") {
        let checkoutUrl = bookingResult.paymentHandoffUrl ?? null;

        if (bookingResult.pmsCheckoutHold && bluePassStripeCheckoutEnabled) {
          const checkoutClient = input.bluePassPmsCheckoutClient ?? createBluePassPmsCheckoutClient(process.env);
          try {
            const session = await checkoutClient.createCheckoutSession({
              tenantId: input.tenant.id,
              conversationId: input.conversationId,
              ...bookingResult.pmsCheckoutHold
            });
            checkoutUrl = session.checkoutUrl;
            assistantContentOverride = `Thanks - I have everything for ${bookingResult.pmsCheckoutHold.productTitle} on ${bookingResult.pmsCheckoutHold.dateText} for ${bookingResult.pmsCheckoutHold.guests} guest${bookingResult.pmsCheckoutHold.guests === 1 ? "" : "s"}. Please complete secure payment here: ${session.checkoutUrl}. Kai never sees or stores your card details.`;
          } catch (error) {
            checkoutUrl = null;
            assistantContentOverride =
              "I've saved this as a lead for the operator - I could not prepare the secure payment link just now, so someone will follow up to complete payment.";
            console.error("generic_booking_turn.bluepass_pms_checkout_failed", {
              conversationId: input.conversationId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }

        paymentRequest = {
          conversationId: input.conversationId,
          productTitle: bookingStatePatch.productTitle,
          dateText: bookingStatePatch.dateText,
          guests: bookingStatePatch.guests,
          checkoutUrl,
          status: "PAYMENT_PENDING"
        };
      }
    }

    const bookingFailureInquiry = buildBookingFailureManualInquiry(bookingResult);
    if (bookingFailureInquiry) {
      manualInquiry = await createManualInquiry({
        tenantId: input.tenant.id,
        conversationId: input.conversationId,
        state: bookingFailureInquiry.state,
        travellerMessage: input.content,
        travellerName: bookingFailureInquiry.travellerName,
        travellerEmail: bookingFailureInquiry.travellerEmail,
        travellerPhone: bookingFailureInquiry.travellerPhone
      });
    }

    if (
      (bookingResult.action === "BOOKING_INQUIRY_READY" ||
        bookingResult.action === "BOOKING_WRITE_DISABLED" ||
        bookingResult.action === "BOOKING_CHECKOUT_READY" ||
        bookingResult.action === "BOOKING_PAYMENT_REQUIRED") &&
      bookingResult.inquiryDraft
    ) {
      manualInquiry = await createManualInquiry({
        tenantId: input.tenant.id,
        conversationId: input.conversationId,
        state: {
          productExternalId: bookingResult.inquiryDraft.productExternalId,
          productTitle: bookingResult.inquiryDraft.productTitle,
          dateText: bookingResult.inquiryDraft.dateText,
          guests: bookingResult.inquiryDraft.guests
        },
        travellerMessage: input.content,
        travellerName: bookingResult.inquiryDraft.travellerName,
        travellerEmail: bookingResult.inquiryDraft.travellerEmail,
        travellerPhone: bookingResult.inquiryDraft.travellerPhone
      });
    }

    assistantContent = assistantContentOverride ?? bookingResult.reply;

    // Disclose the real cancellation terms whenever a live payment link is actually going out - not
    // on every BOOKING_PAYMENT_REQUIRED turn, since that action also covers the Stripe-checkout-
    // failed and no-handoff-url-yet replies above, where nothing is actually payable yet. Sourced
    // from the operator's own saved tiers (falls back to the platform default inside
    // formatCancellationPolicySummary when they haven't set one) rather than the disconnected
    // free-text knowledge-pack answer, so what Kai says here always matches what a real cancellation
    // would actually refund.
    if (bookingResult.action === "BOOKING_PAYMENT_REQUIRED" && paymentRequest?.checkoutUrl) {
      const payoutAccount = await resolveOperatorPayoutAccount(input.tenant.slug, { fetcher: input.fetcher });
      const cancellationSummary = formatCancellationPolicySummary(payoutAccount?.cancellationPolicyTiers ?? null);
      assistantContent = `${assistantContent}\n\nCancellation policy: ${cancellationSummary}.`;
    }

    // Same guard as the cancellation disclosure just above - only when a live payment link
    // actually went out. The dollar figure is real: 5% of the actual gross fare, the same
    // constant Kai's own ledger uses to book a CONSERVATION_ALLOCATION row once payment clears
    // (see confirm-bluepass-pms-payment.ts). The partner name is deliberately generic - a real
    // Rezdy/Boattime booking has no per-trip named conservation partner recorded anywhere
    // server-side. Only bluepass-redesign's 6 curated demo trips have named partners, and those
    // aren't real bookable inventory; naming one here would misattribute this booking's
    // contribution to a project it was never actually routed to.
    if (bookingResult.action === "BOOKING_PAYMENT_REQUIRED" && paymentRequest?.checkoutUrl && bookingResult.pmsCheckoutHold) {
      const conservationCents = calculateConservationContributionCents(bookingResult.pmsCheckoutHold.grossAmountCents);
      const conservationAmount = formatCurrencyAmount(bookingResult.pmsCheckoutHold.currency, conservationCents);
      assistantContent = `${assistantContent}\n\n${conservationAmount} of this fare funds ocean and reef conservation - built into the price you see, never added to it.`;
    }

    const asksForContactDetails =
      bookingResult.action === "BOOKING_DETAILS_REQUIRED" &&
      /name,\s*email,\s*and\s*phone/i.test(bookingResult.reply);

    if (asksForContactDetails) {
      contactRequest = {
        conversationId: input.conversationId,
        fields: ["name", "email", "phone"],
        status: "CONTACT_DETAILS_REQUIRED"
      };
    }
  } catch (error) {
    assistantContent =
      error instanceof Error
        ? "I can help with this, but " + error.message
        : "I can help with this, but the PMS adapter is not available right now.";
  }

  return {
    bookingResult,
    assistantContent,
    manualInquiry,
    contactRequest,
    paymentRequest
  };
}
