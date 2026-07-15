// BluePass market + region gate. Kai now serves two markets - Australia and
// Indonesia - and asks country then region BEFORE the persona pitch, so every
// downstream reply can speak to the traveller/operator/partner's actual waters.

export type BluePassMarket = "AUSTRALIA" | "INDONESIA";

// Region-selection lists per market. Indonesia is Komodo/Raja Ampat live (more
// coming); Australia launches across the whole coast.
export const BLUEPASS_REGIONS: Record<BluePassMarket, readonly string[]> = {
  INDONESIA: ["Komodo", "Raja Ampat"],
  AUSTRALIA: [
    "Great Barrier Reef",
    "Whitsundays",
    "Ningaloo Reef",
    "Gold Coast",
    "Sydney",
    "Byron Bay",
    "Tasmania",
    "Rottnest & Perth"
  ]
};

// Signal -> market. A region or place name implies its country, so "I want
// Komodo" or "we're in Cairns" also settles the market and can skip the gate.
const marketSignals: Array<{ market: BluePassMarket; needles: string[] }> = [
  {
    market: "AUSTRALIA",
    needles: [
      "australia", "australian", "aussie", "great barrier", "gbr", "whitsunday",
      "ningaloo", "exmouth", "gold coast", "sydney", "byron", "cairns",
      "port douglas", "perth", "rottnest", "tasmania", "tassie", "brisbane",
      "queensland", "airlie"
    ]
  },
  {
    market: "INDONESIA",
    needles: [
      "indonesia", "indonesian", "komodo", "raja ampat", "raja", "bali",
      "labuan bajo", "lombok", "gili", "flores", "sorong", "lembeh", "sulawesi"
    ]
  }
];

// Region aliases -> canonical region name, grouped by market.
const regionAliases: Record<BluePassMarket, Array<{ region: string; needles: string[] }>> = {
  AUSTRALIA: [
    { region: "Great Barrier Reef", needles: ["great barrier", "gbr", "cairns", "port douglas"] },
    { region: "Whitsundays", needles: ["whitsunday", "airlie"] },
    { region: "Ningaloo Reef", needles: ["ningaloo", "exmouth"] },
    { region: "Gold Coast", needles: ["gold coast"] },
    { region: "Sydney", needles: ["sydney"] },
    { region: "Byron Bay", needles: ["byron"] },
    { region: "Tasmania", needles: ["tasmania", "tassie", "hobart"] },
    { region: "Rottnest & Perth", needles: ["rottnest", "perth"] }
  ],
  INDONESIA: [
    { region: "Komodo", needles: ["komodo", "labuan bajo", "flores"] },
    { region: "Raja Ampat", needles: ["raja ampat", "raja", "sorong"] }
  ]
};

function firstIndexOfAny(haystack: string, needles: string[]): number {
  let best = -1;
  for (const needle of needles) {
    const idx = haystack.indexOf(needle);
    if (idx !== -1 && (best === -1 || idx < best)) best = idx;
  }
  return best;
}

/**
 * First market signal locks it (oldest message first). Within one message, the
 * earliest-appearing keyword wins, so "in Australia, eyeing Komodo later" =
 * AUSTRALIA. Returns "UNKNOWN" until a signal appears.
 */
export function classifyBluePassMarket(messages: string[]): BluePassMarket | "UNKNOWN" {
  for (const message of messages) {
    const text = message.toLowerCase();
    let winner: BluePassMarket | "UNKNOWN" = "UNKNOWN";
    let winnerIdx = -1;
    for (const { market, needles } of marketSignals) {
      const idx = firstIndexOfAny(text, needles);
      if (idx !== -1 && (winnerIdx === -1 || idx < winnerIdx)) {
        winner = market;
        winnerIdx = idx;
      }
    }
    if (winner !== "UNKNOWN") return winner;
  }
  return "UNKNOWN";
}

/**
 * Within a known market, resolve the region the traveller/operator names.
 * Returns the canonical region string or null if none is mentioned yet.
 */
export function classifyBluePassRegion(market: BluePassMarket, messages: string[]): string | null {
  for (const message of messages) {
    const text = message.toLowerCase();
    let region: string | null = null;
    let regionIdx = -1;
    for (const { region: canonical, needles } of regionAliases[market]) {
      const idx = firstIndexOfAny(text, needles);
      if (idx !== -1 && (regionIdx === -1 || idx < regionIdx)) {
        region = canonical;
        regionIdx = idx;
      }
    }
    if (region) return region;
  }
  return null;
}

// ─── Gate copy ────────────────────────────────────────────────────────────────

/** Step 1 - the very first thing Kai asks: which country. */
export function buildBluePassMarketGreeting(): string {
  return "Hey - Kai here, the BluePass ocean concierge. First up so I point you the right way: are you in Australia or Indonesia?";
}

/**
 * Market-aware "where we're live" sentence for the persona pitch. Defaults to
 * Indonesia (the established market) when the market is not yet known.
 */
export function bluePassRegionsPitch(market?: BluePassMarket): string {
  if (market === "AUSTRALIA") {
    return "In Australia we're live across the Great Barrier Reef, Whitsundays, Ningaloo and more - the best reef and coast the country has, through one link.";
  }
  return "We're Indonesia-first, with Komodo and Raja Ampat live now and more waters coming - two of the best reef destinations on the planet, through one link.";
}

/** Market-aware descriptor for the operator catalogue ("vetted X operators"). */
export function bluePassOperatorsDescriptor(market?: BluePassMarket): string {
  if (market === "AUSTRALIA") return "vetted Australian reef and charter operators";
  return "vetted Indonesian liveaboards";
}

export type BluePassGateStep = "MARKET" | "REGION" | "READY";

export type BluePassGate = {
  step: BluePassGateStep;
  market: BluePassMarket | null;
  region: string | null;
  /** The next question to ask, or null once READY (proceed to the persona flow). */
  prompt: string | null;
};

/**
 * The hard country -> region gate as a pure state machine. The server flow
 * calls this with the conversation so far, BEFORE the persona pitch:
 *   - market unknown  -> ask "Australia or Indonesia?" (step MARKET)
 *   - market known, region unknown -> ask the region for that coast (step REGION)
 *   - both known      -> READY; pass `market` into buildBluePassOperator/PartnerReply.
 * A place name (e.g. "Cairns", "Komodo") settles both at once and skips ahead.
 */
export function resolveBluePassGate(messages: string[]): BluePassGate {
  const market = classifyBluePassMarket(messages);
  if (market === "UNKNOWN") {
    return { step: "MARKET", market: null, region: null, prompt: buildBluePassMarketGreeting() };
  }
  const region = classifyBluePassRegion(market, messages);
  if (!region) {
    return { step: "REGION", market, region: null, prompt: buildBluePassRegionPrompt(market) };
  }
  return { step: "READY", market, region, prompt: null };
}

/** Step 2 - once the market is known, ask which region, listing that market's coast. */
export function buildBluePassRegionPrompt(market: BluePassMarket): string {
  const regions = BLUEPASS_REGIONS[market];
  const last = regions[regions.length - 1];
  const list =
    regions.length <= 2
      ? regions.join(" or ")
      : `${regions.slice(0, -1).join(", ")}, or ${last}`;
  if (market === "AUSTRALIA") {
    return `Australia - welcome. Which stretch of coast are you on: ${list}?`;
  }
  return `Indonesia it is. Komodo and Raja Ampat are live, more waters coming - which one: ${list}?`;
}
