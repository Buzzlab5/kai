import type { BluePassRequiredInquiryField } from "./intent";
import { resolveBluePassDisplayPrice, type BluePassYachtCard, type BluePassYachtCatalogItem } from "./catalog";
import { buildDestinationComparison, buildDestinationSeasonNote } from "./destination-notes";
import { bluePassVesselNoun, type BluePassMarket } from "./market";

type BluePassYachtSummary = Pick<
  BluePassYachtCard,
  "name" | "region" | "tier" | "maxGuests" | "cabins" | "priceSignal" | "charterPriceSignal" | "displayPrice" | "productUrl"
>;

const fieldLabels: Record<BluePassRequiredInquiryField, string> = {
  destination: "destination",
  dateWindow: "dates",
  guests: "group size",
  travellerName: "name",
  travellerEmail: "email",
  travellerPhone: "phone number"
};

export function buildBluePassMissingFieldsReply(input: {
  destination?: string;
  selectedYacht?: BluePassYachtCatalogItem | null;
  missingFields: BluePassRequiredInquiryField[];
  /** The traveller picked this boat on an earlier turn, so Kai has already described it. */
  yachtAlreadyIntroduced?: boolean;
  /** Kai's previous message. If the ask would repeat it word for word ("ok", then "ok" again), it is softened instead. */
  previousReply?: string | null;
}) {
  const reply = buildMissingFieldsAsk(input);

  // Never repeat a line from Kai's own last message word for word (docs/kai-personality.md). Found by
  // running that doc against production, 2026-10-03: two "ok"s in a row got the same ask twice.
  if (input.previousReply && input.previousReply.trim() === reply.trim()) {
    return `No rush. Whenever you have your ${formatFieldList(input.missingFields)}, send them through and I'll take it from there.`;
  }

  return reply;
}

function buildMissingFieldsAsk(input: {
  destination?: string;
  selectedYacht?: BluePassYachtCatalogItem | null;
  missingFields: BluePassRequiredInquiryField[];
  yachtAlreadyIntroduced?: boolean;
}) {
  if (input.selectedYacht) {
    return buildSelectedYachtMissingFieldsReply({
      yacht: input.selectedYacht,
      missingFields: input.missingFields,
      alreadyIntroduced: input.yachtAlreadyIntroduced ?? false
    });
  }

  const missing = formatFieldList(input.missingFields);
  const context = input.destination ? ` for ${input.destination}` : "";

  return `Happy to get this moving${context}. I just need your ${missing}, then I'll send your enquiry to the operator to confirm.`;
}

export function buildBluePassInquiryReadyReply(input: {
  inquiryId: string;
  selectedYachtName?: string | null;
  dispatchQueued: boolean;
  dispatchFailed?: boolean;
}) {
  const target = input.selectedYachtName ? ` for ${input.selectedYachtName}` : "";
  const reference = `(reference ${input.inquiryId})`;

  if (input.dispatchFailed) {
    return `Your enquiry${target} is saved ${reference}, but I couldn't get it to the operator on WhatsApp just now, so it's waiting for the BluePass team to send it on. It's not a confirmed booking yet: the operator still needs to confirm availability and the final price.`;
  }

  if (input.dispatchQueued) {
    return `Done. Your enquiry${target} is on its way to the operator ${reference}. It's not a confirmed booking yet: they'll confirm availability and the final price, and I'll let you know as soon as they reply.`;
  }

  return `Your enquiry${target} is saved ${reference} and ready for the BluePass team to send to the operator. It's not a confirmed booking yet: the operator still needs to confirm availability and the final price.`;
}

