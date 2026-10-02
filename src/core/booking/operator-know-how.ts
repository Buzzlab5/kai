import { bluePassDestinationNotes } from "@/core/bluepass/destination-notes";
import { classifyBluePassMarket } from "@/core/bluepass/market";
import { findTravellerFaqAnswer, type TravellerFaqTopic } from "@/core/bluepass/traveller-faq";
import type { PmsProduct } from "@/core/pms/types";
import { PERSON_OFFER } from "@/core/conversation/human-handoff";
import { cleanTenantName, isQuestionShaped } from "./booking-small-talk";
import { findProductDuration, findProductInclusions } from "./product-insight";
import { matchPmsProduct } from "./product-matcher";

/**
 * What Kai knows that helps on an operator's own booking widget without pretending to know the
 * operator's policies: general tips any good travel mate would give (seasickness, stingers,
 * insurance, visas), when to go for the operator's own waters, and how to get real times and
 * prices. Anything specific to the operator (kids, parking, drinks, refunds) is left to their own
 * knowledge answers or the team.
 */
export type OperatorKnowHowTopic = TravellerFaqTopic | "SEASON" | "TIMES" | "PRICE" | "FEES" | "DURATION" | "INCLUSIONS";

export interface OperatorKnowHowReply {
  topic: OperatorKnowHowTopic;
  /** The full reply, ending with Kai's usual next step ("Want me to check a date for you?"). */
  reply: string;
  /** Just the answer, for when a half-finished booking should be the next step instead. */
  answer: string;
  /** The reply is itself a question back ("which trip do you mean?"), so nothing should follow it. */
  asksBack?: boolean;
}

function knowHow(topic: OperatorKnowHowTopic, answer: string, nextStep?: string): OperatorKnowHowReply {
  return { topic, answer, reply: nextStep ? `${answer} ${nextStep}` : answer };
}

// General know-how that reads right on any operator's widget. The rest of the traveller FAQ
// ("most boats have wifi", "plenty of trips suit kids") would dodge a question about THIS operator.
const generalTopics = new Set<TravellerFaqTopic>(["SEASICKNESS", "STINGERS", "INSURANCE", "VISA", "DIVE_MEDICAL"]);
const topicsNeedingMarket = new Set<TravellerFaqTopic>(["STINGERS", "VISA"]);

