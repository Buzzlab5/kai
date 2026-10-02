import { describe, expect, it } from "vitest";
import {
  asksForSuggestion,
  findProductDuration,
  findProductInclusions,
  pickProductForOccasion,
  plainProductText,
  summariseProductDescription
} from "./product-insight";
import type { PmsProduct } from "@/core/pms/types";

function product(title: string, description: string): PmsProduct {
  return { externalProductId: title.toLowerCase().replace(/\s+/g, "-"), title, description, bookingMode: "AUTO_BOOKING" };
}

const goldCoast = [
  product("Gold Coast Whale Escape", "<p>Join us for a 3 hour whale watching cruise.</p><p>Includes:</p><ul><li>Morning tea</li><li>Expert commentary</li></ul><p>Great for families.</p>"),
  product("Twilight Drift", "Sunset cruise on the Broadwater. Approx 2 hours."),
  product("Broadwater Twilight Dining", "Twilight dining cruise with a three-course dinner. Duration: 2.5 hours. Adults only."),
  product("Private Yacht Charter", "Your own yacht and skipper for birthdays, hens and corporate groups.")
];

describe("reading an operator's trip details", () => {
  it("turns booking system HTML into plain sentences and lists", () => {
    expect(plainProductText("<p>Includes:</p><ul><li>Morning tea</li><li>Snorkel gear</li></ul><p>Fun &amp; easy.</p>")).toBe(
      "Includes: Morning tea, Snorkel gear. Fun & easy."
    );
  });

  it("reads out the first sentence only when it's short", () => {
    expect(summariseProductDescription("Sunset cruise on the Broadwater. Approx 2 hours.")).toBe("Sunset cruise on the Broadwater.");
    expect(summariseProductDescription(`${"A very long sentence ".repeat(12)}.`)).toBeNull();
    expect(summariseProductDescription("")).toBeNull();
  });

  it.each([
    ["Join us for a 3 hour whale watching cruise.", "3 hours"],
    ["Duration: 2.5 hours", "2.5 hours"],
    ["Approx 90 mins on the water", "90 minutes"],
    ["A 3-day liveaboard out of Labuan Bajo", "3 days"],
    ["Our half-day reef trip", "half a day"],
    ["A 2-3 hour sunset sail", "2 to 3 hours"]
  ])("finds the duration in %j", (description, expected) => {
    expect(findProductDuration(product("Trip", description))).toBe(expected);
  });

  it.each(["Free cancellation up to 24 hours notice.", "Please arrive 30 minutes before departure.", "We're open 7 days a week."])(
    "doesn't mistake %j for a duration",
    (description) => {
      expect(findProductDuration(product("Trip", description))).toBeNull();
    }
  );

  it("lists what's included in plain words", () => {
    expect(findProductInclusions(goldCoast[0])).toBe("morning tea and expert commentary");
    expect(findProductInclusions(product("Trip", "Price includes lunch, snorkel gear and the Great Barrier Reef levy."))).toBe(
      "lunch, snorkel gear and the Great Barrier Reef levy"
    );
    expect(findProductInclusions(product("Trip", "Sunset cruise on the Broadwater."))).toBeNull();
  });
});

describe("pickProductForOccasion", () => {
  it("picks the twilight dining cruise for a couple, with the reason from its own details", () => {
    const pick = pickProductForOccasion("what do you recommend for a couple?", goldCoast);

    expect(pick?.product.title).toBe("Broadwater Twilight Dining");
    expect(pick?.reason).toBe("it's out on the water around sunset");
  });

  it("never picks an adults-only trip for a family", () => {
    const pick = pickProductForOccasion("what's best for my wife and the kids?", goldCoast);

    expect(pick?.occasion).toBe("a family");
    expect(pick?.product.title).toBe("Gold Coast Whale Escape");
  });

  it("picks the private charter for a group celebration", () => {
    expect(pickProductForOccasion("ideas for my 40th birthday with friends?", goldCoast)?.product.title).toBe("Private Yacht Charter");
  });

  it("doesn't pick when nothing clearly fits, or there's nothing to choose between", () => {
    expect(pickProductForOccasion("what do you recommend?", goldCoast)).toBeNull();
    expect(
      pickProductForOccasion("for a couple?", [product("Morning Reef", "Snorkel trip"), product("Afternoon Reef", "Snorkel trip")])
    ).toBeNull();
    expect(pickProductForOccasion("for a couple?", [goldCoast[1]])).toBeNull();
  });
});

describe("asksForSuggestion", () => {
  it.each(["which one's best for us?", "what's good for a couple?", "what would you recommend?", "which trip should we book?"])(
    "reads %j as asking Kai to choose",
    (message) => {
      expect(asksForSuggestion(message)).toBe(true);
    }
  );

  it.each(["how long is the whale escape?", "we're a couple from Brisbane"])("doesn't read %j that way", (message) => {
    expect(asksForSuggestion(message)).toBe(false);
  });
});
