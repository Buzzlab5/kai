import { describe, expect, it } from "vitest";
import {
  buildBluePassBookingSystemsReply,
  buildBluePassCommissionReply,
  buildBluePassConservationReply,
  buildBluePassDestinationComparisonReply,
  buildBluePassEnquiryReminder,
  buildBluePassInquiryConfirmationReply,
  buildBluePassInquiryReadyReply,
  buildBluePassInquiryStatusReply,
  buildBluePassMissingFieldsReply,
  buildBluePassOpenQuestionReply,
  buildBluePassPriceObjectionReply,
  buildBluePassRecommendationReply,
  buildBluePassSmallTalkReply,
  buildBluePassValueReply,
  buildBluePassYachtComparisonReply,
  buildBluePassYachtOverviewReply
} from "@/core/bluepass/reply";
import { resolveBluePassCatalog, searchBluePassYachts } from "@/core/bluepass/catalog";
import { buildCardDeclineReply } from "@/core/security/card-detection";
import { listTravellerFaqAnswers } from "@/core/bluepass/traveller-faq";
import { bluePassDestinationNotes } from "@/core/bluepass/destination-notes";
import { buildBluePassSeasonReply } from "@/core/bluepass/reply";
import { buildBluePassResetConversationReply } from "@/core/bluepass/conversation-intent";
import {
  buildBluePassHandoffReply,
  buildBluePassLeadCapturedReply,
  buildBluePassOperatorReply,
  buildBluePassPartnerReply,
  buildBluePassTriageGreeting
} from "@/core/bluepass/triage";
import { composeAssistantReply } from "./assistant-reply-composer";
import {
  buildKaiPersonaPrompt,
  findKaiHouseRuleBreaches,
  findKaiStyleBreaches,
  kaiPersona,
  tidyKaiReply
} from "./kai-persona";

describe("Kai persona prompt", () => {
  it("introduces Kai as the BluePass concierge with the approachable, friendly, knowledgeable Aussie voice", () => {
    const prompt = buildKaiPersonaPrompt({ tenantName: "BluePass" }).join("\n");

    expect(prompt).toContain("You are Kai, the BluePass concierge");
    expect(prompt).toContain("well-travelled Australian");
    expect(prompt).toContain("Approachable, friendly and knowledgeable");
    expect(prompt).toContain("Australian English");
    for (const rule of kaiPersona.houseRules) {
      expect(prompt).toContain(rule);
    }
  });

  it("keeps Kai's personality for a tenant and blends the tenant's own tone on top", () => {
    const prompt = buildKaiPersonaPrompt({
      tenantName: "Boattime Yacht Charters",
      tenantTone: "Polished, calm, premium."
    }).join("\n");

    expect(prompt).toContain("the booking concierge for Boattime Yacht Charters");
    expect(prompt).toContain("This business also wants replies to feel: Polished, calm, premium.");
    expect(prompt).toContain("Australian English");
  });
});

describe("Kai house rules", () => {
  it("flags a commission percentage the model introduced but allows the 5% to the ocean", () => {
    expect(findKaiHouseRuleBreaches("Operators keep 80% and 5% goes to the reef.")).toEqual(["percentage 80%"]);
    expect(findKaiHouseRuleBreaches("5% of every booking goes to the ocean.")).toEqual([]);
    expect(findKaiHouseRuleBreaches("We take twenty percent, well 20 percent.")).toEqual(["percentage 20%"]);
  });

  it("allows a percentage the grounded reply already stated, like an operator's refund policy", () => {
    const grounded = "Cancel more than 30 days out for a 50% refund.";

    expect(findKaiHouseRuleBreaches("You'd get 50% back if you cancel over 30 days out.", grounded)).toEqual([]);
  });

  it("flags price-match and lowest-price promises", () => {
    expect(findKaiHouseRuleBreaches("We price-match any direct rate.")).toEqual(["price promise"]);
    expect(findKaiHouseRuleBreaches("Guaranteed lowest price, every time.")).toEqual(["price promise"]);
    expect(findKaiHouseRuleBreaches("We guarantee the lowest price.")).toEqual(["price promise"]);
    expect(findKaiHouseRuleBreaches("You pay the operator's own price, nothing added.")).toEqual([]);
  });
});

