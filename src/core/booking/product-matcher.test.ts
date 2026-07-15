import { describe, expect, it } from "vitest";
import type { PmsProduct } from "@/core/pms/types";
import { matchPmsProduct } from "./product-matcher";

const products: PmsProduct[] = [
  {
    externalProductId: "mock-komodo-day-trip",
    title: "Komodo Day Trip",
    description: "A shared day trip with auto-booking.",
    bookingMode: "AUTO_BOOKING"
  },
  {
    externalProductId: "mock-private-charter",
    title: "Private Charter",
    description: "A custom charter that requires operator confirmation.",
    bookingMode: "MANUAL_INQUIRY"
  },
  {
    externalProductId: "mock-reef-day-snorkel",
    title: "Reef Day Snorkel",
    description: "A guided snorkeling tour over bright reef sites.",
    bookingMode: "AUTO_BOOKING"
  }
];

describe("product matcher", () => {
  it("matches product aliases from title and description words", () => {
    expect(matchPmsProduct("private boat for 2 guests tomorrow", products)).toMatchObject({
      status: "MATCHED",
      product: {
        externalProductId: "mock-private-charter"
      }
    });

    expect(matchPmsProduct("snorkeling for 2 people tomorrow", products)).toMatchObject({
      status: "MATCHED",
      product: {
        externalProductId: "mock-reef-day-snorkel"
      }
    });
  });

  it("returns ambiguous when only generic tour language is present", () => {
    expect(matchPmsProduct("tour for 2 guests tomorrow", products)).toEqual({
      status: "AMBIGUOUS",
      products
    });
  });

  it("returns no match when there are no meaningful product signals", () => {
    expect(matchPmsProduct("airport pickup tomorrow", products)).toEqual({
      status: "NO_MATCH",
      products
    });
  });

  it("matches Australian trip types (sail, whale, whole-boat charter)", () => {
    const auProducts: PmsProduct[] = [
      { externalProductId: "au-gbr-reef-day-trip", title: "Great Barrier Reef Day Trip", description: "A full-day outer reef snorkel and dive trip from Cairns.", bookingMode: "AUTO_BOOKING" },
      { externalProductId: "au-whitsundays-sailing-day", title: "Whitsundays Sailing Day", description: "A day sailing the Whitsundays with a stop at Whitehaven Beach.", bookingMode: "AUTO_BOOKING" },
      { externalProductId: "au-ningaloo-whale-shark-swim", title: "Ningaloo Whale Shark Swim", description: "A guided swim with whale sharks on Ningaloo Reef from Exmouth.", bookingMode: "AUTO_BOOKING" },
      { externalProductId: "au-whole-boat-charter", title: "Whole-Boat Charter", description: "A private whole-boat charter for groups, quoted by the operator.", bookingMode: "MANUAL_INQUIRY" }
    ];

    expect(matchPmsProduct("we want to sail the Whitsundays tomorrow", auProducts)).toMatchObject({
      status: "MATCHED",
      product: { externalProductId: "au-whitsundays-sailing-day" }
    });
    expect(matchPmsProduct("swim with whale sharks at Ningaloo", auProducts)).toMatchObject({
      status: "MATCHED",
      product: { externalProductId: "au-ningaloo-whale-shark-swim" }
    });
    expect(matchPmsProduct("a whole boat charter for our group", auProducts)).toMatchObject({
      status: "MATCHED",
      product: { externalProductId: "au-whole-boat-charter" }
    });
  });
});
