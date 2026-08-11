import { describe, expect, it } from "vitest";
import {
  buildBluePassConservationReply,
  buildBluePassInquiryConfirmationReply,
  buildBluePassInquiryReadyReply,
  buildBluePassInquiryStatusReply,
  buildBluePassMissingFieldsReply,
  buildBluePassSeasonReply,
  buildBluePassValueReply,
  buildBluePassYachtComparisonReply,
  buildBluePassYachtOverviewReply,
  isBluePassConservationQuestion,
  isBluePassValuePropQuestion
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
      for (const m of reply.matchAll(/(\d+)\s*(?:%|percent)/gi)) {
        expect(["3", "5", "18", "82"].includes(m[1]), `bad % in: ${reply}`).toBe(true);
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

  it("keeps the selected-yacht dates/guests prompt <=320 with a full yacht (price + charter)", () => {
    const y = { ...yacht, name: "Alila Purnama Phinisi Expedition", priceSignal: "from IDR 15,000,000/night" } as any;
    const reply = buildBluePassMissingFieldsReply({ selectedYacht: y, missingFields: ["dateWindow", "guests"] as any });
    expect(reply.length, `selected-yacht prompt too long: ${reply.length}`).toBeLessThanOrEqual(320);
    expect(reply.toLowerCase()).toContain("operator");
  });

  it("keeps the yacht-overview reply <=320 with a charter signal + long name", () => {
    const y = { ...yacht, name: "Alila Purnama Phinisi Expedition" } as any;
    const reply = buildBluePassYachtOverviewReply(y);
    expect(reply.length, `overview too long: ${reply.length}`).toBeLessThanOrEqual(320);
    expect(reply.toLowerCase()).toContain("operator inquiry");
  });

  it("keeps the yacht-comparison reply <=320 with 3 real yachts (incl. long names)", () => {
    const three = [
      { ...yacht, name: "Alila Purnama Phinisi" },
      { ...rajaYacht, name: "Damai II Liveaboard" },
      { ...yacht, name: "Ombak Putih Expedition", region: "Raja Ampat" },
    ] as any;
    const reply = buildBluePassYachtComparisonReply(three);
    expect(reply.length, `comparison too long: ${reply.length}`).toBeLessThanOrEqual(320);
    expect(reply.toLowerCase()).toContain("operator inquiry");
  });

  it("keeps the data-independent replies concise (<=320 chars)", () => {
    expect(buildBluePassValueReply().length).toBeLessThanOrEqual(320);
    expect(buildBluePassSeasonReply("Komodo").length).toBeLessThanOrEqual(320);
    expect(buildBluePassSeasonReply("Raja Ampat").length).toBeLessThanOrEqual(320);
  });

  it("AU-first: season reply gives Australian seasons for AU regions (no Komodo/Labuan Bajo)", () => {
    const gbr = buildBluePassSeasonReply("Great Barrier Reef");
    expect(gbr).toMatch(/Great Barrier Reef|stinger/);
    expect(gbr.toLowerCase()).not.toContain("komodo");
    expect(gbr.toLowerCase()).not.toContain("labuan bajo");
    expect(gbr.length).toBeLessThanOrEqual(320);

    const ningaloo = buildBluePassSeasonReply("Ningaloo Reef");
    expect(ningaloo.toLowerCase()).toMatch(/whale shark|ningaloo/);
    expect(ningaloo.length).toBeLessThanOrEqual(320);

    const whitsundays = buildBluePassSeasonReply("Whitsundays");
    expect(whitsundays.toLowerCase()).toMatch(/whitsundays|whitehaven|74 islands/);
    expect(whitsundays.length).toBeLessThanOrEqual(320);

    // An unknown region gets an honest "don't know yet" fallback rather than fabricated Australia-
    // wide seasonal claims - the same correctness bug this session already fixed once for a Komodo-
    // flavored default (see A5 in the integration plan); the fallback deliberately doesn't assume
    // any one market, matching the decision to leave the country/market gate unwired for now.
    const generic = buildBluePassSeasonReply("Sydney");
    expect(generic.toLowerCase()).toContain("sydney");
    expect(generic.toLowerCase()).not.toContain("komodo");
    expect(generic.length).toBeLessThanOrEqual(320);

    // Indonesian regions still get Indonesian seasons
    expect(buildBluePassSeasonReply("Komodo").toLowerCase()).toContain("komodo");
  });

  it("AU-first: an AU yacht is not called a 'phinisi', and comparisons don't name-drop Komodo/Raja", () => {
    const auYacht = { ...yacht, name: "Reef Explorer", region: "Great Barrier Reef" } as any;
    const missing = buildBluePassMissingFieldsReply({ selectedYacht: auYacht, missingFields: ["dateWindow"] as any });
    expect(missing.toLowerCase()).not.toContain("phinisi");
    expect(buildBluePassYachtOverviewReply(auYacht).toLowerCase()).not.toContain("phinisi");
    // Indonesian yacht still reads as a phinisi
    expect(buildBluePassMissingFieldsReply({ selectedYacht: yacht, missingFields: ["dateWindow"] as any }).toLowerCase()).toContain("phinisi");

    const auComparison = buildBluePassYachtComparisonReply([
      { ...yacht, name: "Reef Explorer", region: "Great Barrier Reef" },
      { ...yacht, name: "Ningaloo Drifter", region: "Ningaloo Reef" }
    ] as any);
    expect(auComparison).not.toContain("Komodo");
    expect(auComparison).not.toContain("Raja Ampat");
    expect(auComparison).toContain("Great Barrier Reef");
    expect(auComparison.toLowerCase()).toContain("operator inquiry");
    expect(auComparison.length).toBeLessThanOrEqual(320);
  });

  it("missing-fields reply names the fields it still needs", () => {
    const reply = buildBluePassMissingFieldsReply({ missingFields: ["destination", "travellerEmail"] as any });
    expect(reply.toLowerCase()).toContain("destination");
    expect(reply.toLowerCase()).toContain("email");
  });

  it("confirmation reply asks the traveller to confirm before sending", () => {
    const reply = buildBluePassInquiryConfirmationReply({ selectedYachtName: "Sea Dragon", destination: "Komodo" });
    expect(reply.toLowerCase()).toContain("should i send this inquiry now?");
  });

  it("status reply reflects the normalized inquiry status", () => {
    const reply = buildBluePassInquiryStatusReply({ inquiryId: "BP-9001", status: "OPERATOR_PENDING" });
    expect(reply).toContain("BP-9001");
    expect(reply.toLowerCase()).toContain("operator pending");
  });

  it("booking-implying replies reference the operator and never assert a confirmed booking", () => {
    // Affirmative "it's booked" language - NOT the negated "not a confirmed booking" disclaimer.
    const AFFIRMS_BOOKED = /booking is confirmed|booking confirmed[.!]|you're booked|you are booked|reservation confirmed|confirmed your booking/i;
    const bookingImplying = [
      buildBluePassInquiryReadyReply({ inquiryId: "BP-3001", dispatchQueued: true }),
      buildBluePassInquiryReadyReply({ inquiryId: "BP-3002", dispatchFailed: true, dispatchQueued: false }),
      buildBluePassInquiryConfirmationReply({ selectedYachtName: "Sea Dragon", destination: "Komodo", guests: 6 }),
      buildBluePassInquiryStatusReply({ inquiryId: "BP-3003", status: "OPERATOR_PENDING" }),
      buildBluePassMissingFieldsReply({ selectedYacht: yacht, missingFields: ["dateWindow"] as any }),
      buildBluePassYachtOverviewReply(yacht)
    ];
    for (const reply of bookingImplying) {
      expect(reply.toLowerCase(), `no operator reference in: ${reply}`).toContain("operator");
      expect(AFFIRMS_BOOKED.test(reply), `asserts a confirmed booking: ${reply}`).toBe(false);
    }
  });

  it("keeps booking-truth honest (no confirmed-booking language before operator confirms)", () => {
    const ready = buildBluePassInquiryReadyReply({ inquiryId: "BP-2001", dispatchQueued: true });
    expect(ready.toLowerCase()).toContain("not a confirmed booking");
  });
});

