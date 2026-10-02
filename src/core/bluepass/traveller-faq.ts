import { PERSON_OFFER } from "@/core/conversation/human-handoff";
import { findDestinationNote } from "./destination-notes";
import { classifyBluePassMarket, type BluePassMarket } from "./market";

/**
 * Kai's own answers to the practical questions travellers ask most. They make Kai useful even when
 * the LLM is off, and with the LLM on they are the grounding it rewrites from, so the facts stay
 * right. General guidance only: anything boat-specific is left to the operator to confirm.
 */
export type TravellerFaqTopic =
  | "AI_OR_HUMAN"
  | "DIVE_MEDICAL"
  | "DIVE_CERTIFICATION"
  | "KIDS"
  | "SEASICKNESS"
  | "STINGERS"
  | "WIFI"
  | "PACKING"
  | "VISA"
  | "PARK_FEES"
  | "CANCELLATION"
  | "INSURANCE"
  | "DIETARY"
  | "SAFETY";

interface TravellerFaqEntry {
  topic: TravellerFaqTopic;
  pattern: RegExp;
  /** Most topics only answer a question; "talk to a human" should be answered however it's phrased. */
  requiresQuestion: boolean;
  answer: (context: FaqContext) => string;
}

interface FaqContext {
  market: BluePassMarket | "UNKNOWN";
  /** "the operator", or "the Alila Purnama crew" when the traveller is asking about a boat in context. */
  operator: string;
}

const kidsWords = "(?:kids?|children|child|toddlers?|bab(?:y|ies)|teenagers?|teens?)";
const suitabilityWords =
  "(?:good for|great for|suitable|ok for|okay for|safe for|allowed|allow|welcome|bring|take|minimum age|age limit|how old)";

