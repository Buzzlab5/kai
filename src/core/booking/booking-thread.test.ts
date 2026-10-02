import { describe, expect, it } from "vitest";
import { describePendingBookingStep } from "./booking-thread";
import type { BookingMemoryState } from "./booking-memory";

const base: BookingMemoryState = {
  productExternalId: "whale",
  productTitle: "Gold Coast Whale Escape",
  dateText: "2027-06-28",
  guests: 3,
  bookingStatus: "AVAILABILITY_CHECKED"
};
const times = [
  { label: "9:00 AM", startTimeLocal: "2027-06-28 09:00:00", remaining: 40 },
  { label: "1:30 PM", startTimeLocal: "2027-06-28 13:30:00", remaining: 22 }
];
const tickets = [
  { label: "Adult", unitPriceCents: 7900 },
  { label: "Child (3-13)", unitPriceCents: 5900 }
];

describe("describePendingBookingStep", () => {
  it("reminds about the time when the times are on screen", () => {
    expect(describePendingBookingStep({ ...base, timeOptions: times })).toBe(
      "When you're ready, just pick a time for Monday 28 June 2027: 9:00 AM or 1:30 PM."
    );
  });

  it("moves on to tickets once a time is picked", () => {
    expect(describePendingBookingStep({ ...base, dateText: "2027-06-28 13:30:00", timeOptions: times, ticketOptions: tickets })).toBe(
      "When you're ready, just tell me which tickets you'd like: Adult or Child (3-13)."
    );
  });

  it("asks about extras once the tickets are sorted", () => {
    expect(
      describePendingBookingStep({
        ...base,
        ticketOptions: tickets,
        ticketQuantities: [{ optionLabel: "Adult", quantity: 3 }],
        extraOptions: [{ label: "Sparkling for 2", unitPriceCents: 4000 }],
        extraQuantities: null
      })
    ).toBe("When you're ready, just tell me if you'd like any extras, or say no extras.");
  });

  it("lists only the contact details still missing", () => {
    expect(
      describePendingBookingStep({
        ...base,
        ticketOptions: tickets,
        ticketQuantities: [{ optionLabel: "Adult", quantity: 3 }],
        extraQuantities: [],
        travellerName: "Maya Chen"
      })
    ).toBe("When you're ready, I just need your email and phone number to finish the booking.");
  });

  it("stays quiet when nothing is pending or the booking is already past Kai", () => {
    expect(describePendingBookingStep(null)).toBeNull();
    expect(describePendingBookingStep({ ...base, productTitle: null })).toBeNull();
    expect(describePendingBookingStep(base)).toBeNull();
    expect(describePendingBookingStep({ ...base, timeOptions: times, bookingStatus: "PAYMENT_PENDING" })).toBeNull();
  });
});
