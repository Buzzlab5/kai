import { describe, expect, it } from "vitest";
import { acceptsPersonOffer, buildHumanHandoffReply, isAskingForAPerson, PERSON_OFFER } from "./human-handoff";
import { findKaiStyleBreaches } from "@/core/llm/kai-persona";

describe("isAskingForAPerson", () => {
  it.each([
    "can I talk to a real person?",
    "I want to speak to a human",
    "get me a human",
    "can I have someone call me",
    "I'd like a person please",
    "human please",
    "can I chat with the team?"
  ])("reads %j as a request for a person", (message) => {
    expect(isAskingForAPerson(message)).toBe(true);
  });

  it.each(["are you a real person?", "are you a bot?", "can I talk to other operators?", "who's the person running the boat?"])(
    "doesn't read %j as one",
    (message) => {
      expect(isAskingForAPerson(message)).toBe(false);
    }
  );
});

describe("acceptsPersonOffer", () => {
  it("takes a plain yes straight after Kai's offer as a request for a person", () => {
    expect(acceptsPersonOffer("yes please", `I won't guess. ${PERSON_OFFER}`)).toBe(true);
    expect(acceptsPersonOffer("sure", PERSON_OFFER)).toBe(true);
  });

  it("ignores a yes to anything else", () => {
    expect(acceptsPersonOffer("yes please", "Want me to send it now?")).toBe(false);
    expect(acceptsPersonOffer("yes, and can you check friday?", PERSON_OFFER)).toBe(false);
  });
});

describe("buildHumanHandoffReply", () => {
  it("never asks a WhatsApp traveller for their number", () => {
    const reply = buildHumanHandoffReply({ channel: "whatsapp", team: "the BluePass team" });

    expect(reply).toBe("Of course, I'll get a person from the BluePass team to jump into this chat as soon as possible.");
    expect(reply).not.toMatch(/number|email/i);
  });

  it("asks a web visitor for their best WhatsApp, since there's no number yet", () => {
    expect(buildHumanHandoffReply({ channel: "web" })).toBe(
      "Of course, I'll get a person from the team onto this as soon as possible. What's the best WhatsApp number for them to reach you on?"
    );
  });

  it("stays in Kai's voice in every form", () => {
    for (const channel of ["whatsapp", "web"] as const) {
      for (const options of [{}, { escalation: true }, { nothingChanges: true }]) {
        const reply = buildHumanHandoffReply({ channel, ...options });
        expect(findKaiStyleBreaches(reply), reply).toEqual([]);
      }
    }
  });
});
