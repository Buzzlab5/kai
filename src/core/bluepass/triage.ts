import type { BluePassRequiredInquiryField } from "./intent";
import type { BluePassLead } from "./lead";

/**
 * BluePass first-touch triage.
 *
 * Three kinds of people reach Kai on the BluePass marketplace surface:
 * travellers (the booking flow), operators (want to list their business),
 * and partners (dive shops, agencies, creators who refer or book for
 * clients). This module classifies who we are talking to from the message
 * history alone — no stored state, persona re-derives every turn — and
 * builds the deterministic onboarding replies for the operator and partner
 * playbooks. Travellers fall through to the existing marketplace flow.
 *
 * Decision-tree spec (shared with the bluepass app):
 * BluePass Build/docs/kai-triage-decision-matrix.md
 */

export type BluePassPersona = "TRAVELLER" | "OPERATOR" | "PARTNER" | "UNKNOWN";

export type BluePassPersonaReply = {
  reply: string;
  /** Flow should attach catalog preview cards to this reply. */
  showCatalog?: boolean;
  /** Narrow attached cards to one destination when set. */
  catalogDestination?: "Komodo" | "Raja Ampat" | null;
};

// Identity nouns that mark a referral partner. Checked BEFORE operator
// phrases so "I run a dive shop" lands on PARTNER (shops refer; they do
// not operate boats). Never use bare "partner" — travellers say "my
// partner and I". Never use bare "referral" — travellers paste referral
// codes.
const partnerSignals = [
  "dive shop",
  "travel agen",
  "tour agen",
  "booking agen",
  "i'm an agent",
  "im an agent",
  "refer or book for clients",
  "refer clients",
  "refer my clients",
  "i refer",
  "my clients",
  "my audience",
  "i'm a creator",
  "im a creator",
  "content creator",
  "influencer",
  "trip leader",
  "dive club",
  "book for clients",
  "on behalf of clients",
  "referral link",
  "referral commission",
  "referral partner",
  "partner program",
  "become a partner",
  "how do commissions work",
  "commission"
];

// Verb-anchored operator phrases — someone who RUNS the boats, dives, or
// stays. Kept specific so traveller phrasings ("my partner", "our trip")
// never match.
const operatorSignals = [
  "i run trips",
  "run trips or charters",
  "i run a",
  "i run an",
  "i run the",
  "i run boats",
  "i run dive",
  "we run",
  "we operate",
  "i operate",
  "i own a",
  "i own an",
  "our fleet",
  "our boats",
  "our yacht",
  "our liveaboard",
  "my liveaboard",
  "my dive centre",
  "my dive center",
  "my dive resort",
  "list my business",
  "list our",
  "list my boat",
  "claim my",
  "claim our",
  "i'm an operator",
  "im an operator",
  "as an operator",
  "join as an operator"
];

const travellerSignals = [
  "planning a trip",
  "komodo",
  "raja ampat",
  "labuan bajo",
  "liveaboard",
  "dive",
  "snorkel",
  "sail",
  "surf",
  "manta",
  "honeymoon",
  "holiday",
  "vacation",
  "yacht",
  "cabin",
  "charter"
];

function includesAny(haystack: string, needles: string[]) {
  return needles.some((needle) => haystack.includes(needle));
}

/**
 * Classify the persona from the whole conversation. Operator/partner are
 * sticky: once someone says who they are, later vague messages ("tell me
 * more") keep the persona. "I run a dive shop" is PARTNER, not OPERATOR —
 * partner identity nouns win over operator verb phrases.
 */
/** Persona of a single message. Within one message, partner identity nouns
 *  beat operator verbs beat traveller intent (a dive shop refers, it doesn't
 *  operate). */
function classifyMessage(text: string): BluePassPersona {
  if (includesAny(text, partnerSignals)) return "PARTNER";
  if (includesAny(text, operatorSignals)) return "OPERATOR";
  if (includesAny(text, travellerSignals)) return "TRAVELLER";
  return "UNKNOWN";
}

/**
 * First concrete signal locks the track. Scanning messages in order (oldest
 * first) means the persona set on the opening turn owns the rest of the
 * conversation — a traveller who later says "commission", or an operator who
 * later says "Komodo", never gets hijacked onto another track.
 */
