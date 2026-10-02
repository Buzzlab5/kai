import { describe, expect, it } from "vitest";
import { findBookingSmallTalkReply, isOfferQuestion, isQuestionShaped } from "./booking-small-talk";
import { findKaiStyleBreaches } from "@/core/llm/kai-persona";

describe("findBookingSmallTalkReply", () => {
  it.each(["hi", "Hey there!", "g'day", "Good morning Kai", "hello."])("greets %j back", (message) => {
    expect(findBookingSmallTalkReply(message)?.kind).toBe("GREETING");
  });

  it.each(["thanks!", "Thank you so much", "ok great, thanks heaps", "cheers mate", "perfect thanks"])(
    "takes %j as thanks",
    (message) => {
      expect(findBookingSmallTalkReply(message)?.kind).toBe("THANKS");
    }
  );

  it.each(["are you a bot?", "Am I talking to a real person?", "is this AI?", "r u real? are you a human"])(
    "answers %j honestly",
    (message) => {
      expect(findBookingSmallTalkReply(message)?.kind).toBe("AI_OR_HUMAN");
    }
  );

  it("names the business and drops internal labels from its name", () => {
    expect(findBookingSmallTalkReply("are you a bot?", { tenantName: "BluePass Australia (Rezdy pilot)" })?.reply).toBe(
      "I'm Kai, the AI booking concierge for BluePass Australia, so not a person, but I'll always be straight with you. Want me to get a person from the team to jump in?"
    );
  });

  it.each([
    "can I talk to a real person?",
    "are you a bot? I want to speak to someone",
    "hi, can you check friday for 2?",
    "thanks, and what time does it leave?",
    "cool"
  ])("leaves %j to the booking flow", (message) => {
    expect(findBookingSmallTalkReply(message)).toBeNull();
  });

  it("keeps every reply in Kai's voice", () => {
    const replies = ["hi", "thanks", "are you a bot?"].flatMap((message) => [
      findBookingSmallTalkReply(message)?.reply ?? "",
      findBookingSmallTalkReply(message, { tenantName: "Boattime Yacht Charters" })?.reply ?? ""
    ]);

    for (const reply of replies) {
      expect(findKaiStyleBreaches(reply), reply).toEqual([]);
    }
  });
});

describe("isQuestionShaped", () => {
  it.each(["can I bring my dog?", "is there parking", "what time do you leave"])("treats %j as a question", (message) => {
    expect(isQuestionShaped(message)).toBe(true);
  });

  it.each(["cool", "I love boats", "sounds good"])("doesn't treat %j as a question", (message) => {
    expect(isQuestionShaped(message)).toBe(false);
  });
});

describe("isOfferQuestion", () => {
  it.each(["do you do the twilight drift?", "Do you guys run whale watching", "is the sunset cruise still running?"])(
    "reads %j as asking whether it's on offer",
    (message) => {
      expect(isOfferQuestion(message)).toBe(true);
    }
  );

  it.each(["how long is the twilight drift?", "what do you recommend?"])("doesn't read %j that way", (message) => {
    expect(isOfferQuestion(message)).toBe(false);
  });
});
