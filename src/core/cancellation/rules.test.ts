import { describe, expect, it } from "vitest";
import { DEFAULT_CANCELLATION_POLICY_TIERS, formatCancellationPolicySummary, resolveRefundTierPercent } from "./rules";

describe("resolveRefundTierPercent", () => {
  const travelDate = new Date("2026-08-24T00:00:00Z"); // 14 days after cancelledAt below
  const cancelledAt = new Date("2026-08-10T00:00:00Z");

  it("always gives 100% for an operator-initiated cancellation, regardless of timing", () => {
    const decision = resolveRefundTierPercent({
      cancelledBy: "OPERATOR",
      travelDate: new Date("2026-08-10T12:00:00Z"), // same day, would be 0% for a customer
      cancelledAt,
      policy: null
    });
    expect(decision).toEqual({ resolved: true, refundPercent: 100, daysBeforeDeparture: null });
  });

  it("is unresolved when the travel date can't be determined, never guesses", () => {
    const decision = resolveRefundTierPercent({
      cancelledBy: "CUSTOMER",
      travelDate: null,
      cancelledAt,
      policy: null
    });
    expect(decision.resolved).toBe(false);
    expect(decision.refundPercent).toBeNull();
  });

  it("uses the platform default policy when the operator hasn't set one", () => {
    const decision = resolveRefundTierPercent({ cancelledBy: "CUSTOMER", travelDate, cancelledAt, policy: null });
    expect(decision).toEqual({ resolved: true, refundPercent: 100, daysBeforeDeparture: 14 });
  });

  it("matches the mid tier for a cancellation inside the top tier but outside the floor", () => {
    const decision = resolveRefundTierPercent({
      cancelledBy: "CUSTOMER",
      travelDate: new Date("2026-08-15T00:00:00Z"), // 5 days out
      cancelledAt,
      policy: null
    });
    expect(decision).toEqual({ resolved: true, refundPercent: 50, daysBeforeDeparture: 5 });
  });

  it("matches the floor tier for a last-minute cancellation", () => {
    const decision = resolveRefundTierPercent({
      cancelledBy: "CUSTOMER",
      travelDate: new Date("2026-08-11T00:00:00Z"), // 1 day out
      cancelledAt,
      policy: null
    });
    expect(decision).toEqual({ resolved: true, refundPercent: 0, daysBeforeDeparture: 1 });
  });

  it("falls back to the floor tier when cancelling after the travel date has already passed", () => {
    const decision = resolveRefundTierPercent({
      cancelledBy: "CUSTOMER",
      travelDate: new Date("2026-08-09T00:00:00Z"), // 1 day in the past
      cancelledAt,
      policy: null
    });
    expect(decision.resolved).toBe(true);
    expect(decision.refundPercent).toBe(0);
    expect(decision.daysBeforeDeparture).toBe(-1);
  });

  it("uses an operator's own policy when one is set", () => {
    const decision = resolveRefundTierPercent({
      cancelledBy: "CUSTOMER",
      travelDate: new Date("2026-08-17T00:00:00Z"), // 7 days out
      cancelledAt,
      policy: [
        { minDaysBeforeDeparture: 30, refundPercent: 100 },
        { minDaysBeforeDeparture: 0, refundPercent: 25 }
      ]
    });
    expect(decision).toEqual({ resolved: true, refundPercent: 25, daysBeforeDeparture: 7 });
  });

  it("falls back to the platform default when the operator's policy is missing a 0-day floor", () => {
    const decision = resolveRefundTierPercent({
      cancelledBy: "CUSTOMER",
      travelDate: new Date("2026-08-11T00:00:00Z"), // 1 day out
      cancelledAt,
      policy: [{ minDaysBeforeDeparture: 30, refundPercent: 100 }]
    });
    // Default policy's floor tier (0 days, 0%) applies instead of leaving this unmatched.
    expect(decision).toEqual({ resolved: true, refundPercent: 0, daysBeforeDeparture: 1 });
  });

  it("falls back to the platform default when the operator's policy has an out-of-range percent", () => {
    const decision = resolveRefundTierPercent({
      cancelledBy: "CUSTOMER",
      travelDate,
      cancelledAt,
      policy: [{ minDaysBeforeDeparture: 0, refundPercent: 150 }]
    });
    expect(decision).toEqual({ resolved: true, refundPercent: 100, daysBeforeDeparture: 14 });
  });

  it("exports a sane, always-resolvable default policy", () => {
    expect(DEFAULT_CANCELLATION_POLICY_TIERS.some((tier) => tier.minDaysBeforeDeparture <= 0)).toBe(true);
    for (const tier of DEFAULT_CANCELLATION_POLICY_TIERS) {
      expect(tier.refundPercent).toBeGreaterThanOrEqual(0);
      expect(tier.refundPercent).toBeLessThanOrEqual(100);
    }
  });
});

describe("formatCancellationPolicySummary", () => {
  it("describes the platform default in plain English", () => {
    expect(formatCancellationPolicySummary(null)).toBe(
      "Full refund 14+ days before departure, 50% refund 3-13 days before, no refund within 3 days"
    );
  });

  it("falls back to the platform default for a floorless operator policy, same as resolveRefundTierPercent", () => {
    expect(formatCancellationPolicySummary([{ minDaysBeforeDeparture: 30, refundPercent: 100 }])).toBe(
      formatCancellationPolicySummary(null)
    );
  });

  it("describes a real operator's own tiers, not the default", () => {
    expect(
      formatCancellationPolicySummary([
        { minDaysBeforeDeparture: 7, refundPercent: 100 },
        { minDaysBeforeDeparture: 0, refundPercent: 50 }
      ])
    ).toBe("Full refund 7+ days before departure, 50% refund within 7 days");
  });

  it("handles a single-tier policy without a range to describe", () => {
    expect(formatCancellationPolicySummary([{ minDaysBeforeDeparture: 0, refundPercent: 0 }])).toBe(
      "no refund 0+ days before departure"
    );
  });
});