export function classifyBluePassPersona(messages: string[]): BluePassPersona {
  for (const message of messages) {
    const persona = classifyMessage(message.toLowerCase());
    if (persona !== "UNKNOWN") return persona;
  }
  return "UNKNOWN";
}

/**
 * First-touch triage greeting for a message with no persona or trip signal
 * at all ("hi", "info?"). The three options ride in the sentence because
 * the widget has no suggestion chips.
 */
export function buildBluePassTriageGreeting() {
  return "Hey - Kai here, the BluePass concierge. Quick one so I point you the right way: are you planning a trip, do you run boats or dive trips, or do you book and refer for clients?";
}

/**
 * True when the conversation gives Kai nothing to act on yet — no persona,
 * no trip intent, no question the marketplace flow already answers — so
 * the triage greeting is the most useful reply.
 */
export function shouldSendBluePassTriageGreeting(input: {
  persona: BluePassPersona;
  missingFields: BluePassRequiredInquiryField[];
  hasIntentSignal: boolean;
}) {
  return input.persona === "UNKNOWN" && !input.hasIntentSignal && input.missingFields.length > 0;
}

// ─── Lead captured (terminal node of both playbooks) ─────────────────────────

/**
 * The moment an operator or partner hands over a reachable channel, Kai
 * acknowledges exactly what it captured (so mistakes surface) and says what
 * happens next. This outranks every keyword branch — never re-ask for what
 * was just given.
 */
export function buildBluePassLeadCapturedReply(input: {
  persona: Extract<BluePassPersona, "OPERATOR" | "PARTNER">;
  lead: BluePassLead;
}): string {
  const captured = [
    input.lead.company ?? null,
    input.lead.region ?? null,
    input.lead.email ?? null,
    input.lead.phone ? `WhatsApp ${input.lead.phone}` : null
  ].filter((value): value is string => Boolean(value));

  const echo = captured.length > 0 ? `I've got you down as ${captured.join(", ")} - shout if any of that's off. ` : "";

  if (input.persona === "OPERATOR") {
    return `Perfect. ${echo}The team will verify the business and send your claim link to that address, usually same day. If your page is already pre-built, claiming it is one click - no password, and it's yours to run.`;
  }

  return `Perfect. ${echo}The team will send your partner claim link there, usually same day - one click, no password, and your tracked link is live. Founding-cohort terms get locked at that point too.`;
}

// ─── Operator playbook ────────────────────────────────────────────────────────

export function buildBluePassOperatorReply(input: {
  latestMessage: string;
  pitched: boolean;
}): BluePassPersonaReply {
  const message = input.latestMessage.toLowerCase();
  const has = (...needles: string[]) => includesAny(message, needles);

  if (has("18", "break down", "breakdown", "fee", "cut", "take rate", "commission")) {
    return {
      reply:
        "Every point: 5% conservation in your waters (co-brandable), 5% to the partners sending you guests, 3% payments, 5% platform. You keep 82% - no listing fees, no subscription, we only earn when you do. Claim link, or vetting first?"
    };
  }

  if (has("what do we get", "what do i get", "why join", "benefit", "what's included", "why bluepass")) {
    return {
      reply:
        "A real page, inquiries over web and WhatsApp, and me pre-qualifying your guests so you talk to ready-to-book people, not tyre-kickers - plus a partner network sending you bookings and a conservation story on every trip. What do you run, and where?"
    };
  }

  if (has("outside", "not in indonesia", "add us to the list")) {
    return {
      reply:
        "Straight answer: we're Indonesia-first and expanding - I'd rather add you to the expansion list than promise a date I can't back. Company, region, and best email, and you're first in when we open your waters."
    };
  }

  if (has("indonesia")) {
    return {
      reply:
        "Then your page may already exist - we pre-built pages for hundreds of Indonesian operators. The claim link goes to your business email: one click, no password. Company name, home port, and best email, and the team sends it over."
    };
  }

  if (has("vet", "green fins", "approval", "requirement", "qualify")) {
    return {
      reply:
        "Three things: safety record, sustainability (Green Fins where it applies), and fair local pay. Approval is a team call - I won't promise it, but I'll get you in front of them. Company name and email?"
    };
  }

  if (has("payout", "paid out", "get paid", "contract", "bank")) {
    return {
      reply:
        "That's one for the humans - payout terms and contracts get sorted with the team, not me. Company and email or WhatsApp, and they'll come back, usually same day."
    };
  }

  if (has("claim")) {
    return {
      reply:
        "Easy - the claim link goes to your business email: one click, no password, and the page is yours. Company name and home port so the team matches you to the right page?"
    };
  }

  if (input.pitched) {
    return {
      reply:
        "Happy to go deeper - the split, vetting, your page. Fastest path though: company name, home port, and best email, and the team takes it from there."
    };
  }

  return {
    reply:
      "Good timing - we're onboarding operators. The deal: you keep 82% of your rate. Our 18% is capped - 5% conservation in your waters, 5% to partners sending you guests, 3% payments, 5% platform - and your guests' price is never marked up. Where do you operate, and what do you run?"
  };
}

