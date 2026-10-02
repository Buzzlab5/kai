/**
 * How many people a traveller means, from the everyday ways they say it: "8 guests", "four
 * people", "2 of us", "2 adults and 2 kids", "just me", "my partner and I". Shared by the BluePass
 * marketplace flow and the operator booking flow so both understand the same phrasing.
 */
const guestNumberWords: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12
};
const guestCount = "(\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";

function toGuestNumber(value: string) {
  return guestNumberWords[value.toLowerCase()] ?? Number(value);
}

export function extractGuestCount(text: string): number | undefined {
  const explicit = text.match(new RegExp(`\\b${guestCount}\\s*(?:guests?|people|pax|travell?ers?|persons?)\\b`, "i"));
  if (explicit) return toGuestNumber(explicit[1]);

  // "one of us" is usually about someone ("one of us can't swim"), not the group size.
  const ofUs = text.match(new RegExp(`\\b${guestCount}\\s+of\\s+us\\b`, "i"));
  if (ofUs && ofUs[1].toLowerCase() !== "one" && ofUs[1] !== "1") return toGuestNumber(ofUs[1]);

  // Adults set the headcount; kids on their own ("we have 2 kids") don't, since the adults are unknown.
  const adults = text.match(new RegExp(`\\b${guestCount}\\s+adults?\\b`, "i"));
  if (adults) {
    const children = text.match(new RegExp(`\\b${guestCount}\\s+(?:kids?|children|child)\\b`, "i"));
    return toGuestNumber(adults[1]) + (children ? toGuestNumber(children[1]) : 0);
  }

  // "for 2", "table for four": a bare number after "for", unless it's clearly something else ("for 3
  // nights", "for 10am", "for 12 June", "for 20 bucks", "for 5 year olds", "for 2 cabins"). "For one"
  // is left out because it's usually a pronoun ("looking for one with a spa"), and anything over 40
  // reads as a price rather than a group.
  const forCount = text.match(
    new RegExp(
      `\\bfor\\s+${guestCount}\\b(?!\\s*(?:nights?|days?|hours?|hrs?|weeks?|months?|mins?|minutes?|years?|yrs?|y\\.?o\\b|o'?clock|am\\b|pm\\b|dollars?|bucks|aud|usd|rupiah|dives?|tanks?|cabins?|rooms?|beds?|berths?|[:./$-]|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))`,
      "i"
    )
  );
  const forGuests = forCount && !/^(?:one|1)$/i.test(forCount[1]) ? toGuestNumber(forCount[1]) : undefined;
  if (forGuests && forGuests <= 40) return forGuests;

  if (/\b(?:just me|only me|by myself|on my own|travell?ing solo)\b/i.test(text)) return 1;
  if (
    /\b(?:me and my (?:partner|wife|husband|girlfriend|boyfriend|fianc[eé]e?|mate)|my (?:partner|wife|husband|girlfriend|boyfriend|fianc[eé]e?|mate) and (?:i|me))\b/i.test(
      text
    ) &&
    !/\b(?:kids?|children|child|family|friends)\b/i.test(text)
  ) {
    return 2;
  }

  return undefined;
}
