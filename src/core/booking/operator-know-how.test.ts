import { describe, expect, it } from "vitest";
import { findOperatorKnowHowReply } from "./operator-know-how";
import type { PmsProduct } from "@/core/pms/types";
import { findKaiHouseRuleBreaches, findKaiStyleBreaches } from "@/core/llm/kai-persona";

const goldCoast: PmsProduct[] = [
  { externalProductId: "whale", title: "Gold Coast Whale Escape", description: "Whale watching cruise", bookingMode: "AUTO_BOOKING" },
  { externalProductId: "drift", title: "Twilight Drift", description: "Sunset cruise on the Broadwater", bookingMode: "AUTO_BOOKING" }
];
const komodo: PmsProduct[] = [
  { externalProductId: "k1", title: "3 Day Komodo Liveaboard", description: "From Labuan Bajo", bookingMode: "MANUAL_INQUIRY" }
];
const nowhere: PmsProduct[] = [
  { externalProductId: "x1", title: "Sunset Cruise", description: "Two hours on the water", bookingMode: "AUTO_BOOKING" }
];

function ask(message: string, catalogue: PmsProduct[] = goldCoast, extra: { productTitle?: string; dateKnown?: boolean } = {}) {
  return findOperatorKnowHowReply({
    message,
    tenantName: "Boattime Yacht Charters (Rezdy pilot)",
    loadCatalogue: async () => catalogue,
    ...extra
  });
}

