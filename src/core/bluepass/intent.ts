import { extractGuestCount } from "@/core/conversation/guest-count";

// Group-size phrasing is shared with the operator booking flow (core/conversation/guest-count.ts).
export { extractGuestCount as extractBluePassGuestCount } from "@/core/conversation/guest-count";

export type BluePassInquiryIntent = {
  destination?: string;
  tripType?: string;
  dateWindow?: string;
  guests?: number;
  budget?: string;
  travellerName?: string;
  travellerEmail?: string;
  travellerPhone?: string;
  selectedYachtSlug?: string;
  interests?: string[];
};

// kai-conversation-flow-notes.md item 10: intent.budget was parsed but never consumed by
// searchBluePassYachts - a traveller who said "budget about $500 each" got quoted $8,580+ boats with
// no filtering at all. This parses the display string (e.g. "USD 500") back into a number so the
// catalog search can score against it.
export function parseBluePassBudgetAmount(budget?: string): { currency: string; amount: number } | null {
  const match = budget?.match(/^([A-Z]{3})\s+([\d,]+)$/);
  if (!match) return null;

  return { currency: match[1], amount: Number(match[2].replace(/,/g, "")) };
}

export type BluePassRequiredInquiryField =
  | "destination"
  | "dateWindow"
  | "guests"
  | "travellerName"
  | "travellerEmail"
  | "travellerPhone";

const requiredFields: BluePassRequiredInquiryField[] = [
  "destination",
  "dateWindow",
  "guests",
  "travellerName",
  "travellerEmail",
  "travellerPhone"
];

// Komodo/Raja Ampat keep their existing spelling-variant synonyms; any other known region (e.g.
// an Australian region from a live catalog) matches on its own exact name, case-insensitively.
const regionSynonymPatterns: Record<string, RegExp> = {
  Komodo: /\b(?:komodo|labuan\s+bajo|flores)\b/gi,
  "Raja Ampat": /\braja\s+ampat\b/gi
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function regionPattern(region: string) {
  return regionSynonymPatterns[region] ?? new RegExp(`\\b${escapeRegExp(region)}\\b`, "gi");
}

export function isRegionMentioned(text: string, region: string): boolean {
  // matchAll (not .test()) deliberately: regionPattern's regex objects are module-level and
  // shared, and a /g-flagged regex's .test() is stateful across calls via lastIndex - matchAll
  // always starts fresh regardless of prior calls on the same pattern.
  return [...text.matchAll(regionPattern(region))].length > 0;
}

export function extractKnownDestination(text: string, knownRegions: string[]): string | undefined {
  let bestRegion: string | undefined;
  let bestIndex = -1;

  for (const region of knownRegions) {
    const mentions = [...text.matchAll(regionPattern(region))];
    const lastIndex = mentions.length > 0 ? mentions[mentions.length - 1].index ?? -1 : -1;

    if (lastIndex > bestIndex) {
      bestIndex = lastIndex;
      bestRegion = region;
    }
  }

  return bestRegion;
}

export function extractBluePassInquiryIntent(
  messages: string[],
  knownRegions: string[] = ["Komodo", "Raja Ampat"]
): BluePassInquiryIntent {
  const text = messages.join("\n");
  const lowerText = text.toLowerCase();
  const intent: BluePassInquiryIntent = {};

  const destination = extractKnownDestination(text, knownRegions);
  if (destination) intent.destination = destination;
  if (/\b(dive|diving)\b/i.test(text)) intent.interests = unique([...(intent.interests ?? []), "dive"]);
  if (/\b(private|charter)\b/i.test(text)) intent.interests = unique([...(intent.interests ?? []), "private"]);
  if (/\bcabin\b/i.test(text)) intent.interests = unique([...(intent.interests ?? []), "cabin"]);

  const guests = extractGuestCount(text);
  if (guests) intent.guests = guests;

  const dateWindow = extractDateWindow(text, lowerText);
  if (dateWindow) intent.dateWindow = dateWindow;

  const budget = findBudget(text);
  if (budget) intent.budget = budget;

  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch) intent.travellerEmail = emailMatch[0];

  const phoneMatch = text.match(/\b(?:phone|whatsapp|wa)(?:\s+number)?\s*(?:is|:)?\s*([+\d][\d\s().-]{6,})/i);
  const barePhone =
    // No "phone is" in front: an international number (+61 400 111 222) or an Australian or
    // Indonesian mobile (0400 111 222, 081234567890) is still clearly a phone number.
    text.match(/(?:^|[\s,;:(])(\+\d{1,3}[\d\s().-]{7,16}\d)/) ??
    text.match(/\b(04\d{2}[\s-]?\d{3}[\s-]?\d{3}|08\d{8,11})\b/);
  if (phoneMatch) intent.travellerPhone = phoneMatch[1].trim();
  else if (barePhone) intent.travellerPhone = barePhone[1].trim();

  const nameMatch = text.match(
    /\b(?:my name is|name is|i am|i'm)\s+([A-Za-z][A-Za-z' -]{1,60})(?=,|\.|$|\s+(?:email|phone|whatsapp)\b)/i
  );
  if (nameMatch) intent.travellerName = nameMatch[1].trim();

  return intent;
}