// ─── Partner playbook ─────────────────────────────────────────────────────────

export function buildBluePassPartnerReply(input: {
  latestMessage: string;
  pitched: boolean;
}): BluePassPersonaReply {
  const message = input.latestMessage.toLowerCase();
  const has = (...needles: string[]) => includesAny(message, needles);

  // Destination first: "Komodo for my clients" is a book-on-behalf brief,
  // not a generic client question.
  if (has("komodo")) {
    return {
      reply:
        "Komodo it is - mantas at Karang Makassar, the drift at Castle Rock, dragons on Rinca between dives. Best September to April, mantas peaking December to February. A couple I'd shortlist for clients below - their dates and group size and I'll narrow it.",
      showCatalog: true,
      catalogDestination: "Komodo"
    };
  }

  if (has("raja ampat", "raja")) {
    return {
      reply:
        "Good taste - Raja Ampat is the planet's richest reef system, best October to April. Bigger boats, out of Sorong. A couple below for clients - dates and group size and I'll match properly.",
      showCatalog: true,
      catalogDestination: "Raja Ampat"
    };
  }

  if (has("conservation", "impact", "reef", "5%")) {
    return {
      reply:
        "5% of every booking funds verified conservation where your clients travel - reef restoration, mangrove nurseries, manta research. Tracked per booking, so you can tell a client their trip funded something real - and it's yours to co-brand."
    };
  }

  if (has("commission", "earn", "percent", "my cut", "%")) {
    return {
      reply:
        "Simple: your client pays the operator's own rate - never a cent more. The operator pays BluePass a capped commission, and your cut comes from that, so recommending us costs your client nothing. Exact rates are per-partner and locked for founding members - the team confirms yours. Attribution runs off your link, plus a manual code for bookings you place."
    };
  }

  if (has("catalogue", "catalog", "which operators", "what boats", "inventory")) {
    return {
      reply:
        "Vetted liveaboards and dive operators across Komodo and Raja Ampat - from accessible Explorer boats to flagship phinisi, every one screened for safety, sustainability, and fair crew pay. A taste below - narrow by destination or budget?",
      showCatalog: true
    };
  }

  if (has("founding", "terms", "lock")) {
    return {
      reply:
        "Founding partners lock their terms before we scale, get a say in which operators join, and first pick of group-trip space. Small cohort. Want in? Company, market, and best email."
    };
  }

  if (has("claim", "link")) {
    return {
      reply:
        "If the team's reached out, you'll have a personal link - a page pre-built for your business, one click, no password. No link yet? Company, market, and best email - or partners@bluepass.co - and we'll mint one."
    };
  }

  if (has("book for a client", "book a trip for", "on behalf", "book now", "dates are set")) {
    return {
      reply:
        "Let's do it - treat it like any trip brief, credited to you. Komodo or Raja Ampat? Then dates and group size, and I'll line up the right boat. The team makes sure it's attributed to your outfit."
    };
  }

  if (input.pitched) {
    return {
      reply:
        "Whatever's most useful - commissions, catalogue, founding terms, or a live client brief. Or skip ahead: company, market, and best email, and the team sends your claim link."
    };
  }

  return {
    reply:
      "Then we built this for you. You get a tracked link and a catalogue of vetted Indonesian liveaboards; your client pays the operator's own rate - never marked up - and your commission comes from the operator's side, not your client's pocket. Every booking funds ocean impact you can put your name on. Shop, agency, or creator?"
  };
}