describe("findOperatorKnowHowReply", () => {
  // Reported live on bluepass.co, 2026-10-03: "How much commission do you take?" got the trip-price
  // line ("Prices depend on the trip and the date...") because the price pattern matched "how much".
  it("answers a commission question about the booking site, not as a trip price", async () => {
    for (const question of [
      "How much commission do you take?",
      "what's your cut?",
      "do you charge a booking fee?",
      "how do you make money?"
    ]) {
      const answer = await ask(question);

      expect(answer?.topic, question).toBe("FEES");
      expect(answer?.reply, question).toContain("operator's own price");
      expect(answer?.reply, question).toContain("never added to your fare");
      expect(answer?.reply, question).not.toMatch(/\d\s*%/);
      expect(findKaiStyleBreaches(answer!.reply), question).toEqual([]);
      expect(findKaiHouseRuleBreaches(answer!.reply), question).toEqual([]);
    }
  });

  it("still treats real trip price questions as price questions", async () => {
    expect((await ask("how much is the whale one?"))?.topic).toBe("PRICE");
    expect((await ask("what does it cost per person?"))?.topic).toBe("PRICE");
  });

  it("gives seasickness tips and points to the crew, not 'the operator'", async () => {
    const answer = await ask("will I get seasick?");

    expect(answer?.topic).toBe("SEASICKNESS");
    expect(answer?.reply).toContain("The crew can tell you how the water's looking closer to the day.");
  });

  it("knows the Gold Coast isn't box jellyfish country", async () => {
    const answer = await ask("are there stingers this time of year?");

    expect(answer?.reply).toContain("rarely an issue on the Gold Coast");
    expect(answer?.reply).toContain("Bluebottles");
  });

  it("answers stingers for Indonesia from an Indonesian operator's trips", async () => {
    expect((await ask("any stingers?", komodo))?.reply).toContain("Indonesia doesn't have a set stinger season");
  });

  it("gives the Indonesian visa answer to an Indonesian operator's travellers", async () => {
    expect((await ask("do I need a visa?", komodo))?.reply).toContain("e-Visa on Arrival");
  });

  it("stays quiet on stingers and visas when it can't tell where the operator runs", async () => {
    expect(await ask("any stingers?", nowhere)).toBeNull();
    expect(await ask("do I need a visa?", nowhere)).toBeNull();
  });

  it("knows when to go in the operator's own waters", async () => {
    const answer = await ask("what's the best time of year to see whales?");

    expect(answer?.topic).toBe("SEASON");
    expect(answer?.reply.startsWith("Whale season on the Gold Coast runs roughly June to November")).toBe(true);
  });

  it("doesn't change the subject to a season somewhere else", async () => {
    expect(await ask("when's the best time to see Komodo?")).toBeNull();
    expect(await ask("what's the best time of year to go?", nowhere)).toBeNull();
  });

  it("offers to pull up real times and prices instead of guessing", async () => {
    expect((await ask("what time does it leave?", goldCoast, { productTitle: "Twilight Drift" }))?.reply).toBe(
      "Times can change from day to day, so tell me your date and I'll pull up the times for Twilight Drift."
    );
    expect((await ask("how much is the whale one?"))?.reply).toBe(
      "I can get you the exact price for Gold Coast Whale Escape. Tell me your date and how many of you, and I'll check it."
    );
    expect((await ask("what are your prices?"))?.reply).toBe(
      "Prices depend on the trip and the date, so tell me which one you're keen on and when, and I'll check it for you."
    );
  });

  it("leaves times and prices to the booking flow once a date is known", async () => {
    expect(await ask("how much is it?", goldCoast, { productTitle: "Twilight Drift", dateKnown: true })).toBeNull();
  });

  it.each(["is it good for kids?", "can I bring my dog?", "where do you leave from?", "is the food first-rate?", "we love whales"])(
    "leaves %j to the operator's own answers or the team",
    async (message) => {
      expect(await ask(message)).toBeNull();
    }
  );

  it("keeps every answer in Kai's voice", async () => {
    const questions = [
      "will I get seasick?",
      "are there stingers?",
      "do I need travel insurance?",
      "what's the best time of year to see whales?",
      "what time does the twilight drift leave?",
      "how much is the whale one?",
      "what are your prices?",
      "what time do you go out?"
    ];

    for (const question of questions) {
      const answer = await ask(question);
      expect(answer, question).not.toBeNull();
      expect(findKaiStyleBreaches(answer!.reply), answer!.reply).toEqual([]);
      expect(findKaiHouseRuleBreaches(answer!.reply), answer!.reply).toEqual([]);
    }
  });

  describe("trip details", () => {
    const detailed: PmsProduct[] = [
      {
        externalProductId: "whale",
        title: "Gold Coast Whale Escape",
        description: "<p>Join us for a 3 hour whale watching cruise.</p><p>Includes:</p><ul><li>Morning tea</li><li>Expert commentary</li></ul>",
        bookingMode: "AUTO_BOOKING"
      },
      { externalProductId: "drift", title: "Twilight Drift", description: "Sunset cruise on the Broadwater", bookingMode: "AUTO_BOOKING" }
    ];

    it("answers how long a trip runs from the operator's own details", async () => {
      expect((await ask("how long is the whale escape?", detailed))?.reply).toBe(
        "Going by the crew's trip details, the Gold Coast Whale Escape runs for about 3 hours. Want me to check a date for you?"
      );
    });

    it("says so when the details don't cover it, rather than guessing", async () => {
      expect((await ask("how long is it?", detailed, { productTitle: "Twilight Drift" }))?.reply).toContain(
        "don't say how long it runs, so I won't guess"
      );
    });

    it("answers what's included, and whether a specific thing is", async () => {
      expect((await ask("what's included in the whale escape?", detailed))?.reply).toContain(
        "includes morning tea and expert commentary"
      );
      expect((await ask("is morning tea included on the whale escape?", detailed))?.reply.startsWith("Yes, going by the crew's trip details")).toBe(
        true
      );
      expect((await ask("is lunch included on the whale escape?", detailed))?.reply).toContain("but lunch isn't mentioned, so I won't guess");
    });

    it("asks which trip when it isn't clear", async () => {
      expect((await ask("how long does it go for?", detailed))?.reply).toBe(
        "Happy to check. Which trip do you mean: Gold Coast Whale Escape or Twilight Drift?"
      );
    });

    it("leaves questions the details can't answer to the team", async () => {
      expect(await ask("does the price include gst?", detailed)).toBeNull();
    });
  });
});
