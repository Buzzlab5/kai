/**
 * Someone telling Kai that a person is hurt or in danger right now. Nothing else Kai does matters
 * until they've called for help, so this is checked before any booking or chat logic, and the reply
 * is never rewritten by the AI. Kept tight on purpose: "what happens in an emergency?" or "will I get
 * stung?" are ordinary questions, not emergencies.
 */
const emergencyPatterns = [
  /\bemergency\b/,
  /\b(?:been|had|there'?s|there is|there was|was|in) an accident\b|\baccident (?:on|at|during)\b/,
  /\b(?:is|are|been|got|was|were|badly|seriously|someone'?s|somebody'?s) (?:hurt|injured)\b|\binjured (?:on|at|during)\b/,
  /\b(?:bleeding|unconscious|not breathing|can'?t breathe|struggling to breathe|drown(?:ing|ed)?|overboard|sinking|capsized|heart attack|seizure|anaphyla\w*|allergic reaction|ambulance|mayday)\b/,
  /\bmissing (?:diver|swimmer|snorkell?er|person|kid|child)\b/,
  /\b(?:been|got|was|were|just got) stung\b|\bstung by\b/
];
const hypotheticalPattern =
  /\b(?:what (?:happens|if|do you do)|in case of|in the event|do you have|is there|are there|policy|insurance|insured|covered|cover for|procedure|first aid kit|safety (?:record|procedures?|briefing)|will i|could i|might i|can i|do people|risk of|chance of|worried about|afraid of|scared of)\b/;

export function isEmergencyMessage(message: string) {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (hypotheticalPattern.test(normalized)) return false;

  return emergencyPatterns.some((pattern) => pattern.test(normalized));
}

export function buildEmergencyReply(market?: "AUSTRALIA" | "INDONESIA" | "UNKNOWN" | null) {
  const call =
    market === "INDONESIA" ? "call 112" : market === "AUSTRALIA" ? "call 000" : "call 000 in Australia or 112 in Indonesia";

  return `That sounds serious. If anyone's hurt or in danger, ${call} right now, and if you're on the water, tell the skipper or crew straight away. I'm an AI concierge, so I can't send help myself. Once everyone's safe, I'm here if you need anything.`;
}
