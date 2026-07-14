import { describe, expect, it } from "vitest";
import {
  buildBluePassInquiryConfirmationReply,
  buildBluePassInquiryReadyReply,
  buildBluePassInquiryStatusReply,
  buildBluePassMissingFieldsReply,
  buildBluePassSeasonReply,
  buildBluePassValueReply,
  buildBluePassYachtComparisonReply,
  buildBluePassYachtOverviewReply
} from "./reply";

// Minimal yacht shapes - the reply builders only read these fields.
const yacht = {
  name: "Sea Dragon",
  region: "Komodo",
  tier: "Explorer",
  maxGuests: 12,
  cabins: 6,
  priceSignal: "from IDR 15M/night",
  charterPriceSignal: "charter from IDR 90M/week",
  productUrl: "https://bluepass.co/y/sea-dragon"
} as any;

const rajaYacht = { ...yacht, name: "Manta Queen", region: "Raja Ampat" } as any;

// Every traveller-facing reply, across representative inputs.
function allTravellerReplies(): string[] {
  return [
    buildBluePassMissingFieldsReply({ missingFields: ["destination", "travellerEmail"] as any }),
    buildBluePassMissingFieldsReply({ destination: "Komodo", missingFields: ["dateWindow"] as any }),
    buildBluePassMissingFieldsReply({ selectedYacht: yacht, missingFields: ["dateWindow", "guests"] as any }),
    buildBluePassMissingFieldsReply({ selectedYacht: yacht, missingFields: ["travellerName", "travellerEmail"] as any }),
    buildBluePassInquiryReadyReply({ inquiryId: "BP-1001", dispatchQueued: true }),
    buildBluePassInquiryReadyReply({ inquiryId: "BP-1002", selectedYachtName: "Sea Dragon", dispatchFailed: true, dispatchQueued: false }),
    buildBluePassInquiryConfirmationReply({}),
    buildBluePassInquiryConfirmationReply({ selectedYachtName: "Sea Dragon", destination: "Komodo", dateWindow: "March", guests: 8, travellerName: "Tony", travellerEmail: "t@x.com", travellerPhone: "+62812" }),
    buildBluePassInquiryStatusReply({ inquiryId: "BP-1003", status: "OPERATOR_PENDING" }),
    buildBluePassYachtOverviewReply(yacht),
    buildBluePassValueReply(),
    buildBluePassSeasonReply("Komodo"),
    buildBluePassSeasonReply("Raja Ampat"),
    buildBluePassYachtComparisonReply([yacht, rajaYacht] as any)
  ];
}

describe("bluepass traveller replies (reply.ts)", () => {
  it("never uses an emoji", () => {
    const EMOJI = /\p{Extended_Pictographic}/u;
    for (const reply of allTravellerReplies()) {
      expect(EMOJI.test(reply), `emoji in: ${reply}`).toBe(false);
    }
  });

  it("only ever states the honest 5% (no invented percentages)", () => {
    for (const reply of allTravellerReplies()) {
      for (const pct of reply.match(/(\d+)%/g) ?? []) {
        expect(["3", "5", "18", "82"].includes(pct.replace("%", "")), `bad % in: ${reply}`).toBe(true);
      }
    }
  });

  it("returns non-empty, trimmed replies with no double spaces", () => {
    for (const reply of allTravellerReplies()) {
      expect(reply.length).toBeGreaterThan(0);
      expect(reply, `untrimmed: ${reply}`).toBe(reply.trim());
      expect(reply.includes("  "), `double space in: ${reply}`).toBe(false);
    }
  });

  it("keeps the data-independent replies concise (<=320 chars)", () => {
    expect(buildBluePassValueReply().length).toBeLessThanOrEqual(320);
    expect(buildBluePassSeasonReply("Komodo").length).toBeLessThanOrEqual(320);
    expect(buildBluePassSeasonReply("Raja Ampat").length).toBeLessThanOrEqual(320);
  });

  it("keeps booking-truth honest (no confirmed-booking language before operator confirms)", () => {
    const ready = buildBluePassInquiryReadyReply({ inquiryId: "BP-2001", dispatchQueued: true });
    expect(ready.toLowerCase()).toContain("not a confirmed booking");
  });
});