// kai-conversation-flow-notes.md stop-the-line item A: Kai once told a traveller the 5% was
// "likely a service fee... goes towards maintaining the platform" - the exact inverse of the truth.
describe("conservation/value-prop grounding", () => {
  it("buildBluePassValueReply never calls the 5% a platform/service fee, and gives the real direction", () => {
    const reply = buildBluePassValueReply();
    expect(reply.toLowerCase()).not.toMatch(/platform fee|service fee/);
    expect(reply.toLowerCase()).toContain("operator's side");
    expect(reply.toLowerCase()).toContain("never added to your fare");
    expect(reply).toContain("5%");
  });

  it("buildBluePassConservationReply names the real, verified partners and explicitly denies it's a platform fee", () => {
    const reply = buildBluePassConservationReply();
    // The reply is allowed to say "not a platform fee" (an explicit rebuttal of the false claim) -
    // what it must never do is affirm it, e.g. "is a platform fee" or "goes towards the platform".
    expect(reply.toLowerCase()).not.toMatch(/\bis a platform fee\b|\bgoes towards.*platform\b|\bmaintaining the platform\b/);
    expect(reply.toLowerCase()).toContain("never a platform fee");
    expect(reply.toLowerCase()).toContain("operator's side");
    expect(reply).toContain("Great Barrier Reef Foundation");
    expect(reply).toContain("Whitsundays Marine Trust");
    expect(reply).toContain("Hervey Bay Whale Research");
    expect(reply).toContain("bluepass.co/conservation");
  });

  it("isBluePassConservationQuestion matches the real transcript question", () => {
    expect(isBluePassConservationQuestion("Where exactly does the 5% go, and who verifies it?")).toBe(true);
    expect(isBluePassConservationQuestion("what happens after I pay")).toBe(false);
  });

  // Regression: a trailing `\b` right after a literal "%" never matches, since "%" isn't a word
  // character - that silently broke the detector for "5%" followed by whitespace/punctuation, which
  // is nearly every real sentence. The test above happened to also contain "verifies", masking this.
  it("isBluePassConservationQuestion matches bare '5%' phrasing with no other trigger word", () => {
    expect(isBluePassConservationQuestion("isn't the 5% just a service fee for bluepass?")).toBe(true);
    expect(isBluePassConservationQuestion("is the 5% a platform fee?")).toBe(true);
    expect(isBluePassConservationQuestion("so where does the 5%. actually go")).toBe(true);
  });

  it("isBluePassValuePropQuestion matches the real transcript question, without matching the conservation one", () => {
    expect(isBluePassValuePropQuestion("Why is booking through you better than going direct to the operator?")).toBe(
      true
    );
    expect(isBluePassValuePropQuestion("Where exactly does the 5% go, and who verifies it?")).toBe(false);
  });
});