const faqEntries: TravellerFaqEntry[] = [
  {
    topic: "AI_OR_HUMAN",
    requiresQuestion: false,
    pattern:
      /\b(?:are you (?:a |an )?(?:bot|robot|real|human|ai|person|machine)|is this (?:a |an )?(?:bot|robot|ai|real person)|real person|talk to (?:a |an )?(?:human|person|real person))\b/,
    answer: () =>
      `I'm Kai, BluePass's AI concierge, so not a person, but I'll always be straight with you. ${PERSON_OFFER}`
  },
  // Before certification, so "do I need a medical certificate?" isn't read as a dive ticket question.
  {
    topic: "DIVE_MEDICAL",
    requiresQuestion: true,
    pattern:
      /\b(?:(?:old|previous|recent|bad|knee|back|shoulder|ear) injur(?:y|ies)|medical (?:form|certificate|clearance|questionnaire)|dive medical|fit to dive|asthma|diabet\w*|epilep\w*|heart condition|pregnan\w*|on medication|had surgery)\b/,
    answer: () =>
      "That one's worth running past your doctor before you go. Most dive operators ask you to fill in a medical form, and some conditions need a doctor's sign-off before you can dive."
  },
  {
    topic: "DIVE_CERTIFICATION",
    requiresQuestion: true,
    pattern:
      /\b(?:certif(?:ied|ication|icate)|open water|padi|ssi|dive (?:ticket|licen[cs]e)|non[- ]?divers?|not a diver|(?:can'?t|cannot|don'?t|do not) dive|learn(?:ing)? to dive|never (?:dived|dove|been diving)|first time diving|(?:need|have) to (?:know how to )?dive)\b/,
    answer: () =>
      "Not for most trips. Snorkellers and non-divers are welcome on most reef trips and liveaboards, and plenty of boats run intro dives with an instructor. For the deeper sites you'll want your Open Water, and some boats can teach it on board."
  },
  {
    topic: "SEASICKNESS",
    requiresQuestion: true,
    pattern: /\b(?:sea ?sick(?:ness)?|motion sick(?:ness)?|sick on (?:the |a )?boats?|nause(?:a|ous)|queasy|rough (?:seas?|water)|choppy)\b/,
    answer: ({ operator }) =>
      `Worth planning for if you're prone to it. Take a seasickness tablet before you board, not once you feel queasy (ask your pharmacist), and stay on deck with your eyes on the horizon. ${capitalise(operator)} can tell you how the water's looking closer to the day.`
  },
  {
    topic: "STINGERS",
    requiresQuestion: true,
    pattern: /\b(?:stingers?|jelly ?fish|box jell(?:y|ies)|irukandji)\b/,
    answer: ({ market }) =>
      market === "INDONESIA"
        ? "Indonesia doesn't have a set stinger season like tropical Queensland, but jellyfish can turn up now and then. A rash vest or thin wetsuit is handy protection, and the crew will tell you if anything's around."
        : "Stinger season in tropical Queensland runs roughly November to May. Reef boats have lycra stinger suits for snorkelling and diving in those months, and the crew will brief you before you get in."
  },
  {
    topic: "WIFI",
    requiresQuestion: true,
    pattern: /\b(?:wi-?fi|internet|(?:mobile|phone|cell) (?:signal|reception|coverage)|reception|4g|5g|stay connected)\b/,
    answer: ({ operator }) =>
      `Don't count on it. Some boats have wifi or pick up signal near the coast, but out on the reef it's patchy at best, so if you need to stay connected, it's worth asking ${operator} before you book.`
  },
  {
    topic: "PACKING",
    requiresQuestion: true,
    pattern: /\b(?:pack(?:ing)?|what (?:should|do) (?:i|we) bring|what to bring|bring with (?:me|us)|luggage|suitcase)\b/,
    answer: () =>
      "Keep it light: swimmers, a rash vest, reef-safe sunscreen, a hat, sunnies and a light layer for the evenings, plus any meds you need. A soft bag stows easier on a boat, and most boats have snorkel gear, but bring your own mask if you've got a favourite."
  },
  {
    topic: "VISA",
    requiresQuestion: true,
    pattern: /\b(?:visas?|passports?|e-?voa|visa on arrival)\b/,
    answer: ({ market }) =>
      market === "AUSTRALIA"
        ? "If you're visiting Australia from overseas, you'll need a visa or an ETA before you fly, and the Department of Home Affairs website will tell you which one fits your passport. Australians travelling at home don't need anything, of course."
        : "Australians (and most other travellers) can get Indonesia's e-Visa on Arrival, good for 30 days and extendable once, and you can apply online before you fly. You'll need six months left on your passport, and the rules do change, so check the official immigration site before booking flights."
  },
  {
    topic: "PARK_FEES",
    requiresQuestion: true,
    pattern: /\b(?:park (?:fees?|permits?|pass(?:es)?)|(?:entry|reef) (?:fees?|tax|permits?)|environmental management charge)\b/,
    answer: ({ operator }) =>
      `Most marine parks charge a fee. On the Great Barrier Reef it's a small daily charge usually built into the tour price, while in Komodo and Raja Ampat some boats include park fees and others collect them on board. ${capitalise(operator)} will confirm what's covered.`
  },
  {
    topic: "CANCELLATION",
    requiresQuestion: true,
    pattern: /\b(?:cancel(?:l?ation|l?ed|l?ing|s)?|refunds?|refundable)\b/,
    answer: ({ operator }) =>
      `Each operator sets their own cancellation terms, so they vary from trip to trip. It's worth checking them before you pay anything, and ${operator} will confirm them with your booking.`
  },
  {
    topic: "INSURANCE",
    requiresQuestion: true,
    pattern: /\b(?:travel insurance|dive insurance|(?:need|get|have) (?:travel |dive )?insurance)\b/,
    answer: () =>
      "Worth having, and if you're diving, make sure your policy covers it, or add dive cover like DAN. Some liveaboards ask for proof of dive insurance before you board."
  },
  {
    topic: "DIETARY",
    requiresQuestion: true,
    pattern: /\b(?:vegetarian|vegan|gluten|coeliac|celiac|allerg(?:y|ies|ic)|dietary|halal|kosher|lactose|dairy[- ]free)\b/,
    answer: ({ operator }) =>
      `Most boats can look after vegetarian, vegan, gluten-free and allergy needs if they know in advance, so make sure ${operator} knows when you enquire.`
  },
  {
    topic: "SAFETY",
    requiresQuestion: true,
    pattern:
      /\b(?:what happens in an emergency|in case of (?:an )?emergency|if there'?s an emergency|safety (?:briefing|procedures?|record|equipment|gear)|first aid|life ?jackets?|medical kit|what if something goes wrong)\b/,
    answer: ({ operator }) =>
      `Boats run a safety briefing before you head out, and the crew are your first call if anything happens on board. For specifics like first aid or medical support, it's worth asking ${operator} when you enquire.`
  },
  // Last: the broad "is it OK for kids" check, so a specific topic ("do kids need stinger suits?") wins.
  {
    topic: "KIDS",
    requiresQuestion: true,
    pattern: new RegExp(`\\b(?:${kidsWords}\\b.*\\b${suitabilityWords}|${suitabilityWords}\\b.*\\b${kidsWords})\\b`),
    answer: ({ operator }) =>
      `Plenty of reef trips and day cruises are great with kids, and snorkelling off the back of the boat is usually the highlight. Liveaboards vary more, as some set a minimum age, so ${operator} will confirm it for your kids before anything's booked.`
  }
];

function isQuestionShaped(normalized: string) {
  return (
    normalized.includes("?") ||
    /^(?:do|does|did|is|are|can|could|will|would|should|what|whats|what's|how|when|where|which|any|tell me|wondering|advice|tips)\b/.test(
      normalized
    )
  );
}

// A booking step ("book Alila Purnama for 2 adults and 2 kids") belongs to the booking flow, even if
// it mentions a FAQ topic in passing.
function isBookingStep(normalized: string) {
  return /\b(?:book|booking|reserve|hold|send|submit|[ei]nquire)\b/.test(normalized);
}

export function findTravellerFaqAnswer(input: {
  message: string;
  market?: BluePassMarket | "UNKNOWN";
  /** A boat already in the conversation, so "does the boat have wifi?" can name it. */
  boatName?: string | null;
  /** How to refer to whoever runs the trip, when "the operator" isn't right (an operator's own widget says "the crew"). */
  operator?: string;
  /** Where the trip is, when the message doesn't say: an operator's own waters. */
  place?: string | null;
}): { topic: TravellerFaqTopic; answer: string } | null {
  const normalized = input.message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  const questionShaped = isQuestionShaped(normalized);
  const bookingStep = isBookingStep(normalized);
  const messageMarket = classifyBluePassMarket([input.message]);
  const market = messageMarket !== "UNKNOWN" ? messageMarket : input.market ?? "UNKNOWN";
  const operator = input.operator ?? (input.boatName ? `the ${input.boatName} crew` : "the operator");

  for (const entry of faqEntries) {
    if (entry.requiresQuestion && (!questionShaped || bookingStep)) continue;
    if (entry.pattern.test(normalized)) {
      // Stingers are local: the Gold Coast isn't box jellyfish country, whatever tropical Queensland does.
      const localStingers =
        entry.topic === "STINGERS" ? (findDestinationNote(input.message) ?? findDestinationNote(input.place ?? ""))?.stingers : null;

      return { topic: entry.topic, answer: localStingers ?? entry.answer({ market, operator }) };
    }
  }

  return null;
}

/** Every answer Kai can give, for the voice lint and for reviewing the copy in one place. */
export function listTravellerFaqAnswers() {
  return faqEntries.flatMap((entry) =>
    Array.from(
      new Set(
        (["AUSTRALIA", "INDONESIA"] as const).flatMap((market) => [
          entry.answer({ market, operator: "the operator" }),
          entry.answer({ market, operator: "the Alila Purnama crew" })
        ])
      )
    ).map((answer) => ({
      topic: entry.topic,
      answer
    }))
  );
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
