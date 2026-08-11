import { describe, expect, it } from "vitest";
import { buildCardDeclineReply, containsCardShapedInput, redactCardShapedInput } from "./card-detection";

describe("containsCardShapedInput", () => {
  it("detects a real (Luhn-valid) card number, spaced or not", () => {
    expect(containsCardShapedInput("My card is 4111 1111 1111 1111, exp 04/29, cvv 123")).toBe(true);
    expect(containsCardShapedInput("4111111111111111")).toBe(true);
    expect(containsCardShapedInput("card: 4111-1111-1111-1111")).toBe(true);
  });

  it("does not false-positive on a long booking reference or phone number", () => {
    // Not Luhn-valid, and no CVV/expiry alongside it.
    expect(containsCardShapedInput("My booking reference is 1234567890123456")).toBe(false);
    expect(containsCardShapedInput("call me on 6285337210180")).toBe(false);
  });

  it("catches a CVV alongside an expiry date even without a card number in the same message", () => {
    expect(containsCardShapedInput("cvv 123, expiry 04/29")).toBe(true);
  });

  it("does not flag ordinary conversation with no card-shaped content", () => {
    expect(containsCardShapedInput("2 guests, Saturday 15 August")).toBe(false);
    expect(containsCardShapedInput("Where exactly does the 5% go, and who verifies it?")).toBe(false);
  });

  it("buildCardDeclineReply says the data was not stored", () => {
    expect(buildCardDeclineReply().toLowerCase()).toContain("didn't save");
  });
});

describe("redactCardShapedInput", () => {
  it("redacts a real card number and CVV, leaving the rest of the message intact", () => {
    const redacted = redactCardShapedInput("Fine, book it. My card is 4111 1111 1111 1111, exp 04/29, cvv 123.");
    expect(redacted).not.toContain("4111");
    expect(redacted).not.toContain("123");
    expect(redacted).toContain("[card number redacted]");
    expect(redacted).toContain("[cvv redacted]");
    expect(redacted).toContain("Fine, book it.");
  });

  it("leaves an unrelated message completely unchanged", () => {
    const message = "2 guests, Saturday 15 August";
    expect(redactCardShapedInput(message)).toBe(message);
  });
});