export function buildBluePassInquiryConfirmationReply(input: {
  selectedYachtName?: string | null;
  destination?: string;
  dateWindow?: string;
  guests?: number;
  travellerName?: string;
  travellerEmail?: string;
  travellerPhone?: string;
}) {
  const yacht = input.selectedYachtName ? ` for ${input.selectedYachtName}` : "";
  const destination = input.destination ? ` in ${input.destination}` : "";
  const trip = [input.dateWindow, input.guests ? `${input.guests} guests` : null].filter(Boolean).join(", ");
  const contact = [input.travellerName, input.travellerEmail, input.travellerPhone].filter(Boolean).join(", ");
  const tripSentence = trip ? ` Trip details: ${trip}.` : "";
  const contactSentence = contact ? ` Contact details: ${contact}.` : "";

  return `Here's what I'll send to the operator${yacht}${destination}.${tripSentence}${contactSentence} Want me to send it now?`;
}

export function buildBluePassInquiryStatusReply(input: {
  inquiryId: string;
  selectedYachtName?: string | null;
  status: string;
}) {
  const target = input.selectedYachtName ? ` for ${input.selectedYachtName}` : "";
  const update =
    inquiryStatusUpdates[input.status] ?? `it's ${input.status.replace(/_/g, " ").toLowerCase()}.`;

  return `Quick update on your enquiry${target} (reference ${input.inquiryId}): ${update}`;
}

// What each BluePassInquiryStatus means for the traveller, in plain words, with the honest next step.
const inquiryStatusUpdates: Record<string, string> = {
  DRAFT: "it's saved and waiting to go to the operator.",
  READY_TO_DISPATCH: "it's saved and waiting to go to the operator.",
  OPERATOR_PENDING:
    "it's with the operator, pending their reply. They still need to confirm availability and the final price, and I'll let you know as soon as they get back to us.",
  OPERATOR_ACCEPTED:
    "good news, the operator has said yes. The final price comes next, and nothing is booked until you've approved it and paid.",
  COUNTER_OFFERED:
    "the operator has come back with a different offer, which I've passed on in this chat. Tell me if you'd like to take it or see other options.",
  DECLINED: "the operator can't do it this time. Want me to find you something similar?",
  CLOSED: "it's closed. If you'd like to start a new one, just tell me where and when."
};

export function buildBluePassYachtOverviewReply(yacht: BluePassYachtCard) {
  // kai-conversation-flow-notes.md item 12/14: one price (resolveBluePassDisplayPrice's pick), no
  // "Price signal:"/"Charter signal:" internal labels - the charter total only appears as a secondary
  // parenthetical when it's a genuinely different figure from the displayed price.
  const charter =
    yacht.charterPriceSignal && yacht.charterPriceSignal !== yacht.displayPrice ? ` (${yacht.charterPriceSignal}.)` : "";

  const price = yacht.displayPrice ? ` ${capitalizeFirst(yacht.displayPrice)}.` : "";

  return `${yacht.name} is ${articleFor(yacht.tier)} ${yacht.tier} ${bluePassVesselNoun(yacht.region)} in ${yacht.region}, with room for up to ${yacht.maxGuests} guests across ${countLabel(yacht.cabins, "cabin")}.${price}${charter} I can compare it with similar boats, or send the operator an enquiry to check real availability.`;
}

export function buildBluePassRecommendationReply(input: {
  destination?: string;
  matches: BluePassYachtSummary[];
  excludedYachtNames?: string[];
}) {
  const destination = input.destination ? ` in ${input.destination}` : "";
  const excluded = input.excludedYachtNames?.length
    ? ` besides ${formatNaturalList(input.excludedYachtNames)}`
    : "";
  const matches = input.matches.slice(0, 3);

  if (matches.length === 0) {
    return `Happy to help you find the right boat${destination}. Tell me when you're going, how many of you, and whether it's more diving or cruising, and I'll narrow it down.`;
  }

  const rows = formatYachtRows(matches);
  const intro = input.destination
    ? `Here are a few good options${destination}${excluded}:`
    : `Here's what BluePass has in ${formatNaturalList(Array.from(new Set(matches.map((yacht) => yacht.region))))}${excluded}:`;

  return `${intro}\n${rows}\n\nI can compare these, tell you who each one suits, or narrow it down by dates, group size, diving or cruising, and budget.`;
}

