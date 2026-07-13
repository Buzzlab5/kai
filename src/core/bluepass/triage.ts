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
  "join as an operator",
  // Bahasa Indonesia — operators are Indonesian.
  "kapal saya",
  "saya punya kapal",
  "operator saya",
  "saya operator",
  "daftar bisnis",
  "daftarkan",
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

// Safety / medical / legal topics go to a human in any vertical — never
// improvised. Kept tight so normal words ("safety record") don't trip it.
const HANDOFF_TOPICS = [
  "unsafe", "accident", "injury", "injured", "medical", "emergency",
  "legal", "lawsuit", "complaint", "dispute",
];

function needsHumanHandoff(message: string): boolean {
  return includesAny(message, HANDOFF_TOPICS);
}

export function buildBluePassHandoffReply(): string {
  return "That's one for a human on the team - I'll flag it and they'll come back to you directly. Anything else I can line up in the meantime?";
}

export function buildBluePassOperatorReply(input: {
  latestMessage: string;
  pitched: boolean;
}): BluePassPersonaReply {
  const message = input.latestMessage.toLowerCase();
  const has = (...needles: string[]) => includesAny(message, needles);

  if (needsHumanHandoff(message)) return { reply: buildBluePassHandoffReply() };

  if (has("legit", "trustworthy", "who's behind", "who runs", "scam", "is this real", "can i trust", "reputable", "are you real")) {
    return {
      reply:
        "Fair to ask - BluePass is a real marketplace onboarding vetted Indonesian operators, guest price never marked up and you keep 82%. Nothing's charged until you claim your own page. Want the 18% breakdown, or your claim link?"
    };
  }

  if (has("undercut", "cheaper elsewhere", "cheaper somewhere", "find it cheaper", "discount my", "discount my rate", "beat my price", "lower my price", "drop my price", "lowest price")) {
    return {
      reply:
        "Never - we don't mark your price up and we don't discount it without your say. Your BluePass price is your own rate; you control it, and no one undercuts you here. What do you run, and where?"
    };
  }

  if (has("18", "break down", "breakdown", "fee", "cut", "take rate", "commission")) {
    return {
      reply:
        "Every point: 5% conservation in your waters (co-brandable), 5% to the partners sending you guests, 3% payments, 5% platform. You keep 82% - no listing fees, no subscription, we only earn when you do. Claim link, or vetting first?"
    };
  }

  if (has("demo", "example page", "sample page", "see how it works", "show me a page", "see a page", "see it first", "kick the tyres", "before i decide")) {
    return {
      reply:
        "Happy to - I can show you a real operator page so you see exactly what yours would look like, no commitment. Want me to pull one up? Then company and email whenever you're ready."
    };
  }

  if (has("what do i need", "what do you need from me", "photos", "photo", "images", "details do you need", "set up my page", "build my page", "prepare", "what to send")) {
    return {
      reply:
        "Barely anything from you - a few photos, your trips and rates, and the team builds the page for you; you review and claim it. If you're already listed elsewhere, they can pull most of it across. Company name and email to kick off?"
    };
  }

  if (has("booking.com", "getyourguide", "viator", "tripadvisor", "expedia", "already list", "already on", "another platform", "listing site", "why not just", "why switch")) {
    return {
      reply:
        "List wherever you like - we're not exclusive. The difference: guests pay your rate direct, never marked up, you keep 82%, 5% funds conservation in your waters, and a partner network sends you guests. What do you run, and where?"
    };
  }

  if (
    has(
      "what do we get", "what do i get", "why join", "benefit", "what's included",
      "why bluepass", "my page", "page look", "dashboard", "inbox", "manage bookings",
    )
  ) {
    return {
      reply:
        "A real page, inquiries over web and WhatsApp, and me pre-qualifying your guests so you talk to ready-to-book people, not tyre-kickers - plus a partner network sending you bookings and a conservation story on every trip. What do you run, and where?"
    };
  }

  if (has("what's the catch", "whats the catch", "the catch", "how do you make money", "how do you earn", "what's in it for you", "whats in it for you", "how do you profit", "where's your money")) {
    return {
      reply:
        "No catch - we make the capped 18% only when a booking completes, nothing else. No listing fees, no per-lead charges, no selling your data. We earn when you earn. What do you run, and where?"
    };
  }

  if (has("per lead", "pay for leads", "pay per lead", "lead fee", "cost per lead", "charge per inquiry", "pay per inquiry", "per enquiry", "charge me upfront", "pay to be listed", "pay for placement")) {
    return {
      reply:
        "No - we never charge per lead or to be listed. No listing fee, no pay-per-inquiry; we only earn the capped 18% when a booking actually completes. Zero risk upfront. What do you run, and where?"
    };
  }

  if (has("set my own", "my own rate", "my own price", "who sets the price", "control the price", "set prices", "set the rate", "i set the")) {
    return {
      reply:
        "You set your own rate - it's your price, full stop. You keep 82% of it, and we never mark it up to your guests. Where do you operate, and what do you run?"
    };
  }

  if (has("more than one boat", "multiple boats", "several boats", "two boats", "list more than", "multiple trips", "multiple listings", "more than one trip", "list all my", "add another boat", "whole fleet", "my fleet")) {
    return {
      reply:
        "Yes - list your whole fleet and every trip type under one page, each with its own rate and calendar. Guests see your full range in one place. What do you run, and where?"
    };
  }

  if (has("availability", "fully booked", "block out", "block dates", "manage dates", "sold out", "mark dates", "control my dates", "close dates", "when i'm full", "already booked")) {
    return {
      reply:
        "You control your own calendar - open dates, block them, mark yourself full, and Kai only ever offers what's actually available. No double-bookings. What do you run, and where?"
    };
  }

  if (has("integrate", "integration", "rezdy", "fareharbor", "bokun", "my booking system", "my pms", "my calendar", "sync my", "connect my")) {
    return {
      reply:
        "Yes - we integrate with the major systems (Rezdy, FareHarbor, Bokun and more) so your availability and bookings sync. The team sets up the connection with you during onboarding. Company name and best email?"
    };
  }

  if (has("will i actually get", "will i get bookings", "how many bookings", "how much demand", "guarantee bookings", "guaranteed bookings", "how much business", "worth my time", "any bookings")) {
    return {
      reply:
        "Straight answer: no one can guarantee booking numbers, and I won't pretend otherwise. What I can promise is real reach - I pre-qualify travellers on your page and the partner network sends warm clients, with no cost until you're earning. Where do you operate?"
    };
  }

  if (has("where do bookings come from", "send me guests", "how do i get guests", "where do guests come from", "how do you fill", "drive bookings", "who sends", "get customers", "get guests", "marketing")) {
    return {
      reply:
        "Two demand channels: me, pre-qualifying travellers on your page and over WhatsApp, and the partner and creator network sending you their clients. You get warm, ready-to-book guests. Where do you operate, and what do you run?"
    };
  }

  if (has("my data", "guest data", "privacy", "private data", "gdpr", "who owns the data", "data protection", "confidential", "share my data", "sell my data")) {
    return {
      reply:
        "Your guest data is yours - we don't sell it or share it beyond running the booking. For the fine print on data handling, the team will walk you through it. Company name and best email?"
    };
  }

  if (has("after a guest inquires", "what happens after", "how does handoff", "when do i take over", "after they inquire", "how do inquiries work", "guest reaches out", "after an inquiry")) {
    return {
      reply:
        "Kai gathers the trip details and pre-qualifies the guest, then hands them straight to you - on WhatsApp or your dashboard - the moment they're ready. You take it from there. Where do you operate, and what do you run?"
    };
  }

  if (has("guest support", "customer service", "who handles support", "who deals with", "problem on the trip", "issue on the trip", "goes wrong", "support my guests", "who looks after", "handle problems")) {
    return {
      reply:
        "You run the experience on the water - that's yours. Before the trip, I handle guest questions and pre-qualify them, and the team backs you on anything tricky. Guests are never left hanging. Where do you operate, and what do you run?"
    };
  }

  if (has("talk to other operators", "speak to other operators", "other operators i can", "references", "operator references", "who else is on board", "operators using you", "operator testimonial", "operators like me", "vouch for you", "who else uses you")) {
    return {
      reply:
        "We're early - I won't hand you references I can't stand behind. What I can say: every operator is vetted for safety, sustainability, and fair pay, and founding operators shape how this grows. Want the 18% breakdown, or your claim link?"
    };
  }

  if (has("competitor", "competitors", "stand out", "next to me", "other operators", "rivals", "differentiate", "against other", "same as everyone")) {
    return {
      reply:
        "It's a curated marketplace, not a race to the bottom - your page is your own storefront, and you stand out on your trips, your reviews, and your conservation story, never by outspending anyone. What do you run, and where?"
    };
  }

  if (has("day trip", "day trips", "day tour", "day tours", "snorkel", "not a liveaboard", "not liveaboard", "land tour", "single day trip")) {
    return {
      reply:
        "Absolutely - it's not just liveaboards. Day trips, snorkel and dive centres, resorts, marine experiences - all welcome, as long as it's real marine tourism run right. Where do you operate, and what do you run?"
    };
  }

  if (has("outside", "not in indonesia", "add us to the list")) {
    return {
      reply:
        "Straight answer: we're Indonesia-first and expanding - I'd rather add you to the expansion list than promise a date I can't back. Company, region, and best email, and you're first in when we open your waters."
    };
  }

  if (has("bahasa", "do i need english", "speak english", "my english", "english ok", "what language", "do you speak", "guests speak", "translate")) {
    return {
      reply:
        "No English needed - I speak Bahasa and English, and I talk to each guest in their own language, so you're covered whoever books. Where do you operate, and what do you run?"
    };
  }

  if (has("indonesia")) {
    return {
      reply:
        "Then your page may already exist - we pre-built pages for hundreds of Indonesian operators. The claim link goes to your business email: one click, no password. Company name, home port, and best email, and the team sends it over."
    };
  }

  if (has("how long", "how soon", "when will", "timeline", "how quickly", "turnaround")) {
    return {
      reply:
        "Honest answer: I can't put a date on it - approval is a team call and I won't invent a timeline. What I can do is get you in front of them fast. Company name and best email?"
    };
  }

  if (
    has(
      "vet", "green fins", "approval", "requirement", "qualify",
      "license", "licence", "certified", "certification", "insured", "insurance",
    )
  ) {
    return {
      reply:
        "Three things: safety record, sustainability (Green Fins where it applies), and fair local pay. Approval is a team call - I won't promise it, but I'll get you in front of them. Company name and email?"
    };
  }

  if (has("cancellation policy", "refund", "guest cancels", "customer cancels", "no-show", "no show", "reschedule", "bad weather", "cancels a trip", "cancels their")) {
    return {
      reply:
        "Your cancellation and refund terms are yours - you set them, and they show on your page so guests book knowing the rules. The team wires them in during setup, and I'll flag anything tricky to a human. Company name and email to start?"
    };
  }

  if (has("pause", "leave anytime", "opt out", "cancel anytime", "no lock", "lock-in", "tied in", "exclusive", "commitment")) {
    return {
      reply:
        "No lock-in - list when it suits you, pause or leave anytime, and you're never tied to us exclusively. Want to get started? Company name and best email."
    };
  }

  if (has("how do guests pay", "pay by card", "payment method", "guests pay", "how do they pay", "do they pay", "card payment", "credit card", "how is payment taken")) {
    return {
      reply:
        "Guests pay securely through BluePass at checkout - card and the usual methods, no cash to chase. The money reaches you via the team's payout setup, minus only the capped 18%. Where do you operate, and what do you run?"
    };
  }

  if (has("payout", "paid out", "get paid", "contract", "bank")) {
    return {
      reply:
        "That's one for the humans - payout terms and contracts get sorted with the team, not me. Company and email or WhatsApp, and they'll come back, usually same day."
    };
  }

  if (has("an app", "any app", "the app", "is there an app", "mobile app", "phone app", "on my phone", "manage on my phone", "manage from my phone", "on mobile", "android", "iphone")) {
    return {
      reply:
        "No separate app to install - your dashboard runs in any browser and inquiries reach you on WhatsApp, so you manage everything from your phone. Where do you operate, and what do you run?"
    };
  }

  if (has("review", "reviews", "rating", "ratings", "testimonial", "guest feedback")) {
    return {
      reply:
        "Reviews come from real guests after real trips and show right on your page - social proof you earn, not buy. The team sets the details up with you as you go live. What do you run, and where?"
    };
  }

  if (has("real person", "talk to someone", "speak to someone", "talk to a human", "speak to a human", "book a call", "jump on a call", "get on a call", "schedule a call", "phone call", "call me", "talk to the team")) {
    return {
      reply:
        "For sure - the team's happy to jump on a call. Drop your company and best email or WhatsApp and they'll set up a time, usually same day. Anything you want me to pass along first?"
    };
  }

  if (has("how do i sign up", "how do i start", "how do i get started", "get started", "how do i join", "how to sign up", "how to join", "how do i register", "how do i onboard", "next step", "sign me up")) {
    return {
      reply:
        "Three steps: send company, home port, and best email; the team matches or builds your page and emails a claim link; you claim it in one click, no password. Your page may already exist - we pre-built hundreds. Want to start?"
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

  if (has("saya", "kapal", "perahu", "daftar")) {
    return {
      reply:
        "Waktu yang tepat - kami onboarding operator. Anda menyimpan 82% dari tarif Anda. 18% dibatasi: 5% konservasi di perairan Anda, 5% mitra pengirim tamu, 3% pembayaran, 5% platform - harga tamu tidak pernah dinaikkan. Di mana Anda beroperasi, dan apa yang Anda jalankan?"
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

  if (needsHumanHandoff(message)) return { reply: buildBluePassHandoffReply() };

  if (has("legit", "trustworthy", "who's behind", "who runs", "scam", "is this real", "can i trust", "reputable")) {
    return {
      reply:
        "Fair question - BluePass is a real marketplace of vetted Indonesian operators, every one screened for safety, sustainability, and fair pay. Your clients pay the operator direct, never marked up. Want the catalogue, or your claim link?"
    };
  }

  if (
    has(
      "which region", "which destination", "what destination", "what region",
      "which regions", "which destinations", "where do you cover", "destinations do you",
      "other destination", "besides komodo", "apart from", "maldives", "philippines",
      "thailand", "fiji", "egypt",
    )
  ) {
    return {
      reply:
        "Straight up: we're Indonesia-first, with Komodo and Raja Ampat live now and more waters coming. Your clients get two of the best reef destinations on the planet through one link. Want the catalogue, or your claim link moving?"
    };
  }

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

  if (has("api", "embed", "on my site", "on my website", "iframe", "plugin", "integrate into my", "widget on", "put it on my site", "developer", "webhook")) {
    return {
      reply:
        "Right now your tracked link and assets drop into any site or bio - that covers most partners. A deeper API or embed is a team conversation as we build it out; I won't overpromise. Company, market, and best email and I'll flag it?"
    };
  }

  if (has("co-brand", "cobrand", "white label", "white-label", "my branding", "my logo", "branded", "put my name")) {
    return {
      reply:
        "The conservation impact is fully yours to co-brand - stats and assets with your name on them. The booking widget itself stays BluePass-branded for trust and truth. Want the assets? Company, market, and best email."
    };
  }

  if (has("marketing asset", "creative", "logos", "banners", "social post", "promo material", "content pack", "sample post", "marketing material")) {
    return {
      reply:
        "Once you claim, your dashboard has the marketing pack - logos, banners, impact one-liners, and sample post copy, all ready to use. Want your claim link? Company, market, and best email."
    };
  }

  if (has("conservation", "impact", "reef", "5%")) {
    return {
      reply:
        "5% of every booking funds verified conservation where your clients travel - reef work, mangrove nurseries, manta research. Tracked per booking, so you can show a client real impact, and it's yours to co-brand. Want the assets, or your claim link moving?"
    };
  }

  if (has("poach", "steal my", "go around me", "own the client", "my clients mine", "my list", "cut me out", "keep my clients", "my relationship", "market to my", "own the relationship")) {
    return {
      reply:
        "Your clients stay yours - the relationship is yours, and we don't market to them behind your back or cut you out on repeat trips. You bring them, you keep the credit. Company, market, and best email?"
    };
  }

  if (has("operator cancels", "boat cancels", "trip is cancelled", "trip gets cancelled", "cancels on my client", "operator pulls out", "falls through", "cancelled by weather", "operator no-show", "what if it's cancelled")) {
    return {
      reply:
        "Rare, but if an operator has to cancel, the team steps in - rebook or refund your client per the operator's terms, and your credit's protected either way. You're never left holding it. Company, market, and best email?"
    };
  }

  if (has("attribution", "referral window", "how is it tracked", "cookie", "lost cookie", "how are bookings attributed", "credited to me", "how do referrals work", "60 day", "60-day")) {
    return {
      reply:
        "Your link sets a 60-day attribution window, so a click today still credits you if they book weeks later. For book-on-behalf or a lost cookie, there's a manual referral code too - nothing slips. Company, market, and best email?"
    };
  }

  if (has("track my bookings", "track earnings", "see my earnings", "track commission", "my dashboard", "see my bookings", "how do i track", "reporting", "track clicks")) {
    return {
      reply:
        "Your tracked link comes with a live dashboard - clicks, bookings, and earnings in one place, plus co-brandable impact stats. Want me to get your claim link moving? Company, market, and best email."
    };
  }

  if (has("cost to join", "sign-up fee", "signup fee", "any fee", "free to join", "how much to join", "upfront cost", "subscription", "monthly fee", "what's the catch")) {
    return {
      reply:
        "No cost to join - no sign-up fee, no subscription. Your commission is funded from the operator's side, so there's nothing to pay and nothing to front. Company, market, and best email to start?"
    };
  }

  if (has("currency", "currencies", "usd", "idr", "rupiah", "exchange rate", "converted", "what currency", "paid in")) {
    return {
      reply:
        "You're paid in your currency - which one and how it's converted is set with the team when you go live, so no surprises. I'll flag it for them. Company, market, and best email?"
    };
  }

  if (has("get paid", "paid out", "payout", "when do i get paid", "how am i paid", "how do i get paid")) {
    return {
      reply:
        "You get paid from the operator's commission to BluePass - never from your client's pocket. Payout timing and method are set with the team once you're active; I'll flag it and they confirm the details. Company, market, and best email to start?"
    };
  }

  if (has("booking fee", "service fee", "does my client pay", "client pay a fee", "extra fee", "hidden fee", "surcharge", "fee for my client", "any fee to my client", "processing fee")) {
    return {
      reply:
        "None - your client pays the operator's own rate, full stop. No BluePass booking fee, no service fee, nothing added at checkout. That's what makes you easy to recommend. Company, market, and best email?"
    };
  }

  if (has("markup", "mark up", "add my own", "my own margin", "charge my client more", "add margin", "my margin", "resell at", "sell it for more", "add commission on top", "add my margin")) {
    return {
      reply:
        "Straight answer: no - your client always pays the operator's own rate, never a rupiah more. Your earnings come from the operator's capped commission to BluePass, not from marking up your client. That's the whole promise. Company, market, and best email?"
    };
  }

  if (has("ballpark", "rough number", "roughly", "give me a number", "just a number", "typical rate", "average commission", "what's the rate", "whats the rate", "ballpark figure")) {
    return {
      reply:
        "I won't guess a number I can't stand behind - your rate is set per-partner and confirmed with the team, funded from the operator's capped commission (never your client). Send company, market, and best email and they'll quote you real terms."
    };
  }

  if (has("commission", "earn", "percent", "my cut", "%")) {
    return {
      reply:
        "Simple: your client pays the operator's own rate - never a cent more, so recommending us costs them nothing. Your cut comes from the operator's capped commission to BluePass; exact rates are per-partner, locked for founding members. Ready to lock terms? Company, market, and best email."
    };
  }

  if (has("demo", "example page", "sample page", "see how it works", "show me a page", "see a page", "see it first", "kick the tyres", "before i decide")) {
    return {
      reply:
        "Of course - I can show you the live catalogue and a sample partner page so you see exactly what you'd be sharing, no commitment. Want a look? Then company, market, and email when you're ready."
    };
  }

  if (has("real person", "talk to someone", "speak to someone", "talk to a human", "speak to a human", "book a call", "jump on a call", "get on a call", "schedule a call", "phone call", "call me", "talk to the team")) {
    return {
      reply:
        "Of course - the team will happily hop on a call. Send your company, market, and best email or WhatsApp and they'll set up a time, usually same day. Anything you'd like me to flag ahead?"
    };
  }

  if (has("day trip", "day trips", "liveaboards only", "only liveaboards", "just liveaboards", "what kind of trip", "what trips", "type of trip", "half day", "single day", "day tours")) {
    return {
      reply:
        "Right now it's mainly multi-day liveaboards and dive trips across Komodo and Raja Ampat; day trips and wider activities grow as we add operators. What are your clients after? Company, market, and best email to start."
    };
  }

  if (has("catalogue", "catalog", "which operators", "what boats", "inventory")) {
    return {
      reply:
        "Vetted liveaboards and dive operators across Komodo and Raja Ampat - from accessible Explorer boats to flagship phinisi, every one screened for safety, sustainability, and fair crew pay. A taste below - narrow by destination or budget?",
      showCatalog: true
    };
  }

  if (has("who else", "other partners", "who's using", "whos using", "testimonial", "case study", "success story", "anyone i'd know", "any partners", "who's on board", "social proof")) {
    return {
      reply:
        "We're early and building the founding cohort now - I won't drop names I can't back up. What I can say: every operator is vetted, and founding partners lock the best terms before we scale. Want in? Company, market, and best email."
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

  if (has("group booking", "charter for", "whole yacht", "private charter", "group trip", "book a group", "large group", "group hold", "group of clients")) {
    return {
      reply:
        "Absolutely - group trips and whole-yacht charters for clients are our sweet spot. Tell me the destination, rough dates, and headcount and the team will hold space. Which region - Komodo or Raja Ampat?"
    };
  }

  if (has("refer operators", "refer an operator", "operator intro", "introduce operators", "introduce an operator", "bring operators", "refer boats", "refer a boat", "know an operator", "recommend an operator")) {
    return {
      reply:
        "Love it - if you know operators who'd be a good fit, send them our way. There may be a referral for operator intros; the team confirms the terms, so I won't quote a number. Who've you got, and your best email?"
    };
  }

  if (has("how do i refer", "how does referring", "how do i send them", "how do i share my link", "how do i recommend", "referral flow", "how does it work for me", "how do i get them to book", "how do i pass")) {
    return {
      reply:
        "Simple: share your tracked link, your client books direct at the operator's own rate, and you're credited automatically - no codes to chase, 60-day window. Want your claim link so the tracked link goes live? Company, market, and best email."
    };
  }

  if (has("book for a client", "book a trip for", "on behalf", "book now", "dates are set")) {
    return {
      reply:
        "Let's do it - treat it like any trip brief, credited to you. Komodo or Raja Ampat? Then dates and group size, and I'll line up the right boat. The team makes sure it's attributed to your outfit."
    };
  }

  if (has("minimum volume", "minimum bookings", "how many clients", "volume requirement", "minimum to join", "quota", "how many do i need", "minimum spend", "minimum number")) {
    return {
      reply:
        "No minimum - one client a year or a hundred, you're welcome. Founding partners lock their terms early regardless of size. Company, market, and best email?"
    };
  }

  if (
    has(
      "no clients", "just starting", "just started", "new creator", "small audience",
      "small following", "building my audience", "no bookings", "haven't booked",
      "havent booked", "growing my",
    )
  ) {
    return {
      reply:
        "Creators are first-class here - no client list needed to start. Your tracked link plus our co-brandable impact assets do the selling, and the operator side funds your commission, so there's nothing to front. Your handle, audience size, and best email?"
    };
  }

  if (has("what support", "help me set up", "onboarding help", "hand-hold", "help getting started", "partner manager", "account manager", "training", "do you help me", "someone to help", "support do i get")) {
    return {
      reply:
        "You're not on your own - the team helps you claim, set up your tracked link and assets, and get your first bookings moving. Founding partners get the closest hand. Want to start? Company, market, and best email."
    };
  }

  if (has("go live", "how soon can i", "how fast can i", "when can i start", "up and running", "start today", "how long to set up", "live immediately", "start right away")) {
    return {
      reply:
        "Fast - claiming is one click on a magic link, and your tracked link goes live the moment you confirm your email. Company, market, and best email and you're off?"
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
      "Then we built this for you: a tracked link and a catalogue of vetted Indonesian liveaboards. Your client pays the operator's own rate - never marked up - and your commission comes from the operator's side, not your client's pocket. Shop, agency, or creator?"
  };
}
