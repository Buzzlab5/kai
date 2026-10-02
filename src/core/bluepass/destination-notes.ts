import { isRegionMentioned } from "./intent";

/**
 * What Kai knows about the places travellers ask about: when to go, what each place is best for,
 * and where trips leave from. This is knowledge, not inventory, so Kai can answer "best time for
 * Ningaloo?" or "Reef or Whitsundays?" even before BluePass lists boats there. General guidance in
 * Kai's voice; kai-persona.test.ts lints every line.
 */
export interface BluePassDestinationNote {
  name: string;
  /** How Kai names it mid-sentence: "the Great Barrier Reef", "Komodo". */
  displayName: string;
  market: "AUSTRALIA" | "INDONESIA";
  pattern: RegExp;
  /** A looser name ("the Reef") that only counts when no place in the other country is named. */
  contextualPattern?: RegExp;
  season: string;
  bestFor: string;
  gateway: string;
  /** Local stinger know-how, where it differs from the tropical Queensland answer. */
  stingers?: string;
}

export const bluePassDestinationNotes: BluePassDestinationNote[] = [
  {
    name: "Great Barrier Reef",
    displayName: "the Great Barrier Reef",
    market: "AUSTRALIA",
    pattern: /\b(?:great\s+barrier(?:\s+reef)?|gbr|cairns|port\s+douglas|ribbon\s+reefs?|osprey\s+reef|coral\s+sea)\b/i,
    contextualPattern: /\bthe\s+reef\b/i,
    season:
      "The Reef is good year-round. June to October is the pick, dry and calm with clear water, and it's when dwarf minke whales visit the Ribbon Reefs in June and July. November to May is warmer and wetter, and it's stinger season, so boats hand out stinger suits.",
    bestFor: "big-name reef diving and snorkelling, on day trips or liveaboards",
    gateway: "Cairns or Port Douglas"
  },
  {
    name: "Whitsundays",
    displayName: "the Whitsundays",
    market: "AUSTRALIA",
    pattern: /\b(?:whitsundays?|airlie(?:\s+beach)?|whitehaven|hamilton\s+island|hook\s+island)\b/i,
    season:
      "The Whitsundays are good year-round, and August to October is the sweet spot: dry, warm and the trade winds ease off. Humpbacks come through from about July to September.",
    bestFor: "sailing between islands, calm anchorages and Whitehaven Beach, with reef days on the side",
    gateway: "Airlie Beach"
  },
  {
    name: "Ningaloo",
    displayName: "Ningaloo",
    market: "AUSTRALIA",
    pattern: /\b(?:ningaloo|exmouth|coral\s+bay)\b/i,
    season:
      "Whale sharks are on Ningaloo from about March to July, humpbacks from July to October, and manta rays are around all year. Mornings out of Exmouth and Coral Bay are usually the calmest.",
    bestFor: "swimming with whale sharks and snorkelling a reef that starts right off the beach",
    gateway: "Exmouth or Coral Bay"
  },
  {
    name: "Hervey Bay",
    displayName: "Hervey Bay",
    market: "AUSTRALIA",
    pattern: /\b(?:hervey\s+bay|k'?gari|fraser\s+island)\b/i,
    season:
      "Hervey Bay is one of the best places in the world to see humpbacks, roughly late July to early November, when mums and calves rest in the calm water of the bay.",
    bestFor: "close-up humpback whale watching in calm, sheltered water",
    gateway: "Hervey Bay"
  },
  {
    name: "Gold Coast",
    displayName: "the Gold Coast",
    market: "AUSTRALIA",
    pattern: /\b(?:gold\s+coast|surfers\s+paradise|southport|broadwater)\b/i,
    season:
      "Whale season on the Gold Coast runs roughly June to November as humpbacks pass by on their migration, and the rest of the year is great for cruising the Broadwater and the coast.",
    bestFor: "whale watching, day cruises and private charters close to the city",
    gateway: "the Gold Coast",
    stingers:
      "Box jellyfish and Irukandji are a tropical north Queensland thing, so they're rarely an issue on the Gold Coast. Bluebottles can wash in on summer north-easterlies, though, and the crew will let you know if they're about."
  },
  {
    name: "Komodo",
    displayName: "Komodo",
    market: "INDONESIA",
    pattern: /\b(?:komodo|labuan\s+bajo|flores|padar|rinca)\b/i,
    season:
      "Komodo's main liveaboard season is April to November, when it's dry and the seas are calmer. Mantas are around all year and tend to peak in the wetter months, from about December to February.",
    bestFor: "dragons, dramatic islands and mantas, on shorter liveaboards",
    gateway: "Labuan Bajo"
  },
  {
    name: "Raja Ampat",
    displayName: "Raja Ampat",
    market: "INDONESIA",
    pattern: /\b(?:raja\s+ampat|misool|wayag|sorong|dampier\s+strait)\b/i,
    season:
      "Raja Ampat is best from about October to April, when the seas are calmest. June to September gets windier, and many liveaboards head elsewhere for those months.",
    bestFor: "the richest reefs on the planet and longer, more remote liveaboards",
    gateway: "Sorong"
  }
];

// Hand-written for the comparisons travellers ask most, with an honest steer. Keyed by the two
// note names in alphabetical order.
const pairComparisons: Record<string, string> = {
  "Komodo|Raja Ampat":
    "Both are brilliant, just different trips. Komodo is easier to reach from Labuan Bajo, with dragons, dramatic islands and mantas on shorter liveaboards. Raja Ampat is more remote, out of Sorong, with the richest reefs on the planet and longer trips. For a first liveaboard, I'd start with Komodo.",
  "Great Barrier Reef|Whitsundays":
    "The Reef is the one for diving and snorkelling, with day trips and liveaboards out of Cairns and Port Douglas. The Whitsundays are more about sailing between islands and Whitehaven Beach, with reef days on the side. Divers usually pick the Reef, while sailors and families tend to love the Whitsundays.",
  "Great Barrier Reef|Ningaloo":
    "The Great Barrier Reef is bigger and better known, with day trips and liveaboards out of Cairns and Port Douglas. Ningaloo is quieter and wilder, and it's the place to swim with whale sharks from about March to July, a short boat ride from the beach. If whale sharks are on the list, Ningaloo wins."
};

export function findDestinationNote(value: string): BluePassDestinationNote | null {
  return bluePassDestinationNotes.find((note) => note.pattern.test(value)) ?? null;
}

/**
 * Every destination named in the text, in the order mentioned: Kai's known places (under the
 * catalogue's own name when the catalogue has them) plus any other catalogue region.
 */
export function findMentionedDestinations(text: string, knownRegions: string[] = []): string[] {
  const found: Array<{ name: string; index: number; market: string }> = [];
  const catalogNameFor = (note: BluePassDestinationNote) =>
    knownRegions.find((region) => note.pattern.test(region)) ?? note.name;

  for (const note of bluePassDestinationNotes) {
    const match = note.pattern.exec(text);
    if (match) found.push({ name: catalogNameFor(note), index: match.index, market: note.market });
  }

  // "The Reef" means the Great Barrier Reef to an Australian, unless they're talking about Misool.
  for (const note of bluePassDestinationNotes) {
    if (!note.contextualPattern || found.some((entry) => entry.name === catalogNameFor(note))) continue;
    if (found.some((entry) => entry.market !== note.market)) continue;
    const match = note.contextualPattern.exec(text);
    if (match) found.push({ name: catalogNameFor(note), index: match.index, market: note.market });
  }

  for (const region of knownRegions) {
    if (findDestinationNote(region) || !isRegionMentioned(text, region)) continue;
    found.push({ name: region, index: text.toLowerCase().indexOf(region.toLowerCase()), market: "UNKNOWN" });
  }

  return Array.from(new Set(found.sort((a, b) => a.index - b.index).map((entry) => entry.name)));
}

export function buildDestinationSeasonNote(destination: string) {
  return findDestinationNote(destination)?.season ?? null;
}

/**
 * Kai's comparison of two or three places it knows, or null when it doesn't know them all well
 * enough to compare honestly.
 */
export function buildDestinationComparison(destinations: string[]) {
  const notes = Array.from(
    new Map(
      destinations
        .map((destination) => findDestinationNote(destination))
        .filter((note): note is BluePassDestinationNote => Boolean(note))
        .map((note) => [note.name, note])
    ).values()
  ).slice(0, 3);
  if (notes.length < 2 || notes.length < Math.min(destinations.length, 3)) return null;

  if (notes.length === 2) {
    const pair = pairComparisons[notes.map((note) => note.name).sort().join("|")];
    if (pair) return pair;
  }

  const lines = notes.map((note) => `${capitalise(note.displayName)} is best for ${note.bestFor}, out of ${note.gateway}.`);
  return `${lines.join(" ")} Tell me what matters most to you and I'll help you pick.`;
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
