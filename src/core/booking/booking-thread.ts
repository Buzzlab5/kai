import type { BookingMemoryState } from "./booking-memory";
import { friendlyDate } from "./friendly-date";

/**
 * Where a half-finished booking is up to, as one line Kai can add after answering a side question
 * ("will I get seasick?" while it's waiting on a time), so the traveller never has to scroll back to
 * work out what's next. Only stages Kai can read with certainty get a line; anything else gets none.
 */
export function describePendingBookingStep(memory: BookingMemoryState | null | undefined): string | null {
  if (!memory?.productTitle) return null;
  if (memory.bookingStatus && !["DRAFT", "AVAILABILITY_CHECKED"].includes(memory.bookingStatus)) return null;

  const timeOptions = memory.timeOptions ?? [];
  const timeChosen = timeOptions.some((option) => option.startTimeLocal === memory.dateText);
  if (timeOptions.length > 1 && !timeChosen && memory.dateText && /^\d{4}-\d{2}-\d{2}$/.test(memory.dateText)) {
    return `When you're ready, just pick a time for ${friendlyDate(memory.dateText)}: ${formatList(
      timeOptions.map((option) => option.label),
      "or"
    )}.`;
  }

  const ticketOptions = memory.ticketOptions ?? [];
  const ticketsChosen = Boolean(memory.ticketQuantities?.length);
  if (ticketOptions.length > 1 && !ticketsChosen) {
    return `When you're ready, just tell me which tickets you'd like: ${formatList(
      ticketOptions.map((option) => option.label),
      "or"
    )}.`;
  }

  if (ticketsChosen && memory.extraOptions?.length && memory.extraQuantities == null) {
    return "When you're ready, just tell me if you'd like any extras, or say no extras.";
  }

  // Contact details are only asked for once the tickets are sorted, or once the traveller has started
  // giving them, so a missing email before then isn't a pending step yet.
  const contactStarted = ticketsChosen || Boolean(memory.travellerName || memory.travellerEmail || memory.travellerPhone);
  const missingContact = [
    memory.travellerName ? null : "name",
    memory.travellerEmail ? null : "email",
    memory.travellerPhone ? null : "phone number"
  ].filter((field): field is string => Boolean(field));
  if (contactStarted && missingContact.length > 0) {
    return `When you're ready, I just need your ${formatList(missingContact, "and")} to finish the booking.`;
  }

  return null;
}

function formatList(values: string[], joiner: "and" | "or") {
  return values.length <= 1 ? values.join("") : `${values.slice(0, -1).join(", ")} ${joiner} ${values[values.length - 1]}`;
}