// kai-conversation-flow-notes.md item 11: a traveller who objected to price ("way over budget, any
// other options?") used to get the same unfiltered top-3 shown again, since nothing changed in the
// sticky search context. Now paired with a budget-aware search (catalog.ts's resolveBluePassDisplayPrice/
// budget scoring), this either shows what genuinely fits or says so honestly instead of re-showing the
// same boats with different words.
export function buildBluePassPriceObjectionReply(input: {
  matches: (BluePassYachtSummary & { reasons?: string[] })[];
  destination?: string;
}) {
  const destination = input.destination ? ` in ${input.destination}` : "";
  const fitting = input.matches.filter((yacht) => yacht.reasons?.includes("within budget")).slice(0, 3);

  if (fitting.length === 0) {
    return `Nothing${destination} fits that budget in the BluePass catalogue right now, and I'd rather be straight with you than stretch it. Happy to show you the full range anyway, or tell me what matters most and I'll find the closest fit.`;
  }

  return `Here's what fits your budget${destination}:\n${formatYachtRows(fitting)}\n\nI can compare these or narrow it down by dates and group size.`;
}

// Only seen word-for-word when the LLM is off or its rewrite is rejected; with the LLM on it is the
// grounding for a general-knowledge answer. Either way it must be honest (no guessing) and still
// move the trip forward.
export function buildBluePassOpenQuestionReply(input?: {
  offCatalogPlace?: string | null;
  destination?: string | null;
  /** Regions BluePass does cover near the off-catalogue place, offered instead. */
  nearbyRegions?: string[];
}) {
  if (input?.offCatalogPlace) {
    const alternative = input.nearbyRegions?.length
      ? `We do have ${formatNaturalList(input.nearbyRegions)} if you'd like a look.`
      : "Happy to show you what we do have if you're keen.";

    return `${input.offCatalogPlace} isn't somewhere BluePass has vetted trips yet, so I won't pretend otherwise. ${alternative}`;
  }

  const honest = "Good question. I don't want to give you a dud answer on that one, so I won't guess.";

  // Never re-ask for a destination the traveller already gave.
  return input?.destination
    ? `${honest} The operator can confirm it once we've picked your trip in ${input.destination}.`
    : `${honest} What I can do is line up trips that suit: where are you thinking of heading?`;
}

// Kai conversation flow audit (kai-conversation-flow-notes.md), stop-the-line item A: an LLM rewrite
// once described the 5% as "likely a service fee... goes towards maintaining the platform" - the
// exact inverse of the truth. This is the grounded source of truth, verified against the real copy
// on bluepass.co/conservation (ConservationHero.tsx: "Bluepass' commission comes from the operator's
// side - never added to your fare"; PromiseGrid.tsx: Operator 95% / Ocean 5%) - never paraphrase this
// away from those two facts, and never call the 5% a platform/service fee.
export function buildBluePassValueReply() {
  return "You pay the operator's own price, the same as booking direct, because our commission comes from the operator's side and is never added to your fare. Every operator is vetted, and 5% of every booking goes to ocean conservation before we take a cent.";
}

// Deeper "where does it go / who verifies it" question gets the fuller answer with named partners -
// verified against lib/conservation.ts's real partner list, not invented. Points to the public page
// rather than re-stating every detail, so this never drifts out of sync with the actual page.
export function buildBluePassConservationReply() {
  return "5% of every booking is set aside for the ocean before we take a cent, and it's never a platform fee. Our commission comes from the operator's side and is never added to your fare. The partners are named and the reports are dated: Great Barrier Reef Foundation in Cairns, Whitsundays Marine Trust in Airlie Beach and Hervey Bay Whale Research in Hervey Bay. The full record is at bluepass.co/conservation.";
}

