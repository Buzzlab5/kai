import { describe, expect, it } from "vitest";
import { formatDateAndTime, formatDateForSentence, formatDatePhrase, friendlyDate } from "./friendly-date";

describe("friendly dates", () => {
  it("says dates the way a person would", () => {
    expect(friendlyDate("2027-06-28")).toBe("Monday 28 June 2027");
    expect(formatDatePhrase("2026-06-28")).toBe("on Sunday 28 June 2026");
    expect(formatDateAndTime("2026-06-28 13:30:00")).toBe("on Sunday 28 June 2026 at 1:30 PM");
    expect(formatDatePhrase("2026-06-28 09:00:00")).toBe("on Sunday 28 June 2026 at 9:00 AM");
    expect(formatDateForSentence("2026-06-28")).toBe("Sunday 28 June 2026");
  });

  it("keeps the traveller's own relative words", () => {
    expect(formatDatePhrase("tomorrow")).toBe("tomorrow");
    expect(formatDateForSentence("today")).toBe("today");
    expect(formatDatePhrase(null)).toBe("that date");
  });
});