const seasonPattern =
  /\b(?:best time|good time|right time|ideal time|what time of (?:the )?year|which months?|what months?|(?:whale|humpback|manta|turtle|dive|diving|liveaboard|migration) season|when(?:'s| is| are) (?:the )?(?:whales?|humpbacks?|season)|when (?:do|does|can) (?:you|we|i) (?:see|spot) (?:the )?(?:whales?|humpbacks?|mantas?))\b/i;
const timesPattern =
  /\b(?:what time(?! of\b)|when (?:does|do) (?:it|the|they|you|we)\b.{0,40}\b(?:leave|depart|start|go out|head out|run)|departure times?|start times?|what times?)\b/i;
const durationQuestionPattern =
  /\b(?:how long|how many hours|duration|what time does it (?:finish|end|get back)|when do (?:we|you) get back|length of)\b/i;
const inclusionQuestionPattern =
  /\b(?:what'?s included|what is included|what do (?:we|you|i) get|includes?|included|come with|comes with|provided|do (?:we|i|you) get (?:lunch|food|drinks|a meal|snacks|dinner))\b/i;
const generalInclusionQuestionPattern =
  /\b(?:what'?s included|what is included|what do (?:we|you|i) get|what does (?:it|the [\w\s]{1,40}?) include|what comes with|inclusions)\b/i;
const inclusionItemPattern =
  /\b(lunch|dinner|breakfast|morning tea|afternoon tea|food|snacks|drinks|alcohol|snorkel gear|wetsuits?|stinger suits?|equipment|gear|transfers?|pick ?ups?|parking|towels?)\b/i;
// A question about what the booking site itself takes ("how much commission do you take?"), not what a
// trip costs. Reported live on bluepass.co, 2026-10-03: the price pattern below matched "how much"
// and answered with a trip-price line, which read as Kai ignoring the question.
const feesPattern =
  /\b(?:commissions?|your cut|service fees?|booking fees?|platform fees?|mark ?-?ups?|(?:how|where) (?:do|does) (?:bluepass|kai|you|this) (?:make|earn) (?:its |your )?money)\b/i;
const pricePattern = /\b(?:how much|price|prices|pricing|cost|costs|(?<!-)rates?|fares?|per person)\b/i;

export async function findOperatorKnowHowReply(input: {
  message: string;
  tenantName?: string | null;
  /** The trip named in this message, or the one already chosen earlier in the chat. */
  productTitle?: string | null;
  /** A date is already on the table, so "tell me your date" would be the wrong answer. */
  dateKnown?: boolean;
  loadCatalogue: () => Promise<PmsProduct[]>;
}): Promise<OperatorKnowHowReply | null> {
  if (!isQuestionShaped(input.message)) return null;

  const tenantName = cleanTenantName(input.tenantName);
  const catalogueText = async () => {
    const catalogue = await input.loadCatalogue();
    return [tenantName ?? "", ...catalogue.flatMap((product) => [product.title, product.description])].join(" \n ");
  };

  // On the operator's own widget, whoever runs the trip is simply "the crew".
  const faq = findTravellerFaqAnswer({ message: input.message, operator: "the crew" });
  if (faq && generalTopics.has(faq.topic)) {
    if (!topicsNeedingMarket.has(faq.topic)) return knowHow(faq.topic, faq.answer);

    // Stingers and visas depend on where this operator runs.
    const text = await catalogueText();
    const ownPlaces = bluePassDestinationNotes.filter((note) => note.pattern.test(text));
    const messageMarket = classifyBluePassMarket([input.message]);
    const market = messageMarket !== "UNKNOWN" ? messageMarket : operatorMarket(text);
    if (market === "UNKNOWN") return null;

    const localFaq = findTravellerFaqAnswer({
      message: input.message,
      market,
      operator: "the crew",
      place: ownPlaces.length === 1 ? ownPlaces[0].name : null
    });
    return localFaq ? knowHow(localFaq.topic, localFaq.answer) : null;
  }

  if (seasonPattern.test(input.message)) {
    const text = await catalogueText();
    const ownPlaces = bluePassDestinationNotes.filter((note) => note.pattern.test(text));
    const askedPlace = bluePassDestinationNotes.find((note) => note.pattern.test(input.message));
    // Only the operator's own waters: a season for somewhere they don't run would change the subject.
    const place = askedPlace ? ownPlaces.find((note) => note === askedPlace) : ownPlaces.length === 1 ? ownPlaces[0] : null;
    if (!place) return null;

    return knowHow("SEASON", place.season, "If you've got dates in mind, I'll check what's running.");
  }

  if (feesPattern.test(input.message)) {
    // Only what is true on every booking: the fare is the operator's own and nothing is added on top.
    // No percentage here: the one number Kai ever states is the 5% for the ocean (see kai-persona.ts).
    return knowHow(
      "FEES",
      "You pay the operator's own price, the same as booking direct. Any commission comes out of the operator's side and is never added to your fare.",
      "Tell me the trip and your date and I'll check it for you."
    );
  }

  const asksDuration = durationQuestionPattern.test(input.message);
  // "What's included?" or "is lunch included?" can be read off the trip details; "does it include
  // GST?" can't, so it's left for the team rather than answered with the wrong list.
  const asksAboutInclusions = inclusionQuestionPattern.test(input.message);
  const asksInclusions =
    !asksDuration &&
    asksAboutInclusions &&
    (inclusionItemPattern.test(input.message) || generalInclusionQuestionPattern.test(input.message));
  if (asksDuration || asksInclusions) {
    const catalogue = await input.loadCatalogue();
    const match = matchPmsProduct(input.message, catalogue);
    const remembered = input.productTitle
      ? catalogue.find((product) => product.title.toLowerCase() === input.productTitle!.toLowerCase())
      : undefined;
    const product = match.status === "MATCHED" ? match.product : (remembered ?? (catalogue.length === 1 ? catalogue[0] : undefined));

    if (!product) {
      // Better to ask which trip than to answer for the wrong one.
      return catalogue.length > 1 && catalogue.length <= 4
        ? {
            ...knowHow(asksDuration ? "DURATION" : "INCLUSIONS", `Happy to check. Which trip do you mean: ${formatOrList(catalogue.map((item) => item.title))}?`),
            asksBack: true
          }
        : null;
    }

    return asksDuration ? describeDuration(product) : describeInclusions(product, input.message);
  }

  if (input.dateKnown) return null;

  const asksTimes = timesPattern.test(input.message);
  const asksPrice = !asksTimes && !asksAboutInclusions && pricePattern.test(input.message);
  if (!asksTimes && !asksPrice) return null;

  // "How much is the whale one?" names a trip in the operator's own words, and a trip named now
  // beats the one chosen earlier in the chat.
  const match = matchPmsProduct(input.message, await input.loadCatalogue());
  const productTitle = match.status === "MATCHED" ? match.product.title : (input.productTitle ?? null);

  if (asksTimes) {
    return knowHow(
      "TIMES",
      productTitle
        ? `Times can change from day to day, so tell me your date and I'll pull up the times for ${productTitle}.`
        : "Times depend on the trip and the day, so tell me which one you're keen on and your date, and I'll pull them up."
    );
  }

  return knowHow(
    "PRICE",
    productTitle
      ? `I can get you the exact price for ${productTitle}. Tell me your date and how many of you, and I'll check it.`
      : "Prices depend on the trip and the date, so tell me which one you're keen on and when, and I'll check it for you."
  );
}

function describeDuration(product: PmsProduct): OperatorKnowHowReply {
  const duration = findProductDuration(product);

  return duration
    ? knowHow("DURATION", `Going by the crew's trip details, the ${product.title} runs for about ${duration}.`, "Want me to check a date for you?")
    : knowHow(
        "DURATION",
        `The trip details I have for the ${product.title} don't say how long it runs, so I won't guess.`,
        PERSON_OFFER
      );
}

function describeInclusions(product: PmsProduct, message: string): OperatorKnowHowReply {
  const inclusions = findProductInclusions(product);
  const item = message.match(inclusionItemPattern)?.[1]?.toLowerCase() ?? null;

  if (!inclusions) {
    return knowHow(
      "INCLUSIONS",
      `The trip details I have for the ${product.title} don't list what's included, so I won't guess.`,
      PERSON_OFFER
    );
  }

  if (!item) {
    return knowHow(
      "INCLUSIONS",
      `Going by the crew's trip details, the ${product.title} includes ${inclusions}.`,
      "Tell me your date and I'll check it."
    );
  }

  const mentioned = inclusions.toLowerCase().includes(item.replace(/s$/, ""));
  const verb = /s$/.test(item) ? "are" : "is";

  return mentioned
    ? knowHow(
        "INCLUSIONS",
        `Yes, going by the crew's trip details, ${item} ${verb} included on the ${product.title}.`,
        "Tell me your date and I'll check it."
      )
    : knowHow(
        "INCLUSIONS",
        `Going by the crew's trip details, the ${product.title} includes ${inclusions}, but ${item} ${verb === "are" ? "aren't" : "isn't"} mentioned, so I won't guess.`,
        PERSON_OFFER
      );
}

function formatOrList(values: string[]) {
  return values.length <= 1 ? values.join("") : `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`;
}

function operatorMarket(catalogueText: string) {
  const places = bluePassDestinationNotes.filter((note) => note.pattern.test(catalogueText));
  const markets = new Set(places.map((note) => note.market));
  if (markets.size === 1) return [...markets][0];

  return classifyBluePassMarket([catalogueText]);
}
