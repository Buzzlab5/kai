export type BluePassLedgerEstimateInput = {
  inquiryId: string;
  budget?: string | null;
  referralPartnerId?: string | null;
  referralLinkId?: string | null;
  referralCode?: string | null;
  referralRole?: string | null;
  /** See BluePassLedgerSplitInput.market - accepted but currently inert, see that comment for why. */
  market?: BluePassLedgerMarket;
};

export type BluePassLedgerCurrency = "USD" | "IDR" | "EUR" | "AUD";

export type BluePassLedgerEstimate = {
  inquiryId: string;
  kind:
    | "PARTNER_COMMISSION_ESTIMATE"
    | "BLUEPASS_PLATFORM_COMMISSION"
    | "CONSERVATION_ALLOCATION"
    | "PAYMENT_PROCESSING_ALLOCATION"
    | "OPERATOR_PAYOUT_PLACEHOLDER";
  amountCents: number;
  currency: BluePassLedgerCurrency;
  status: "PENDING" | "FINALIZED";
  referralPartnerId: string | null;
  referralLinkId: string | null;
  referralCode: string | null;
  referralRole: string | null;
  metadata: {
    budgetAmount: number;
  };
};

export type BluePassLedgerMarket = "AUSTRALIA" | "INDONESIA";

export type BluePassLedgerSplitInput = {
  inquiryId: string;
  grossAmountCents: number;
  currency: BluePassLedgerCurrency;
  status: "PENDING" | "FINALIZED";
  referralPartnerId?: string | null;
  referralLinkId?: string | null;
  referralCode?: string | null;
  referralRole?: string | null;
  /**
   * Region for the commission split. Accepted but currently INERT - kept in the type only so
   * callers that already pass it (bluepass-inquiry-repository.ts) don't need a signature change,
   * and so a future region-specific split doesn't require re-adding this field.
   *
   * History, in case a future divergence needs it: AU moved to 20%/80% on 2026-08-05; Indonesia was
   * corrected to the same 20%/80% on 2026-08-24 ("Indonesia ternyata 20% juga, bukan 18%"); a code
   * comment at the time claimed Boattime (confirm-bluepass-pms-payment.ts, which never passes this
   * field) had to stay frozen on the old 18%/82% split "per a 2026-08-06 instruction" - but that
   * claim couldn't be traced to any real source (the docs it cited, e.g. kai-persona-triage.md,
   * don't exist anywhere in this workspace, and Bluepass's own real pitch deck has stated a 20%
   * commission all along, with no Boattime exception). Explicitly corrected 2026-08-24: every
   * market, AU/Indonesia/no-market-at-all alike, is now the same 20%/80% split. Don't reintroduce a
   * market-specific carve-out without a real, checkable source for it this time.
   */
  market?: BluePassLedgerMarket;
};

// The real split, confirmed against Bluepass's own pitch deck ("We charge a 20% commission... we
// keep ~12% of every booking" - the unreferred case: 5% reef + 3% payments + 12% BluePass net = 20%).
// Already live in Kai's own chat copy (reply.ts's buildBluePassCommissionReply, triage.ts, and
// market.ts's bluePassCommissionSummary). Conservation and payment-processing always apply; partner
// commission only applies when a referral is attached, in which case BluePass's own platform-fee
// bucket is smaller so the operator's net share never depends on whether a referral happened to be
// attached. No dollar cap.
//
// One flat rate for every market as of 2026-08-24 - AU, Indonesia, and Boattime (previously believed
// frozen on an old 18%/82% figure that turned out to have no real source - see
// BluePassLedgerSplitInput.market's comment) all resolve here now, regardless of whether a market is
// passed at all.
const conservationPct = 0.05;
const partnerCommissionPct = 0.05;
const paymentProcessingPct = 0.03;
const platformFeePctReferred = 0.07;
const platformFeePctUnreferred = 0.12;