// Split from a single merged detector (kai-conversation-flow-notes.md) so the deeper "where does it
// go / who verifies it" question gets buildBluePassConservationReply's fuller, named-partner answer
// instead of the shorter general value-prop line.
export function isBluePassConservationQuestion(content: string) {
  const normalized = content.toLowerCase();
  // "%" is not a word character, so a trailing `\b` right after it never matches when the sign is
  // followed by whitespace or punctuation (i.e. almost always in real sentences like "the 5% fee") -
  // that silently broke this detector for the single most common phrasing of the question. The
  // numeric branch is checked separately, without a trailing \b, so it isn't subject to that bug.
  return (
    /\b5\s*%/.test(normalized) ||
    /\bfive\s*percent\b/.test(normalized) ||
    /\b(?:conservation|give\s*back|goes?\s+to\s+the\s+ocean|verif(?:y|ies|ied|ication))\b/.test(normalized)
  );
}

export function isBluePassValuePropQuestion(content: string) {
  const normalized = content.toLowerCase();
  return (
    /\b(?:what is|what's|tell me about|explain)\s+bluepass\b/.test(normalized) ||
    /\b(?:why|how)\s+(?:should\s+i\s+)?(?:use|book\s+(?:with|through|via|on)|go\s+through|choose)\s+bluepass\b/.test(normalized) ||
    /\bwhy\s+(?:should\s+i\s+)?(?:use|book\s+(?:with|through|via)|go\s+through|choose)\s+you\b/.test(normalized) ||
    /\b(?:why|how)\s+bluepass\b/.test(normalized) ||
    /\b(?:book(?:ing)?\s+direct|direct\s+booking|same\s+price|better\s+than\s+(?:going\s+)?direct|instead\s+of\s+(?:going\s+)?direct)\b/.test(
      normalized
    )
  );
}

// Traveller-facing answer to "what commission do you take?". Kai explains how the commission works
// (capped, operator-side, never added to the fare) but, per the BluePass copy rule, the only
// percentage it states is the 5% to the ocean; the split itself stays internal. Operators and
// partners get their own playbooks in triage.ts. market is kept for call-site compatibility.
export function buildBluePassCommissionReply(_market?: BluePassMarket) {
  return "It's a capped commission that comes from the operator's side, never added to your fare, so you pay the same as booking direct. And 5% of every booking is set aside for the ocean before we take a cent.";
}

export function buildBluePassSmallTalkReply(input?: {
  gratitude?: boolean;
  latestMessage?: string;
  destination?: string;
  /** Mid-enquiry, the next step of the enquiry replaces the usual "what can I help with" line. */
  enquiryReminder?: string | null;
  /** An enquiry is under way even if there's nothing new to remind them of (Kai only just did). */
  midEnquiry?: boolean;
}) {
  if (input?.gratitude) {
    if (input.enquiryReminder) return `No worries at all. ${input.enquiryReminder}`;
    if (input.midEnquiry) return "No worries at all.";

    return "No worries at all. Just give me a shout if you want to compare a few more boats or pick this up again later.";
  }

  const message = input?.latestMessage ?? "";
  const opener = /\bhow(?:'s|\s+is|\s+are)\b.*\b(?:you|going|things)\b/i.test(message)
    ? "Going well, thanks for asking."
    : /\b(?:can you help|help me|what can you do)\b/i.test(message)
      ? "Happy to."
      : "Hey, good to hear from you.";
  if (input?.enquiryReminder) return `${opener} ${input.enquiryReminder}`;
  if (input?.midEnquiry) return opener;

  const nextStep = input?.destination
    ? `Still keen on ${input.destination}, or want to look further afield?`
    : "Where are you thinking of heading?";

  return `${opener} I can find you a reef trip, liveaboard or sailing charter that suits, compare a few side by side, or talk through what to expect before you go. ${nextStep}`;
}

export function buildBluePassSeasonReply(destination: string, options: { inCatalogue?: boolean } = {}) {
  const season = buildDestinationSeasonNote(destination);

  if (!season) {
    return `I don't have solid seasonal notes for ${destination} yet, and I'd rather not guess. The operator will know the local conditions best, so it's a good one to ask them when you enquire.`;
  }

  // Knowing a place isn't the same as having boats there, so Kai says which it is.
  return options.inCatalogue === false
    ? `${season} BluePass doesn't have trips there just yet, but I'm happy to show you what we do have.`
    : `${season} If you've got dates in mind, I'll line up what fits.`;
}

export function buildBluePassDestinationComparisonReply(regions: string[] = ["Komodo", "Raja Ampat"]) {
  return (
    buildDestinationComparison(regions) ??
    `I can walk through what's different between ${formatNaturalList(regions)}, but I don't have detailed side-by-side notes for that pairing yet. Tell me what matters most (trip style, length, budget) and I'll compare what actually fits.`
  );
}

export function buildBluePassYachtComparisonReply(
  yachts: Pick<BluePassYachtCard, "name" | "region" | "tier" | "maxGuests">[]
) {
  const shortlist = yachts.slice(0, 3);
  const rows = shortlist
    .map((yacht) => `${yacht.name}: ${yacht.tier}, ${yacht.region}, ${yacht.maxGuests} guests.`)
    .join(" ");

  // Route hint follows the ACTUAL regions being compared - never name-drop Komodo/Raja on an
  // Australian (or mixed) comparison.
  const regions = [...new Set(shortlist.map((yacht) => yacht.region).filter(Boolean))];
  const routeHint =
    regions.length === 0
      ? "Each suits a different kind of trip."
      : regions.length === 1
        ? `Each runs its own route in ${regions[0]} and suits a different kind of trip.`
        : `They run different routes across ${formatNaturalList(regions)} and suit different kinds of trips.`;

  return `${rows} ${routeHint} Want me to narrow it down by dates and group size?`;
}

function formatFieldList(fields: BluePassRequiredInquiryField[]) {
  const labels = fields.map((field) => fieldLabels[field]);
  if (labels.length <= 1) return labels[0] ?? "details";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

function buildSelectedYachtMissingFieldsReply(input: {
  yacht: BluePassYachtCatalogItem;
  missingFields: BluePassRequiredInquiryField[];
  alreadyIntroduced: boolean;
}) {
  const yacht = input.yacht;
  const primaryPrice = resolveBluePassDisplayPrice(yacht);
  const priceText = primaryPrice ? ` ${capitalizeFirst(primaryPrice)}.` : "";
  const cabinText = [yacht.cabins ? countLabel(yacht.cabins, "cabin") : null, yacht.maxGuests ? `up to ${yacht.maxGuests} guests` : null]
    .filter(Boolean)
    .join(", ");
  const vessel = bluePassVesselNoun(yacht.region);
  const intro = `Good pick. ${yacht.name} is ${articleFor(yacht.tier)}${yacht.tier ? ` ${yacht.tier}` : ""} ${vessel} in ${yacht.region}${cabinText ? ` (${cabinText})` : ""}.${priceText}`;
  const bookingTruth = "I can't check live availability or take payment in chat, but I'll get the operator to confirm.";
  // Second time round the boat and the booking caveat have already been said, so just move on.
  const opener = input.alreadyIntroduced ? "Got it, thanks." : `${intro} ${bookingTruth}`;
  const needsDates = input.missingFields.includes("dateWindow");
  const needsGuests = input.missingFields.includes("guests");

  if (needsDates || needsGuests) {
    const question =
      needsDates && needsGuests
        ? "When are you thinking of going, and how many of you?"
        : needsDates
          ? "When are you thinking of going?"
          : "How many of you are going?";

    return `${opener} ${question}`;
  }

  const contactFields = [
    input.missingFields.includes("travellerName") ? "name" : null,
    input.missingFields.includes("travellerEmail") ? "email" : null,
    input.missingFields.includes("travellerPhone") ? "WhatsApp number" : null
  ].filter((value): value is string => Boolean(value));

  if (contactFields.length > 0) {
    const contactOpener = input.alreadyIntroduced
      ? `Nearly there for ${yacht.name}.`
      : `Nice, ${yacht.name} it is. ${bookingTruth}`;

    if (input.missingFields.includes("travellerPhone")) {
      return `${contactOpener} Pop your details in the form below so the operator can get back to you.`;
    }

    return `${contactOpener} When you're ready, send me your ${formatNaturalList(contactFields)} and I'll get your enquiry to the operator. I've already got this WhatsApp number for follow-up.`;
  }

  return `${intro} ${bookingTruth}`;
}

/**
 * Where an enquiry is up to, as one line Kai adds after answering a side question mid-enquiry, so the
 * traveller doesn't have to scroll back to find what's next. Null once everything's in: whether it's
 * already been sent isn't something this line can know.
 */
export function buildBluePassEnquiryReminder(input: {
  yachtName: string;
  missingFields: BluePassRequiredInquiryField[];
  /** Everything's in and nothing has been sent from this chat yet, so it's just waiting on a yes. */
  readyToSend?: boolean;
}) {
  const needsDates = input.missingFields.includes("dateWindow");
  const needsGuests = input.missingFields.includes("guests");

  if (needsDates || needsGuests) {
    const ask =
      needsDates && needsGuests
        ? `your dates and how many of you for ${input.yachtName}`
        : needsDates
          ? `your dates for ${input.yachtName}`
          : `how many of you are going on ${input.yachtName}`;
    return `When you're ready, just tell me ${ask}.`;
  }

  const contactFields = [
    input.missingFields.includes("travellerName") ? "name" : null,
    input.missingFields.includes("travellerEmail") ? "email" : null
  ].filter((value): value is string => Boolean(value));

  if (input.missingFields.includes("travellerPhone")) {
    return "When you're ready, pop your details in the form below and I'll get your enquiry to the operator.";
  }

  if (contactFields.length > 0) {
    return `When you're ready, send me your ${formatNaturalList(contactFields)} and I'll get your enquiry to the operator.`;
  }

  return input.readyToSend ? `When you're ready, just say yes and I'll send your ${input.yachtName} enquiry to the operator.` : null;
}

function formatYachtRows(matches: BluePassYachtSummary[]) {
  return matches
    .map((yacht, index) => {
      const capacity = `${countLabel(yacht.cabins, "cabin")}, up to ${yacht.maxGuests} guests`;
      const link = yacht.productUrl ? ` Details: ${yacht.productUrl}` : "";

      const price = yacht.displayPrice ? ` ${capitalizeFirst(yacht.displayPrice)}.` : "";

      return `${index + 1}. ${yacht.name} - ${yacht.tier} in ${yacht.region}, ${capacity}.${price}${link}`;
    })
    .join("\n");
}

function countLabel(count: number | null | undefined, noun: string) {
  return `${count ?? 0} ${noun}${count === 1 ? "" : "s"}`;
}

function capitalizeFirst(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatNaturalList(values: string[]) {
  if (values.length <= 1) return values[0] ?? "details";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function articleFor(value?: string | null) {
  if (!value) return "a";

  return /^[aeiou]/i.test(value) ? "an" : "a";
}


// "Which booking systems do you connect to?" is a real question from operators and curious travellers,
// and used to get the enquiry script ("I just need your destination, dates...") because nothing
// answered it (found by running docs/kai-personality.md against production, 2026-10-03). Only names
// systems BluePass has a connector for (Rezdy, FareHarbor, Inseanq), per house rule 8.
const bookingSystemQuestionPattern =
  /\b(?:booking|reservation) (?:systems?|software|platforms?)\b|\b(?:connect|integrate|integrates|integration|sync|work) (?:with|to)\b.{0,50}\b(?:rezdy|fareharbor|b[oó]kun|peek ?pro|checkfront|bookeo|rezgo|pms)\b/i;

export function isBluePassBookingSystemQuestion(content: string) {
  return bookingSystemQuestionPattern.test(content) && /\?|^(?:which|what|do|does|can|is|are)\b/i.test(content.trim());
}

export function buildBluePassBookingSystemsReply() {
  return "We work with operators on Rezdy, FareHarbor and Inseanq, and with operators who have no booking system at all, where the team confirms by hand. Is there a trip you're keen on?";
}
