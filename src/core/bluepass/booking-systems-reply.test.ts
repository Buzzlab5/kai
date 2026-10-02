import { describe, expect, it } from "vitest";
import {
  buildBluePassBookingSystemsReply,
  buildBluePassMissingFieldsReply,
  buildBluePassPricePromiseReply,
  isBluePassBookingSystemQuestion,
  isBluePassPricePromiseRequest
} from "./reply";
import { findKaiHouseRuleBreaches, findKaiStyleBreaches } from "@/core/llm/kai-persona";

describe("booking systems question", () => {
  it("recognises questions about which booking systems BluePass connects to", () => {
    for (const question of [
      "Which booking systems do you connect to?",
      "do you integrate with Rezdy?",
      "Does Bluepass work with Bokun?",
      "what booking software do you support?"
    ]) {
      expect(isBluePassBookingSystemQuestion(question), question).toBe(true);
    }
  });

  it("leaves ordinary trip and person questions alone", () => {
    for (const message of [
      "I booked with Rezdy last year, what trips do you have?",
      "Can I connect with a person?",
      "Is the whale trip on Rezdy?",
      "I want to book a trip in Komodo"
    ]) {
      expect(isBluePassBookingSystemQuestion(message), message).toBe(false);
    }
  });

  it("only names systems BluePass has a connector for, in Kai's voice", () => {
    const reply = buildBluePassBookingSystemsReply();

    expect(reply).toContain("Rezdy");
    expect(reply).toContain("FareHarbor");
    expect(reply).toContain("Inseanq");
    expect(reply).not.toMatch(/Peek ?Pro|B[oó]kun|Bookeo|Rezgo|Checkfront/i);
    expect(findKaiStyleBreaches(reply)).toEqual([]);
    expect(findKaiHouseRuleBreaches(reply)).toEqual([]);
  });
});

describe("missing fields ask", () => {
  it("does not repeat its own last message word for word", () => {
    const first = buildBluePassMissingFieldsReply({ destination: "Komodo", missingFields: ["dateWindow"] });
    const second = buildBluePassMissingFieldsReply({ destination: "Komodo", missingFields: ["dateWindow"], previousReply: first });

    expect(second).not.toBe(first);
    expect(second).toContain("send them through");
    expect(findKaiStyleBreaches(second)).toEqual([]);
    expect(findKaiHouseRuleBreaches(second)).toEqual([]);
  });

  it("keeps the normal ask when the last message was something else", () => {
    const reply = buildBluePassMissingFieldsReply({ destination: "Komodo", missingFields: ["dateWindow"], previousReply: "Hey, good to hear from you." });

    expect(reply).toContain("Happy to get this moving for Komodo");
  });
});

describe("price promise request", () => {
  it("recognises asks for a lowest-price promise or a price match", () => {
    for (const message of [
      "Can you promise me the lowest price and price match?",
      "do you price match?",
      "will you beat another site's price",
      "can you guarantee the cheapest price"
    ]) {
      expect(isBluePassPricePromiseRequest(message), message).toBe(true);
    }
  });

  it("leaves ordinary price questions alone", () => {
    for (const message of ["what's the cheapest price for Komodo?", "is there a best price for June?", "how much is it", "it's too expensive for me"]) {
      expect(isBluePassPricePromiseRequest(message), message).toBe(false);
    }
  });

  it("refuses the promise and says what is true, in Kai's voice", () => {
    const reply = buildBluePassPricePromiseReply();

    expect(reply).toContain("can't promise");
    expect(reply).toContain("operator's own price");
    expect(reply).not.toMatch(/\d\s*%/);
    expect(findKaiStyleBreaches(reply)).toEqual([]);
    expect(findKaiHouseRuleBreaches(reply)).toEqual([]);
  });
});
