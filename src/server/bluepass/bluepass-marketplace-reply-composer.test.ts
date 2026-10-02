import { describe, expect, it } from "vitest";
import type { AssistantLlmClient } from "@/core/llm/assistant-reply-composer";
import { composeBluePassMarketplaceAssistantReply } from "./bluepass-marketplace-reply-composer";

describe("composeBluePassMarketplaceAssistantReply", () => {
  it("lets concierge discovery use the LLM as the answer layer instead of forcing deterministic facts", async () => {
    const capturedInputs: Parameters<AssistantLlmClient["composeReply"]>[0][] = [];
    const result = await composeBluePassMarketplaceAssistantReply({
      deterministicReply:
        "Good BluePass liveaboard options:\n1. Aliikai - Premium in Raja Ampat.\n2. Alila Purnama - Legend in Komodo.",
      latestMessage: "i want healing but im confuse where to go",
      conversationHistory: [],
      llmClient: {
        async composeReply(input) {
          capturedInputs.push(input);
          return "For a healing trip, I would steer you toward Raja Ampat on Aliikai if you're after quiet reefs and slow mornings, or Komodo on Alila Purnama if you're after a warmer spa-like phinisi feel. Are you imagining solo/couple calm, or a group trip?";
        }
      },
      marketplaceResult: {
        replyMode: "CONCIERGE",
        bluepassMatches: [
          { name: "Aliikai", region: "Raja Ampat" },
          { name: "Alila Purnama", region: "Komodo" }
        ],
        bluepassInquiry: null,
        assistantContent: ""
      }
    });

    expect(result.source).toBe("LLM");
    expect(result.reply).toContain("healing trip");
    expect(result.reply).toContain("Raja Ampat");
    expect(result.reply).not.toContain("Here are a few good options");
    expect(capturedInputs[0].requiredFacts).toEqual([]);
  });

  it("rejects a concierge-mode LLM rewrite that drops the 5% fact, even though concierge mode has no other required facts", async () => {
    // Regression: a real bug reached production behavior in manual testing - the LLM rewrote an
    // accurate commission answer into a hallucinated "isn't publicly disclosed" hedge, and it passed
    // isSafeRewrite because concierge mode's requiredFacts list was empty. Percentages in the
    // deterministic reply (now only ever the 5% to conservation) must survive rewriting regardless
    // of replyMode.
    const deterministicReply =
      "It's a capped commission that comes from the operator's side, never added to your fare, so you pay the same as booking direct. And 5% of every booking is set aside for the ocean before we take a cent.";
    const capturedInputs: Parameters<AssistantLlmClient["composeReply"]>[0][] = [];
    const result = await composeBluePassMarketplaceAssistantReply({
      deterministicReply,
      latestMessage: "what commission does BluePass take",
      conversationHistory: [],
      llmClient: {
        async composeReply(input) {
          capturedInputs.push(input);
          return "BluePass Australia's commission structure isn't publicly disclosed, but our pricing is competitive and transparent, with no hidden fees.";
        }
      },
      marketplaceResult: {
        replyMode: "CONCIERGE",
        bluepassMatches: [],
        bluepassInquiry: null,
        assistantContent: ""
      }
    });

    expect(capturedInputs[0].requiredFacts).toEqual(["5%"]);
    expect(result.source).toBe("DETERMINISTIC");
    expect(result.reply).toBe(deterministicReply);
  });

  it("keeps the mid-enquiry reminder through any rewrite", async () => {
    const reminder = "When you're ready, just tell me your dates and how many of you for Alila Purnama.";
    const deterministicReply = `Worth planning for if you're prone to it. A seasickness tablet before you board helps. ${reminder}`;
    const capturedInputs: Parameters<AssistantLlmClient["composeReply"]>[0][] = [];
    const result = await composeBluePassMarketplaceAssistantReply({
      deterministicReply,
      latestMessage: "will I get seasick?",
      conversationHistory: [],
      llmClient: {
        async composeReply(input) {
          capturedInputs.push(input);
          return "Take a seasickness tablet before you board and keep your eyes on the horizon, you'll be right.";
        }
      },
      marketplaceResult: { replyMode: "CONCIERGE", bluepassMatches: [], bluepassInquiry: null, assistantContent: "" }
    });

    expect(capturedInputs[0].requiredFacts).toContain(reminder);
    expect(result.source).toBe("DETERMINISTIC");
    expect(result.reply).toBe(deterministicReply);
  });

  it("still allows a concierge-mode LLM rewrite that keeps the 5% and adds no other percentage", async () => {
    const result = await composeBluePassMarketplaceAssistantReply({
      deterministicReply:
        "It's a capped commission that comes from the operator's side, never added to your fare, so you pay the same as booking direct. And 5% of every booking is set aside for the ocean before we take a cent.",
      latestMessage: "what commission does BluePass take",
      conversationHistory: [],
      llmClient: {
        async composeReply() {
          return "It's a capped commission paid on the operator's side, so you pay exactly what you'd pay booking direct. On top of that, 5% of every booking goes to protecting the ocean before we take anything.";
        }
      },
      marketplaceResult: {
        replyMode: "CONCIERGE",
        bluepassMatches: [],
        bluepassInquiry: null,
        assistantContent: ""
      }
    });

    expect(result.source).toBe("LLM");
    expect(result.reply).toContain("5%");
  });

  it("rejects a rewrite that brings the commission split back into the answer", async () => {
    const deterministicReply =
      "It's a capped commission that comes from the operator's side, never added to your fare, so you pay the same as booking direct. And 5% of every booking is set aside for the ocean before we take a cent.";
    const result = await composeBluePassMarketplaceAssistantReply({
      deterministicReply,
      latestMessage: "what commission does BluePass take",
      conversationHistory: [],
      llmClient: {
        async composeReply() {
          return "We take a capped 20%, so operators keep 80%, and 5% of every booking goes to the ocean.";
        }
      },
      marketplaceResult: {
        replyMode: "CONCIERGE",
        bluepassMatches: [],
        bluepassInquiry: null,
        assistantContent: ""
      }
    });

    expect(result.source).toBe("DETERMINISTIC");
    expect(result.reply).toBe(deterministicReply);
  });

  it("keeps transactional replies fact-preserving", async () => {
    const capturedInputs: Parameters<AssistantLlmClient["composeReply"]>[0][] = [];
    const result = await composeBluePassMarketplaceAssistantReply({
      deterministicReply:
        "Done. Your enquiry for Calico Jack is on its way to the operator (reference inquiry_123). It's not a confirmed booking yet: they'll confirm availability and the final price, and I'll let you know as soon as they reply.",
      latestMessage: "yes please send inquiry",
      conversationHistory: [],
      llmClient: {
        async composeReply(input) {
          capturedInputs.push(input);
          return "Calico Jack is confirmed for you.";
        }
      },
      marketplaceResult: {
        bluepassMatches: [],
        bluepassInquiry: {
          selectedYachtName: "Calico Jack",
          destination: "Komodo",
          dateWindow: "19 July",
          guests: 2
        },
        assistantContent: ""
      }
    });

    expect(result.source).toBe("DETERMINISTIC");
    expect(result.reply).toContain("Your enquiry");
    expect(capturedInputs[0].requiredFacts).toEqual(
      expect.arrayContaining(["Calico Jack", "Komodo", "19 July", "2"])
    );
  });
});
