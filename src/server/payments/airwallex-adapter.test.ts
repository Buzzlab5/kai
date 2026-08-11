import { describe, expect, it } from "vitest";
import { AirwallexNotLiveError, getAirwallexAdapter, StubAirwallexAdapter } from "./airwallex-adapter";

describe("StubAirwallexAdapter", () => {
  it("throws AirwallexNotLiveError on every real call, never silently pretending to move money", async () => {
    const adapter = new StubAirwallexAdapter({ apiKey: "fake", clientId: "fake" });

    await expect(
      adapter.createDisbursement({
        airwallexBeneficiaryId: "ben_123",
        amountCents: 5000,
        currency: "IDR",
        reference: "ledger_entry_1"
      })
    ).rejects.toBeInstanceOf(AirwallexNotLiveError);
  });

  it("throws the same error even with no config at all", async () => {
    const adapter = new StubAirwallexAdapter();

    await expect(
      adapter.createDisbursement({
        airwallexBeneficiaryId: "ben_123",
        amountCents: 5000,
        currency: "IDR",
        reference: "ledger_entry_1"
      })
    ).rejects.toThrow(/Airwallex payout rail is not live yet/);
  });
});

describe("getAirwallexAdapter", () => {
  it("returns a StubAirwallexAdapter", () => {
    expect(getAirwallexAdapter()).toBeInstanceOf(StubAirwallexAdapter);
  });
});
