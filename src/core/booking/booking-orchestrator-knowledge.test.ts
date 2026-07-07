import { describe, expect, it } from "vitest";
import { MockPmsAdapter } from "@/core/pms/mock-pms-adapter";
import { EMPTY_KNOWLEDGE_PACK, type OperatorKnowledgePack } from "@/core/knowledge/types";
import { handleTravellerBookingMessage } from "./booking-orchestrator";

const CANCELLATION_ANSWER = "Full refund up to 48 hours before departure; 50% within 48 hours.";

function packWithCancellation(): OperatorKnowledgePack {
  return {
    ...EMPTY_KNOWLEDGE_PACK,
    entries: [
      {
        id: "cancellation-policy",
        question: "What is your cancellation and refund policy?",
        answer: CANCELLATION_ANSWER,
        keywords: ["cancel", "cancellation", "refund", "reschedule"],
        category: "policies",
        isPolicy: true,
      },
      {
        id: "meeting-point",
        question: "Where and what time do we meet?",
        answer: "We meet at the Labuan Bajo marina gate at 7am.",
        keywords: ["where", "meet", "meeting point", "what time"],
        category: "logistics",
        isPolicy: false,
      },
    ],
  };
}

describe("booking orchestrator — operator knowledge pack", () => {
  it("answers a policy question from the operator's pack, verbatim when the LLM is off", async () => {
    const result = await handleTravellerBookingMessage({
      message: "what's your cancellation policy?",
      pmsAdapter: new MockPmsAdapter(),
      knowledgePack: packWithCancellation(),
    });

    expect(result.reply).toBe(CANCELLATION_ANSWER);
    expect(result.replySource).toBe("DETERMINISTIC");
  });

  it("answers a logistics question from the pack", async () => {
    const result = await handleTravellerBookingMessage({
      message: "where and what time do we meet?",
      pmsAdapter: new MockPmsAdapter(),
      knowledgePack: packWithCancellation(),
    });

    expect(result.reply).toContain("Labuan Bajo marina");
  });

  it("forces a policy answer verbatim when an LLM rewrite drops the policy text", async () => {
    const result = await handleTravellerBookingMessage({
      message: "can I get a refund if I cancel?",
      pmsAdapter: new MockPmsAdapter(),
      knowledgePack: packWithCancellation(),
      llmClient: {
        // Unsafe: invents a lenient policy the operator never stated.
        async composeReply() {
          return "Sure, you can cancel anytime and we'll always refund you in full.";
        },
      },
    });

    // isSafeRewrite drops the unsafe rewrite (required policy text missing).
    expect(result.reply).toBe(CANCELLATION_ANSWER);
    expect(result.replySource).toBe("DETERMINISTIC");
  });

  it("escalates a policy-shaped question with no matching entry instead of guessing", async () => {
    const result = await handleTravellerBookingMessage({
      message: "do you take pregnant guests or is there a medical restriction?",
      pmsAdapter: new MockPmsAdapter(),
      knowledgePack: {
        ...EMPTY_KNOWLEDGE_PACK,
        escalation: {
          fallbackToHuman: true,
          handoffMessage: "Great question — let me pass you to the operator's team for an accurate answer.",
          handoffKeywords: [],
        },
      },
    });

    expect(result.action).toBe("HUMAN_HANDOFF");
    expect(result.reply).toContain("operator's team");
  });

  it("leaves behaviour unchanged when no knowledge pack is supplied", async () => {
    const withPack = await handleTravellerBookingMessage({
      message: "what's your cancellation policy?",
      pmsAdapter: new MockPmsAdapter(),
      knowledgePack: packWithCancellation(),
    });
    const withoutPack = await handleTravellerBookingMessage({
      message: "what's your cancellation policy?",
      pmsAdapter: new MockPmsAdapter(),
    });

    // With a pack, the operator's answer is served; without, it is not.
    expect(withPack.reply).toBe(CANCELLATION_ANSWER);
    expect(withoutPack.reply).not.toBe(CANCELLATION_ANSWER);
  });
});
