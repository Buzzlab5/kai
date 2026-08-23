export type BookingBrainIntent =
  | "CHECK_AVAILABILITY"
  | "BOOKING_INQUIRY"
  | "PRODUCT_RECOMMENDATION"
  | "HUMAN_HANDOFF"
  | "GENERAL_QUESTION";

export type BookingBrainConfidence = "HIGH" | "MEDIUM" | "LOW";
export type BookingBrainMissingSlot = "product" | "date" | "guests";

export interface BookingBrainSlots {
  productHint: string | null;
  dateText: string | null;
  guests: number | null;
  /** kai-conversation-flow-notes.md item 10. AUD-only (Boattime is AUD-only) - never a booking-
   * blocking slot, so it's not in BookingBrainMissingSlot/getMissingSlots. */
  budget: number | null;
}

export interface BookingBrainResult {
  intent: BookingBrainIntent;
  confidence: BookingBrainConfidence;
  slots: BookingBrainSlots;
  missingSlots: BookingBrainMissingSlot[];
}

// Hand-authored and tenant-agnostic, not read from any tenant's real publicProductCatalog - a
// deliberate gap for the fast, LLM-free regex path only. When a title here is stale (renamed) or
// missing, the message still resolves correctly via the LLM router (shouldEscalateGenericBookingRouterToLlm
// always escalates when findProductHint comes back empty) - confirmed live for Riverfire 2026 on
// boattimeyachtcharters.com (2026-08-23) - but that costs an LLM call the regex path exists to
// avoid, and depends on a router client being configured at all. Kept in sync by hand with
// Boattime's catalog (2026-08-23): the two renamed entries ("Broadwater Twilight Dining", "Coastal
// Lunch Escape" -> "Gold Coast: Chef's Table Dinner" / "Gold Coast: Chef's Table") are kept
// alongside their new names so a returning traveller typing the old name is still recognized.
const PRODUCT_HINTS = [
  "Komodo Day Trip",
  "Private Charter",
  "Reef Day Snorkel",
  "Gold Coast Whale Escape",
  "Twilight Drift",
  "Broadwater Twilight Dining",
  "Coastal Lunch Escape",
  "Private Yacht Charter",
  "Gold Coast: Chef's Table Dinner – Flavours of Australia",
  "Gold Coast: Chef's Table – Flavours of Australia",
  "Riverfire 2026",
  "New Year's Eve 2026",
  "Valentine's evening",
  "Corporate Charter",
  "Wedding Yacht Charter"
];
const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12"
};
const MONTH_PATTERN = Object.keys(MONTHS)
  .sort((left, right) => right.length - left.length)
  .join("|");
const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};
const WEEKDAY_PATTERN = Object.keys(WEEKDAYS).join("|");

function findProductHint(message: string) {
  const lowerMessage = message.toLowerCase();

  return (
    PRODUCT_HINTS.find((product) => lowerMessage.includes(product.toLowerCase())) ??
    (lowerMessage.includes("komodo") ? "Komodo Day Trip" : null)
  );
}

// kai-conversation-flow-notes.md finding #4 (booking-integrity, high): a traveller typed "14 March
// 2027" and Kai echoed "2026-03-14" - it silently defaulted to a hardcoded current year and dropped
// the explicit year the traveller actually gave. Copy rule: "Always resolve the year explicitly."
// When no year is given at all, picks the next real occurrence of that month/day (this year if it
// hasn't passed yet, else next year) instead of a hardcoded literal that goes stale every January.
function resolveDefaultYear(month: number, day: number, now: Date = new Date()) {
  const currentYear = now.getUTCFullYear();
  const candidate = new Date(Date.UTC(currentYear, month - 1, day));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return candidate.getTime() >= today.getTime() ? currentYear : currentYear + 1;
}

