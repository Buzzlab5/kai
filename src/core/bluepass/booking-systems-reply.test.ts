import { describe, expect, it } from "vitest";
import { buildBluePassBookingSystemsReply, buildBluePassMissingFieldsReply, isBluePassBookingSystemQuestion } from "./reply";
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
