import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import type { PmsExtraQuantity, PmsTicketQuantity } from "@/core/pms/types";
import type { PmsProvider } from "@/core/tenant/types";
import type { PmsProvider as PrismaPmsProvider } from "@prisma/client";
import { resolveRefundTierPercent } from "@/core/cancellation/rules";
import type { CancelledBy } from "@/core/cancellation/types";
import { parseAttemptTravelDate } from "@/core/settlement/rules";
import { createAssistantMessage } from "@/server/conversation/conversation-repository";
import { getPmsAdapter } from "@/server/pms/pms-adapter-registry";
import { resolveTenantPmsEnv } from "@/server/pms/tenant-pms-credentials";
import { getBluePassStripeClient, type BluePassStripeEnv } from "./bluepass-stripe";
import { resolveOperatorPayoutAccount } from "./operator-payout-account-client";

export const PMS_BOOKING_DIRECT_CHECKOUT_FLOW = "PMS_BOOKING_DIRECT";

export interface CreateBluePassCheckoutSessionForPmsBookingInput {
  tenantId: string;
  conversationId: string;
  pmsProvider: PmsProvider;
  productExternalId: string;
  productTitle: string;
  dateText: string;
  guests: number;
  travellerName: string;
  travellerEmail: string;
  travellerPhone?: string | null;
  ticketQuantities?: PmsTicketQuantity[] | null;
  extraQuantities?: PmsExtraQuantity[] | null;
  grossAmountCents: number;
  currency: string;
  externalBookingId: string;
}

// BluePass's own Stripe account collecting payment for a real-time, PMS-confirmed booking (e.g.
// boattime's Rezdy inventory) - distinct from createBluePassCheckoutSession (bluepass-stripe.ts),
// which is hard-tied to a BluePassInquiry/marketplace quote. This one requires no such row: the
// PMS's own PAYMENT_HOLD reservation (externalBookingId) is the source of truth for availability,
// BluePass only collects payment and later confirms that hold. The DB row is only created after
// Stripe confirms the session, so a Stripe failure never leaves an orphaned attempt record.
export async function createBluePassCheckoutSessionForPmsBooking(
  input: CreateBluePassCheckoutSessionForPmsBookingInput,
  deps: { stripeClient?: Stripe; env?: BluePassStripeEnv } = {}
): Promise<{ checkoutUrl: string; sessionId: string; attemptId: string }> {
  const env = deps.env ?? process.env;
  const stripe = deps.stripeClient ?? getBluePassStripeClient(env);
  const appBaseUrl = (env.KAI_APP_URL ?? "http://localhost:3107").replace(/\/$/, "");

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: input.currency.toLowerCase(),
          unit_amount: input.grossAmountCents,
          product_data: {
            name: `${input.productTitle} - ${input.dateText} (${input.guests} guest${input.guests === 1 ? "" : "s"})`
          }
        }
      }
    ],
    success_url: `${appBaseUrl}/embed/kai/payment-return?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appBaseUrl}/embed/kai/payment-return?session_id={CHECKOUT_SESSION_ID}&cancelled=true`,
    // Stripe's own enforced floor (30min-24h). Rezdy's real PAYMENT_HOLD TTL is not surfaced
    // anywhere in this codebase - this is the tightest bound achievable without knowing it; needs
    // reassessing against a live Rezdy sandbox account (see the implementation plan's Phase 5).
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    metadata: {
      kaiFlow: PMS_BOOKING_DIRECT_CHECKOUT_FLOW,
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      pmsProvider: input.pmsProvider
    }
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL for this session.");
  }

  // Frozen from the conversation's first-touch attribution (see
  // captureConversationReferralAttribution) at the moment checkout is created, not looked up again
  // at confirm time - so a later, unrelated referral cookie on the same browser can never rewrite
  // the economics of a booking already in flight.
  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: { referralPartnerId: true, referralLinkId: true, referralCode: true, referralRole: true }
  });

  const attempt = await prisma.pmsBookingPaymentAttempt.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      referralPartnerId: conversation?.referralPartnerId ?? null,
      referralLinkId: conversation?.referralLinkId ?? null,
      referralCode: conversation?.referralCode ?? null,
      referralRole: conversation?.referralRole ?? null,
      // Cast bridges the app-level PmsProvider (which includes "REZDY_AGENT") to the narrower Prisma
      // enum, same pattern already used in tenant-pms-credentials.ts. "REZDY_AGENT" isn't in the
      // Prisma enum yet (that's a deliberately-deferred production schema migration - see
      // rezdy-agent-pms-adapter.ts), so this would fail at the DB layer if actually reached with that
      // value; nothing can reach it with "REZDY_AGENT" today since no tenant/adapter selection can
      // produce it without that migration.
      pmsProvider: input.pmsProvider as PrismaPmsProvider,
      productExternalId: input.productExternalId,
      productTitle: input.productTitle,
      dateText: input.dateText,
      guests: input.guests,
      travellerName: input.travellerName,
      travellerEmail: input.travellerEmail,
      travellerPhone: input.travellerPhone ?? null,
      ticketQuantities: (input.ticketQuantities ?? []) as unknown as object,
      extraQuantities: (input.extraQuantities ?? []) as unknown as object,
      grossAmountCents: input.grossAmountCents,
      currency: input.currency,
      externalBookingId: input.externalBookingId,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
      status: "AWAITING_PAYMENT"
    }
  });

  return { checkoutUrl: session.url, sessionId: session.id, attemptId: attempt.id };
}

