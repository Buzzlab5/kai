import { describe, expect, it } from "vitest";
import { updateBookingMemoryState, type BookingMemoryState } from "./booking-memory";
import { handleTravellerBookingMessage, type BookingOrchestratorResult } from "./booking-orchestrator";
import type { PmsAdapter, PmsAvailabilityRequest, PmsAvailabilityResult, PmsProduct } from "@/core/pms/types";
import { findKaiHouseRuleBreaches, findKaiStyleBreaches } from "@/core/llm/kai-persona";

const boattimeProducts: PmsProduct[] = [
  {
    externalProductId: "boattime-whale-escape",
    title: "Gold Coast Whale Escape",
    description: "Luxury whale watching cruise",
    bookingMode: "AUTO_BOOKING",
    productUrl: "http://localhost:3107/demo/boattime#gold-coast-whale-escape"
  },
  {
    externalProductId: "boattime-twilight-drift",
    title: "Twilight Drift",
    description: "Sunset cruise experience",
    bookingMode: "AUTO_BOOKING",
    productUrl: "http://localhost:3107/demo/boattime#twilight-drift"
  },
  {
    externalProductId: "boattime-broadwater-twilight-dining",
    title: "Broadwater Twilight Dining",
    description: "Twilight dining cruise",
    bookingMode: "AUTO_BOOKING",
    productUrl: "http://localhost:3107/demo/boattime#broadwater-twilight-dining"
  },
  {
    externalProductId: "boattime-coastal-lunch-escape",
    title: "Coastal Lunch Escape",
    description: "Lunch cruise package",
    bookingMode: "AUTO_BOOKING",
    productUrl: "http://localhost:3107/demo/boattime#coastal-lunch-escape"
  },
  {
    externalProductId: "boattime-private-yacht-charter",
    title: "Private Yacht Charter",
    description: "Private yacht charter",
    bookingMode: "MANUAL_INQUIRY",
    productUrl: "http://localhost:3107/demo/boattime#private-yacht-charter"
  }
];

function boattimeAvailability(input: PmsAvailabilityRequest): PmsAvailabilityResult {
  if (input.productId === "boattime-whale-escape") {
    return {
      productId: input.productId,
      date: input.date,
      available: true,
      remaining: 78,
      currency: "AUD",
      unitPriceCents: 7900,
      timeOptions: [
        { label: "9:00 AM", startTimeLocal: `${input.date} 09:00:00`, remaining: 78 },
        { label: "12:00 PM", startTimeLocal: `${input.date} 12:00:00`, remaining: 75 },
        { label: "1:30 PM", startTimeLocal: `${input.date} 13:30:00`, remaining: 75 }
      ],
      ticketOptions: [
        { label: "Family (2A +2C) 3-13", unitPriceCents: 24900 },
        { label: '"2 people for $149.00', unitPriceCents: 14900 },
        { label: "Child (3-13)", unitPriceCents: 5900 },
        { label: "Infant (under 3)", unitPriceCents: 0 },
        { label: "Adult (Winter Special)", unitPriceCents: 7900 }
      ],
      extraOptions: [
        { label: "Corona Bucket", unitPriceCents: 3000 },
        { label: "Sparkling for 2", unitPriceCents: 4000 }
      ]
    };
  }

  if (input.productId === "boattime-twilight-drift") {
    return {
      productId: input.productId,
      date: input.date,
      available: true,
      remaining: 16,
      currency: "AUD",
      unitPriceCents: 7900,
      timeOptions: [{ label: "5:30 PM", startTimeLocal: `${input.date} 17:30:00`, remaining: 16 }],
      ticketOptions: [{ label: "Adult", unitPriceCents: 7900 }]
    };
  }

  return {
    productId: input.productId,
    date: input.date,
    available: true,
    remaining: 12,
    currency: "AUD",
    unitPriceCents: 9900
  };
}

function createBoattimeEvalAdapter(): PmsAdapter {
  return {
    provider: "MOCK",
    listProducts: async () => boattimeProducts,
    getAvailability: async (input) => boattimeAvailability(input),
    createBooking: async () => {
      throw new Error("Conversation evals should not create PMS bookings.");
    },
    cancelBooking: async () => ({ cancelled: false }),
    getBooking: async () => null
  };
}

// Fixed reference "now" (well before June) so hardcoded "2026-06-*" expectations in these evals stay
// deterministic regardless of the real wall-clock date the suite runs on - see resolveDefaultYear in
// booking-brain.ts.
const REFERENCE_NOW = new Date("2026-01-01T00:00:00Z");

