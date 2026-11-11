import { describe, expect, it } from "vitest";
import { bluePassPreviewCatalog, findBluePassAlternativeYachts, searchBluePassYachts } from "./catalog";

describe("searchBluePassYachts", () => {
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
    // Not a strict first > last: several Komodo yachts (alila-purnama, calico-jack, anne-bonny,
    // celestia, dunia-baru, jakare, katharina, mutiara-laut) all fit >=8 guests and match "dive",
    // so they legitimately tie on score - catalogIndex is what makes the order deterministic, not
    // the score itself. What actually matters is that scores never increase down the ranked list.
    expect(results.every((result, i) => i === 0 || result.score <= results[i - 1].score)).toBe(true);
  });

  // kai-conservation-flow-notes.md item 10: budget was parsed but never applied - a traveller who
  // said "budget about $500 each" got quoted $8,580+ boats with no filtering. Additive score boost,
  // not a hard filter, so a budget nobody fits still returns the existing top matches rather than an
  // empty list.
  it("scores yachts that fit a stated USD budget higher, without ever excluding the rest", () => {
    // Alila Purnama is "from USD 3,000 per cabin" (catalog.ts) - comfortably inside a 5,000 budget.
    const withinBudget = searchBluePassYachts({
      destination: "Komodo",
      selectedYachtSlug: "alila-purnama",
      budget: { currency: "USD", amount: 5000 }
    });
    const alilaWithBudget = withinBudget.find((yacht) => yacht.slug === "alila-purnama");
    expect(alilaWithBudget?.reasons).toContain("within budget");

    // Same yacht, budget too low to fit - no false "within budget" claim, but still returned (the
    // selectedYachtSlug bonus keeps it in the results either way).
    const overBudget = searchBluePassYachts({
      destination: "Komodo",
      selectedYachtSlug: "alila-purnama",
      budget: { currency: "USD", amount: 100 }
    });
    const alilaOverBudget = overBudget.find((yacht) => yacht.slug === "alila-purnama");
    expect(alilaOverBudget?.reasons).not.toContain("within budget");
    expect(alilaOverBudget?.score).toBeLessThan(alilaWithBudget!.score);
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

// bluepass.co has no boat pages until the January 2027 launch, so a /yachts/<slug> link 404s.
describe("BluePass yacht links", () => {
  it("never links a preview catalog yacht to a boat page", () => {
    const cards = searchBluePassYachts({}, undefined, bluePassPreviewCatalog.length);

    expect(cards).toHaveLength(bluePassPreviewCatalog.length);
    expect(cards.every((card) => !card.productUrl)).toBe(true);
  });

  it("drops the catalog snapshot's /yachts links and anything that isn't a full address, keeping other links", () => {
    const cards = searchBluePassYachts({ destination: "Komodo" }, [
      { slug: "calico-jack", name: "Calico Jack", region: "Komodo", productUrl: "https://bluepass.co/yachts/calico-jack" },
      { slug: "dunia-baru", name: "Dunia Baru", region: "Komodo", productUrl: "/operators/dunia-baru" },
      { slug: "sea-dragon", name: "Sea Dragon", region: "Komodo", productUrl: " https://seadragon.example/charters " }
    ]);

    expect(Object.fromEntries(cards.map((card) => [card.slug, card.productUrl]))).toEqual({
      "calico-jack": null,
      "dunia-baru": null,
      "sea-dragon": "https://seadragon.example/charters"
    });
  });
});