// Direct-PMS/Rezdy flow's equivalent of bluepass-inquiry-repository.ts's markBluePassLedgerEntryPaid -
// same idempotency/eligibility rules (only FINALIZED entries, no-op if already paid), just operating
// on PmsBookingLedgerEntry instead of BluePassLedgerEntry, since the two flows use separate models.
export async function markPmsBookingLedgerEntryPaid(input: {
  entryId: string;
  paidOutReference: string;
  reviewerEmail: string;
}) {
  const entry = await prisma.pmsBookingLedgerEntry.findUniqueOrThrow({ where: { id: input.entryId } });

  if (entry.status !== "FINALIZED") {
    throw new Error(
      `PMS booking ledger entry ${input.entryId} is ${entry.status}, not FINALIZED - only finalized entries can be marked paid.`
    );
  }
  if (entry.paidOutAt) {
    return entry;
  }

  return prisma.pmsBookingLedgerEntry.update({
    where: { id: input.entryId },
    data: {
      paidOutAt: new Date(),
      paidOutReference: input.paidOutReference,
      paidOutBy: input.reviewerEmail
    }
  });
}

/**
 * Direct-PMS/Rezdy flow's equivalent of releaseBluePassLedgerEntryPayoutViaStripe (bluepass-stripe.ts)
 * - same real Stripe transfer, same idempotent PmsBookingOperatorPayout upsert-on-failure/success
 * pattern, same OPERATOR_PAYOUT_PLACEHOLDER-only gate (every other ledger kind is BluePass's/the
 * partner's own revenue, not the operator's - transferring those would be a real money-safety bug).
 * Added 2026-08-06 because PmsBookingLedgerEntry previously had no real-transfer release path at all
 * - Boattime/Rezdy bookings could only be "paid" via the manual paidOutReference attestation.
 * stripeConnectAccountId is caller-supplied here too (same manual-trust model as the marketplace
 * flow's version) - Milestone 1 wires this up to the new cross-repo operator-payout-account lookup
 * instead of requiring it to be typed in by hand.
 */
