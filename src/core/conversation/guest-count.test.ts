import { describe, expect, it } from "vitest";
import { extractGuestCount } from "./guest-count";

describe("extractGuestCount", () => {
  it.each([
    ["8 guests", 8],
    ["four people", 4],
    ["there are 3 of us", 3],
    ["2 adults and 2 kids", 4],
    ["just me", 1],
    ["me and my partner", 2],
    ["can you check the whale watch for 2 tomorrow?", 2],
    ["a table for four on Saturday", 4],
    ["private charter for 12 in July", 12]
  ])("reads %j as %i", (text, expected) => {
    expect(extractGuestCount(text)).toBe(expected);
  });

  it.each([
    "we'd like it for 3 nights",
    "can we go for 2 weeks?",
    "is it on for 10 am?",
    "looking for 12 June",
    "is it good for 5 year olds?",
    "have you got anything for 2 cabins?",
    "we want to go for 3 dives",
    "looking for one with a spa",
    "anything for 200?",
    "one of us can't swim",
    "we have 2 kids"
  ])("doesn't read a group size into %j", (text) => {
    expect(extractGuestCount(text)).toBeUndefined();
  });
});
