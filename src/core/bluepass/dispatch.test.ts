import { describe, expect, it } from "vitest";
import { buildBluePassDispatchText } from "./dispatch";

describe("buildBluePassDispatchText", () => {
  it("builds an operator WhatsApp inquiry text without confirming booking", () => {
    const text = buildBluePassDispatchText({
      inquiryId: "inquiry_1",
      selectedYachtName: "Alila Purnama",
      travellerName: "Maya Chen",
      travellerPhone: "+61 400 111 222",
      destination: "Komodo",
      dateWindow: "next month",
      guests: 8,
      budget: "USD 10000",
      referralCode: "CREATOR42"
    });

    expect(text).toContain("BluePass inquiry inquiry_1");
    expect(text).toContain("Alila Purnama");
    expect(text).toContain("Maya Chen");
    expect(text).toContain("operator confirmation required");
    expect(text).not.toMatch(/confirmed booking/i);
  });

  it("keeps the dispatch template clean: no emoji, only honest percentages, operator-truth", () => {
    const text = buildBluePassDispatchText({
      inquiryId: "inquiry_2",
      selectedYachtName: "Sea Dragon",
      travellerName: "Tony",
      travellerPhone: "+62812",
      destination: "Komodo",
      dateWindow: "March",
      guests: 6,
      budget: "USD 8000"
    });
    expect(/\p{Extended_Pictographic}/u.test(text), `emoji in dispatch: ${text}`).toBe(false);
    // Kai's own dispatch copy states NO percentage at all (non-vacuous: clean inputs carry none).
    expect(text.includes("%"), `dispatch copy introduced a %: ${text}`).toBe(false);
    // Even when a traveller's budget carries a % ("10% deposit"), the ONLY % is that echoed
    // user value - Kai's template adds none of its own.
    const withPct = buildBluePassDispatchText({
      inquiryId: "inquiry_3",
      selectedYachtName: "Sea Dragon",
      travellerName: "Tony",
      travellerPhone: "+62812",
      destination: "Komodo",
      guests: 6,
      budget: "10% deposit"
    });
    expect(withPct.replace("10% deposit", "").includes("%"), `template % leaked: ${withPct}`).toBe(false);
    expect(text.toLowerCase()).toContain("operator confirmation required before booking");
  });
});