export async function releasePmsBookingLedgerEntryPayoutViaStripe(
  input: { entryId: string; stripeConnectAccountId: string; reviewerEmail: string },
  deps: { stripeClient?: Stripe; env?: BluePassStripeEnv } = {}
) {
  const entry = await prisma.pmsBookingLedgerEntry.findUniqueOrThrow({ where: { id: input.entryId } });

  if (entry.kind !== "OPERATOR_PAYOUT_PLACEHOLDER") {
    throw new Error(
      `PMS booking ledger entry ${input.entryId} is kind ${entry.kind}, not OPERATOR_PAYOUT_PLACEHOLDER - only the operator's own payout share can be released via Stripe transfer.`
    );
  }
  if (entry.status !== "FINALIZED") {
    throw new Error(
      `PMS booking ledger entry ${input.entryId} is ${entry.status}, not FINALIZED - only finalized entries can be paid out.`
    );
  }
  if (entry.paidOutAt) {
    // Already paid out (manually or via a previous Stripe transfer) - idempotent no-op.
    return entry;
  }

  const stripe = deps.stripeClient ?? getBluePassStripeClient(deps.env);

  let transfer: Stripe.Transfer;
  try {
    transfer = await stripe.transfers.create({
      amount: entry.amountCents,
      currency: entry.currency.toLowerCase(),
      destination: input.stripeConnectAccountId
    });
  } catch (error) {
    await prisma.pmsBookingOperatorPayout.upsert({
      where: { pmsBookingLedgerEntryId: entry.id },
      create: {
        tenantId: entry.tenantId,
        pmsBookingLedgerEntryId: entry.id,
        stripeConnectAccountId: input.stripeConnectAccountId,
        amountCents: entry.amountCents,
        currency: entry.currency,
        status: "FAILED",
        releasedBy: input.reviewerEmail,
        failureReason: error instanceof Error ? error.message : String(error)
      },
      update: {
        status: "FAILED",
        releasedBy: input.reviewerEmail,
        failureReason: error instanceof Error ? error.message : String(error)
      }
    });
    throw error;
  }

  await prisma.pmsBookingOperatorPayout.upsert({
    where: { pmsBookingLedgerEntryId: entry.id },
    create: {
      tenantId: entry.tenantId,
      pmsBookingLedgerEntryId: entry.id,
      stripeConnectAccountId: input.stripeConnectAccountId,
      stripeTransferId: transfer.id,
      amountCents: entry.amountCents,
      currency: entry.currency,
      status: "TRANSFERRED",
      releasedBy: input.reviewerEmail,
      releasedAt: new Date()
    },
    update: {
      stripeTransferId: transfer.id,
      status: "TRANSFERRED",
      releasedBy: input.reviewerEmail,
      releasedAt: new Date(),
      failureReason: null
    }
  });

  return markPmsBookingLedgerEntryPaid({
    entryId: entry.id,
    paidOutReference: transfer.id,
    reviewerEmail: input.reviewerEmail
  });
}

/**
 * Lists this tenant's PmsBookingLedgerEntry rows - the AU/Rezdy direct-PMS-booking counterpart to
 * listBluePassLedgerEntriesForTenantSlug (bluepass-inquiry-repository.ts), which only ever covered the
 * Indonesia/BluePass marketplace ledger. Nothing browsed this table before: the daily settlement cron
 * (settle-pms-bookings) and the Stripe transfer release both run unattended, so without this an admin
 * has no way to see whether an operator was actually paid short of querying the DB directly.
 *
 * Mirrors that function's shape (tenantSlug -> tenant lookup -> scoped findMany, status/take params)
 * so a single admin UI can treat both ledgers the same way.
 */
export async function listPmsBookingLedgerEntriesForTenantSlug(input: {
  tenantSlug: string;
  status?: "PENDING" | "FINALIZED" | "VOIDED";
  take?: number;
}) {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: input.tenantSlug },
    select: { id: true }
  });

  if (!tenant) {
    return [];
  }

  return prisma.pmsBookingLedgerEntry.findMany({
    where: {
      tenantId: tenant.id,
      status: input.status ?? "FINALIZED"
    },
    orderBy: { createdAt: "desc" },
    take: input.take ?? 100,
    include: {
      attempt: {
        select: {
          productTitle: true,
          dateText: true,
          guests: true,
          travellerName: true,
          externalBookingId: true,
          grossAmountCents: true,
          settledAt: true
        }
      },
      payout: {
        select: {
          status: true,
          stripeTransferId: true,
          releasedAt: true,
          releasedBy: true,
          failureReason: true
        }
      }
    }
  });
}

/**
 * Milestone 1 (payment-settlement plan): turns "mark this trip settled" into the whole real thing,
 * not just a status flip. Admin-triggered (a button/endpoint), not yet on a schedule - Milestone 2
 * adds the cron that calls this automatically once a trip's travel date has passed.
 *
 * Resolution order for the Stripe Connect account: an explicit input.stripeConnectAccountId always
 * wins (admin override, same manual-trust escape hatch the marketplace flow's mark-paid route
 * already has); otherwise this looks it up automatically via resolveOperatorPayoutAccount, closing
 * the exact gap Milestone 0/1 exists to close (no more pasting the account id in by hand). If
 * neither an explicit id nor a real lookup result exists (operator not yet onboarded to Stripe
 * Connect), falls back to the existing manual bank-transfer attestation path when the caller
 * supplies paidOutReference - matching the plan's "manual payout stays the interim safety net,"
 * not something this removes.
 *
 * PmsBookingPaymentAttempt only transitions to SETTLED once the operator's payout has actually been
 * released (by either path) - never on a bare admin click with no real payout behind it.
 */
