import { describe, expect, it } from "vitest";
import { evaluateSettlement, findBookingsReadyToSettle, parseAttemptTravelDate } from "./rules";

describe("parseAttemptTravelDate", () => {
  it("parses Rezdy's structured session time", () => {
    expect(parseAttemptTravelDate("2026-06-26 13:30:00")).toEqual(new Date("2026-06-26T13:30:00Z"));
  });

  it("parses a structured session time with a T separator", () => {
    expect(parseAttemptTravelDate("2026-06-26T13:30:00")).toEqual(new Date("2026-06-26T13:30:00Z"));
  });

  it("parses a bare date as end-of-day", () => {
    expect(parseAttemptTravelDate("2026-06-26")).toEqual(new Date("2026-06-26T23:59:59Z"));
  });

  it("returns null for an unresolved relative word", () => {
    expect(parseAttemptTravelDate("tomorrow")).toBeNull();
    expect(parseAttemptTravelDate("today")).toBeNull();
    expect(parseAttemptTravelDate("tonight")).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(parseAttemptTravelDate("")).toBeNull();
    expect(parseAttemptTravelDate("next Saturday")).toBeNull();
  });
});

describe("evaluateSettlement", () => {
  const now = new Date("2026-08-10T00:00:00Z");

  it("is due when the travel date has passed", () => {
    const decision = evaluateSettlement({ attemptId: "a1", dateText: "2026-06-26 13:30:00" }, now);
    expect(decision.due).toBe(true);
    expect(decision.travelDate).toEqual(new Date("2026-06-26T13:30:00Z"));
  });

  it("is not due when the travel date is in the future", () => {
    const decision = evaluateSettlement({ attemptId: "a2", dateText: "2026-12-25 09:00:00" }, now);
    expect(decision.due).toBe(false);
    expect(decision.travelDate).toEqual(new Date("2026-12-25T09:00:00Z"));
  });

  it("is not due when the travel date can't be resolved, never a false positive", () => {
    const decision = evaluateSettlement({ attemptId: "a3", dateText: "tomorrow" }, now);
    expect(decision.due).toBe(false);
    expect(decision.travelDate).toBeNull();
  });

  it("is due exactly at the travel instant (inclusive boundary)", () => {
    const decision = evaluateSettlement({ attemptId: "a4", dateText: "2026-08-10 00:00:00" }, now);
    expect(decision.due).toBe(true);
  });
});

describe("findBookingsReadyToSettle", () => {
  it("filters a batch to only the ones due, preserving order", () => {
    const now = new Date("2026-08-10T00:00:00Z");
    const candidates = [
      { attemptId: "past", dateText: "2026-06-26 13:30:00" },
      { attemptId: "future", dateText: "2026-12-25 09:00:00" },
      { attemptId: "unparseable", dateText: "tomorrow" },
      { attemptId: "past-2", dateText: "2026-01-01" },
    ];

    expect(findBookingsReadyToSettle(candidates, now).map((c) => c.attemptId)).toEqual(["past", "past-2"]);
  });

  it("returns an empty array when nothing is due", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const candidates = [{ attemptId: "future", dateText: "2026-12-25 09:00:00" }];
    expect(findBookingsReadyToSettle(candidates, now)).toEqual([]);
  });
});
