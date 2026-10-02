import { describe, expect, it } from "vitest";
import { buildEmergencyReply, isEmergencyMessage } from "./emergency";
import { findKaiStyleBreaches } from "@/core/llm/kai-persona";

describe("isEmergencyMessage", () => {
  it.each([
    "there's been an accident on our trip and my friend is injured",
    "medical emergency on the boat, what do we do?",
    "someone's been stung by a box jellyfish",
    "my son is bleeding and the boat is still out",
    "we have a missing diver",
    "man overboard!!"
  ])("treats %j as an emergency", (message) => {
    expect(isEmergencyMessage(message)).toBe(true);
  });

  it.each([
    "what happens in an emergency?",
    "will I get stung by jellyfish?",
    "I have an old knee injury, can I still dive?",
    "does travel insurance cover accidents?",
    "do you have a first aid kit on board?",
    "is it safe for kids?"
  ])("leaves %j to the normal answers", (message) => {
    expect(isEmergencyMessage(message)).toBe(false);
  });
});

describe("buildEmergencyReply", () => {
  it("gives the right number for where they are", () => {
    expect(buildEmergencyReply("AUSTRALIA")).toContain("call 000 right now");
    expect(buildEmergencyReply("INDONESIA")).toContain("call 112 right now");
    expect(buildEmergencyReply()).toContain("call 000 in Australia or 112 in Indonesia right now");
  });

  it("is honest that Kai can't send help, and stays in Kai's voice", () => {
    for (const market of ["AUSTRALIA", "INDONESIA", undefined] as const) {
      const reply = buildEmergencyReply(market);
      expect(reply).toContain("I'm an AI concierge, so I can't send help myself.");
      expect(findKaiStyleBreaches(reply), reply).toEqual([]);
    }
  });
});