export async function settlePmsBookingPaymentAttempt(
  input: {
    attemptId: string;
    reviewerEmail: string;
    /** Admin override - skips the automatic lookup below when supplied. */
    stripeConnectAccountId?: string;
    /** Manual bank-transfer fallback, used only if no Stripe Connect account is available. */
    paidOutReference?: string;
  },
  deps: { stripeClient?: Stripe; env?: BluePassStripeEnv; fetcher?: typeof fetch } = {}
) {
  const attempt = await prisma.pmsBookingPaymentAttempt.findUniqueOrThrow({ where: { id: input.attemptId } });

  if (attempt.status !== "CONFIRMED") {
    throw new Error(
      `PmsBookingPaymentAttempt ${input.attemptId} is ${attempt.status}, not CONFIRMED - only a confirmed booking can be settled.`
    );
  }

  const payoutEntry = await prisma.pmsBookingLedgerEntry.findFirstOrThrow({
    where: { pmsBookingPaymentAttemptId: attempt.id, kind: "OPERATOR_PAYOUT_PLACEHOLDER" }
  });

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: attempt.tenantId } });

  let stripeConnectAccountId = input.stripeConnectAccountId?.trim();
  let account: Awaited<ReturnType<typeof resolveOperatorPayoutAccount>> = null;
  if (!stripeConnectAccountId) {
    account = await resolveOperatorPayoutAccount(tenant.slug, { fetcher: deps.fetcher });
    if (account?.stripeConnectAccountId && account.chargesEnabled && account.payoutsEnabled) {
      stripeConnectAccountId = account.stripeConnectAccountId;
    }
  }

  let ledgerEntry;
  let method: "STRIPE" | "MANUAL";

  if (stripeConnectAccountId) {
    ledgerEntry = await releasePmsBookingLedgerEntryPayoutViaStripe(
      { entryId: payoutEntry.id, stripeConnectAccountId, reviewerEmail: input.reviewerEmail },
      { stripeClient: deps.stripeClient, env: deps.env }
    );
    method = "STRIPE";
  } else if (input.paidOutReference?.trim()) {
    ledgerEntry = await markPmsBookingLedgerEntryPaid({
      entryId: payoutEntry.id,
      paidOutReference: input.paidOutReference.trim(),
      reviewerEmail: input.reviewerEmail
    });
    method = "MANUAL";
  } else if (account?.payoutMethod === "AIRWALLEX") {
    // Milestone 2.5: this operator is on the Airwallex rail, which is shape-only today (see
    // airwallex-adapter.ts) - never attempted with invented beneficiary data, always routed to a
    // human until a real Airwallex integration exists.
    throw new Error(
      `Tenant "${tenant.slug}" is on the Airwallex payout rail, which is not live yet (no real Airwallex account exists). Supply paidOutReference to settle this one manually until then.`
    );
  } else {
    throw new Error(
      `No Stripe Connect account is linked for tenant "${tenant.slug}" yet, and no paidOutReference was supplied for a manual settlement. Either onboard the operator to Stripe Connect first, or supply paidOutReference to settle this one manually.`
    );
  }

  const settledAttempt = await prisma.pmsBookingPaymentAttempt.update({
    where: { id: attempt.id },
    data: { status: "SETTLED", settledAt: new Date() }
  });

  return { attempt: settledAttempt, ledgerEntry, method };
}

/**
 * Milestone 3 (payment-settlement plan): cancels a CONFIRMED (never-settled) booking with a real
 * Stripe refund, per PAYMENT_ARCHITECTURE.md - "because funds are held and the operator isn't paid
 * until sail, a refund is clean" (no operator clawback needed, since the operator was never paid).
 *
 * Refund sizing: OPERATOR-initiated cancellations always get 100% back immediately (the brief's own
 * words). CUSTOMER/ADMIN-initiated cancellations are tiered by days-to-departure via
 * resolveRefundTierPercent, using the operator's own cancellationPolicyTiers (looked up the same way
 * as the Stripe Connect account) or the platform default when unset. An explicit
 * refundTierPercentOverride always wins over both, for an admin who needs to force a specific outcome
 * (e.g. the travel date couldn't be parsed and resolveRefundTierPercent came back unresolved).
 *
 * Ledger treatment on cancellation, per PAYMENT_ARCHITECTURE.md's explicit rule ("if a booking is
 * refunded before settlement, no conservation line is taken - nothing was delivered"):
 * - CONSERVATION_ALLOCATION is always voided to zero, regardless of the refund tier.
 * - Every other FINALIZED entry (commission, processing, operator payout placeholder, referral) is
 *   voided and replaced with a new FINALIZED entry scaled to the RETAINED fraction (100 - refund%) of
 *   the original gross, so the surviving entries always sum to exactly what's left in BluePass's
 *   balance after the refund - never more. A 100% refund naturally zeroes everything out.
 */