export function mergeBluePassInquiryIntent(
  previous: BluePassInquiryIntent | null | undefined,
  next: BluePassInquiryIntent
): BluePassInquiryIntent {
  return {
    ...(previous ?? {}),
    ...removeUndefined(next),
    interests: unique([...(previous?.interests ?? []), ...(next.interests ?? [])])
  };
}

export function getMissingBluePassInquiryFields(intent: BluePassInquiryIntent) {
  return requiredFields.filter((field) => {
    const value = intent[field];
    return value === undefined || value === null || value === "";
  });
}

// The first number with money evidence right next to it: a "$", a currency code (before or after),
// or a budget word shortly before. A year ("December 2026") is only money with a "$" or currency
// code. The old single regex took the first 3+ digit number anywhere (a year, or the "000" tail of
// "8,000") and then looked for a cue anywhere after it, so "December 2026 ... around $8,000"
// stored "USD 2026" and "budget $8,000" stored "USD 000". An explicit currency code is kept as
// stated; a bare "$" or cue falls back to USD, as before.
function findBudget(text: string) {
  for (const match of text.matchAll(/(?<![\d,.+-])(\d{1,3}(?:,\d{3})+|\d{3,9})(?!\d)/g)) {
    const amount = match[1];
    const start = match.index ?? 0;
    const before = text.slice(Math.max(0, start - 24), start);
    const after = text.slice(start + amount.length, start + amount.length + 8);
    const code = (before.match(/\b(USD|IDR|EUR|AUD)\s*\$?\s*$/i) ?? after.match(/^\s*(USD|IDR|EUR|AUD)\b/i))?.[1];
    const hasCurrency = Boolean(code) || /\$\s*$/.test(before);
    const hasCue = /\b(?:budget|around|about|approx(?:imately)?|under|up to|max(?:imum)?|total)\b/i.test(before);
    const isYear = /^(?:19|20)\d{2}$/.test(amount);

    if (isYear ? !hasCurrency : !hasCurrency && !hasCue) continue;
    return `${code?.toUpperCase() ?? "USD"} ${amount}`;
  }
}

function extractDateWindow(text: string, lowerText: string) {
  if (lowerText.includes("next month")) return "next month";
  if (lowerText.includes("tomorrow")) return "tomorrow";
  if (lowerText.includes("next week")) return "next week";

  const fullDayMonthMatch = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?[ \t]*(?:of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)(?:[ \t]*,?[ \t]*(\d{4}))?\b/i
  );
  if (fullDayMonthMatch) {
    return formatDayMonthDate(fullDayMonthMatch[1], fullDayMonthMatch[2], fullDayMonthMatch[3]);
  }

  const fullMonthDayMatch = text.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)[ \t]*(\d{1,2})(?:st|nd|rd|th)?(?:[ \t]*,?[ \t]*(\d{4}))?\b/i
  );
  if (fullMonthDayMatch) {
    return formatDayMonthDate(fullMonthDayMatch[2], fullMonthDayMatch[1], fullMonthDayMatch[3]);
  }

  const monthMatch = text.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i
  );
  return monthMatch ? titleCaseMonth(monthMatch[0]) : undefined;
}

function formatDayMonthDate(day: string, month: string, year?: string) {
  return [String(Number(day)), titleCaseMonth(month), year].filter(Boolean).join(" ");
}

function titleCaseMonth(month: string) {
  return month.slice(0, 1).toUpperCase() + month.slice(1).toLowerCase();
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function removeUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}
