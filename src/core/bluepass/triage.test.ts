import { describe, expect, it } from "vitest";
import {
  buildBluePassOperatorReply,
  buildBluePassPartnerReply,
  buildBluePassTriageGreeting,
  classifyBluePassPersona,
  shouldSendBluePassTriageGreeting
} from "./triage";

describe("classifyBluePassPersona", () => {
  it("classifies an operator from a first-person business message", () => {
    expect(classifyBluePassPersona(["Hi, I run a dive resort in Raja Ampat and want to list my boats"])).toBe(
      "OPERATOR"
    );
    expect(classifyBluePassPersona(["We operate three liveaboards out of Labuan Bajo"])).toBe("OPERATOR");
    expect(classifyBluePassPersona(["How do I claim my page? You emailed us"])).toBe("OPERATOR");
  });

  it("classifies a partner from identity nouns even with operator-style verbs", () => {
    expect(classifyBluePassPersona(["I run a dive shop in Sydney and send divers to Indonesia"])).toBe("PARTNER");
    expect(classifyBluePassPersona(["I'm a travel agent looking at your partner program"])).toBe("PARTNER");
    expect(classifyBluePassPersona(["I want to book for clients, a group of 12"])).toBe("PARTNER");
    expect(classifyBluePassPersona(["How do commissions work?"])).toBe("PARTNER");
  });

  it("classifies a traveller from trip language", () => {
    expect(classifyBluePassPersona(["My wife and I want mantas in Komodo in March"])).toBe("TRAVELLER");
    expect(classifyBluePassPersona(["Looking at a liveaboard cabin for two"])).toBe("TRAVELLER");
  });

  it("never mistakes a romantic partner or a referral code for a business partner", () => {
    expect(classifyBluePassPersona(["My partner and I want to dive Komodo"])).toBe("TRAVELLER");
    expect(classifyBluePassPersona(["I have referral code BP123 and want a Komodo trip"])).toBe("TRAVELLER");
  });

  it("keeps the persona sticky across vague follow-ups", () => {
    expect(classifyBluePassPersona(["I run a dive resort in Bali", "ok tell me more"])).toBe("OPERATOR");
    expect(classifyBluePassPersona(["I'm a travel agent", "sounds good"])).toBe("PARTNER");
  });

  it("locks the track to the first concrete signal — later cross-vertical keywords don't hijack", () => {
    // Traveller who later mentions a partner word stays a traveller.
    expect(classifyBluePassPersona(["I want to dive Komodo", "any referral commission if I bring friends?"])).toBe(
      "TRAVELLER",
    );
    // Operator who later says "Komodo" stays an operator.
    expect(classifyBluePassPersona(["I run a liveaboard", "we sail Komodo mostly"])).toBe("OPERATOR");
    // Partner who later asks a trip question stays a partner.
    expect(classifyBluePassPersona(["I'm a travel agent", "what's the best Komodo boat?"])).toBe("PARTNER");
  });

  it("keeps every branch reply concise (WhatsApp-friendly length)", () => {
    const CEIL = 320;
    const opMsgs = [
      "how does the 18% break down", "what do we get", "we're outside indonesia",
      "we're in indonesia", "how long until approved", "do i need a license",
      "how do payouts work", "send me the claim link", "ok", "i run a liveaboard",
      "saya punya kapal di komodo", "there was an injury",
    ];
    const partnerMsgs = [
      "how do i get paid", "how do commissions work", "what's in the catalogue",
      "founding terms", "conservation impact", "send me my claim link",
      "book for a client now", "just starting with a small audience", "komodo",
      "raja ampat", "hello there", "my client wants to file a complaint",
    ];
    for (const pitched of [false, true]) {
      for (const m of opMsgs) {
        expect(buildBluePassOperatorReply({ latestMessage: m, pitched }).reply.length).toBeLessThanOrEqual(CEIL);
      }
      for (const m of partnerMsgs) {
        expect(buildBluePassPartnerReply({ latestMessage: m, pitched }).reply.length).toBeLessThanOrEqual(CEIL);
      }
    }
  });

  it("returns UNKNOWN for a bare greeting", () => {
    expect(classifyBluePassPersona(["hello"])).toBe("UNKNOWN");
    expect(classifyBluePassPersona([])).toBe("UNKNOWN");
  });
});

describe("shouldSendBluePassTriageGreeting", () => {
  it("greets when there is no persona and no trip signal", () => {
    expect(
      shouldSendBluePassTriageGreeting({
        persona: "UNKNOWN",
        missingFields: ["destination", "dateWindow", "guests", "travellerName", "travellerEmail", "travellerPhone"],
        hasIntentSignal: false
      })
    ).toBe(true);
  });

  it("stays quiet once any trip signal exists", () => {
    expect(
      shouldSendBluePassTriageGreeting({
        persona: "UNKNOWN",
        missingFields: ["dateWindow", "guests", "travellerName", "travellerEmail", "travellerPhone"],
        hasIntentSignal: true
      })
    ).toBe(false);
  });

  it("offers the three verticals in the greeting", () => {
    const greeting = buildBluePassTriageGreeting();

    expect(greeting).toContain("planning a trip");
    expect(greeting).toContain("run boats or dive trips");
    expect(greeting).toContain("book and refer for clients");
  });
});