async function runConversation(messages: string[]) {
  const pmsAdapter = createBoattimeEvalAdapter();
  let memory: BookingMemoryState | null = null;
  const priorTravellerMessages: string[] = [];
  const conversationHistory: Array<{ role: "traveller" | "assistant"; content: string }> = [];
  const turns: BookingOrchestratorResult[] = [];
  const products = await pmsAdapter.listProducts();

  for (const message of messages) {
    const bookingMemory = updateBookingMemoryState({
      previousState: memory,
      message,
      products
    });
    const result = await handleTravellerBookingMessage({
      message,
      priorTravellerMessages: [...priorTravellerMessages],
      conversationHistory: [...conversationHistory, { role: "traveller", content: message }],
      bookingMemory,
      pmsAdapter,
      bookingWriteEnabled: true,
      now: REFERENCE_NOW
    });

    turns.push(result);
    memory = result.bookingStatePatch ?? bookingMemory;
    priorTravellerMessages.push(message);
    conversationHistory.push({ role: "traveller", content: message });
    conversationHistory.push({ role: "assistant", content: result.reply });
  }

  return { turns, memory };
}

describe("booking conversation evals", () => {
  it("keeps product-switch intent grounded in the latest traveller message", async () => {
    const { turns } = await runConversation([
      "can you give me recommendation?",
      "info on gold coast whale escape",
      "what about twilight drift?"
    ]);

    expect(turns[0]).toMatchObject({ action: "PRODUCT_RECOMMENDATION" });
    expect(turns[1]).toMatchObject({ action: "PRODUCT_LINK" });
    expect(turns[1].reply).toContain("Gold Coast Whale Escape");
    expect(turns[2]).toMatchObject({ action: "PRODUCT_LINK" });
    expect(turns[2].reply).toContain("Twilight Drift");
    expect(turns[2].reply).not.toContain("Gold Coast Whale Escape is");
  });

  it("lets the traveller switch products and continue availability in the same message", async () => {
    const { turns, memory } = await runConversation([
      "info on gold coast whale escape",
      "actually twilight drift for 2 people on 28 june"
    ]);

    expect(turns.map((turn) => turn.action)).toEqual(["PRODUCT_LINK", "AVAILABILITY_CHECKED"]);
    expect(turns[1].reply).toContain("Twilight Drift");
    expect(turns[1].reply).toContain("2 guests");
    expect(turns[1].reply).toContain("Sunday 28 June 2026");
    expect(turns[1].reply).not.toContain("Gold Coast Whale Escape is available");
    // dateText now carries Twilight Drift's own single available time slot (17:30), not just the
    // plain date the traveller typed - this AVAILABILITY_CHECKED turn now persists a
    // bookingStatePatch (see booking-orchestrator.ts's captureAppliesToKnownProduct guard) so a
    // later capture-intent turn can tell a real availability check already happened here, instead
    // of silently discarding that evidence as it used to.
    expect(memory).toMatchObject({
      productTitle: "Twilight Drift",
      dateText: "2026-06-28 17:30:00",
      guests: 2
    });
  });

  it("moves a messy traveller from product browsing to secure payment without losing state", async () => {
    const { turns, memory } = await runConversation([
      "info on gold coast whale escape please",
      "28june, 3 people",
      "1:30 please",
      "option 5 x3",
      "no extras thanks",
      "David Samantha",
      "david@example.com 0412 345 678"
    ]);

    expect(turns.map((turn) => turn.action)).toEqual([
      "PRODUCT_LINK",
      "BOOKING_TIME_SELECTION_REQUIRED",
      "BOOKING_TICKET_SELECTION_REQUIRED",
      "BOOKING_EXTRAS_SELECTION_REQUIRED",
      "BOOKING_DETAILS_REQUIRED",
      "BOOKING_DETAILS_REQUIRED",
      "BOOKING_PAYMENT_REQUIRED"
    ]);
    expect(memory).toMatchObject({
      productTitle: "Gold Coast Whale Escape",
      dateText: "2026-06-28 13:30:00",
      guests: 3,
      travellerName: "David Samantha",
      travellerEmail: "david@example.com",
      travellerPhone: "0412 345 678",
      bookingStatus: "PAYMENT_PENDING"
    });
  });

  it("keeps manual-charter products out of instant booking", async () => {
    const { turns } = await runConversation(["i want private yacht charter for 20 people on 28 june"]);

    expect(turns[0]).toMatchObject({ action: "MANUAL_INQUIRY_REQUIRED" });
    expect(turns[0].reply).toContain("nothing's booked until they confirm");
  });

  it("understands a numbered product choice after showing recommendations", async () => {
    const { turns } = await runConversation(["can you give me recommendation?", "1"]);

    expect(turns.map((turn) => turn.action)).toEqual(["PRODUCT_RECOMMENDATION", "PRODUCT_LINK"]);
    expect(turns[1].reply).toContain("Gold Coast Whale Escape");
    expect(turns[1].reply).not.toContain("You can choose from");
  });

  it("sounds like Kai at every step of a real booking", async () => {
    const conversations = [
      [
        "info on gold coast whale escape please",
        "28june, 3 people",
        "1:30 please",
        "option 5 x3",
        "no extras thanks",
        "David Samantha",
        "david@example.com 0412 345 678"
      ],
      ["can you give me recommendation?", "info on gold coast whale escape", "what about twilight drift?"],
      ["info on gold coast whale escape", "actually twilight drift for 2 people on 28 june"],
      ["i want private yacht charter for 20 people on 28 june"],
      ["can you give me recommendation?", "1"],
      [
        "hi",
        "are you a bot?",
        "do you do the twilight drift?",
        "do you do the reef day snorkel?",
        "can I bring my dog?",
        "can I talk to a real person?",
        "thanks heaps"
      ],
      [
        "will I get seasick?",
        "are there stingers this time of year?",
        "what's the best time of year to see whales?",
        "how much is the twilight drift?",
        "what time does it leave?"
      ],
      [
        "what do you recommend for a couple?",
        "what would you recommend for a family with kids?",
        "info on the twilight drift",
        "how long does it go for?",
        "what's included?"
      ],
      [
        "info on gold coast whale escape please",
        "28 june 2027, 3 of us",
        "will I get seasick?",
        "can I bring my dog?",
        "1:30 please",
        "how long is it?"
      ]
    ];

    for (const messages of conversations) {
      const { turns } = await runConversation(messages);
      for (const turn of turns) {
        expect(findKaiStyleBreaches(turn.reply), turn.reply).toEqual([]);
        expect(findKaiHouseRuleBreaches(turn.reply), turn.reply).toEqual([]);
      }
    }
  });

  it("remembers a time the traveller gave before the times were on screen", async () => {
    const { turns } = await runConversation([
      "info on gold coast whale escape please",
      "1:30 please",
      "28 june 2027, 3 of us",
      "yes"
    ]);

    expect(turns[2].action).toBe("BOOKING_TIME_SELECTION_REQUIRED");
    expect(turns[2].reply).toContain("1:30 PM is free");
    expect(turns[3].action).toBe("BOOKING_TICKET_SELECTION_REQUIRED");
    expect(turns[3].reply).toContain("at 1:30 PM for 3 guests");
  });

  it("nudges for the time instead of repeating the whole list", async () => {
    const { turns } = await runConversation([
      "info on gold coast whale escape please",
      "28 june 2027, 3 of us",
      "Maya Chen"
    ]);

    expect(turns[1].reply).toContain("Here are the available times");
    expect(turns[2].reply).toBe("I just need a time first: 9:00 AM, 12:00 PM or 1:30 PM?");
  });

  it("says plainly when the traveller names a trip this operator doesn't run", async () => {
    const { turns } = await runConversation(["can you check the komodo day trip for 2 tomorrow?"]);

    expect(turns[0].reply.startsWith("I don't have a Komodo Day Trip here, sorry.")).toBe(true);
    expect(turns[0].reply).toContain("Gold Coast Whale Escape");
  });

  it("doesn't add the apology when the named trip is on offer", async () => {
    const { turns } = await runConversation(["info on gold coast whale escape"]);

    expect(turns[0].reply).not.toContain("I don't have");
  });

  it("answers the small stuff like a person, not with the booking menu", async () => {
    const { turns } = await runConversation(["hi", "are you a bot?", "thanks heaps"]);

    expect(turns[0].reply).toBe("Hey, good to hear from you. Tell me what you're keen on, or ask me anything about the trips.");
    expect(turns[1].reply).toContain("I'm Kai, an AI booking concierge, so not a person");
    expect(turns[2].reply.startsWith("No worries at all.")).toBe(true);
    for (const turn of turns) {
      expect(turn.reply).not.toContain("I can check times and prices, book you in");
    }
  });

  it("gives a straight yes or no when asked whether a trip is on offer", async () => {
    const { turns } = await runConversation(["do you do the twilight drift?", "do you do the reef day snorkel?"]);

    expect(turns[0].reply).toBe(
      "Yes, Twilight Drift is one I can book for you. Tell me the date and how many of you, and I'll check it."
    );
    expect(turns[1].reply.startsWith("I don't have a Reef Day Snorkel here, sorry.")).toBe(true);
    expect(turns[1].reply).toContain("Twilight Drift");
  });

  it("owns up when it can't answer a question instead of changing the subject", async () => {
    const { turns } = await runConversation(["can I bring my dog?"]);

    expect(turns[0].action).toBe("GENERAL_REPLY");
    expect(turns[0].reply).toContain("so I won't guess");
    expect(turns[0].reply.endsWith("Want me to get a person from the team to jump in?")).toBe(true);
  });

  it("brings in a person when the traveller says yes to Kai's offer", async () => {
    const { turns } = await runConversation(["can I bring my dog?", "yes please"]);

    expect(turns[1].action).toBe("HUMAN_HANDOFF");
    expect(turns[1].reply).toContain("I'll get a person from the team");
  });

  it("never asks a WhatsApp traveller for the number the team already has", async () => {
    const result = await handleTravellerBookingMessage({
      message: "can I talk to a real person?",
      pmsAdapter: createBoattimeEvalAdapter(),
      channel: "whatsapp"
    });

    expect(result.reply).toBe(
      "Of course, I'll get a person from the team to jump into this chat as soon as possible, and nothing gets booked or changed in the meantime."
    );
  });

  it("still hands over when the traveller asks for a person", async () => {
    const { turns } = await runConversation(["can I talk to a real person?"]);

    expect(turns[0].action).toBe("HUMAN_HANDOFF");
    // On the web there's no number yet, so Kai asks for the best WhatsApp.
    expect(turns[0].reply).toBe(
      "Of course, I'll get a person from the team onto this as soon as possible, and nothing gets booked or changed in the meantime. What's the best WhatsApp number for them to reach you on?"
    );
  });

  it("answers what a well-travelled local would know, and gets real times and prices instead of guessing", async () => {
    const { turns } = await runConversation([
      "what's the best time of year to see whales?",
      "will I get seasick?",
      "how much is the twilight drift?",
      "what time does it leave?"
    ]);

    expect(turns[0].reply).toContain("June to November");
    expect(turns[1].reply).toContain("seasickness tablet");
    expect(turns[2].reply).toBe(
      "I can get you the exact price for Twilight Drift. Tell me your date and how many of you, and I'll check it."
    );
    expect(turns[3].reply).toContain("pull up the times for Twilight Drift");
    for (const turn of turns) {
      expect(turn.reply).not.toContain("I won't guess");
    }
  });

  it("picks a trip for a couple and says why, even after the full list was shown", async () => {
    const { turns } = await runConversation(["can you give me recommendation?", "what do you recommend for a couple?"]);

    expect(turns[0].reply).toContain("You can choose from");
    expect(turns[1].action).toBe("PRODUCT_RECOMMENDATION");
    expect(turns[1].reply).toBe(
      "For a couple, I'd go with the Broadwater Twilight Dining: it's out on the water around sunset. Tell me your date and I'll check it, or I can run you through the others."
    );
    expect(turns[1].productCards?.[0]?.title).toBe("Broadwater Twilight Dining");
  });

  it("finds the trip from the traveller's own words when they ask for info", async () => {
    const { turns } = await runConversation(["info on the twilight drift"]);

    expect(turns[0].action).toBe("PRODUCT_LINK");
    expect(turns[0].reply.startsWith("Twilight Drift is a sunset cruise experience.")).toBe(true);
  });

  it("answers a side question mid-booking, then picks the booking back up", async () => {
    const { turns } = await runConversation([
      "info on gold coast whale escape please",
      "28 june 2027, 3 of us",
      "will I get seasick?",
      "can I bring my dog?"
    ]);
    const timeReminder = "When you're ready, just pick a time for Monday 28 June 2027: 9:00 AM, 12:00 PM or 1:30 PM.";

    expect(turns[2].reply).toContain("seasickness tablet");
    expect(turns[2].reply.endsWith(timeReminder)).toBe(true);
    // Straight after saying it, the reminder isn't repeated word for word.
    expect(turns[3].reply).toBe(
      "Good question. I don't want to give you a dud answer on that one, so I won't guess. Just ask if you'd like a person from the team to jump in."
    );
  });

  it("brings the reminder back once it's no longer the last thing Kai said", async () => {
    const { turns } = await runConversation([
      "info on gold coast whale escape please",
      "28 june 2027, 3 of us",
      "will I get seasick?",
      "can I bring my dog?",
      "is there parking at the marina?"
    ]);

    expect(turns[3].reply).not.toContain("When you're ready");
    expect(turns[4].reply.endsWith("When you're ready, just pick a time for Monday 28 June 2027: 9:00 AM, 12:00 PM or 1:30 PM.")).toBe(true);
  });

  it("never mistakes the booking step itself for a side question", async () => {
    const { turns } = await runConversation(["info on gold coast whale escape please", "28 june 2027, 3 of us", "can we do 1:30?"]);

    expect(turns[2].reply).toContain("1:30 PM");
    expect(turns[2].reply).not.toContain("won't guess");
  });

  it("tells the traveller about a trip they name on its own", async () => {
    const { turns } = await runConversation(["the twilight drift"]);

    expect(turns[0].action).toBe("PRODUCT_LINK");
    expect(turns[0].reply.startsWith("Twilight Drift is a sunset cruise experience.")).toBe(true);
  });
});
