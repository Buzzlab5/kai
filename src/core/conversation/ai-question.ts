/**
 * "Are you a bot?", "am I talking to a real person?": a question about Kai, which always gets a
 * straight answer (Kai never claims to be a person). "Can I talk to a real person?" is a request for
 * one, which is a handoff instead.
 */
const aiQuestionPattern =
  /\b(?:are (?:you|u) (?:a |an )?(?:bot|chat ?bot|robot|real|human|ai|person|machine)|is this (?:a |an )?(?:bot|chat ?bot|robot|ai|real person|human|person)|am i (?:talking|chatting|speaking) (?:to|with) (?:a |an )?(?:bot|chat ?bot|robot|ai|real person|human|person|machine))\b/;
const handoffRequestPattern =
  /\b(?:talk|speak|chat) (?:to|with) (?:a |an |the )?(?:human|person|real person|someone|somebody|team|staff|operator|manager)\b|\b(?:want|need|get me|put me through to) (?:a |an |the )?(?:human|real person|someone|somebody|staff member|manager)\b/;

export function isAskingIfKaiIsHuman(message: string) {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();

  return aiQuestionPattern.test(normalized) && !handoffRequestPattern.test(normalized);
}