describe("tidyKaiReply", () => {
  it("drops emojis and turns em dashes into commas", () => {
    expect(tidyKaiReply("Komodo is great \u2014 especially June to September 🐠")).toBe(
      "Komodo is great, especially June to September"
    );
  });

  it("never rewrites a product name that itself contains an em dash", () => {
    const title = "Reef Explorer \u2014 Full Day";

    expect(tidyKaiReply(`${title} still has seats.`, [title])).toBe(`${title} still has seats.`);
  });
});

describe("Kai's scripted voice", () => {
  const catalog = resolveBluePassCatalog(undefined);
  const matches = searchBluePassYachts({ destination: "Komodo" }, catalog, 3);

  // Every scripted line that has been rewritten in Kai's voice. Add each builder here as its copy
  // moves over, so the lint keeps it honest from then on.
  const scriptedLines: Record<string, string> = {
    triageGreeting: buildBluePassTriageGreeting(),
    smallTalk: buildBluePassSmallTalkReply(),
    smallTalkHowAreYou: buildBluePassSmallTalkReply({ latestMessage: "how's it going?" }),
    smallTalkHelp: buildBluePassSmallTalkReply({ latestMessage: "can you help me" }),
    smallTalkWithDestination: buildBluePassSmallTalkReply({ destination: "the Whitsundays" }),
    gratitude: buildBluePassSmallTalkReply({ gratitude: true }),
    openQuestion: buildBluePassOpenQuestionReply(),
    openQuestionWithDestination: buildBluePassOpenQuestionReply({ destination: "Ningaloo" }),
    openQuestionOffCatalog: buildBluePassOpenQuestionReply({ offCatalogPlace: "Sulawesi" }),
    value: buildBluePassValueReply(),
    conservation: buildBluePassConservationReply(),
    commission: buildBluePassCommissionReply(),
    bookingSystems: buildBluePassBookingSystemsReply(),
    destinationComparisonFallback: buildBluePassDestinationComparisonReply(["Ningaloo", "the Whitsundays"]),
    travellerReset: buildBluePassResetConversationReply(),
    cardDecline: buildCardDeclineReply(),
    missingFields: buildBluePassMissingFieldsReply({ destination: "Komodo", missingFields: ["dateWindow", "guests"] }),
    missingFieldsContact: buildBluePassMissingFieldsReply({ missingFields: ["travellerName", "travellerEmail"] }),
    selectedYachtNeedsDates: buildBluePassMissingFieldsReply({ selectedYacht: catalog[0], missingFields: ["dateWindow", "guests"] }),
    selectedYachtNeedsContact: buildBluePassMissingFieldsReply({ selectedYacht: catalog[0], missingFields: ["travellerName", "travellerEmail"] }),
    selectedYachtNeedsForm: buildBluePassMissingFieldsReply({ selectedYacht: catalog[0], missingFields: ["travellerPhone"] }),
    enquiryReminderTrip: buildBluePassEnquiryReminder({ yachtName: "Alila Purnama", missingFields: ["dateWindow", "guests"] }) ?? "",
    enquiryReminderGuests: buildBluePassEnquiryReminder({ yachtName: "Alila Purnama", missingFields: ["guests"] }) ?? "",
    enquiryReminderForm: buildBluePassEnquiryReminder({ yachtName: "Alila Purnama", missingFields: ["travellerPhone"] }) ?? "",
    enquiryReminderReady:
      buildBluePassEnquiryReminder({ yachtName: "Alila Purnama", missingFields: [], readyToSend: true }) ?? "",
    smallTalkMidEnquiry: buildBluePassSmallTalkReply({
      gratitude: true,
      enquiryReminder: "When you're ready, just tell me your dates and how many of you for Alila Purnama."
    }),
    enquiryReminderChat:
      buildBluePassEnquiryReminder({ yachtName: "Alila Purnama", missingFields: ["travellerName", "travellerEmail"] }) ?? "",
    followUpNeedsGuests: buildBluePassMissingFieldsReply({
      selectedYacht: catalog[0],
      missingFields: ["guests"],
      yachtAlreadyIntroduced: true
    }),
    followUpNeedsContact: buildBluePassMissingFieldsReply({
      selectedYacht: catalog[0],
      missingFields: ["travellerName", "travellerEmail"],
      yachtAlreadyIntroduced: true
    }),
    confirmation: buildBluePassInquiryConfirmationReply({
      selectedYachtName: catalog[0].name,
      destination: "Komodo",
      dateWindow: "19 July",
      guests: 2,
      travellerName: "Maya Chen",
      travellerEmail: "maya@example.com"
    }),
    enquirySent: buildBluePassInquiryReadyReply({ inquiryId: "BP-1", selectedYachtName: catalog[0].name, dispatchQueued: true }),
    enquirySendFailed: buildBluePassInquiryReadyReply({ inquiryId: "BP-1", dispatchQueued: false, dispatchFailed: true }),
    enquirySaved: buildBluePassInquiryReadyReply({ inquiryId: "BP-1", dispatchQueued: false }),
    ...Object.fromEntries(
      ["DRAFT", "OPERATOR_PENDING", "OPERATOR_ACCEPTED", "COUNTER_OFFERED", "DECLINED", "CLOSED"].map((status) => [
        `status${status}`,
        buildBluePassInquiryStatusReply({ inquiryId: "BP-1", selectedYachtName: catalog[0].name, status })
      ])
    ),
    yachtOverview: buildBluePassYachtOverviewReply(matches[0]),
    recommendation: buildBluePassRecommendationReply({ destination: "Komodo", matches }),
    recommendationNoMatches: buildBluePassRecommendationReply({ destination: "Komodo", matches: [] }),
    priceObjectionNoFit: buildBluePassPriceObjectionReply({ destination: "Komodo", matches: [] }),
    yachtComparison: buildBluePassYachtComparisonReply(matches.slice(0, 2)),
    openQuestionOffCatalogWithNearby: buildBluePassOpenQuestionReply({
      offCatalogPlace: "Sulawesi",
      nearbyRegions: ["Komodo", "Raja Ampat"]
    }),
    ...Object.fromEntries(listTravellerFaqAnswers().map(({ topic, answer }, index) => [`faq${topic}${index}`, answer])),
    ...Object.fromEntries(
      bluePassDestinationNotes.flatMap((note) => [
        [`season${note.name}`, buildBluePassSeasonReply(note.name)],
        [`season${note.name}NotListed`, buildBluePassSeasonReply(note.name, { inCatalogue: false })]
      ])
    ),
    seasonUnknownPlace: buildBluePassSeasonReply("Sydney"),
    ...Object.fromEntries(
      bluePassDestinationNotes.flatMap((first, index) =>
        bluePassDestinationNotes
          .slice(index + 1)
          .map((second) => [`compare${first.name}${second.name}`, buildBluePassDestinationComparisonReply([first.name, second.name])])
      )
    )
  };

  for (const [name, line] of Object.entries(scriptedLines)) {
    it(`${name} follows Kai's style and house rules`, () => {
      expect(findKaiStyleBreaches(line), line).toEqual([]);
      expect(findKaiHouseRuleBreaches(line), line).toEqual([]);
    });
  }

  it("never re-asks for a destination the traveller already gave", () => {
    expect(buildBluePassOpenQuestionReply({ destination: "Ningaloo" })).not.toContain("where are you thinking");
    expect(buildBluePassSmallTalkReply({ destination: "Komodo" })).toContain("Still keen on Komodo");
  });
});