describe("buildBluePassOperatorReply", () => {
  it("opens with the honest economics pitch", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "I run a dive resort in Raja Ampat", pitched: false });

    expect(result.reply).toContain("82%");
    expect(result.reply).toContain("never marked up");
    expect(result.reply).toContain("5% conservation");
  });

  it("itemises the 18% when asked", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "How does the 18% break down?", pitched: true });

    expect(result.reply).toContain("5%");
    expect(result.reply).toContain("3%");
    expect(result.reply).toContain("82%");
    expect(result.reply).toContain("no listing fees");
  });

  it("routes Indonesian operators to the pre-built claim path", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "We're in Indonesia", pitched: true });

    expect(result.reply).toContain("pre-built");
    expect(result.reply).toContain("claim link");
  });

  it("is honest with operators outside Indonesia", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "We're outside Indonesia, in Fiji", pitched: true });

    expect(result.reply).toContain("Indonesia-first");
    expect(result.reply).toContain("expansion list");
  });

  it("never promises approval when explaining vetting", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "How does vetting work?", pitched: true });

    expect(result.reply).toContain("Green Fins");
    expect(result.reply).toContain("won't promise");
  });

  it("greets an Indonesian operator in Bahasa with the honest numbers", () => {
    expect(classifyBluePassPersona(["saya punya kapal, ingin daftar"])).toBe("OPERATOR");
    const result = buildBluePassOperatorReply({ latestMessage: "saya punya kapal di Komodo", pitched: false });
    expect(result.reply).toContain("82%");
    expect(result.reply).toMatch(/menyimpan|perairan|dibatasi/);
  });

  it("gives an honest no-timeline answer to approval-speed questions", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "how long until I'm approved?", pitched: true });
    expect(result.reply).toContain("team");
    expect(result.reply).not.toMatch(/\d+\s*(day|week|hour)/i);
  });

  it("routes license/certification questions to the vetting answer", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "do I need a license to join?", pitched: true });
    expect(result.reply).toContain("Green Fins");
  });

  it("hands payout and contract questions to humans", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "How do payouts work?", pitched: true });

    expect(result.reply).toContain("team");
    expect(result.reply).not.toContain("82%");
  });

  it("hands safety/medical/legal topics to a human in both playbooks", () => {
    expect(buildBluePassOperatorReply({ latestMessage: "a guest had an injury last week", pitched: true }).reply).toContain("human");
    expect(buildBluePassPartnerReply({ latestMessage: "my client wants to file a complaint", pitched: true }).reply).toContain("human");
  });

  it("nudges for lead details instead of repeating the pitch", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "ok", pitched: true });

    expect(result.reply).toContain("company name");
    expect(result.reply).not.toContain("82%");
  });
});

describe("buildBluePassPartnerReply", () => {
  it("opens with the zero-markup commission pitch", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "I'm a travel agent", pitched: false });

    expect(result.reply).toContain("tracked link");
    expect(result.reply).toContain("never marked up");
    expect(result.reply).toContain("operator's side");
  });

  it("explains the commission mechanism without inventing a percentage", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "How do commissions work?", pitched: true });

    expect(result.reply).toContain("operator's own rate");
    expect(result.reply).toContain("founding");
    expect(result.reply).not.toMatch(/\byour commission is \d+%/i);
  });

  it("explains partner payout mechanism and hands terms to the team", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "how do I get paid?", pitched: true });
    expect(result.reply).toContain("operator");
    expect(result.reply).toContain("team");
  });

  it("reassures a creator with no clients yet and stays on the partner track", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "I'm just starting out with a small audience", pitched: true });
    expect(result.reply.toLowerCase()).toContain("creator");
    expect(result.reply.toLowerCase()).toMatch(/email|handle/);
  });

  it("shows catalog cards for the catalogue branch", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "What's in the catalogue?", pitched: true });

    expect(result.showCatalog).toBe(true);
    expect(result.reply).toContain("Komodo and Raja Ampat");
  });

  it("answers a partner regions question honestly (Indonesia-first, two live)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "which destinations do you cover?", pitched: true });
    expect(result.reply).toMatch(/Indonesia/i);
    expect(result.reply).toContain("Raja Ampat");
  });

  it("routes a destination brief to book-on-behalf with destination cards", () => {
    const komodo = buildBluePassPartnerReply({ latestMessage: "Komodo for my clients", pitched: true });
    const raja = buildBluePassPartnerReply({ latestMessage: "Raja Ampat instead", pitched: true });

    expect(komodo.showCatalog).toBe(true);
    expect(komodo.catalogDestination).toBe("Komodo");
    expect(raja.catalogDestination).toBe("Raja Ampat");
  });

  it("keeps conservation and commission replies pointing to a same-track next step", () => {
    expect(buildBluePassPartnerReply({ latestMessage: "tell me about conservation", pitched: true }).reply).toMatch(/\?|claim link/);
    expect(buildBluePassPartnerReply({ latestMessage: "how do commissions work?", pitched: true }).reply.toLowerCase()).toContain("email");
  });

  it("keeps conservation impact ahead of the commission keyword match", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "Tell me about the 5% conservation impact", pitched: true });

    expect(result.reply).toContain("conservation");
    expect(result.reply).toContain("co-brand");
  });

  it("nudges for lead details instead of repeating the pitch", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "ok", pitched: true });

    expect(result.reply).toContain("claim link");
    expect(result.reply).not.toContain("tracked link and a catalogue");
  });
});