// Core split, operating directly on a real amount in cents - shared by the pre-booking PENDING
// estimate (parsed from operator free text, see calculateBluePassLedgerEstimate below) and the
// post-booking FINALIZED ledger (computed from the actual confirmed price, see
// finalizeBluePassLedgerForConfirmedBooking in bluepass-inquiry-repository.ts), so both paths use
// the identical percentage math rather than two copies that could drift apart.
export function calculateBluePassLedgerSplit(input: BluePassLedgerSplitInput): BluePassLedgerEstimate[] {
  const budgetAmount = input.grossAmountCents / 100;
  const hasReferral = Boolean(input.referralPartnerId);
  // input.market is accepted but unused here - every market resolves to the same flat rate now, see
  // BluePassLedgerSplitInput.market's comment for why this isn't a market-keyed lookup anymore.
  const conservation = budgetAmount * conservationPct;
  const partnerCommission = hasReferral ? budgetAmount * partnerCommissionPct : 0;
  const paymentProcessing = budgetAmount * paymentProcessingPct;
  const platformFee = budgetAmount * (hasReferral ? platformFeePctReferred : platformFeePctUnreferred);
  // Derived as the remainder (not a separate budgetAmount * 0.82) so the four ledger rows always
  // sum to exactly budgetAmount, with no rounding-cent leakage between buckets.
  const operatorNet = budgetAmount - conservation - partnerCommission - paymentProcessing - platformFee;

  const base = {
    inquiryId: input.inquiryId,
    currency: input.currency,
    status: input.status,
    referralPartnerId: input.referralPartnerId ?? null,
    referralLinkId: input.referralLinkId ?? null,
    referralCode: input.referralCode ?? null,
    referralRole: input.referralRole ?? null,
    metadata: {
      budgetAmount
    }
  };

  const entries: BluePassLedgerEstimate[] = [
    { ...base, kind: "CONSERVATION_ALLOCATION", amountCents: toCents(conservation) },
    { ...base, kind: "PAYMENT_PROCESSING_ALLOCATION", amountCents: toCents(paymentProcessing) },
    { ...base, kind: "BLUEPASS_PLATFORM_COMMISSION", amountCents: toCents(platformFee) },
    { ...base, kind: "OPERATOR_PAYOUT_PLACEHOLDER", amountCents: toCents(operatorNet) }
  ];

  if (hasReferral) {
    entries.push({ ...base, kind: "PARTNER_COMMISSION_ESTIMATE", amountCents: toCents(partnerCommission) });
  }

  return entries;
}

export function calculateBluePassLedgerEstimate(input: BluePassLedgerEstimateInput): BluePassLedgerEstimate[] {
  const { currency, amount: budgetAmount } = parseBudgetAmount(input.budget);

  return calculateBluePassLedgerSplit({
    inquiryId: input.inquiryId,
    grossAmountCents: toCents(budgetAmount),
    currency,
    status: "PENDING",
    referralPartnerId: input.referralPartnerId,
    referralLinkId: input.referralLinkId,
    referralCode: input.referralCode,
    referralRole: input.referralRole,
    market: input.market
  });
}

const knownLedgerCurrencies: BluePassLedgerCurrency[] = ["USD", "IDR", "EUR", "AUD"];

// Mirrors bluepass-quote.ts's parsePrice currency detection: an explicit currency code wins,
// otherwise USD is the existing default (unchanged behavior for budgets with no code at all).
export function parseBudgetAmount(value?: string | null): { currency: BluePassLedgerCurrency; amount: number } {
  if (!value) return { currency: "USD", amount: 0 };

  const match = value.replace(/,/g, "").match(/(USD|IDR|EUR|AUD)?\s*\$?\s*(\d{2,7})/i);
  if (!match) return { currency: "USD", amount: 0 };

  const detectedCurrency = match[1]?.toUpperCase();
  const currency: BluePassLedgerCurrency =
    detectedCurrency && (knownLedgerCurrencies as string[]).includes(detectedCurrency)
      ? (detectedCurrency as BluePassLedgerCurrency)
      : "USD";

  return { currency, amount: Number(match[2]) };
}

function toCents(value: number) {
  return Math.round(value * 100);
}

// Shared with bluepass-quote.ts's operator-quote conservation display so the two never drift to
// different percentages of the same real (not budget-text-parsed) price.
export function calculateConservationContributionCents(grossPriceCents: number): number {
  return Math.round(grossPriceCents * conservationPct);
}