describe("Kai's voice with operators and partners", () => {
  // Every branch of both playbooks, in both markets, pitched and not.
  const questions = [
    "is this legit?", "will you undercut me?", "is it free to list?", "do you charge per lead?", "what's your commission?",
    "can I see a demo?", "help me get set up", "what do you need from me?", "we're on viator already", "what do I get?",
    "what's the catch?", "can I run a promo?", "can I set my own prices?", "can I list my whole fleet?", "can I block dates?",
    "do you integrate with rezdy?", "will I get bookings?", "where do guests come from?", "what about my data?",
    "what happens after a guest enquires?", "who handles support?", "any operator references?", "what about competitors?",
    "I only run day trips", "we're outside indonesia and australia", "do I need english?", "we're in australia", "indonesia",
    "how long does approval take?", "how does vetting work?", "what's your cancellation policy?", "can I leave anytime?",
    "what deposit do guests pay?", "how do guests pay?", "when do I get paid?", "is there an app?", "how do reviews work?",
    "can we book a call?", "how do I sign up?", "how do I claim my page?", "saya punya kapal di Komodo", "ok sounds good",
    "which destinations do you cover?", "some want komodo, some raja ampat", "komodo", "raja ampat", "great barrier reef",
    "can I embed it on my site?", "can I co-brand it?", "do you have marketing assets?", "do you poach my clients?",
    "what if the operator cancels?", "how does attribution work?", "how do I track clicks?", "does my client pay a fee?",
    "which currency?", "can I add my own markup?", "just give me a ballpark", "how do commissions work?", "book for a client",
    "how much do trips cost?", "what trips do you have?", "who else is on board?", "founding terms?", "I got a link from you",
    "group trip for my clients", "I know some operators", "how does the tracked link work?", "no minimum?", "I'm a creator",
    "conservation impact"
  ];
  const replies = new Set<string>();
  for (const market of ["AUSTRALIA", "INDONESIA", undefined] as const) {
    for (const pitched of [false, true]) {
      for (const latestMessage of questions) {
        replies.add(buildBluePassOperatorReply({ latestMessage, pitched, market }).reply);
        replies.add(buildBluePassPartnerReply({ latestMessage, pitched, market }).reply);
      }
    }
  }
  replies.add(buildBluePassHandoffReply());
  for (const persona of ["OPERATOR", "PARTNER"] as const) {
    replies.add(buildBluePassLeadCapturedReply({ persona, lead: { company: "Coral Cove", email: "ops@coralcove.com" } }));
  }

  it("covers a wide spread of the playbook", () => {
    expect(replies.size).toBeGreaterThan(60);
  });

  for (const reply of replies) {
    it(`sounds like Kai: ${reply.slice(0, 60)}`, () => {
      expect(findKaiStyleBreaches(reply), reply).toEqual([]);
      expect(findKaiHouseRuleBreaches(reply), reply).toEqual([]);
    });
  }
});

