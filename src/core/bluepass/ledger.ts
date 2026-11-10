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

export type BluePassLedgerMarket = "AUSTRALIA" | "INDONESIA" | "BARBADOS";

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
   * Which market's commission rate applies. Omitted (or unknown) means AUSTRALIA, 20%/80%.
   *
   * History: AU moved to 20%/80% on 2026-08-05; Indonesia was set to the same split on 2026-08-24
   * ("Indonesia ternyata 20% juga, bukan 18%"), which also ended a Boattime carve-out that had no
   * checkable source. On 2026-11-10 Tony (the founder) said the rate is 20% for Australia and 18% for
   * Indonesia and Barbados, named markets only, never a blanket rate - so a market-specific rate is
   * back, this time on his word. Callers pass the market only when they can really tell it
   * (see marketForCurrency); anything else gets the 20% default.
   */
  market?: BluePassLedgerMarket;
};

// The split, confirmed against Bluepass's own pitch deck ("We charge a 20% commission... we keep
// ~12% of every booking" - the unreferred case: 5% reef + 3% payments + 12% BluePass net = 20%).
// Conservation and payment-processing always apply; partner commission only applies when a referral
// is attached, in which case BluePass's own platform-fee bucket is smaller so the operator's net
// share never depends on whether a referral happened to be attached. No dollar cap.
//
// The markets Tony named at 18% (Indonesia, Barbados) lower only the platform fee by two points
// (5% referred / 10% unreferred), which is the same 5/5/3/5 and 5/3/10 shape the earlier 18% split
// had: the operator still keeps 82%, and conservation stays 5%. Mirrored in the website repo's
// lib/constants/economics.ts - change both together.
const conservationPct = 0.05;
const partnerCommissionPct = 0.05;
const paymentProcessingPct = 0.03;
const platformFeePct: Record<BluePassLedgerMarket, { referred: number; unreferred: number }> = {
  AUSTRALIA: { referred: 0.07, unreferred: 0.12 },
  INDONESIA: { referred: 0.05, unreferred: 0.1 },
  BARBADOS: { referred: 0.05, unreferred: 0.1 }
};

/**
 * The market a booking is in, when its currency says so unambiguously. Bookings carry no market of
 * their own yet, and USD is quoted in every market, so USD (and anything else) returns undefined and
 * the caller gets the 20% default rather than a guess. shortcut: replace with a stored market on the
 * inquiry / payment attempt once one exists.
 */
export function marketForCurrency(currency?: string | null): BluePassLedgerMarket | undefined {
  switch (currency?.toUpperCase()) {
    case "AUD":
      return "AUSTRALIA";
    case "IDR":
      return "INDONESIA";
    case "BBD":
      return "BARBADOS";
    default:
      return undefined;
  }
}

// Core split, operating directly on a real amount in cents - shared by the pre-booking PENDING
// estimate (parsed from operator free text, see calculateBluePassLedgerEstimate below) and the
// post-booking FINALIZED ledger (computed from the actual confirmed price, see
// finalizeBluePassLedgerForConfirmedBooking in bluepass-inquiry-repository.ts), so both paths use
// the identical percentage math rather than two copies that could drift apart.
export function calculateBluePassLedgerSplit(input: BluePassLedgerSplitInput): BluePassLedgerEstimate[] {
  const budgetAmount = input.grossAmountCents / 100;
  const hasReferral = Boolean(input.referralPartnerId);
  const fees = platformFeePct[input.market ?? "AUSTRALIA"];
  const conservation = budgetAmount * conservationPct;
  const partnerCommission = hasReferral ? budgetAmount * partnerCommissionPct : 0;
  const paymentProcessing = budgetAmount * paymentProcessingPct;
  const platformFee = budgetAmount * (hasReferral ? fees.referred : fees.unreferred);
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
    market: input.market ?? marketForCurrency(currency)
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