export async function cancelPmsBookingPaymentAttempt(
  input: {
    attemptId: string;
    cancelledBy: CancelledBy;
    reviewerEmail: string;
    cancellationReason?: string;
    /** Admin override - skips the automatic tier lookup/calculation below when supplied. */
    refundTierPercentOverride?: number;
  },
  deps: { stripeClient?: Stripe; env?: BluePassStripeEnv; fetcher?: typeof fetch; now?: Date } = {}
) {
  const attempt = await prisma.pmsBookingPaymentAttempt.findUniqueOrThrow({ where: { id: input.attemptId } });

  if (attempt.status !== "CONFIRMED") {
    throw new Error(
      `PmsBookingPaymentAttempt ${input.attemptId} is ${attempt.status}, not CONFIRMED - only a confirmed, not-yet-settled booking can be cancelled through this refund-clean path.`
    );
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: attempt.tenantId } });

  let refundTierPercent = input.refundTierPercentOverride;
  if (refundTierPercent === undefined) {
    const account = await resolveOperatorPayoutAccount(tenant.slug, { fetcher: deps.fetcher });
    const decision = resolveRefundTierPercent({
      cancelledBy: input.cancelledBy,
      travelDate: parseAttemptTravelDate(attempt.dateText),
      cancelledAt: deps.now ?? new Date(),
      policy: account?.cancellationPolicyTiers ?? null
    });
    if (!decision.resolved || decision.refundPercent === null) {
      throw new Error(
        `Cannot auto-determine a refund tier for attempt ${input.attemptId} - its dateText ("${attempt.dateText}") could not be resolved to a real travel date. Supply refundTierPercentOverride to cancel this one manually.`
      );
    }
    refundTierPercent = decision.refundPercent;
  }
  if (refundTierPercent < 0 || refundTierPercent > 100) {
    throw new Error(`refundTierPercent must be 0-100, got ${refundTierPercent}.`);
  }

  const refundAmountCents = Math.round((attempt.grossAmountCents * refundTierPercent) / 100);
  const retainedCents = attempt.grossAmountCents - refundAmountCents;

  const stripe = deps.stripeClient ?? getBluePassStripeClient(deps.env);
  let stripeRefundId: string | null = null;
  if (refundAmountCents > 0 && attempt.stripePaymentIntentId) {
    const refund = await stripe.refunds.create({
      payment_intent: attempt.stripePaymentIntentId,
      amount: refundAmountCents
    });
    stripeRefundId = refund.id;
  }

  const finalizedEntries = await prisma.pmsBookingLedgerEntry.findMany({
    where: { pmsBookingPaymentAttemptId: attempt.id, status: "FINALIZED" }
  });
  const conservationEntries = finalizedEntries.filter((entry) => entry.kind === "CONSERVATION_ALLOCATION");
  const retainedEntries = finalizedEntries.filter((entry) => entry.kind !== "CONSERVATION_ALLOCATION");

  for (const entry of conservationEntries) {
    await prisma.pmsBookingLedgerEntry.update({
      where: { id: entry.id },
      data: {
        status: "VOIDED",
        voidedAt: new Date(),
        voidReason: "Booking cancelled before settlement - no conservation line is taken on an undelivered trip."
      }
    });
  }

  // Scale every retained entry by the retained fraction, EXCEPT BLUEPASS_PLATFORM_COMMISSION, which
  // instead absorbs whatever's left over (retainedCents minus everyone else's scaled share). That
  // remainder is two things: ordinary rounding, and - the bigger piece - conservation's own
  // now-voided share of the retained amount, which has to land somewhere. It goes to BluePass's own
  // commission line, not the operator's payout or the processing-fee pass-through: those two should
  // scale predictably by exactly the retained percentage, with no hidden windfall from conservation
  // being waived. (Confirmed with the user 2026-08-10 after a live simulation surfaced the original
  // "last entry in array order absorbs the remainder" behavior silently inflating the operator's cut.)
  const commissionIndex = retainedEntries.findIndex((entry) => entry.kind === "BLUEPASS_PLATFORM_COMMISSION");
  const scaledAmounts = retainedEntries.map((entry) =>
    Math.round((entry.amountCents * (100 - refundTierPercent)) / 100)
  );
  if (commissionIndex !== -1) {
    const sumExceptCommission = scaledAmounts.reduce((total, amount, i) => (i === commissionIndex ? total : total + amount), 0);
    scaledAmounts[commissionIndex] = retainedCents - sumExceptCommission;
  } else if (scaledAmounts.length > 0) {
    // Defensive fallback only - every real booking's ledger split always includes a
    // BLUEPASS_PLATFORM_COMMISSION entry, so this branch should never actually run.
    const sumExceptLast = scaledAmounts.slice(0, -1).reduce((total, amount) => total + amount, 0);
    scaledAmounts[scaledAmounts.length - 1] = retainedCents - sumExceptLast;
  }

  for (let i = 0; i < retainedEntries.length; i += 1) {
    const entry = retainedEntries[i];
    const newAmountCents = scaledAmounts[i];
    await prisma.pmsBookingLedgerEntry.update({
      where: { id: entry.id },
      data: {
        status: "VOIDED",
        voidedAt: new Date(),
        voidReason: `Booking cancelled - reversed and rescaled to ${100 - refundTierPercent}% (the retained/non-refunded share) of the original amount.`
      }
    });
    if (newAmountCents > 0) {
      await prisma.pmsBookingLedgerEntry.create({
        data: {
          tenantId: entry.tenantId,
          conversationId: entry.conversationId,
          pmsBookingPaymentAttemptId: entry.pmsBookingPaymentAttemptId,
          kind: entry.kind,
          amountCents: newAmountCents,
          currency: entry.currency,
          status: "FINALIZED",
          referralPartnerId: entry.referralPartnerId,
          referralLinkId: entry.referralLinkId,
          referralCode: entry.referralCode,
          referralRole: entry.referralRole,
          finalizedAt: new Date(),
          metadata: { reversedFromEntryId: entry.id, cancellationRefundTierPercent: refundTierPercent }
        }
      });
    }
  }

  const cancelledAttempt = await prisma.pmsBookingPaymentAttempt.update({
    where: { id: attempt.id },
    data: {
      status: "CANCELLED_REFUNDED",
      cancelledAt: new Date(),
      cancelledBy: input.cancelledBy,
      cancellationReason: input.cancellationReason ?? null,
      refundTierPercent,
      refundAmountCents,
      stripeRefundId: stripeRefundId ?? attempt.stripeRefundId
    }
  });

  // Best-effort: release the PMS's own hold too, so Rezdy doesn't keep showing this as confirmed.
  // Mirrors handlePmsBookingCheckoutSessionExpired's same best-effort cancelBooking call - Rezdy's
  // cancelBooking is not implemented today and is expected to throw; never let this block the refund
  // that already succeeded.
  try {
    const tenantPmsEnv = await resolveTenantPmsEnv(tenant.id, attempt.pmsProvider, process.env);
    const pmsAdapter = getPmsAdapter(attempt.pmsProvider, tenantPmsEnv, deps.fetcher ?? fetch, tenant.slug);
    await pmsAdapter.cancelBooking(attempt.externalBookingId);
  } catch (error) {
    console.warn("pms_booking_cancellation.release_hold_failed", {
      attemptId: attempt.id,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  const refundSummary =
    refundTierPercent === 100
      ? "You've received a full refund."
      : refundTierPercent === 0
        ? "Per the cancellation policy for this booking, no refund applies."
        : `Per the cancellation policy for this booking, ${refundTierPercent}% has been refunded.`;
  await createAssistantMessage({
    tenantId: attempt.tenantId,
    conversationId: attempt.conversationId,
    content: `Your booking for ${attempt.productTitle} on ${attempt.dateText} has been cancelled. ${refundSummary}`
  });

  return { attempt: cancelledAttempt, refundTierPercent, refundAmountCents, retainedCents };
}
