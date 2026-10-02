import { describe, expect, it } from "vitest";
import { buildDestinationComparison, findDestinationNote, findMentionedDestinations } from "./destination-notes";

describe("findMentionedDestinations", () => {
  it("finds the places Kai knows, in the order they're mentioned", () => {
    expect(findMentionedDestinations("Ningaloo or the Whitsundays?")).toEqual(["Ningaloo", "Whitsundays"]);
    expect(findMentionedDestinations("whats better komodo or raja ampat?", ["Komodo", "Raja Ampat"])).toEqual([
      "Komodo",
      "Raja Ampat"
    ]);
    expect(findMentionedDestinations("flying into Cairns then Airlie Beach")).toEqual(["Great Barrier Reef", "Whitsundays"]);
  });

  it("uses the catalogue's own name for a place BluePass lists", () => {
    expect(findMentionedDestinations("best time for ningaloo?", ["Ningaloo Reef", "Komodo"])).toEqual(["Ningaloo Reef"]);
  });

  it("reads 'the Reef' as the Great Barrier Reef, unless the traveller is talking about Indonesia", () => {
    expect(findMentionedDestinations("the reef or the whitsundays?")).toEqual(["Great Barrier Reef", "Whitsundays"]);
    expect(findMentionedDestinations("how is the reef at Misool?")).toEqual(["Raja Ampat"]);
  });

  it("still finds catalogue regions Kai has no notes on", () => {
    expect(findMentionedDestinations("tell me about Bunaken", ["Bunaken"])).toEqual(["Bunaken"]);
  });
});

describe("buildDestinationComparison", () => {
  it("uses the hand-written steer for the pairs travellers ask most", () => {
    expect(buildDestinationComparison(["Raja Ampat", "Komodo"])).toContain("For a first liveaboard, I'd start with Komodo.");
    expect(buildDestinationComparison(["Ningaloo Reef", "Great Barrier Reef"])).toContain("Ningaloo wins");
  });

  it("builds a fair side-by-side for any other places Kai knows", () => {
    const reply = buildDestinationComparison(["Komodo", "Hervey Bay"]);
    expect(reply).toContain("Komodo is best for");
    expect(reply).toContain("Hervey Bay is best for");
  });

  it("won't compare when it doesn't know one of the places", () => {
    expect(buildDestinationComparison(["Komodo", "Bunaken"])).toBeNull();
  });
});

describe("findDestinationNote", () => {
  it("matches the everyday names for each place", () => {
    expect(findDestinationNote("Port Douglas")?.name).toBe("Great Barrier Reef");
    expect(findDestinationNote("Labuan Bajo")?.name).toBe("Komodo");
    expect(findDestinationNote("K'gari")?.name).toBe("Hervey Bay");
    expect(findDestinationNote("Sydney")).toBeNull();
  });
});
