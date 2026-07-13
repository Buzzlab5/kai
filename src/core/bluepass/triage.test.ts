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

  it("answers page/dashboard questions with the what-you-get pitch", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "do I get a dashboard?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/page|inquiries|network/);
  });

  it("answers operator data/privacy questions honestly with a team handoff", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "who owns my guest data?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/data|privacy|yours/);
    expect(result.reply.toLowerCase()).toContain("team");
  });

  it("explains the inquiry handoff (Kai pre-qualifies, then hands to you)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "what happens after a guest inquires?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/pre-qualif|hands|whatsapp/);
  });

  it("confirms operator PMS integration is handled by the team", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "do you integrate with Rezdy?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/integrat|rezdy|sync/);
    expect(result.reply.toLowerCase()).toContain("team");
  });

  it("explains where operator bookings come from (Kai + partner network)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "how do you send me guests?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/partner|network|whatsapp/);
  });

  it("tells operators they set their own rate and keep 82%", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "can I set my own prices?", pitched: true });
    expect(result.reply).toContain("82%");
    expect(result.reply.toLowerCase()).toMatch(/your (own )?rate|your price/);
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

  it("reassures operators there's no lock-in", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "can I pause or leave anytime?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/no lock|pause|leave/);
    expect(result.reply.toLowerCase()).toContain("email");
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

  it("tells partners they can go live fast (one-click claim)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "how soon can I go live?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/one click|magic link|live/);
    expect(result.reply.toLowerCase()).toContain("email");
  });

  it("explains referral attribution (60-day window + manual code)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "how does attribution work?", pitched: true });
    expect(result.reply).toMatch(/60/);
    expect(result.reply.toLowerCase()).toContain("code");
  });

  it("shows partners the tracked-link dashboard for bookings/earnings", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "how do I track my bookings?", pitched: true });
    expect(result.reply.toLowerCase()).toContain("dashboard");
    expect(result.reply.toLowerCase()).toContain("email");
  });

  it("tells partners there's no minimum volume to join", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "is there a minimum volume to join?", pitched: true });
    expect(result.reply.toLowerCase()).toContain("no minimum");
    expect(result.reply.toLowerCase()).toContain("email");
  });

  it("tells partners there's no cost to join, funded from the operator side", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "is there any cost to join?", pitched: true });
    expect(result.reply.toLowerCase()).toContain("no cost");
    expect(result.reply.toLowerCase()).toContain("operator");
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

  it("answers a partner currency/conversion question honestly (set with team)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "which currency am I paid in, and the exchange rate?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/your currency|converted|with the team/);
  });

  it("answers a competitor/differentiation worry (curated marketplace, your own storefront)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "will you list my competitors right next to me?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/curated|your own storefront|stand out/);
  });

  it("explains how guests pay (secure BluePass checkout, operator paid out)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "how do guests pay - by card?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/securely|checkout|card/);
  });

  it("reassures a partner their clients stay theirs (no poaching)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "do you poach my clients or go around me?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/stay yours|relationship is yours|keep the credit/);
  });

  it("handles a partner API/embed ask honestly (link+assets now, deeper = team chat)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "do you have an API to embed on my site?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/tracked link|team conversation|won't overpromise/);
  });

  it("reassures an operator no English is needed (Kai handles both languages)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "do you support bahasa? my english isn't great", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/bahasa|no english/);
  });

  it("clarifies guest-support split (operator runs the trip, Kai + team pre-trip)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "who handles customer service for guests?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/you run|pre-qualif|the team/);
  });

  it("offers an operator a no-commitment demo/example page", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "can I see an example page first?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/no commitment/);
  });

  it("offers a partner a no-commitment demo/example page", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "got a demo I can see?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/no commitment/);
  });

  it("tells an operator the page build is low-lift (team builds, few photos)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "what do you need from me for my page? photos?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/team builds|build the page|few photos|barely/);
  });

  it("explains the partner referral mechanism (tracked link, auto-credited)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "how do i refer a client to you?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/tracked link/);
    expect(result.reply.toLowerCase()).toMatch(/credited|automatically/);
  });

  it("confirms an operator can list a whole fleet / multiple trips under one page", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "can I list more than one boat?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/fleet|one page|each/);
  });

  it("tells an operator their cancellation/refund terms are their own", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "what's the refund policy if a guest cancels?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/yours|you set/);
  });

  it("is honest that booking volume isn't guaranteed, without deflating the offer", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "will i actually get any bookings?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/guarantee|no one can/);
    expect(result.reply.toLowerCase()).toMatch(/partner network|pre-qualif|reach/);
  });

  it("reassures an operator BluePass is legit (real marketplace, keep 82%)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "is this legit or a scam?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/real|vetted|82%/);
  });

  it("gives an operator the concrete sign-up steps and captures company/port/email", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "how do i sign up?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/company/);
    expect(result.reply.toLowerCase()).toMatch(/claim/);
  });

  it("refuses to invent a ballpark commission number, points to real per-partner terms", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "just give me a ballpark figure", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/per-partner|real terms|won't guess|confirmed with the team/);
    expect(result.reply).not.toMatch(/\d+\s?%/);
  });

  it("reassures partners BluePass is legit (vetted, operator-direct)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "is this legit?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/vetted|real|screened/);
  });

  it("answers a partner regions question honestly (Indonesia-first, two live)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "which destinations do you cover?", pitched: true });
    expect(result.reply).toMatch(/Indonesia/i);
    expect(result.reply).toContain("Raja Ampat");
  });

  it("handles partner group/charter requests with a team hold", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "can I do group bookings for clients?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/group|charter/);
    expect(result.reply.toLowerCase()).toContain("hold");
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

  it("points partners to the marketing pack in their dashboard", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "where do I get the marketing assets?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/dashboard|pack|logos|banners/);
    expect(result.reply.toLowerCase()).toContain("email");
  });

  it("says the impact assets are co-brandable but the widget stays BluePass", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "can I white-label this?", pitched: true });
    expect(result.reply.toLowerCase()).toContain("co-brand");
    expect(result.reply).toContain("BluePass");
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
