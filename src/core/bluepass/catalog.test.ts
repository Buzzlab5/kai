import { describe, expect, it } from "vitest";
import { findBluePassAlternativeYachts, searchBluePassYachts } from "./catalog";

describe("searchBluePassYachts", () => {
  it("seeds and matches Australian inventory (region normalizes + destination scores)", () => {
    const auCatalog = [
      {
        slug: "reef-magic",
        name: "Reef Magic",
        region: "Cairns, Great Barrier Reef",
        tier: "Explorer",
        maxGuests: 30,
        cabins: 0,
        priceSignal: "from AUD 250pp",
        charterPriceSignal: null,
        operatorId: "op-au-1",
        operatorName: "Reef Magic Cruises",
        operatorPhone: "+61 7 0000 0000"
      }
    ];
    const results = searchBluePassYachts({ destination: "Great Barrier Reef", guests: 10 }, auCatalog as any);
    expect(results).toHaveLength(1);
    expect(results[0].region).toBe("Great Barrier Reef");
    expect(results[0].reasons.join(" ")).toContain("Great Barrier Reef");
  });

  it("returns ranked preview catalog matches with truth labels", () => {
    const results = searchBluePassYachts({
      destination: "Komodo",
      guests: 8,
      interests: ["dive"]
    });

    expect(results[0]).toMatchObject({
      slug: "alila-purnama",
      name: "Alila Purnama",
      region: "Komodo",
      truth: {
        availabilitySource: "preview_catalog",
        priceSource: "preview_catalog",
        bookingConfirmationSource: "operator_admin"
      }
    });
    expect(results[0].score).toBeGreaterThan(results.at(-1)?.score ?? 0);
  });

  it("recommends similar alternatives after an operator decline without reusing the declined yacht", () => {
    const results = findBluePassAlternativeYachts({
      destination: "Komodo",
      guests: 4,
      declinedYachtSlug: "calico-jack"
    });

    expect(results.map((result) => result.slug)).toContain("alila-purnama");
    expect(results.map((result) => result.slug)).not.toContain("calico-jack");
    expect(results.every((result) => result.region === "Komodo")).toBe(true);
    expect(results.every((result) => result.maxGuests >= 4)).toBe(true);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});
