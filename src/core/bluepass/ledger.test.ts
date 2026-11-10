import { describe, expect, it } from "vitest";
import { calculateBluePassLedgerEstimate, calculateBluePassLedgerSplit, calculateConservationContributionCents, marketForCurrency } from "./ledger";

// Australia (and any booking whose market is unknown) is 20%/80%; per Tony (2026-11-10) Indonesia and
// Barbados are 18%/82%, a lower platform fee only. See ledger.ts's BluePassLedgerSplitInput.market.
describe("calculateBluePassLedgerEstimate", () => {
  it("splits a referred booking into the real 20% (5/5/3/7) breakdown, operator keeps 80%", () => {
    const entries = calculateBluePassLedgerEstimate({
      inquiryId: "inquiry_1",
      budget: "USD 10000",
      referralPartnerId: "partner_creator_1",
      referralCode: "CREATOR42",
      referralRole: "CREATOR"
    });

    expect(entries).toEqual([
      expect.objectContaining({ kind: "CONSERVATION_ALLOCATION", amountCents: 50000 }),
      expect.objectContaining({ kind: "PAYMENT_PROCESSING_ALLOCATION", amountCents: 30000 }),
      expect.objectContaining({ kind: "BLUEPASS_PLATFORM_COMMISSION", amountCents: 70000 }),
      expect.objectContaining({ kind: "OPERATOR_PAYOUT_PLACEHOLDER", amountCents: 800000 }),
      expect.objectContaining({ kind: "PARTNER_COMMISSION_ESTIMATE", amountCents: 50000 })
    ]);
    // All rows sum to exactly the budget - no rounding leakage between buckets.
    expect(entries.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(1_000_000);
  });

  it("still posts conservation, payments, platform fee, and operator payout without a referral - only the partner line is skipped", () => {
    const entries = calculateBluePassLedgerEstimate({
      inquiryId: "inquiry_1",
      budget: "USD 10000"
    });

    // No PARTNER_COMMISSION_ESTIMATE row at all when unreferred - the platform-fee bucket absorbs
    // the unused partner slice (12% instead of 7%) so operator net still lands on 80%.
    expect(entries).toEqual([
      expect.objectContaining({ kind: "CONSERVATION_ALLOCATION", amountCents: 50000 }),
      expect.objectContaining({ kind: "PAYMENT_PROCESSING_ALLOCATION", amountCents: 30000 }),
      expect.objectContaining({ kind: "BLUEPASS_PLATFORM_COMMISSION", amountCents: 120000 }),
      expect.objectContaining({ kind: "OPERATOR_PAYOUT_PLACEHOLDER", amountCents: 800000 })
    ]);
    expect(entries.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(1_000_000);
  });

  it("applies the identical percentage split to a large AUD budget - no dollar cap", () => {
    const entries = calculateBluePassLedgerEstimate({
      inquiryId: "inquiry_2",
      budget: "AUD 100000",
      referralPartnerId: "partner_creator_1",
      referralCode: "CREATOR42",
      referralRole: "CREATOR"
    });

    // Same percentages as the USD case, just 10x the budget and no cap kicking in at any size.
    expect(entries).toEqual([
      expect.objectContaining({ kind: "CONSERVATION_ALLOCATION", currency: "AUD", amountCents: 500000 }),
      expect.objectContaining({ kind: "PAYMENT_PROCESSING_ALLOCATION", currency: "AUD", amountCents: 300000 }),
      expect.objectContaining({ kind: "BLUEPASS_PLATFORM_COMMISSION", currency: "AUD", amountCents: 700000 }),
      expect.objectContaining({ kind: "OPERATOR_PAYOUT_PLACEHOLDER", currency: "AUD", amountCents: 8000000 }),
      expect.objectContaining({ kind: "PARTNER_COMMISSION_ESTIMATE", currency: "AUD", amountCents: 500000 })
    ]);
    expect(entries[0].metadata).toEqual({ budgetAmount: 100000 });
  });

  it("pays the partner commission for any referral role, not only CREATOR", () => {
    const entries = calculateBluePassLedgerEstimate({
      inquiryId: "inquiry_3",
      budget: "USD 10000",
      referralPartnerId: "partner_dive_shop_1",
      referralRole: "DIVE_SHOP"
    });

    expect(entries).toContainEqual(
      expect.objectContaining({ kind: "PARTNER_COMMISSION_ESTIMATE", amountCents: 50000 })
    );
  });

  it("is 20%/80% for Australia and when no market is given", () => {
    const base = { inquiryId: "inquiry_market", budget: "USD 10000" } as const;
    for (const entries of [calculateBluePassLedgerEstimate(base), calculateBluePassLedgerEstimate({ ...base, market: "AUSTRALIA" })]) {
      expect(entries).toEqual([
        expect.objectContaining({ kind: "CONSERVATION_ALLOCATION", amountCents: 50000 }),
        expect.objectContaining({ kind: "PAYMENT_PROCESSING_ALLOCATION", amountCents: 30000 }),
        expect.objectContaining({ kind: "BLUEPASS_PLATFORM_COMMISSION", amountCents: 120000 }),
        expect.objectContaining({ kind: "OPERATOR_PAYOUT_PLACEHOLDER", amountCents: 800000 })
      ]);
    }
  });

  it("is 18%/82% for Indonesia and Barbados: only the platform fee drops, 10% unreferred and 5% referred", () => {
    for (const market of ["INDONESIA", "BARBADOS"] as const) {
      const unreferred = calculateBluePassLedgerEstimate({ inquiryId: "i", budget: "USD 10000", market });
      expect(unreferred).toEqual([
        expect.objectContaining({ kind: "CONSERVATION_ALLOCATION", amountCents: 50000 }),
        expect.objectContaining({ kind: "PAYMENT_PROCESSING_ALLOCATION", amountCents: 30000 }),
        expect.objectContaining({ kind: "BLUEPASS_PLATFORM_COMMISSION", amountCents: 100000 }),
        expect.objectContaining({ kind: "OPERATOR_PAYOUT_PLACEHOLDER", amountCents: 820000 })
      ]);

      const referred = calculateBluePassLedgerEstimate({ inquiryId: "i", budget: "USD 10000", market, referralPartnerId: "p1" });
      expect(referred).toContainEqual(expect.objectContaining({ kind: "BLUEPASS_PLATFORM_COMMISSION", amountCents: 50000 }));
      expect(referred).toContainEqual(expect.objectContaining({ kind: "OPERATOR_PAYOUT_PLACEHOLDER", amountCents: 820000 }));
      expect(referred).toContainEqual(expect.objectContaining({ kind: "PARTNER_COMMISSION_ESTIMATE", amountCents: 50000 }));
      expect(referred.reduce((sum, e) => sum + e.amountCents, 0)).toBe(1_000_000);
    }
  });

  it("reads the market from an unambiguous currency, and leaves USD at the 20% default", () => {
    expect(marketForCurrency("AUD")).toBe("AUSTRALIA");
    expect(marketForCurrency("idr")).toBe("INDONESIA");
    expect(marketForCurrency("BBD")).toBe("BARBADOS");
    expect(marketForCurrency("USD")).toBeUndefined();
    expect(marketForCurrency(null)).toBeUndefined();

    const idr = calculateBluePassLedgerEstimate({ inquiryId: "i", budget: "IDR 1000000" });
    expect(idr).toContainEqual(expect.objectContaining({ kind: "OPERATOR_PAYOUT_PLACEHOLDER", amountCents: 82000000 }));
    const usd = calculateBluePassLedgerEstimate({ inquiryId: "i", budget: "USD 10000" });
    expect(usd).toContainEqual(expect.objectContaining({ kind: "OPERATOR_PAYOUT_PLACEHOLDER", amountCents: 800000 }));
  });

  it("an explicit market beats the currency", () => {
    const entries = calculateBluePassLedgerSplit({ inquiryId: "i", grossAmountCents: 1_000_000, currency: "USD", status: "FINALIZED", market: "INDONESIA" });
    expect(entries).toContainEqual(expect.objectContaining({ kind: "OPERATOR_PAYOUT_PLACEHOLDER", amountCents: 820000 }));
  });
});

describe("calculateConservationContributionCents", () => {
  it("matches the ledger's own 5% conservation figure for a real gross price", () => {
    expect(calculateConservationContributionCents(1_000_000)).toBe(50000);
  });
});