describe("findKaiStyleBreaches", () => {
  it("catches the habits Kai's copy must not have", () => {
    expect(findKaiStyleBreaches("Great trip \u2014 book now")).toContain("en or em dash");
    expect(findKaiStyleBreaches("Great trip - book now")).toContain("hyphen used as a dash");
    expect(findKaiStyleBreaches("Pick your favorite color")).toContain("American spelling");
    expect(findKaiStyleBreaches("G'day mate, crikey")).toContain("caricature slang");
    expect(findKaiStyleBreaches("Wow!! Amazing")).toContain("stacked exclamation marks");
    expect(findKaiStyleBreaches("When? Where?")).toContain("more than one question");
    expect(findKaiStyleBreaches("I saved the request in admin, not the PMS.")).toContain("internal jargon");
    expect(findKaiStyleBreaches("Kai will not store card details.")).toContain("Kai in the third person");
  });

  it("allows numbered catalogue rows and Australian spellings", () => {
    expect(findKaiStyleBreaches("1. Alila Purnama - Legend in Komodo.\nThe travelling colour of the reef.")).toEqual([]);
  });
});

describe("Kai persona in the reply composer", () => {
  it("rejects a model rewrite that states a commission percentage, keeping the scripted answer", async () => {
    const deterministicReply = buildBluePassCommissionReply();
    const result = await composeAssistantReply({
      deterministicReply,
      llmClient: {
        async composeReply() {
          return "We take a capped 20% from the operator's side, and 5% goes to the ocean.";
        }
      }
    });

    expect(result).toEqual({ source: "DETERMINISTIC", reply: deterministicReply });
  });

  it("tidies a model rewrite: no opening g'day, no em dashes, no emojis", async () => {
    const result = await composeAssistantReply({
      deterministicReply: "Grounding reply.",
      llmClient: {
        async composeReply() {
          return "G'day mate! the Whitsundays are best August to October \u2014 calm and dry ⛵";
        }
      }
    });

    expect(result).toEqual({
      source: "LLM",
      reply: "The Whitsundays are best August to October, calm and dry"
    });
  });

  it("leaves a scripted greeting alone when there is no model rewrite", async () => {
    const greeting = buildBluePassTriageGreeting();
    const result = await composeAssistantReply({ deterministicReply: greeting });

    expect(result).toEqual({ source: "DETERMINISTIC", reply: greeting });
  });
});

describe("Kai never promises what the system doesn't do", () => {
  it("has no scripted 'I'll pass you to the team' or 'I'll flag it' lines left", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const roots = ["src/core/booking", "src/core/bluepass", "src/server/bluepass", "src/server/booking"];
    const unbacked = /I'll (?:pass (?:you|it) to|flag it|bring in)|I'll let the team know|pass (?:you|it) to (?:the|their) team/;

    for (const root of roots) {
      for (const file of readdirSync(root).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))) {
        const source = readFileSync(join(root, file), "utf8");
        expect(source.match(unbacked)?.[0] ?? null, `${root}/${file}`).toBeNull();
      }
    }
  });
});

