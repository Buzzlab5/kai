import { describe, expect, it } from "vitest";
import { findTravellerFaqAnswer, listTravellerFaqAnswers } from "./traveller-faq";

const topicFor = (message: string, market?: "AUSTRALIA" | "INDONESIA") =>
  findTravellerFaqAnswer({ message, market })?.topic ?? null;

describe("findTravellerFaqAnswer", () => {
  it("recognises the practical questions travellers actually ask", () => {
    expect(topicFor("Do I need to be a certified diver?")).toBe("DIVE_CERTIFICATION");
    expect(topicFor("I've never dived, is that a problem?")).toBe("DIVE_CERTIFICATION");
    expect(topicFor("Is Komodo good for a family with young kids?")).toBe("KIDS");
    expect(topicFor("can we bring our toddler")).toBe("KIDS");
    expect(topicFor("I get seasick, will I be ok?")).toBe("SEASICKNESS");
    expect(topicFor("what about stingers in January?")).toBe("STINGERS");
    expect(topicFor("Does the boat have wifi?")).toBe("WIFI");
    expect(topicFor("what should I pack for a liveaboard?")).toBe("PACKING");
    expect(topicFor("Do I need a visa for Bali?")).toBe("VISA");
    expect(topicFor("are park fees included?")).toBe("PARK_FEES");
    expect(topicFor("what if I need to cancel?")).toBe("CANCELLATION");
    expect(topicFor("do I need travel insurance?")).toBe("INSURANCE");
    expect(topicFor("can they do gluten free meals?")).toBe("DIETARY");
    expect(topicFor("are you a real person?")).toBe("AI_OR_HUMAN");
    expect(topicFor("I want to talk to a human")).toBe("AI_OR_HUMAN");
  });

  it("lets the specific topic win over the broad kids question", () => {
    expect(topicFor("do kids need a stinger suit?")).toBe("STINGERS");
    expect(topicFor("is it ok for kids who get seasick?")).toBe("SEASICKNESS");
  });

  it("stays out of booking steps, statements and look-alike questions", () => {
    expect(topicFor("book Alila Purnama for 2 adults and 2 kids")).toBeNull();
    expect(topicFor("my kids love snorkelling")).toBeNull();
    expect(topicFor("is the boat insured?")).toBeNull();
    expect(topicFor("what's included in the package?")).toBeNull();
    expect(topicFor("show me boats in Komodo")).toBeNull();
  });

  it("answers for the right country", () => {
    expect(findTravellerFaqAnswer({ message: "any jellyfish in Komodo?" })?.answer).toContain("Indonesia");
    expect(findTravellerFaqAnswer({ message: "any stingers on the reef?", market: "AUSTRALIA" })?.answer).toContain(
      "Queensland"
    );
    expect(findTravellerFaqAnswer({ message: "do I need a visa for Australia?" })?.answer).toContain("Home Affairs");
    expect(findTravellerFaqAnswer({ message: "do I need a visa?" })?.answer).toContain("Indonesia");
  });

  it("keeps every answer short enough to read comfortably on a phone", () => {
    for (const { answer } of listTravellerFaqAnswers()) {
      expect(answer.split(/\s+/).length, answer).toBeLessThanOrEqual(50);
      expect(answer.split(/(?<=[.!?])\s+/).length, answer).toBeLessThanOrEqual(3);
    }
  });

  it("sends medical questions about diving to a doctor, and safety questions to the operator", () => {
    expect(topicFor("I have an old knee injury, can I still dive?")).toBe("DIVE_MEDICAL");
    expect(topicFor("do I need a medical certificate to dive?")).toBe("DIVE_MEDICAL");
    expect(topicFor("can I dive if I have asthma?")).toBe("DIVE_MEDICAL");
    expect(topicFor("what happens in an emergency?")).toBe("SAFETY");
    expect(topicFor("do they have life jackets?")).toBe("SAFETY");
    expect(topicFor("do I need to be certified?")).toBe("DIVE_CERTIFICATION");
  });
});

