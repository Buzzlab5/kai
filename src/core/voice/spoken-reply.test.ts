import { describe, expect, it } from "vitest";
import { toSpokenReply } from "./spoken-reply";

describe("toSpokenReply", () => {
  it("drops links nobody can tap mid-call", () => {
    const spoken = toSpokenReply(
      "Alila Purnama is a Legend phinisi in Komodo. Details: https://bluepass.co/yachts/alila-purnama"
    );

    expect(spoken).toBe("Alila Purnama is a Legend phinisi in Komodo.");
    expect(spoken).not.toContain("http");
  });

  it("reads a numbered list as sentences", () => {
    const spoken = toSpokenReply(
      [
        "Here are a few good options in Komodo:",
        "1. Alila Purnama - Legend in Komodo, 5 cabins. Details: https://bluepass.co/yachts/alila-purnama",
        "2. Alexa - Premium in Komodo, 1 cabin. Details: https://bluepass.co/yachts/alexa"
      ].join("\n")
    );

    expect(spoken).toBe(
      "Here are a few good options in Komodo: Alila Purnama, Legend in Komodo, 5 cabins. Alexa, Premium in Komodo, 1 cabin."
    );
  });

  it("says prices the way a person would", () => {
    expect(toSpokenReply("There are 40 seats at A$79 per guest.")).toBe("There are 40 seats at 79 Australian dollars per guest.");
    expect(toSpokenReply("From USD 3,000 per cabin.")).toBe("From 3,000 US dollars per cabin.");
    expect(toSpokenReply("Around IDR 250,000 each.")).toBe("Around 250,000 rupiah each.");
    expect(toSpokenReply("It's US$185 per person.")).toBe("It's 185 US dollars per person.");
  });

  it("leaves an ordinary answer alone", () => {
    const reply = "Komodo's main liveaboard season is April to November, when it's dry and the seas are calmer.";

    expect(toSpokenReply(reply)).toBe(reply);
  });
});
