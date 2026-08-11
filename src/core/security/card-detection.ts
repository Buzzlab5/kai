// kai-conversation-flow-notes.md finding #16 (compliance): a traveller pasted a full card number,
// expiry, and CVV into chat. Kai correctly refused to transact, but never told the traveller not to
// paste that, and the PAN was presumably left sitting in the transcript/database/model logs. This
// module gives every chat path a shared, explicit "don't accept this" gate, checked before anything
// else - card-shaped input must never reach intent classification, an LLM call, or storage.

function luhnValid(digits: string): boolean {
  let sum = 0;
  let shouldDouble = false;

  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

/**
 * True when the message contains something that looks like real payment-card data - a Luhn-valid
 * card number, or an explicit CVV alongside an expiry-shaped date. Luhn-checked (not just "13-19
 * digits in a row") to avoid false-positiving on long booking references or phone numbers.
 */
export function containsCardShapedInput(message: string): boolean {
  const candidates = message.match(/\b(?:\d[ -]?){13,19}\b/g) ?? [];
  const hasValidCardNumber = candidates.some((candidate) => {
    const digits = candidate.replace(/[^\d]/g, "");
    return digits.length >= 13 && digits.length <= 19 && luhnValid(digits);
  });
  if (hasValidCardNumber) return true;

  const hasCvv = /\bcvv\s*:?\s*\d{3,4}\b/i.test(message);
  const hasExpiry = /\b(0[1-9]|1[0-2])\s*\/\s*\d{2,4}\b/.test(message);
  return hasCvv && hasExpiry;
}

/** Redacts anything containsCardShapedInput would flag - for the one place a raw message must ever
 * be written to a durable transcript store, so a refused card paste doesn't survive in the database
 * even though the payment itself never went through. */
export function redactCardShapedInput(message: string): string {
  return message
    .replace(/\b(?:\d[ -]?){13,19}\b/g, (candidate) => {
      const digits = candidate.replace(/[^\d]/g, "");
      return digits.length >= 13 && digits.length <= 19 && luhnValid(digits) ? "[card number redacted]" : candidate;
    })
    .replace(/\bcvv\s*:?\s*\d{3,4}\b/gi, "[cvv redacted]");
}

export function buildCardDeclineReply() {
  return "I can't take card or payment details in chat, so I didn't save that - please don't paste it here. When you're ready to pay, I'll send a secure checkout link that Kai never sees or stores.";
}
