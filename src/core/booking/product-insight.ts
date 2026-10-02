import type { PmsProduct } from "@/core/pms/types";

/**
 * What Kai can honestly read out of an operator's own trip details: a one-line summary, how long a
 * trip runs, what's included, and which trip suits a couple, a family or a group. Everything comes
 * from the operator's own title and description, and anything they don't say is left unsaid.
 */

/** Plain text from a booking system description, which is often HTML with lists and entities. */
export function plainProductText(description: string | null | undefined) {
  return (description ?? "")
    .replace(/<\s*br\s*\/?>/gi, ", ")
    .replace(/<\/\s*li\s*>/gi, ", ")
    .replace(/<\/\s*(?:p|div|ul|ol|h[1-6])\s*>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&(?:rsquo|lsquo|#39|apos);/gi, "'")
    .replace(/&(?:rdquo|ldquo|quot);/gi, '"')
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*(?:,\s*)+/g, ", ")
    .replace(/,\s*\./g, ".")
    .replace(/:\s*\.\s*/g, ": ")
    .replace(/(?:\.\s*){2,}/g, ". ")
    .trim();
}

/** The operator's own first sentence, if it's short enough to read out. */
export function summariseProductDescription(description: string | null | undefined) {
  const text = plainProductText(description);
  if (!text) return null;

  const firstSentence = text.split(/(?<=[.!?])\s+/)[0].trim();
  return firstSentence.length <= 160 ? firstSentence : null;
}

const numberWord = "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
const amount = `(?:\\d+(?:\\.\\d+)?|${numberWord}|half an?|an?)`;
const range = `(${amount}(?:\\s*(?:-|to)\\s*${amount})?)`;
const unit = "(hours?|hrs?|minutes?|mins?|days?|nights?)";
const tripNoun =
  "(?:cruise|tour|trip|charter|experience|adventure|journey|sail|sailing|snorkel|dive|excursion|package|liveaboard|safari|outing|escape)";
// Only an explicit duration counts: "a 3 hour cruise", "Duration: 2.5 hours", "approx 90 mins".
// Loose numbers ("24 hours notice", "arrive 30 minutes before") never do.
const durationPatterns = [
  new RegExp(`\\b(?:duration|lasts?|runs? for|goes for|approx(?:imately|\\.)?|around|about)\\s*:?\\s*${range}[\\s-]*${unit}\\b`, "i"),
  new RegExp(`\\b${range}[\\s-]*${unit}[\\s-]+(?:\\w+[\\s-]+){0,2}${tripNoun}\\b`, "i")
];

function durationUnit(value: string, quantity: string) {
  const base = value.toLowerCase().startsWith("h")
    ? "hour"
    : value.toLowerCase().startsWith("m")
      ? "minute"
      : value.toLowerCase().startsWith("d")
        ? "day"
        : "night";
  const singular = /^(?:1|one|an?|half an?)$/i.test(quantity.trim());

  return singular ? base : `${base}s`;
}

/** "3 hours", "2 to 3 hours", "half a day": how long the trip runs, in words that fit "about ...". */
export function findProductDuration(product: Pick<PmsProduct, "title" | "description">) {
  const text = `${product.title}. ${plainProductText(product.description)}`;

  if (/\bhalf[\s-]day\b/i.test(text)) return "half a day";
  if (/\bfull[\s-]day\b/i.test(text)) return "a full day";

  for (const pattern of durationPatterns) {
    const match = text.match(pattern);
    if (match) {
      const quantity = match[1].replace(/\s*-\s*/, " to ").toLowerCase();
      return `${quantity} ${durationUnit(match[2], quantity.split(" to ").pop() ?? quantity)}`;
    }
  }

  return null;
}

/** What the operator says comes with the trip, from an "Includes:" line or list. */
export function findProductInclusions(product: Pick<PmsProduct, "description">) {
  const text = plainProductText(product.description);
  const match = text.match(/\b(?:inclusions?|includes|included|comes with|what'?s included)\s*:?\s*([^.!?]{3,200})/i);
  if (!match) return null;

  const items = match[1]
    .replace(/^(?:are|is)\s+/i, "")
    .split(/\s*,\s*/)
    .map((item) => item.replace(/[\s;:]+$/, "").trim())
    .filter(Boolean)
    // "Morning tea" reads as "morning tea" mid-sentence; "Great Barrier Reef levy" keeps its capitals.
    .map((item) => (/^[A-Z][a-z]*(?:\s+[a-z].*)?$/.test(item) ? lowerFirst(item) : item));
  if (!items.length || items.join(" ").length < 3) return null;

  return items.length === 1 || /\band\b/.test(items[items.length - 1])
    ? items.join(", ")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function lowerFirst(value: string) {
  return /^[A-Z][a-z]/.test(value) ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

type Occasion = {
  label: string;
  pattern: RegExp;
  signals: Array<{ pattern: RegExp; weight: number; reason?: string; titleOnly?: boolean }>;
  /** Trip details that rule a trip out for this group ("adults only", "not suitable for children"). */
  excludes?: RegExp;
};

// Family first, so "my wife and the kids" gets a family pick rather than a couple's one.
const occasions: Occasion[] = [
  {
    label: "a family",
    pattern: /\b(?:family|families|kids?|children|child|toddlers?|little ones)\b/i,
    signals: [
      { pattern: /\b(?:famil(?:y|ies)|kids?|children)\b/i, weight: 3, reason: "it's pitched at families" },
      { pattern: /\b(?:whales?|humpbacks?)\b/i, weight: 2, reason: "kids usually love the whales" },
      { pattern: /\bdolphins?\b/i, weight: 2, reason: "kids usually love the dolphins" },
      { pattern: /\bsnorkel(?:l?ing)?\b/i, weight: 2, reason: "they get to snorkel" },
      { pattern: /\b(?:lunch|bbq)\b/i, weight: 1 }
    ],
    excludes: /\b(?:not suitable|unsuitable) for (?:children|kids|infants)\b|\bno (?:children|kids)\b|\badults? only\b|\b18\s*\+|\bover 18s?\b/i
  },
  {
    label: "a couple",
    pattern:
      /\b(?:couples?|romantic|romance|anniversary|honeymoon|date night|proposal|propose|my (?:wife|husband|partner|girlfriend|boyfriend|fianc[eé]e?)|the two of us|just us two)\b/i,
    signals: [
      { pattern: /\b(?:sunset|twilight)\b/i, weight: 3, reason: "it's out on the water around sunset" },
      { pattern: /\b(?:dinner|dining)\b/i, weight: 3, reason: "it's the dining one" },
      { pattern: /\bprivate\b/i, weight: 2, reason: "you'd have the boat to yourselves", titleOnly: true },
      { pattern: /\bromantic\b/i, weight: 3 },
      { pattern: /\b(?:champagne|sparkling|wine|bubbles|cocktails?)\b/i, weight: 1 },
      { pattern: /\bluxury\b/i, weight: 1 }
    ]
  },
  {
    label: "a group",
    pattern: /\b(?:group|mates|friends|birthday|hens?|bucks?|celebrat\w*|work (?:do|function)|corporate)\b/i,
    signals: [
      { pattern: /\b(?:private|charter)\b/i, weight: 3, reason: "you'd have the boat to yourselves", titleOnly: true },
      { pattern: /\b(?:party|celebrat\w*|groups?|functions?)\b/i, weight: 3, reason: "it's set up for groups" },
      { pattern: /\b(?:bbq|drinks|bar)\b/i, weight: 1 }
    ]
  }
];

/**
 * Kai's pick for who's travelling ("for a couple", "with the kids", "for my mate's birthday"), when
 * one trip clearly suits them better than the rest. No clear winner, no pick: the full list is more
 * honest than a coin toss.
 */
export function pickProductForOccasion(message: string, products: PmsProduct[]) {
  const occasion = occasions.find((candidate) => candidate.pattern.test(message));
  if (!occasion || products.length < 2) return null;

  const scored = products
    .map((product) => {
      const body = `${product.title} ${plainProductText(product.description)}`;
      if (occasion.excludes?.test(body)) return { product, score: -1, reason: null };
      const matched = occasion.signals.filter((signal) => signal.pattern.test(signal.titleOnly ? product.title : body));

      return {
        product,
        score: matched.reduce((total, signal) => total + signal.weight, 0),
        reason: matched.find((signal) => signal.reason)?.reason ?? null
      };
    })
    .sort((a, b) => b.score - a.score);

  const [best, runnerUp] = scored;
  if (!best.reason || best.score === 0 || best.score === runnerUp.score) return null;

  return { product: best.product, occasion: occasion.label, reason: best.reason, isFamily: occasion.label === "a family" };
}

/** "Which one's best for us?", "what's good for a couple?": asking Kai to choose, not to list. */
export function asksForSuggestion(message: string) {
  return /\b(?:recommend|suggest|what'?s good|what is good|which (?:one|trip|cruise|tour|option)|best (?:one|trip|option|bet|for)|suits? (?:us|a|our)|would you (?:pick|choose|go)|should (?:we|i) (?:do|book|pick|choose))\b/i.test(
    message
  );
}
