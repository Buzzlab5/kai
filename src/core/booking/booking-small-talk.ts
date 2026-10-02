/**
 * The everyday messages an operator's booking concierge gets that aren't a booking step: a hello, a
 * thank you, "are you a bot?". Each gets a real answer instead of the booking menu, so Kai sounds
 * like someone listening rather than a form.
 */
import { isAskingIfKaiIsHuman } from "@/core/conversation/ai-question";
import { PERSON_OFFER } from "@/core/conversation/human-handoff";

export type BookingSmallTalkKind = "GREETING" | "THANKS" | "AI_OR_HUMAN";

const greetingPattern =
  /^(?:hi|hiya|hey|heya|hello|howdy|g'?day|yo|good (?:morning|afternoon|evening)|morning|afternoon|evening)(?:,? (?:there|kai|team|all|everyone|guys|folks))?[\s!.,]*$/;
const thanksPattern =
  /^(?:(?:ok(?:ay)?|great|perfect|awesome|lovely|brilliant|sweet|nice|cool|legend)[\s,!.]+)*(?:thanks|thank you|thankyou|thx|ta|cheers)(?:,? (?:so much|heaps|a lot|mate|kai|again|for (?:that|your help|the help|all your help)))*[\s!.,]*$/;
/** A tenant's public name, without internal labels like "(Rezdy pilot)". */
export function cleanTenantName(tenantName?: string | null) {
  return tenantName?.replace(/\s*\([^)]*\)/g, "").trim() || null;
}

export function findBookingSmallTalkReply(
  message: string,
  context: { tenantName?: string | null } = {}
): { kind: BookingSmallTalkKind; reply: string } | null {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  if (greetingPattern.test(normalized)) {
    return {
      kind: "GREETING",
      reply: "Hey, good to hear from you. Tell me what you're keen on, or ask me anything about the trips."
    };
  }

  if (thanksPattern.test(normalized)) {
    return {
      kind: "THANKS",
      reply: "No worries at all. Give me a shout if there's anything else I can help with."
    };
  }

  // "Are you a bot?" gets a straight answer. "Can I talk to a real person?" is a request, not a
  // question about Kai, so it's left to the handoff.
  if (isAskingIfKaiIsHuman(normalized)) {
    const tenantName = cleanTenantName(context.tenantName);
    const who = tenantName ? `the AI booking concierge for ${tenantName}` : "an AI booking concierge";

    return {
      kind: "AI_OR_HUMAN",
      reply: `I'm Kai, ${who}, so not a person, but I'll always be straight with you. ${PERSON_OFFER}`
    };
  }

  return null;
}

/** A question rather than a statement, so an honest "I don't know" fits better than the booking menu. */
export function isQuestionShaped(message: string) {
  const normalized = message.toLowerCase().trim();

  return (
    normalized.includes("?") ||
    /^(?:do|does|did|is|are|can|could|will|would|should|what|whats|what's|how|when|where|which|who|why|any|tell me|wondering)\b/.test(
      normalized
    )
  );
}

/** "Do you do the Twilight Drift?", "do you guys run whale watching?": a yes or no about the catalogue. */
export function isOfferQuestion(message: string) {
  return /\b(?:do|does) (?:you|u|ya|they|the crew)(?: guys| still)? (?:do|have|run|offer|operate|sell)\b|\bis (?:the |there (?:a |an )?)?.{0,60}\b(?:still )?(?:on offer|running|available)\b/i.test(
    message
  );
}
