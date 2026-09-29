/**
 * Kai's written replies are made for a screen: links, numbered lists, "A$79". Read aloud on a call
 * they sound wrong, so this turns one into something a person would actually say. Facts are never
 * changed or dropped, only the way they're written: links go (nobody can tap a link mid-call), list
 * rows become sentences, and prices and codes are spelled the way they're spoken.
 */
const currencyWords: Record<string, string> = {
  A$: "Australian dollars",
  AU$: "Australian dollars",
  AUD: "Australian dollars",
  "US$": "US dollars",
  USD: "US dollars",
  $: "dollars",
  IDR: "rupiah",
  Rp: "rupiah"
};

export function toSpokenReply(reply: string) {
  const withoutLinks = stripLinks(reply);
  const rows = withoutLinks
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(speakListRow);

  return speakAmounts(rows.join(" ")).replace(/\s{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
}

/** "Details: https://..." and bare URLs: useless on a call, and a mouthful to read out. */
function stripLinks(reply: string) {
  return reply
    .replace(/\s*(?:Details|Link|More|Book(?:ing)?|Quote link|You can pay securely here|See it here)\s*:\s*https?:\/\/\S+/gi, "")
    .replace(/\s*\(?https?:\/\/\S+\)?/gi, "")
    .replace(/\s*·\s*$/gm, "");
}

/** "1. Alila Purnama - Legend in Komodo, 5 cabins" reads as a sentence, not a numbered row. */
function speakListRow(line: string) {
  const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
  if (!numbered) return line;

  const body = numbered[2].replace(/\s+-\s+/, ", ").trim();
  return /[.!?]$/.test(body) ? body : `${body}.`;
}

/** "A$79" is read as "A dollar seventy nine" unless the currency is spelled out. */
function speakAmounts(text: string) {
  return text
    .replace(/\b(AUD|USD|IDR|Rp)\s?([\d,.]+)/g, (_match, code: string, amount: string) => `${amount} ${currencyWords[code]}`)
    .replace(/(A\$|AU\$|US\$|\$)\s?([\d,.]+)/g, (_match, symbol: string, amount: string) => `${amount} ${currencyWords[symbol]}`);
}