function findDateText(message: string, now: Date = new Date()) {
  const lowerMessage = message.toLowerCase();
  const relativeDate = lowerMessage.match(/\b(today|tomorrow|tonight)\b/);
  if (relativeDate) {
    return relativeDate[1];
  }

  const isoDate = lowerMessage.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (isoDate) {
    return isoDate[0];
  }

  const numericDayMonthDate = lowerMessage.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numericDayMonthDate) {
    const day = Number(numericDayMonthDate[1]);
    const month = Number(numericDayMonthDate[2]);
    const rawYear = numericDayMonthDate[3];

    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const year = rawYear ? (rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear)) : resolveDefaultYear(month, day, now);
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // Day-first ordinal ("14th of March 2027", "14 March") with an optional trailing explicit year -
  // previously this pattern had no year-capturing group at all, so any explicit year the traveller
  // gave was matched by the regex but never read, silently discarded.
  const ordinalMonthDate = lowerMessage.match(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?(${MONTH_PATTERN})\\b(?:\\s*,?\\s*(\\d{4}))?`)
  );
  if (ordinalMonthDate) {
    const day = Number(ordinalMonthDate[1]);
    const month = Number(MONTHS[ordinalMonthDate[2]]);
    const explicitYear = ordinalMonthDate[3];
    const year = explicitYear ? Number(explicitYear) : resolveDefaultYear(month, day, now);
    return `${year}-${MONTHS[ordinalMonthDate[2]]}-${String(day).padStart(2, "0")}`;
  }

  // Month-first ("March 14, 2027" / "March 14 2027") - not handled by either pattern above at all.
  const monthFirstDate = lowerMessage.match(
    new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?\\b`)
  );
  if (monthFirstDate) {
    const day = Number(monthFirstDate[2]);
    const month = Number(MONTHS[monthFirstDate[1]]);
    const explicitYear = monthFirstDate[3];
    const year = explicitYear ? Number(explicitYear) : resolveDefaultYear(month, day, now);
    return `${year}-${MONTHS[monthFirstDate[1]]}-${String(day).padStart(2, "0")}`;
  }

  // Weekday names ("Saturday", "this Saturday", "next Saturday") - not covered by any pattern above.
  // Resolves to the next real calendar occurrence of that weekday; "next" skips past the closest one
  // to the following week (so "next Saturday" said on a Monday means 12 days out, not 5).
  const weekdayDate = lowerMessage.match(new RegExp(`\\b(next\\s+)?(?:this\\s+)?(${WEEKDAY_PATTERN})\\b`));
  if (weekdayDate) {
    const wantsFollowingWeek = Boolean(weekdayDate[1]);
    const targetDay = WEEKDAYS[weekdayDate[2]];
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const currentDay = today.getUTCDay();
    let daysUntil = (targetDay - currentDay + 7) % 7;
    if (wantsFollowingWeek) {
      daysUntil += 7;
    }
    const target = new Date(today.getTime() + daysUntil * 24 * 60 * 60 * 1000);
    return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(target.getUTCDate()).padStart(2, "0")}`;
  }

  return null;
}

// kai-conversation-flow-notes.md finding #5: "2 adults" failed the same way bare "2" did - only
// guest|guests|pax|people|person|persons were accepted as the unit word, so a completely normal
// reply to "how many guests?" fell through to null and re-triggered the same question.
function findGuests(message: string) {
  const guestCount = message.match(
    /\b(\d{1,2})\s*(guest|guests|pax|people|person|persons|adult|adults|traveller|travellers|traveler|travelers)\b/i
  );
  if (!guestCount) {
    return null;
  }

  return Number(guestCount[1]);
}

// kai-conversation-flow-notes.md item 10: "budget about $500 each"/"budget $500" - AUD-only since
// Boattime is AUD-only (no currency code needed, unlike the Indonesia path's multi-currency parsing
// in bluepass/intent.ts).
function findBudget(message: string) {
  const match = message.match(/\bbudget\b[^\d]{0,15}(\d[\d,]*)/i);
  if (!match) return null;

  const amount = Number(match[1].replace(/,/g, ""));
  return amount > 0 ? amount : null;
}

function classifyIntent(message: string, now: Date = new Date()): BookingBrainIntent {
  const lowerMessage = message.toLowerCase();
  const dateText = findDateText(message, now);
  const guests = findGuests(message);
  const productHint = findProductHint(message);

  if (/\b(human|agent|operator|staff|person|refund|complaint)\b/.test(lowerMessage)) {
    return "HUMAN_HANDOFF";
  }

  // Checked before the generic availability-keyword catch below, on purpose. "What experiences do
  // you have available?" contains "available", but a traveller who doesn't know a product name yet
  // is asking to browse, not asking Kai to check a specific date - and CHECK_AVAILABILITY only ever
  // resolves by demanding a product/date/guests it can't supply. Reproduced live (2026-08-23): every
  // natural "what do you have" / "what do you offer" / "show me everything" phrasing landed here as
  // CHECK_AVAILABILITY (or, for phrasing outside the old trigger list, fell through to
  // GENERAL_QUESTION) and got stuck re-asking for a product name in a loop with no way out.
  if (
    /\b(recommend|recommendation|suggest|suggestion|options?|what should i do)\b/.test(lowerMessage) ||
    /\bwhat\b[\w\s]{0,20}\b(do you have|do you offer|have you got)\b/.test(lowerMessage) ||
    /\b(what'?s on offer|show me options|show me experiences|show me everything|everything you have|everything you offer|what can i do|what are my options)\b/.test(
      lowerMessage
    ) ||
    /\b(know about|learn about|tell me about|more about|info (about|on)|details? (about|on)|curious about|interested in|looking at)\b/.test(
      lowerMessage
    ) ||
    (Boolean(productHint) && /\b(see|view|look at|show me|let me see|open|page)\b/.test(lowerMessage))
  ) {
    return "PRODUCT_RECOMMENDATION";
  }

  if (/\b(available|availability|check|slot|spots?)\b/.test(lowerMessage)) {
    return "CHECK_AVAILABILITY";
  }

  if (dateText && /\b(what about|how about|instead)\b/.test(lowerMessage)) {
    return "CHECK_AVAILABILITY";
  }

  if (productHint && dateText && guests) {
    return "CHECK_AVAILABILITY";
  }

  if (
    productHint &&
    /\b(what about|how about|instead|rather|actually|i mean|switch|change|another|other|different)\b/.test(lowerMessage)
  ) {
    return "PRODUCT_RECOMMENDATION";
  }

  if (
    /\b(yes please|sounds good|looks good|i want it|i want this|i want that|want it|want this|want that|take it|let'?s do it|continue|go ahead|proceed)\b/.test(
      lowerMessage
    )
  ) {
    return "BOOKING_INQUIRY";
  }

  if (/\b(book|booking|reserve|reservation|trips?|tours?|charters?|boats?)\b/.test(lowerMessage)) {
    return "BOOKING_INQUIRY";
  }

  if (dateText && guests) {
    return "CHECK_AVAILABILITY";
  }

  return "GENERAL_QUESTION";
}

function getMissingSlots(intent: BookingBrainIntent, slots: BookingBrainSlots) {
  if (intent === "HUMAN_HANDOFF" || intent === "GENERAL_QUESTION" || intent === "PRODUCT_RECOMMENDATION") {
    return [];
  }

  const missingSlots: BookingBrainMissingSlot[] = [];
  if (!slots.productHint) {
    missingSlots.push("product");
  }
  if (!slots.dateText) {
    missingSlots.push("date");
  }
  if (!slots.guests) {
    missingSlots.push("guests");
  }

  return missingSlots;
}

function getConfidence(intent: BookingBrainIntent, missingSlots: BookingBrainMissingSlot[]) {
  if (intent === "HUMAN_HANDOFF") {
    return "HIGH";
  }

  if (missingSlots.length === 0) {
    return "HIGH";
  }

  return missingSlots.length === 3 ? "LOW" : "MEDIUM";
}

export function analyzeTravellerBookingMessage(message: string, now: Date = new Date()): BookingBrainResult {
  const intent = classifyIntent(message, now);
  const slots = {
    productHint: findProductHint(message),
    dateText: findDateText(message, now),
    guests: findGuests(message),
    budget: findBudget(message)
  };
  const missingSlots = getMissingSlots(intent, slots);

  return {
    intent,
    confidence: getConfidence(intent, missingSlots),
    slots,
    missingSlots
  };
}

export function composeBookingBrainReply(analysis: BookingBrainResult) {
  if (analysis.intent === "HUMAN_HANDOFF") {
    return "I can hand this to the team. I will keep the booking details grounded and avoid making changes until an operator reviews it.";
  }

  if (analysis.intent === "GENERAL_QUESTION") {
    return "I can help with availability, booking, or handing you off to the team.";
  }

  if (analysis.missingSlots.length > 0) {
    const missing = analysis.missingSlots;

    if (missing.join(",") === "product,date,guests") {
      return "I can help with that. Which tour, date, and number of guests should I check first?";
    }

    return `I can help with that. Please share the ${missing.join(", ")} and I'll check availability.`;
  }

  return `I can check ${analysis.slots.productHint} for ${analysis.slots.guests} guest${
    analysis.slots.guests === 1 ? "" : "s"
  } on ${analysis.slots.dateText}. Let me check availability before confirming anything.`;
}
