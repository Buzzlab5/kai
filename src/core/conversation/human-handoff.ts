/**
 * Someone who asks for a person gets one. Kai says a person from the team will jump into the chat as
 * soon as possible, and the team adds them to it. On WhatsApp the team already has the number, so Kai
 * never asks for it. On the web there's no number yet, so Kai asks for their best WhatsApp.
 */
export type ConversationChannel = "whatsapp" | "web";

/** Kai's offer of a person. A plain "yes" straight after it is taken as a request for one. */
export const PERSON_OFFER = "Want me to get a person from the team to jump in?";

/** On the web there's no number yet, so the handoff asks for one; the next message is read for it. */
export const WHATSAPP_NUMBER_ASK = "What's the best WhatsApp number for them to reach you on?";

const personRequestPatterns = [
  /\b(?:talk|speak|chat) (?:to|with) (?:a |an |the )?(?:human|person|real person|actual person|someone|somebody|team|staff|manager)\b/,
  /\b(?:want|need|get me|put me through to|connect me (?:to|with)|can i (?:get|have)|i'?d like) (?:a |an |the )?(?:human|person|real person|actual person|someone|somebody|staff member|manager)\b/,
  /^(?:a )?(?:human|real person|person|agent)(?: please)?[.!?]*$/
];
const affirmativePattern =
  /^(?:yes|yeah|yep|yup|sure|ok|okay|please|yes please|go on|go ahead|do it|sounds good|that'?d be great|that would be great)(?:,? (?:please|thanks|mate))?[.! ]*$/;

/** Asking for a person, or saying yes straight after Kai offered one. */
export function shouldHandOffToPerson(message: string, lastKaiMessage?: string | null) {
  return isAskingForAPerson(message) || acceptsPersonOffer(message, lastKaiMessage);
}

/** A phone number in a reply, as the traveller typed it. */
export function extractCallbackNumber(message: string) {
  const match = message.match(/\+?\d[\d\s().-]{6,}\d/);
  if (!match) return null;

  return match[0].replace(/\D/g, "").length >= 8 ? match[0].trim() : null;
}

/** Their WhatsApp number, sent straight after Kai asked for it on the web. */
export function givesCallbackNumber(message: string, lastKaiMessage?: string | null) {
  return Boolean(lastKaiMessage?.includes(WHATSAPP_NUMBER_ASK)) ? extractCallbackNumber(message) : null;
}

export function buildCallbackNumberThanksReply(number: string, team = "the team") {
  return `Thanks, I've passed ${number} to ${team}, and a person will message you on WhatsApp as soon as possible.`;
}

export function isAskingForAPerson(message: string) {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();

  return personRequestPatterns.some((pattern) => pattern.test(normalized));
}

export function acceptsPersonOffer(message: string, lastKaiMessage?: string | null) {
  return Boolean(lastKaiMessage?.includes(PERSON_OFFER)) && affirmativePattern.test(message.toLowerCase().trim());
}

export function buildHumanHandoffReply(input: {
  channel: ConversationChannel;
  /** "the BluePass team", or "the team" on an operator's own widget. */
  team?: string;
  /** Kai is handing over on its own (a question only the team can answer), not because they asked. */
  escalation?: boolean;
  /** Mid-booking reassurance for an operator's widget. */
  nothingChanges?: boolean;
}) {
  const team = input.team ?? "the team";
  const opener = input.escalation ? "That's one for the team rather than me, so" : "Of course,";
  const reassurance = input.nothingChanges ? ", and nothing gets booked or changed in the meantime" : "";

  return input.channel === "whatsapp"
    ? `${opener} I'll get a person from ${team} to jump into this chat as soon as possible${reassurance}.`
    : `${opener} I'll get a person from ${team} onto this as soon as possible${reassurance}. ${WHATSAPP_NUMBER_ASK}`;
}
